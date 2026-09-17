package ar.portal659.walink

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private val poll = object : Runnable {
        override fun run() {
            updateStatus()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val vpsUrl = findViewById<EditText>(R.id.vpsUrl)
        val token = findViewById<EditText>(R.id.token)
        vpsUrl.setText(Config.vpsUrl(this))
        token.setText(Config.token(this))

        findViewById<Button>(R.id.start).setOnClickListener {
            Config.setVpsUrl(this, vpsUrl.text.toString())
            Config.setToken(this, token.text.toString())
            requestPermissionsIfNeeded()
            requestBatteryExemption()
            RelayService.start(this)
        }
        findViewById<Button>(R.id.stop).setOnClickListener { RelayService.stop(this) }
        findViewById<Button>(R.id.refresh).setOnClickListener { updateStatus() }
        findViewById<Button>(R.id.reset).setOnClickListener {
            RelayService.resetAndReconnect(this)
            updateStatus()
        }
        try {
            findViewById<TextView>(R.id.version).text = "v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"
        } catch (_: Exception) {}
    }

    private fun updateStatus() {
        findViewById<TextView>(R.id.status).text = "Estado: ${Config.status(this)}"

        // Log del proceso relay (para diagnóstico en app, sin adb).
        val logs = Config.logLines(this)
        findViewById<TextView>(R.id.logView).text =
            if (logs.isEmpty()) "(log aparentará acá)" else logs.joinToString("\n") { it }

        // El QR se muestra SOLO en el panel web (/vendor/wa-bot): escanearlo
        // desde este mismo celular es imposible (WhatsApp no puede leer su
        // propia pantalla). Acá solo indicamos que hay uno esperando. Y no
        // renderizamos con ZXing: el string del QR de WhatsApp puede disparar
        // una excepción en el main thread y cerrar la app.
        val qrData = Config.qrImageData(this)
        val banner = findViewById<TextView>(R.id.qrBanner)
        if (qrData.isNotEmpty()) {
            banner.visibility = View.VISIBLE
        } else {
            banner.visibility = View.GONE
        }

        // Fallback de código de pareo.
        val code = Config.pairingCode(this)
        findViewById<TextView>(R.id.pairing).text = if (code.isNotEmpty()) "Código de pareo: $code" else ""
    }

    private fun requestPermissionsIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 100)
        }
    }

    private fun requestBatteryExemption() {
        if (Build.VERSION.SDK_INT >= 23) {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(Uri.parse("package:$packageName"))
                try { startActivity(intent) } catch (_: Exception) {
                    val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    startActivity(fallback)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        handler.post(poll)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(poll)
    }
}
