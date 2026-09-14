package ar.portal659.walink

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Arranca el relay al encender el teléfono (solo si el usuario lo tiene activo). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && Config.enabled(context)) {
            RelayService.start(context)
        }
    }
}