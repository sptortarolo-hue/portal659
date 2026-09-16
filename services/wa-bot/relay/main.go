// Portal Wa Link relay — WhatsApp multidevice (whatsmeow) que corre en el APK.
//
// Relay "tonto": mantiene la sesión de WhatsApp en el celular (IP móvil),
// reenvía mensajes entrantes al cerebro (services/wa-bot) por WebSocket y ejecuta
// los envíos que el cerebro le ordene. No conoce la lógica del pedido.
//
// Persistencia con `modernc.org/sqlite` (driver sqlite PURO Go, sin CGO), vía
// sqlstore.NewWithDB: compila con CGO_ENABLED=0 → NO necesita NDK para Android.
//
// Compilar (en la máquina con Go + Android SDK/JDK17):
//   cd services/wa-bot/relay
//   go mod tidy
//   CGO_ENABLED=0 GOOS=android GOARCH=arm64 go build -ldflags="-s -w" -o relay-arm64 .
//   CGO_ENABLED=0 GOOS=android GOARCH=amd64 go build -ldflags="-s -w" -o relay-x86_64 .
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "modernc.org/sqlite" // registra el driver "sqlite" (CGO-free)
	"github.com/gorilla/websocket"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waProto "go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
	"net"
)

// fixAndroidNet: Go compilado para Android no encuentra /etc/resolv.conf ni el
// bundle de CA — hace que los dials fallen con "connection refused" (se veía como
// fallo de WebSocket pero era DNS/TLS). Vermifix: resolver explícito (8.8.8.8,
// public) + sistema de CA de Android (cacerts). %wiki: android dns failure (AndroidP
// doesn't have /etc/resolv.conf: )
// - https://github.com/golang/go/issues/23971 (Android: DNS resolver requires
//   CGO or netdns=go without /etc/resolv.conf → '[::1]:53' → connection refused)
// - https://stackoverflow.com/questions/38959067/dns-lookup-issue-when-running-my-go-app-in-termux
func fixAndroidNet() {
	// (1) Forzar el resolver "puro Go" y dialar el DNS explícito (la rama `Dial`
	// del resolver es la que evita que Go intente abrir /etc/resolv.conf).
	net.DefaultResolver.PreferGo = true
	net.DefaultResolver.Dial = func(_ context.Context, network, addr string) (net.Conn, error) {
		d := net.Dialer{Timeout: 10 * time.Second}
		return d.Dial(network, "8.8.8.8:53")
	}

	// (2) Los certificados system de Android no están en /etc/ssl/certs sino en
	// cacerts. whatsmeow (y gorilla/websocket) los lee desde la var env.
	if _, err := os.Stat("/system/etc/security/cacerts"); err == nil && os.Getenv("SSL_CERT_DIR") == "" {
		_ = os.Setenv("SSL_CERT_DIR", "/system/etc/security/cacerts")
	}
}

type config struct {
	vpsURL     string // p.ej. ws://host:8792/wa
	token      string // vendor_wa_bots.token
	sessionDir string
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	doLogin := flag.Bool("login", false, "borrar sesión y regenerar pairing code")
	sessionDir := flag.String("session", envOr("SESSION_DIR", "./session"), "carpeta de sesión")
	flag.Parse()

	cfg := config{
		vpsURL:     envOr("WABOT_URL", envOr("VPS_WS_URL", "ws://localhost:8792/wa")),
		token:      envOr("WA_TOKEN", ""),
		sessionDir: *sessionDir,
	}

	if err := os.MkdirAll(cfg.sessionDir, 0o700); err != nil {
		log.Fatalf("mkdir session: %v", err)
	}
	dbPath := cfg.sessionDir + "/session.db"
	if *doLogin {
		_ = os.Remove(dbPath)
		_ = os.Remove(dbPath + "-shm")
		_ = os.Remove(dbPath + "-wal")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	fixAndroidNet()

	// Driver "sqlite" de modernc.org (puro Go) + dialect "sqlite3" para dbutil.
	db, err := sql.Open("sqlite", "file:"+dbPath+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		log.Fatalf("sql open: %v", err)
	}
	container := sqlstore.NewWithDB(db, "sqlite3", nil)
	if err := container.Upgrade(ctx); err != nil {
		log.Fatalf("upgrade store: %v", err)
	}

	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		log.Fatalf("device: %v", err)
	}

	client := whatsmeow.NewClient(device, nil)
	relay := &relay{cfg: cfg, client: client, inbound: make(chan inboundMsg, 128), qrOut: make(chan string, 8)}

	// Conexión al cerebro (VPS) primero — el token autentica y el QR
	// ya puede reenviarse al comercio/ panel aunque aún no haya pareo.
	go relay.outboundLoop(ctx)

if client.Store.ID == nil {
		log.Printf("sin sesión guardada — emitiendo QR")
		relay.login(ctx)
	} else {
		// Con sesión ya guardada: reintentar el connect inicial con backoff.
		// Un fallo transitorio NO debe matar el proceso (antes log.Fatalf → la
		// app reiniciaba en loop y quedaba "reconectando" para siempre).
		for {
			if ctx.Err() != nil {
				return
			}
			if err := client.Connect(); err != nil {
				log.Printf("connect (reintentando): %v", err)
				select {
				case <-time.After(2 * time.Second):
				case <-ctx.Done():
					return
				}
				continue
			}
			break
		}
	}

	log.Println("relay whatsmeow corriendo")
	<-ctx.Done()
	client.Disconnect()
	_ = container.Close()
	log.Println("relay detenido")
}

