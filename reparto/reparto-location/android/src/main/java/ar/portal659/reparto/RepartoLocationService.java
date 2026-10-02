package ar.portal659.reparto;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Foreground service de ubicación del repartidor (foregroundServiceType
 * "location"): reporta lat/lng a POST /api/vendor/orders/[id]/position cada
 * ~15s (o 20m) con el JWT del repartidor (Bearer). Sobrevive con la pantalla
 * apagada o la app cerrada (WakeLock + START_STICKY + stopWithTask=false).
 *
 * Auto-stop de privacidad: si el server responde 403/404/409 (el pedido ya no
 * está En camino o no es tuyo), el servicio se detiene solo y borra el pedido
 * persistido. Sin Play Services: usa LocationManager directo (GPS + red).
 */
public class RepartoLocationService extends Service {
    public static final String ACTION_STOP = "ar.portal659.reparto.STOP";

    private static final int NOTIFICATION_ID = 42660;
    private static final String CHANNEL_ID = "portal_reparto_location";
    private static final String PREFS = "portalreparto";

    private static final String KEY_SERVER = "serverUrl";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_ORDER = "orderId";
    private static final String KEY_LABEL = "orderLabel";
    private static final String KEY_SHARING = "sharing";
    private static final String KEY_LAST_FIX = "lastFixAt";

    private static final long MIN_INTERVAL_MS = 15_000;
    private static final float MIN_DISTANCE_M = 20f;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private PowerManager.WakeLock wakeLock;
    private LocationManager locationManager;
    private LocationListener locationListener;
    private OkHttpClient httpClient;
    private final ExecutorService netExecutor = Executors.newSingleThreadExecutor();
    private double lastLat;
    private double lastLng;
    private long lastAt;

