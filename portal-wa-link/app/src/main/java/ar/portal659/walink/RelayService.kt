package ar.portal659.walink

import android.content.SharedPreferences
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import android.app.NotificationChannel
import android.app.NotificationManager
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * ForegroundService que ejecuta el relay `whatsmeow` (Go) como subproceso y lo
 * mantiene vivo: reconexión con backoff, WakeLock parcial y notificación fija.
 * El relay lee stdout y escribe estado/pairing-code en Config (leído por la UI).
 */
class RelayService : Service() {

    private val stopping = AtomicBoolean(false)
    private val handler = Handler(Looper.getMainLooper())
    private var process: Process? = null
    private var wakelock: PowerManager.WakeLock? = null
    private var restartDelayMs = 2000L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopRelay()
            stopSelf()
            return START_NOT_STICKY
        }
        stopping.set(false)
        startForegroundCompat()
        Config.setEnabled(this, true)
        ensureBinary()
        val prefs = getSharedPreferences("walink", Context.MODE_PRIVATE)
        if (prefs.getBoolean("reset_pending", false)) {
            prefs.edit().putBoolean("reset_pending", false).apply()
            // Borrar sesión para re-escanear QR.
            val sessionDir = File(filesDir, "session")
            listOf(File(sessionDir, "session.db"), File(sessionDir, "session.db-shm"), File(sessionDir, "session.db-wal")).forEach { it.delete() }
            startProcess(doLogin = true)
        } else {
            startProcess()
        }
        return START_STICKY
    }

    private fun startForegroundCompat() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Portal Wa Link", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Portal Wa Link")
            .setContentText(Config.status(this))
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, notif)
        }
        acquireWakeLock()
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakelock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "walink:relay")
        wakelock?.acquire()
    }

    /** El binario del relay se empaqueta como librería nativa (`jniLibs/arm64-v8a/librelay.so`).
     *  Android lo extrae en [applicationInfo.nativeLibraryDir] y ahí sí puede
     *  ejecutarse (SELinux ya no lo bloquea como "datos de la app"). */
    private fun binaryPath(): File =
        File(applicationInfo.nativeLibraryDir, "librelay.so")

    private fun ensureBinary() {
        val bin = binaryPath()
        if (!bin.exists()) {
            Config.appendLog(this, "[check] binario no está en nativeLibraryDir: ${bin.absolutePath}")
            Config.setStatus(this, "No hay binario para esta arquitectura")
            return
        }
        Config.appendLog(this, "[check] binario OK: ${bin.absolutePath} (${bin.length()} bytes)")
    }

    private fun startProcess(doLogin: Boolean = false) {
        if (stopping.get()) return
        val loginFlag = if (doLogin) "--login" else ""
        val cmd = if (doLogin) {
            arrayOf(binaryPath().absolutePath, "--login", "--session", File(filesDir, "session").absolutePath)
        } else {
            arrayOf(binaryPath().absolutePath, "--session", File(filesDir, "session").absolutePath)
        }
        val env = arrayOf(
            "WABOT_URL=${Config.vpsUrl(this)}",
            "WA_TOKEN=${Config.token(this)}",
            "SESSION_DIR=${File(filesDir, "session").absolutePath}",
            "HOME=${filesDir.absolutePath}",
            "TMPDIR=${cacheDir.absolutePath}",
            "PATH=/system/bin:/system/xbin",
            "GOOS=android",
        )
        val bin = binaryPath()
        Config.appendLog(this, "[start] binario=${bin.absolutePath} exists=${bin.exists()} size=${bin.length()} canRead=${bin.canRead()} canExec=${bin.canExecute()} doLogin=$doLogin")
        Config.setStatus(this, if (doLogin) "Re-escanenando..." else "Iniciando relay...")
        try {
            val p = Runtime.getRuntime().exec(cmd, env, filesDir)
            process = p
            pump(p.inputStream)
            pump(p.errorStream)
            Thread {
                val code = p.waitFor()
                Config.appendLog(this, "[exit] proceso terminó con código $code")
                process = null
                if (!stopping.get()) scheduleRestart()
                else Config.setStatus(this, "Detenido ($code)")
            }.start()
        } catch (e: Exception) {
            Config.appendLog(this, "[exec] ERROR: ${e.javaClass.simpleName}: ${e.message}")
            Config.setStatus(this, "Error al arrancar: ${e.message}")
            scheduleRestart()
        }
    }

    private fun pump(stream: java.io.InputStream) {
        Thread {
            val reader = stream.bufferedReader()
            while (true) {
                val line = reader.readLine() ?: break
                parseLine(line)
            }
        }.start()
    }

    private fun parseLine(line: String) {
        val l = line.trim()
        if (l.isEmpty()) return

        // Log raw: todas las líneas (stdout + stderr) al buffer para diagnóstico.
        Config.appendLog(this, l)

        when {
            l.startsWith("PAIRING_CODE=") -> {
                Config.setPairingCode(this, l.removePrefix("PAIRING_CODE="))
                Config.setStatus(this, "Código de pareo disponible")
            }
            l.startsWith("QR_DATA=") -> {
                // El QR raw del relay (whatsmeow): lo mostramos en pantalla como imagen.
                Config.setQrImageData(this, l.removePrefix("QR_DATA="))
                Config.setStatus(this, "QR listo para escanear")
            }
            l.startsWith("QR_EVENT=") -> Config.setStatus(this, "QR listo para escanear")
            l.startsWith("QR_TIMEOUT=") -> Config.setStatus(this, "QR vencido — el relay reintentará solo")
            l.startsWith("LINKED=") -> {
                Config.setStatus(this, "Vinculado")
                Config.setQrImageData(this, "")
                Config.setPairingCode(this, "")
            }
            l.startsWith("CONNECTED=") -> Config.setStatus(this, "Conectado")
            l.startsWith("DISCONNECTED=") -> Config.setStatus(this, "Desconectado (reintentando)")
            l.startsWith("LOGGED_OUT=") -> {
                Config.setStatus(this, "Desvinculado: reescanear QR/código")
                Config.setPairingCode(this, "")
                Config.setQrImageData(this, "")
            }
            else -> return
        }
        restartDelayMs = 2000L
    }

    private fun scheduleRestart() {
        if (stopping.get()) return
        Config.setStatus(this, "Reconectando en ${restartDelayMs / 1000}s...")
        handler.postDelayed({
            if (!stopping.get()) {
                ensureBinary()
                startProcess()
            }
        }, restartDelayMs)
        restartDelayMs = (restartDelayMs * 2).coerceAtMost(30000L)
    }

    private fun stopRelay() {
        stopping.set(true)
        Config.setEnabled(this, false)
        Config.setStatus(this, "Detenido")
        process?.destroy()
        process = null
        wakelock?.let { if (it.isHeld) it.release() }
        wakelock = null
    }

    override fun onDestroy() {
        stopRelay()
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "ar.portal659.walink.START"
        const val ACTION_STOP = "ar.portal659.walink.STOP"
        private const val CHANNEL_ID = "walink"
        private const val NOTIF_ID = 1001
        private const val PREFS_RESET = "reset_pending"

        fun start(ctx: Context) {
            ctx.startForegroundService(Intent(ctx, RelayService::class.java).setAction(ACTION_START))
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, RelayService::class.java).setAction(ACTION_STOP))
        }

        fun resetAndReconnect(ctx: Context) {
            stop(ctx)
            val prefs = ctx.getSharedPreferences("walink", Context.MODE_PRIVATE)
            prefs.edit().putBoolean(PREFS_RESET, true).apply()
            start(ctx)
        }
    }
}