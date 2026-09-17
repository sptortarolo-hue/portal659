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
	// Si se pidió re-login, limpiar Store.ID para que GetQRChannel
	// emita un QR nuevo (el .db se borró pero el device persistía
	// en memoria, lo que causaba que GetQRChannel devolviera
	// ErrQRStoreContainsID sin emitir QR).
	if *doLogin {
		client.Store.ID = nil
	}
	relay := &relay{cfg: cfg, client: client, container: container, inbound: make(chan inboundMsg, 128), qrOut: make(chan string, 8), stateCh: make(chan string, 64), db: db, ctx: ctx}

	// Registrar el handler principal (mensajes, connected, logged_out): sin
	// esto los *events.Message nunca llegan a onMessage y el bot no responde
	// (el QR funcionaba porque GetQRChannel registra su propio handler interno).
	client.AddEventHandler(relay.onEvent)

	// Conexión al cerebro (VPS) primero — el token autentica y el QR
	// ya puede reenviarse al comercio/ panel aunque aún no haya pareo.
	go relay.outboundLoop(ctx)

	if client.Store.ID == nil {
		log.Printf("sin sesión guardada — emitiendo QR")
		if !relay.login(ctx) {
			stop()
			return
		}
	}

	// Loop común de conexión (para ambas ramas):
	// - Si había sesión guardada: conecta y recibe mensajes.
	// - Si se acaba de parear: el server desconectó el socket tras el
	//   expectDisconnect() del pairing y NO autoreconecta — sin este
	//   Connect() el relay queda "vinculado" pero nunca recibe mensajes
	//   (era el bug de "hola y nada").
	for {
		if ctx.Err() != nil {
			return
		}
		if client.IsConnected() {
			break
		}
		if err := client.Connect(); err != nil {
			if err == whatsmeow.ErrAlreadyConnected {
				break // el socket del pairing quedó vivo: sirve igual
			}
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
	cfg       config
	client    *whatsmeow.Client
	container *sqlstore.Container // para recrear el device cliente tras LoggedOut
	inbound   chan inboundMsg
	qrOut     chan string // se publica vía WS al cerebro
	stateCh   chan string // "linked" / "logged_out" → notify al cerebro
	db        *sql.DB     // para checkpoint post-vinculación
	ctx       context.Context
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
			if err == whatsmeow.ErrQRStoreContainsID {
				// Sesión vigente: conectar directamente sin QR.
				r.client.Disconnect()
				if err := r.client.Connect(); err != nil {
					log.Printf("connect: %v", err)
					time.Sleep(3 * time.Second)
					continue
				}
				if r.client.Store.ID != nil {
					fmt.Println("LINKED=1")
					r.stateCh <- "linked"
					return true
				}
				continue
			}
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
		// Avisar al cerebro que estamos esperando escaneo: el panel quita el
		// "✅ Número vinculado" y vuelve a mostrar la sección del QR.
		select {
		case r.stateCh <- "pairing":
		default:
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
		if linked || r.client.Store.ID != nil {
			fmt.Println("LINKED=1")
			_, _ = r.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)") // persistir identidad en Android
			r.stateCh <- "linked"
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
		// La sesión se cerró desde WhatsApp: hay que re-escanear el QR.
		// NOTIFICAR al cerebro (status='unlinked') y re-parear automáticamente.
		r.stateCh <- "logged_out"
		// El store actual quedó en estado Deleted (NoopStore) — no sirve para
		// nada más. Recrear el client con un device fresco para el re-paireo.
		r.client.Disconnect()
		device := r.container.NewDevice()
		r.client = whatsmeow.NewClient(device, nil)
		r.client.AddEventHandler(r.onEvent)
		go r.login(r.ctx)
	case *events.Disconnected:
		// Corte transitorio de red: whatsmeow auto-reconecta solo
		// (EnableAutoReconnect). Antes hacíamos os.Exit(1) → WhatsApp mostraba
		// "sincronizando / última conexión" cada vez que el proceso moría.
		fmt.Println("DISCONNECTED=1")
	}
}

func (r *relay) onMessage(m *events.Message) {
	if m.Info.IsFromMe || m.Info.IsGroup {
		return
	}
	text := getText(m.Message)
	if text == "" {
		// Llega un mensaje pero sin texto extraíble: loguear el tipo para
		// distinguir en el log de la app "no llega nada" vs "llega sin texto".
		fmt.Printf("INBOUND_EMPTY=%s chat=%s\n", messageType(m.Message), m.Info.Chat.String())
		return
	}
	// JID completo (user@server): hoy los no-contactos llegan como
	// 1346...@lid, y para responder hay que usar el server correcto.
	chatJID := m.Info.Chat.String()
	fmt.Printf("INBOUND=%s len=%d\n", chatJID, len(text))
	r.inbound <- inboundMsg{waID: chatJID, body: text}
}

// getText extrae el texto plano del mensaje, desenvolviendo los wrappers que
// usa WhatsApp multi-device hoy (ephemeral = mensajes temporales, viewOnce,
// deviceSent). Sin esto, "hola" llegaba como EphemeralMessage y se descartaba
// silenciosamente (bot que "no responde").
func getText(msg *waProto.Message) string {
	msg = unwrapMessage(msg)
	if msg == nil {
		return ""
	}
	if s := msg.GetConversation(); s != "" {
		return s
	}
	if s := msg.GetExtendedTextMessage().GetText(); s != "" {
		return s
	}
	// Captions de media (foto/video/documento con caption "puede llevar texto").
	if s := msg.GetImageMessage().GetCaption(); s != "" {
		return s
	}
	if s := msg.GetVideoMessage().GetCaption(); s != "" {
		return s
	}
	if s := msg.GetDocumentMessage().GetCaption(); s != "" {
		return s
	}
	return ""
}

func unwrapMessage(msg *waProto.Message) *waProto.Message {
	if msg == nil {
		return nil
	}
	if e := msg.GetEphemeralMessage(); e != nil {
		return unwrapMessage(e.GetMessage())
	}
	if v := msg.GetViewOnceMessage(); v != nil {
		return unwrapMessage(v.GetMessage())
	}
	if v := msg.GetViewOnceMessageV2(); v != nil {
		return unwrapMessage(v.GetMessage())
	}
	if d := msg.GetDeviceSentMessage(); d != nil {
		return unwrapMessage(d.GetMessage())
	}
	if e := msg.GetEditedMessage(); e != nil {
		return unwrapMessage(e.GetMessage())
	}
	return msg
}

func messageType(msg *waProto.Message) string {
	if msg == nil {
		return "nil"
	}
	switch {
	case msg.GetConversation() != "":
		return "conversation"
	case msg.GetExtendedTextMessage() != nil:
		return "extendedText"
	case msg.GetEphemeralMessage() != nil:
		return "ephemeral"
	case msg.GetViewOnceMessage() != nil:
		return "viewOnce"
	case msg.GetViewOnceMessageV2() != nil:
		return "viewOnceV2"
	case msg.GetDeviceSentMessage() != nil:
		return "deviceSent"
	case msg.GetImageMessage() != nil:
		return "image"
	case msg.GetVideoMessage() != nil:
		return "video"
	case msg.GetAudioMessage() != nil:
		return "audio"
	case msg.GetDocumentMessage() != nil:
		return "document"
	case msg.GetStickerMessage() != nil:
		return "sticker"
	default:
		return "other"
	}
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
		case state := <-r.stateCh:
			if err := conn.WriteJSON(wsOut{Type: state}); err != nil {
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
	// ParseJID respeta el server original: los chats de no-contactos son
	// LID (xxxxx@lid). Hardcodear DefaultUserServer mandaba las respuestas
	// a un destinatario inexistente y WhatsApp las descartaba en silencio.
	jid, err := types.ParseJID(waID)
	if err != nil {
		// Compat: si llegó sin "@server", asumir usuario normal.
		jid = types.NewJID(waID, types.DefaultUserServer)
	}
	_, err = r.client.SendMessage(ctx, jid, &waProto.Message{Conversation: proto.String(text)})
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