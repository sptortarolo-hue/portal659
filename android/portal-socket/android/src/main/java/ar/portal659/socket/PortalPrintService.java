package ar.portal659.socket;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Foreground service que mantiene vivo el proceso de la app para que el WebSocket
 * con el relay (print-bridge) no sea matado por el sistema de ahorro de batería.
 * Muestra una notificación fija (obligatorio para foreground services).
 */
public class PortalPrintService extends Service {
    private static final int NOTIFICATION_ID = 42659;
    private static final String CHANNEL_ID = "portal_print_foreground";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel();

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent tap = PendingIntent.getActivity(
            this, 0, launch, PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification;
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Portal Print activo")
            .setContentText("Manteniendo la conexión con la impresora")
            .setContentIntent(tap)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE);

        notification = builder.build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_STICKY;
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

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
