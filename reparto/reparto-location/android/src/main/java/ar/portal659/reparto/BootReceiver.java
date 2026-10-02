package ar.portal659.reparto;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Al encender el celu, retoma el sharing si había un pedido activo (el
 * servicio relee server/token/order de SharedPreferences; si el pedido ya no
 * está En camino, el primer POST da 409 y se detiene solo).
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        SharedPreferences p = context.getSharedPreferences("portalreparto", Context.MODE_PRIVATE);
        if (!p.getBoolean("sharing", false)) return;
        String orderId = p.getString("orderId", "");
        if (orderId == null || orderId.isEmpty()) return;
        Intent svc = new Intent(context, RepartoLocationService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(svc);
        } else {
            context.startService(svc);
        }
    }
}