type inboundMsg struct {
	waID string // parte numérica del JID (celular del cliente)
	body string
}

// qrMsg es el mensaje WS del relay → cerebro con el payload del QR (para que
// el comercio lo vea en su panel web y lo escanee con el teléfono).
type qrMsg struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

type relay struct {
	cfg     config
	client  *whatsmeow.Client
	inbound chan inboundMsg
	qrOut   chan string // se publica vía WS al cerebro
}

// login espera el código de pareo/QR y lo imprime a stdout (el wrapper Kotlin lo
// muestra como imagen al dueño). Además --> el QR se reenvía por WEBSOCKET al
// cerebro (para la página /vendor/wa-bot) — así no necesita screencapturear de celular.
func (r *relay) login(ctx context.Context) bool {
	for attempt := 1; ; attempt++ {
		if ctx.Err() != nil {
			return false
		}
		if attempt > 1 {
			// El canal anterior se cerró (timeout/error): reconectar y pedir QR nuevo.
			r.client.Disconnect()
			time.Sleep(2 * time.Second)
		}
		qrChan, err := r.client.GetQRChannel(ctx)
		if err != nil {
			log.Printf("qr (intento %d): %v", attempt, err)
			time.Sleep(3 * time.Second)
			continue
		}
		// QRChannel debe registrarse ANTES de Connect.
		if err := r.client.Connect(); err != nil {
			log.Printf("connect (intento %d): %v", attempt, err)
			time.Sleep(3 * time.Second)
			continue
		}
		linked := false
		for item := range qrChan {
			switch item.Event {
			case "code":
				fmt.Printf("QR_DATA=%s\n", item.Code)
				select {
				case r.qrOut <- item.Code:
				default:
				}
			case "success":
				linked = true
			case "error":
				fmt.Printf("PAIR_ERROR=%v\n", item.Error)
			case "timeout":
				fmt.Println("QR_TIMEOUT=1")
			}
			if linked {
				break
			}
		}
		if linked {
			fmt.Println("LINKED=1")
			return true
		}
		// El canal se cerró sin éxito (timeout/error): reintentar con un QR nuevo.
		log.Printf("reintentando obtener QR (intento %d -> %d)...", attempt, attempt+1)
	}
}

func (r *relay) onEvent(evt any) {
	switch v := evt.(type) {
	case *events.Message:
		r.onMessage(v)
	case *events.Connected:
		fmt.Println("CONNECTED=1")
	case *events.LoggedOut:
		fmt.Println("LOGGED_OUT=1")
		os.Exit(1)
	case *events.Disconnected:
		fmt.Println("DISCONNECTED=1")
	}
}

func (r *relay) onMessage(m *events.Message) {
	if m.Info.IsFromMe || m.Info.IsGroup {
		return
	}
	text := getText(m.Message)
	if text == "" {
		return
	}
	r.inbound <- inboundMsg{waID: m.Info.Chat.User, body: text}
}

func getText(msg *waProto.Message) string {
	if s := msg.GetConversation(); s != "" {
		return s
	}
	if s := msg.GetExtendedTextMessage().GetText(); s != "" {
		return s
	}
	return ""
}

func (r *relay) outboundLoop(ctx context.Context) {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		conn, _, err := websocket.DefaultDialer.Dial(r.wsURL(), nil)
		if err != nil {
			log.Printf("ws dial: %v (reintento en %s)", err, backoff)
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return
			}
			backoff = minDur(backoff*2, 30*time.Second)
			continue
		}
		backoff = time.Second
		log.Println("conectado al cerebro")

		go r.readLoop(ctx, conn)
		r.writeLoop(ctx, conn)
		_ = conn.Close()
	}
}

func (r *relay) wsURL() string {
	if r.cfg.token != "" {
		return r.cfg.vpsURL + "?token=" + r.cfg.token
	}
	return r.cfg.vpsURL
}

type wsOut struct {
	Type string `json:"type"`
	WaID string `json:"wa_id,omitempty"`
	Body string `json:"body,omitempty"`
}

type wsIn struct {
	Type  string `json:"type"`
	WaID  string `json:"wa_id,omitempty"`
	Text  string `json:"text,omitempty"`
	Error string `json:"message,omitempty"`
}

func (r *relay) writeLoop(ctx context.Context, conn *websocket.Conn) {
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-r.inbound:
			if err := conn.WriteJSON(wsOut{Type: "message", WaID: m.waID, Body: m.body}); err != nil {
				return
			}
		case qr := <-r.qrOut:
			if err := conn.WriteJSON(qrMsg{Type: "qr", Data: qr}); err != nil {
				return
			}
		}
	}
}

func (r *relay) readLoop(ctx context.Context, conn *websocket.Conn) {
	for {
		var in wsIn
		if err := conn.ReadJSON(&in); err != nil {
			return
		}
		switch in.Type {
		case "send":
			if in.WaID != "" && in.Text != "" {
				r.sendText(ctx, in.WaID, in.Text)
			}
		case "error", "hello":
			b, _ := json.Marshal(in)
			log.Printf("cerebro: %s", string(b))
		}
	}
}

func (r *relay) sendText(ctx context.Context, waID, text string) {
	jid := types.NewJID(waID, types.DefaultUserServer)
	_, err := r.client.SendMessage(ctx, jid, &waProto.Message{Conversation: proto.String(text)})
	if err != nil {
		log.Printf("send a %s: %v", waID, err)
	}
}

func minDur(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}