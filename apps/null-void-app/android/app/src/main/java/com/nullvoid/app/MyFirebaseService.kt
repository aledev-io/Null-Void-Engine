package com.nullvoid.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import java.util.Locale

class MyFirebaseService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "FCM_SERVICE"
        
        // Claves de Grupo para Stacking
        private const val GROUP_SOCIAL = "com.nullvoid.app.GROUP_SOCIAL"
        private const val GROUP_AI = "com.nullvoid.app.GROUP_AI"
        private const val GROUP_SCRAPER = "com.nullvoid.app.GROUP_SCRAPER"
        private const val GROUP_CLOUD = "com.nullvoid.app.GROUP_CLOUD"
        private const val GROUP_CALENDAR = "com.nullvoid.app.GROUP_CALENDAR"
        private const val GROUP_SYSTEM = "com.nullvoid.app.GROUP_SYSTEM"

        // IDs de Canales
        private const val CHANNEL_SOCIAL = "channel_social"
        private const val CHANNEL_AI = "channel_ai"
        private const val CHANNEL_SCRAPER = "channel_scraper"
        private const val CHANNEL_CLOUD = "channel_cloud"
        private const val CHANNEL_CALENDAR = "channel_calendar"
        private const val CHANNEL_SYSTEM = "channel_system"

        // CLAVE COMPARTIDA (AES/GCM)
        private val SECRET_KEY_BASE64 = BuildConfig.FCM_SECRET_KEY
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        Log.d(TAG, "Mensaje recibido de: ${remoteMessage.from}")

        if (remoteMessage.data.isNotEmpty()) {
            val module = remoteMessage.data["module"]?.lowercase(Locale.ROOT) ?: "system"
            val encryptedTitle = remoteMessage.data["title"]
            val encryptedBody = remoteMessage.data["body"]
            val ivBase64 = remoteMessage.data["iv"]

            if (encryptedTitle != null && encryptedBody != null && ivBase64 != null) {
                try {
                    val title = decrypt(encryptedTitle, ivBase64)
                    val body = decrypt(encryptedBody, ivBase64)
                    sendModuleNotification(module, title, body)
                } catch (e: Exception) {
                    Log.e(TAG, "Error descifrando el mensaje: ${e.message}")
                }
            } else {
                val title = remoteMessage.data["title"] ?: getString(R.string.app_name)
                val body = remoteMessage.data["body"] ?: getString(R.string.default_notification_body)
                sendModuleNotification(module, title, body)
            }
        }
    }

    override fun onNewToken(token: String) {
        Log.d(TAG, "Nuevo Token FCM: $token")
        val intent = Intent("com.nullvoid.app.FCM_TOKEN")
        intent.putExtra("token", token)
        sendBroadcast(intent)
    }

    private fun sendModuleNotification(module: String, title: String, messageBody: String) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val (groupKey, channelId, importance, summaryRes) = when (module) {
            "social" -> quadruple(GROUP_SOCIAL, CHANNEL_SOCIAL, NotificationManager.IMPORTANCE_HIGH, R.string.summary_social)
            "ai"     -> quadruple(GROUP_AI, CHANNEL_AI, NotificationManager.IMPORTANCE_DEFAULT, R.string.summary_ai)
            "scraper"-> quadruple(GROUP_SCRAPER, CHANNEL_SCRAPER, NotificationManager.IMPORTANCE_DEFAULT, R.string.summary_scraper)
            "cloud"  -> quadruple(GROUP_CLOUD, CHANNEL_CLOUD, NotificationManager.IMPORTANCE_LOW, R.string.summary_cloud)
            "calendar"-> quadruple(GROUP_CALENDAR, CHANNEL_CALENDAR, NotificationManager.IMPORTANCE_HIGH, R.string.summary_calendar)
            else     -> quadruple(GROUP_SYSTEM, CHANNEL_SYSTEM, NotificationManager.IMPORTANCE_HIGH, R.string.summary_system)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channelName = when (module) {
                "social" -> getString(R.string.channel_social_name)
                "ai"     -> getString(R.string.channel_ai_name)
                "scraper"-> getString(R.string.channel_scraper_name)
                "cloud"  -> getString(R.string.channel_cloud_name)
                "calendar" -> getString(R.string.channel_calendar_name)
                else     -> getString(R.string.channel_system_name)
            }
            val channelDesc = when (module) {
                "social" -> getString(R.string.channel_social_desc)
                "ai"     -> getString(R.string.channel_ai_desc)
                "scraper"-> getString(R.string.channel_scraper_desc)
                "cloud"  -> getString(R.string.channel_cloud_desc)
                "calendar" -> getString(R.string.channel_calendar_desc)
                else     -> getString(R.string.channel_system_desc)
            }
            val channel = NotificationChannel(channelId, channelName, importance).apply {
                description = channelDesc
            }
            notificationManager.createNotificationChannel(channel)
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE)

        val notificationBuilder = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_refresh)
            .setContentTitle(title)
            .setContentText(messageBody)
            .setAutoCancel(true)
            .setPriority(mapImportanceToPriority(importance))
            .setContentIntent(pendingIntent)
            .setGroup(groupKey)

        val notificationId = (System.currentTimeMillis() and 0x3FFFFFFF).toInt()
        notificationManager.notify(notificationId, notificationBuilder.build())

        val summaryNotification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_refresh)
            .setStyle(NotificationCompat.InboxStyle()
                .setSummaryText(getString(summaryRes)))
            .setGroup(groupKey)
            .setGroupSummary(true)
            .setPriority(mapImportanceToPriority(importance))
            .build()

        notificationManager.notify(groupKey.hashCode(), summaryNotification)
    }

    private data class Quadruple<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)
    private fun quadruple(a: String, b: String, c: Int, d: Int) = Quadruple(a, b, c, d)

    private fun mapImportanceToPriority(importance: Int): Int = when (importance) {
        NotificationManager.IMPORTANCE_HIGH -> NotificationCompat.PRIORITY_HIGH
        NotificationManager.IMPORTANCE_LOW -> NotificationCompat.PRIORITY_LOW
        else -> NotificationCompat.PRIORITY_DEFAULT
    }

    private fun decrypt(encryptedData: String, ivBase64: String): String {
        val keyBytes = Base64.decode(SECRET_KEY_BASE64, Base64.DEFAULT)
        val ivBytes = Base64.decode(ivBase64, Base64.DEFAULT)
        val dataBytes = Base64.decode(encryptedData, Base64.DEFAULT)

        val secretKey = SecretKeySpec(keyBytes, "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val spec = GCMParameterSpec(128, ivBytes)
        
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
        return String(cipher.doFinal(dataBytes), Charsets.UTF_8)
    }
}
