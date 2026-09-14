package ar.portal659.walink

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.appcompat.app.AppCompatActivity
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView

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
    }

    private fun updateStatus() {
        findViewById<TextView>(R.id.status).text = "Estado: ${Config.status(this)}"
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