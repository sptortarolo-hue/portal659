package ar.portal659.walink

import android.content.Context

/** Preferencias compartidas: config del relay + estado visible para la UI. */
object Config {
    private const val PREFS = "portal_walink"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun vpsUrl(ctx: Context): String =
        prefs(ctx).getString("vps_url", "ws://portal659.vps/wa") ?: ""

    fun setVpsUrl(ctx: Context, value: String) = prefs(ctx).edit().putString("vps_url", value).apply()

    fun token(ctx: Context): String = prefs(ctx).getString("token", "") ?: ""

    fun setToken(ctx: Context, value: String) = prefs(ctx).edit().putString("token", value).apply()

    fun enabled(ctx: Context): Boolean = prefs(ctx).getBoolean("enabled", false)

    fun setEnabled(ctx: Context, value: Boolean) = prefs(ctx).edit().putBoolean("enabled", value).apply()

    fun status(ctx: Context): String = prefs(ctx).getString("status", "Detenido") ?: "Detenido"

    fun setStatus(ctx: Context, value: String) = prefs(ctx).edit().putString("status", value).apply()

    fun pairingCode(ctx: Context): String = prefs(ctx).getString("pairing_code", "") ?: ""

    fun setPairingCode(ctx: Context, value: String) = prefs(ctx).edit().putString("pairing_code", value).apply()

    fun qrImageData(ctx: Context): String = prefs(ctx).getString("qr_image_data", "") ?: ""

    fun setQrImageData(ctx: Context, value: String) = prefs(ctx).edit().putString("qr_image_data", value).apply()
}