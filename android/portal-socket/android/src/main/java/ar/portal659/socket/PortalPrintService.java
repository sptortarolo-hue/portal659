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

import java.net.InetSocketAddress;
import java.net.Socket;
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
        }
        connectRelay();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running.set(false);
        releaseLocks();
        disconnect();
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