package ai.jayra.companion.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.wifi.WifiManager
import android.os.*
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import ai.jayra.companion.model.PhoneStatusPayload
import java.io.File

class DeviceControlManager(private val context: Context) {

    private var activeRingtone: Ringtone? = null
    private var vibrator: Vibrator? = null
    private var finderStopHandler: Handler? = null

    init {
        createNotificationChannel()
    }

    fun triggerRingtoneFinder(mode: String = "ring", durationSec: Int = 30): Result<String> {
        stopRingtoneFinder()

        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val originalVolume = audioManager?.getStreamVolume(AudioManager.STREAM_ALARM) ?: 5
        val maxVolume = audioManager?.getStreamMaxVolume(AudioManager.STREAM_ALARM) ?: 10

        // Set to high volume for locating
        audioManager?.setStreamVolume(AudioManager.STREAM_ALARM, maxVolume, 0)

        if (mode == "ring" || mode == "both") {
            val alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

            activeRingtone = RingtoneManager.getRingtone(context, alertUri)?.apply {
                audioAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                play()
            }
        }

        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            manager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }

        val pattern = longArrayOf(0, 800, 400, 800, 400)
        vibrator?.let {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                it.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                it.vibrate(pattern, 0)
            }
        }

        finderStopHandler = Handler(Looper.getMainLooper()).apply {
            postDelayed({
                stopRingtoneFinder()
                audioManager?.setStreamVolume(AudioManager.STREAM_ALARM, originalVolume, 0)
            }, (durationSec * 1000).toLong())
        }

        return Result.success("Ringtone finder active for $durationSec seconds")
    }

    fun stopRingtoneFinder() {
        activeRingtone?.stop()
        activeRingtone = null
        vibrator?.cancel()
        vibrator = null
        finderStopHandler?.removeCallbacksAndMessages(null)
        finderStopHandler = null
    }

    fun queryPhoneStatus(): PhoneStatusPayload {
        // Battery status
        val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        val batteryPercent = if (level >= 0 && scale > 0) (level * 100) / scale else null

        // Storage status
        val statFs = StatFs(Environment.getDataDirectory().path)
        val freeBytes = statFs.availableBlocksLong * statFs.blockSizeLong
        val totalBytes = statFs.blockCountLong * statFs.blockSizeLong

        // Wi-Fi status
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val wifiInfo = wifiManager?.connectionInfo
        val ssid = wifiInfo?.ssid?.replace("\"", "")

        return PhoneStatusPayload(
            batteryPercent = batteryPercent,
            batteryCharging = isCharging,
            storageFreeBytes = freeBytes,
            storageTotalBytes = totalBytes,
            wifiState = if (wifiInfo?.networkId != -1) "connected" else "disconnected",
            wifiSsid = if (ssid != "<unknown ssid>") ssid else null,
            foregroundApp = null
        )
    }

    fun sendNotification(title: String, body: String, priority: String = "normal"): Result<String> {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return Result.failure(IllegalStateException("NotificationManager unavailable"))

        val notificationPriority = when (priority.lowercase()) {
            "high" -> NotificationCompat.PRIORITY_HIGH
            "low" -> NotificationCompat.PRIORITY_LOW
            else -> NotificationCompat.PRIORITY_DEFAULT
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(notificationPriority)
            .setAutoCancel(true)
            .build()

        manager.notify((System.currentTimeMillis() % 10000).toInt(), notification)
        return Result.success("Notification posted: $title")
    }

    fun controlMedia(operation: String, volume: Int? = null): Result<String> {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            ?: return Result.failure(IllegalStateException("AudioManager unavailable"))

        if (volume != null) {
            val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val target = ((volume / 100.0) * maxVol).toInt()
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, AudioManager.FLAG_SHOW_UI)
            return Result.success("Music volume set to $volume%")
        }

        val keyCode = when (operation.lowercase()) {
            "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "toggle" -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else -> return Result.failure(IllegalArgumentException("Unsupported media operation: $operation"))
        }

        audioManager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
        audioManager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyCode))
        return Result.success("Dispatched media key: $operation")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "JAYRA Alerts & Tasks",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Task updates and remote alerts from JAYRA Desktop"
            }
            val manager = context.getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_ID = "jayra_companion_notifications"
    }
}
