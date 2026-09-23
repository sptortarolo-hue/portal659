package ar.portal659.socket;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Base64;

import org.json.JSONObject;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * Servicio en primer plano que mantiene el WebSocket con el relay (print-bridge)
 * EN JAVA, independiente de la WebView. Recibe los jobs, los imprime por TCP 9100
 * y responde el ack. Sobrevive en segundo plano (WakeLock + WifiLock + START_STICKY).
 */
public class PortalPrintService extends Service {
    private static final int NOTIFICATION_ID = 42659;
    private static final String CHANNEL_ID = "portal_print_foreground";
    private static final String PREFS = "portalprint";

    private static final String KEY_SERVER = "serverUrl";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_PRINTER_IP = "printerIp";
    private static final String KEY_PRINTER_PORT = "printerPort";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_CONN = "connStatus";

    private OkHttpClient httpClient;
    private WebSocket webSocket;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean connecting = new AtomicBoolean(false);
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private final ExecutorService printExecutor = Executors.newSingleThreadExecutor();

    @Override
    public void onCreate() {
        super.onCreate();
        httpClient = new OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)      // mantiene vivo el socket
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)   // el WS no tiene read timeout
            .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!running.getAndSet(true)) {
            acquireLocks();
            startForegroundInternal("Portal Print activo", "Manteniendo la conexión con la impresora");
            startLocalServer();
        }
        connectRelay();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running.set(false);
        releaseLocks();
        disconnect();
        stopLocalServer();
        printExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Si el usuario elimina la tarea, el servicio no debe morir.
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---------------------------------------------------------------- locks

    private void acquireLocks() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "portalprint::wake");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "portalprint::wifi");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        } catch (Exception ignored) {}
    }

    private void releaseLocks() {
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
        try { if (wifiLock != null && wifiLock.isHeld()) wifiLock.release(); } catch (Exception ignored) {}
    }

    // ---------------------------------------------------------------- config

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String cfg(String key, String def) {
        return prefs().getString(key, def);
    }

    // ---------------------------------------------------------------- relay WS

    private void connectRelay() {
        if (!running.get() || !prefs().getBoolean(KEY_ENABLED, true)) return;
        String token = cfg(KEY_TOKEN, "");
        String server = cfg(KEY_SERVER, "https://www.portal659.com.ar").replaceAll("/+$", "");
        if (token.isEmpty()) {
            setConn("sin_token");
            return;
        }
        if (webSocket != null || connecting.get()) return;

        String base = server.startsWith("https") ? server.replaceFirst("^https", "wss") : server.replaceFirst("^http", "ws");
        String url = base + "/printbridge?token=" + token;

        connecting.set(true);
        Request req = new Request.Builder().url(url).build();
        webSocket = httpClient.newWebSocket(req, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket ws, Response response) {
                connecting.set(false);
                setConn("connected");
                updateNotification("Portal Print activo", "Conectado · imprimiendo automáticamente");
            }

            @Override
            public void onMessage(WebSocket ws, String text) {
                handleMessage(text);
            }

            @Override
            public void onMessage(WebSocket ws, ByteString bytes) {
                handleMessage(bytes.utf8());
            }

            @Override
            public void onFailure(WebSocket ws, Throwable t, Response response) {
                connecting.set(false);
                webSocket = null;
                setConn("error");
                updateNotification("Portal Print", "Sin conexión · reintentando");
                scheduleReconnect();
            }

            @Override
            public void onClosed(WebSocket ws, int code, String reason) {
                connecting.set(false);
                webSocket = null;
                setConn("disconnected");
                updateNotification("Portal Print", "Sin conexión · reintentando");
                scheduleReconnect();
            }
        });
    }

    private int reconnectAttempt = 0;
    private void scheduleReconnect() {
        if (!running.get() || !prefs().getBoolean(KEY_ENABLED, true)) return;
        reconnectAttempt = Math.min(reconnectAttempt + 1, 6);
        long delay = Math.min(30000, 1000L * (1 << reconnectAttempt)); // 1s,2s,4s,8s,16s,32s
        httpClient.dispatcher().executorService().execute(() -> {
            try { Thread.sleep(delay); } catch (InterruptedException ignored) {}
            connectRelay();
        });
    }

    private void disconnect() {
        if (webSocket != null) {
            try { webSocket.close(1000, "service stopped"); } catch (Exception ignored) {}
            webSocket = null;
        }
    }

    private void handleMessage(String text) {
        try {
            JSONObject msg = new JSONObject(text);
            String type = msg.optString("type");
            if ("job".equals(type) && msg.has("jobId")) {
                String jobId = msg.getString("jobId");
                JSONObject job = msg.optJSONObject("job");
                dispatchJob(jobId, job);
            }
        } catch (Exception ignored) {}
    }

    private void dispatchJob(String jobId, JSONObject job) {
        if (job == null) { ack(jobId, false, "job inválido"); return; }
        String payload = job.optString("payload", "");
        String ip = job.has("printerIp") && !job.isNull("printerIp") && !job.optString("printerIp").isEmpty()
            ? job.optString("printerIp")
            : cfg(KEY_PRINTER_IP, "");
        int port = job.optInt("printerPort", prefs().getInt(KEY_PRINTER_PORT, 9100));

        if (ip.isEmpty()) { ack(jobId, false, "sin IP de impresora"); return; }

        final byte[] data;
        try {
            data = Base64.decode(payload, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            ack(jobId, false, "base64 inválido");
            return;
        }

        printExecutor.execute(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(ip, port), 5000);
                socket.getOutputStream().write(data);
                socket.getOutputStream().flush();
                ack(jobId, true, null);
            } catch (Exception e) {
                ack(jobId, false, "TCP " + ip + ":" + port + " → " + e.getMessage());
            }
        });
    }

    private void ack(String jobId, boolean ok, String error) {
        if (webSocket == null) return;
        try {
            JSONObject ack = new JSONObject();
            ack.put("type", "ack");
            ack.put("jobId", jobId);
            ack.put("ok", ok);
            if (error != null) ack.put("error", error);
            webSocket.send(ack.toString());
        } catch (Exception ignored) {}
    }

    private void setConn(String status) {
        prefs().edit().putString(KEY_CONN, status).apply();
    }

    // --------------------------------------- servidor local offline

    private static final int LOCAL_PORT = 8793;
    private ServerSocket localServer;
    private Thread localThread;

    /**
     * Servidor local de impresión offline (Track Impresión F3).
     * Solo loopback 127.0.0.1:8793: la PWA hace fetch sin mixed content
     * (origen trustworthy) y ningún otro equipo de la red llega a este
     * puerto. Mismo contrato que el agente PC:
     *   POST /local-print { token, payload(base64), printerIp?, printerPort? }
     *   GET /local-status (diagnóstico, sin auth).
     * Sin dependencias nuevas: ServerSocket + org.json (ya usados).
     */
    private void startLocalServer() {
        if (localThread != null && localThread.isAlive()) return;
        localThread = new Thread(() -> {
            try {
                ServerSocket ss = new ServerSocket(LOCAL_PORT, 4, InetAddress.getByName("127.0.0.1"));
                localServer = ss;
                while (running.get() && !ss.isClosed()) {
                    try {
                        Socket sock = ss.accept();
                        printExecutor.execute(() -> serveLocal(sock));
                    } catch (Exception ignored) {
                        if (ss.isClosed()) break;
                    }
                }
            } catch (Exception ignored) {}
        }, "portalprint-local");
        localThread.setDaemon(true);
        localThread.start();
    }

    private void stopLocalServer() {
        try { if (localServer != null) localServer.close(); } catch (Exception ignored) {}
        localServer = null;
        localThread = null;
    }

    private void serveLocal(Socket sock) {
        try (Socket s = sock) {
            s.setSoTimeout(10000);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            String head = readHttpHead(in);
            if (head == null) return;
            String[] requestLine = head.split("\r\n")[0].split(" ");
            String method = requestLine.length > 0 ? requestLine[0] : "";
            String rawPath = requestLine.length > 1 ? requestLine[1] : "/";
            String path = rawPath.split("\\?")[0];
            if ("GET".equals(method) && "/local-status".equals(path)) {
                writeJson(out, 200, "{\"ok\":true,\"service\":\"portal-print\",\"local\":true,\"port\":" + LOCAL_PORT + "}");
                return;
            }
            if (!"POST".equals(method) || !"/local-print".equals(path)) {
                writeJson(out, 404, "{\"ok\":false,\"error\":\"no encontrado\"}");
                return;
            }
            int contentLength = contentLengthOf(head);
            if (contentLength < 0 || contentLength > 8 * 1024 * 1024) {
                writeJson(out, 413, "{\"ok\":false,\"error\":\"cuerpo inválido\"}");
                return;
            }
            byte[] body = readFully(in, contentLength);
            if (body == null) {
                writeJson(out, 400, "{\"ok\":false,\"error\":\"cuerpo incompleto\"}");
                return;
            }
            writeJson(out, 200, handleLocalPrint(new String(body, StandardCharsets.UTF_8)));
        } catch (Exception ignored) {}
    }

    private String readHttpHead(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int a = -1, b = -1, c = -1, d = -1;
        int total = 0;
        int r;
        while ((r = in.read()) != -1) {
            buf.write(r);
            a = b; b = c; c = d; d = r;
            if (++total > 65536) return null;
            if (a == '\r' && b == '\n' && c == '\r' && d == '\n') break;
        }
        if (total == 0) return null;
        return buf.toString("UTF-8");
    }

    private int contentLengthOf(String head) {
        for (String line : head.split("\r\n")) {
            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("Content-Length")) {
                try {
                    return Integer.parseInt(line.substring(colon + 1).trim());
                } catch (NumberFormatException e) {
                    return -1;
                }
            }
        }
        return -1;
    }

    private byte[] readFully(InputStream in, int n) throws Exception {
        byte[] buf = new byte[n];
        int off = 0;
        while (off < n) {
            int r = in.read(buf, off, n - off);
            if (r == -1) return null;
            off += r;
        }
        return buf;
    }

    private void writeJson(OutputStream out, int status, String json) throws Exception {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + " OK\r\nContent-Type: application/json\r\nContent-Length: "
            + body.length + "\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private String handleLocalPrint(String bodyText) {
        try {
            JSONObject body = new JSONObject(bodyText);
            String configured = cfg(KEY_TOKEN, "");
            if (configured.isEmpty()) return "{\"ok\":false,\"error\":\"app sin token configurado\"}";
            if (!configured.equals(body.optString("token", ""))) {
                return "{\"ok\":false,\"error\":\"token inválido\"}";
            }
            byte[] data;
            try {
                data = Base64.decode(body.optString("payload", ""), Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                return "{\"ok\":false,\"error\":\"payload inválido\"}";
            }
            if (data.length == 0) return "{\"ok\":false,\"error\":\"payload vacío\"}";
            String ip = body.optString("printerIp", "");
            if (ip.isEmpty()) ip = cfg(KEY_PRINTER_IP, "");
            int port = body.has("printerPort")
                ? body.optInt("printerPort", prefs().getInt(KEY_PRINTER_PORT, 9100))
                : prefs().getInt(KEY_PRINTER_PORT, 9100);
            if (ip.isEmpty()) return "{\"ok\":false,\"error\":\"sin IP de impresora\"}";
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(ip, port), 5000);
                socket.getOutputStream().write(data);
                socket.getOutputStream().flush();
                return "{\"ok\":true}";
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage().replace('"', '\'') : "error TCP";
                return "{\"ok\":false,\"error\":\"TCP " + ip + ":" + port + " -> " + msg + "\"}";
            }
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"JSON inválido\"}";
        }
    }

    // ---------------------------------------------------------------- notification

    private void startForegroundInternal(String title, String text) {
        createChannel();
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent tap = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE);

        Notification n = builder.build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void updateNotification(String title, String text) {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;
            createChannel();
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            PendingIntent tap = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder builder = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
            builder
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(tap)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE);
            nm.notify(NOTIFICATION_ID, builder.build());
        } catch (Exception ignored) {}
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Portal Print (conexión activa)",
                NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }
}