    @Override
    public void onCreate() {
        super.onCreate();
        httpClient = new OkHttpClient.Builder()
            .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSharing();
            stopSelf();
            return START_NOT_STICKY;
        }
        SharedPreferences p = prefs();
        if (intent != null && intent.hasExtra(KEY_ORDER)) {
            p.edit()
                .putString(KEY_ORDER, intent.getStringExtra(KEY_ORDER))
                .putString(KEY_TOKEN, intent.getStringExtra(KEY_TOKEN))
                .putString(KEY_SERVER, intent.getStringExtra(KEY_SERVER))
                .putString(KEY_LABEL, intent.getStringExtra(KEY_LABEL))
                .putBoolean(KEY_SHARING, true)
                .apply();
        }
        String orderId = p.getString(KEY_ORDER, "");
        if (orderId == null || orderId.isEmpty() || !p.getBoolean(KEY_SHARING, false)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!running.getAndSet(true)) {
            acquireWakeLock();
            startForegroundInternal("Portal Reparto activo", label() + " · compartiendo ubicación");
            startUpdates();
            sendLastKnown();
        } else {
            updateNotification("Portal Reparto activo", label() + " · compartiendo ubicación");
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running.set(false);
        stopUpdates();
        releaseWakeLock();
        netExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Si el usuario swapea la tarea, el servicio sigue (es lo que permite
        // reportar con la pantalla apagada).
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---------------------------------------------------------------- prefs

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String label() {
        String l = prefs().getString(KEY_LABEL, "");
        return (l == null || l.isEmpty()) ? "Tu entrega" : l;
    }

    private void stopSharing() {
        prefs().edit().putBoolean(KEY_SHARING, false).putString(KEY_ORDER, "").apply();
    }

    // ---------------------------------------------------------------- locks

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "portalreparto::wake");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
        } catch (Exception ignored) {}
    }

    private void releaseWakeLock() {
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
    }

    // ---------------------------------------------------------------- GPS

    private boolean hasFineLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void startUpdates() {
        try {
            if (!hasFineLocation()) {
                updateNotification("Portal Reparto", "Falta el permiso de ubicación: abrilo y aceptalo");
                return;
            }
            locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (locationManager == null) return;
            locationListener = new LocationListener() {
                @Override public void onLocationChanged(Location location) { onFix(location); }
                @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
                @Override public void onProviderEnabled(String provider) {}
                @Override public void onProviderDisabled(String provider) {}
            };
            Looper looper = Looper.getMainLooper();
            try {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, MIN_INTERVAL_MS, MIN_DISTANCE_M, locationListener, looper);
            } catch (Exception ignored) {}
            try {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, MIN_INTERVAL_MS, MIN_DISTANCE_M, locationListener, looper);
            } catch (Exception ignored) {}
        } catch (Exception ignored) {}
    }

    private void stopUpdates() {
        try {
            if (locationManager != null && locationListener != null) {
                locationManager.removeUpdates(locationListener);
            }
        } catch (Exception ignored) {}
        locationListener = null;
    }

    private void sendLastKnown() {
        try {
            if (!hasFineLocation() || locationManager == null) return;
            Location fix = null;
            try { fix = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER); } catch (Exception ignored) {}
            if (fix == null) {
                try { fix = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER); } catch (Exception ignored) {}
            }
            if (fix != null) onFix(fix);
        } catch (Exception ignored) {}
    }

    private void onFix(Location location) {
        if (location == null) return;
        if (location.hasAccuracy() && location.getAccuracy() > 150) return; // fix berreta
        long now = System.currentTimeMillis();
        if (lastAt != 0 && now - lastAt < MIN_INTERVAL_MS && distM(lastLat, lastLng, location.getLatitude(), location.getLongitude()) < MIN_DISTANCE_M) {
            return;
        }
        lastLat = location.getLatitude();
        lastLng = location.getLongitude();
        lastAt = now;
        postPosition(lastLat, lastLng);
    }

    private static double distM(double aLat, double aLng, double bLat, double bLng) {
        double R = 6371000;
        double dLat = Math.toRadians(bLat - aLat);
        double dLng = Math.toRadians(bLng - aLng);
        double s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(aLat)) * Math.cos(Math.toRadians(bLat))
            * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.asin(Math.sqrt(s));
    }

    // ---------------------------------------------------------------- POST

    private void postPosition(double lat, double lng) {
        SharedPreferences p = prefs();
        final String server = p.getString(KEY_SERVER, "https://www.portal659.com.ar").replaceAll("/+$", "");
        final String token = p.getString(KEY_TOKEN, "");
        final String orderId = p.getString(KEY_ORDER, "");
        if (token == null || token.isEmpty() || orderId == null || orderId.isEmpty()) return;
        netExecutor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("lat", lat);
                body.put("lng", lng);
                RequestBody rb = RequestBody.create(
                    body.toString().getBytes(StandardCharsets.UTF_8),
                    MediaType.parse("application/json; charset=utf-8"));
                Request req = new Request.Builder()
                    .url(server + "/api/vendor/orders/" + orderId + "/position")
                    .header("Authorization", "Bearer " + token)
                    .post(rb)
                    .build();
                try (Response res = httpClient.newCall(req).execute()) {
                    int code = res.code();
                    if (code == 200 || code == 429) {
                        prefs().edit().putLong(KEY_LAST_FIX, System.currentTimeMillis()).apply();
                        if (code == 200) updateNotification("Portal Reparto activo", label() + " · último envío recién");
                    } else if (code == 403 || code == 404 || code == 409) {
                        // El pedido ya no está En camino (o no es tuyo): corte
                        // de privacidad automático, sin depender de la UI.
                        stopSharing();
                        stopSelf();
                    }
                }
            } catch (Exception ignored) {
                // Sin red: se reintenta en el próximo fix (best-effort).
            }
        });
    }

    // ---------------------------------------------------------------- notification

    private void startForegroundInternal(String title, String text) {
        createChannel();
        Notification n = buildNotification(title, text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void updateNotification(String title, String text) {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;
            createChannel();
            nm.notify(NOTIFICATION_ID, buildNotification(title, text));
        } catch (Exception ignored) {}
    }

    private Notification buildNotification(String title, String text) {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent tap = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE);

        Intent stop = new Intent(this, RepartoLocationService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .addAction(new Notification.Action.Builder(null, "Detener", stopPi).build())
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Portal Reparto (ubicación en vivo)",
                NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }
}
