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

class MyFirebaseService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "FCM_SERVICE"
        private const val CHANNEL_ID = "null_void_alerts"
        // CLAVE COMPARTIDA (Debe ser la misma en el servidor Flask)
        // Se carga dinámicamente desde el archivo .env principal en el servidor durante la compilación
        private val SECRET_KEY_BASE64 = BuildConfig.FCM_SECRET_KEY
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        Log.d(TAG, "Mensaje recibido de: ${remoteMessage.from}")

        // Solo procesamos si hay datos
        if (remoteMessage.data.isNotEmpty()) {
            val encryptedTitle = remoteMessage.data["title"]
            val encryptedBody = remoteMessage.data["body"]
            val ivBase64 = remoteMessage.data["iv"]

            if (encryptedTitle != null && encryptedBody != null && ivBase64 != null) {
                try {
                    val title = decrypt(encryptedTitle, ivBase64)
                    val body = decrypt(encryptedBody, ivBase64)
                    sendNotification(title, body)
                } catch (e: Exception) {
                    Log.e(TAG, "Error descifrando el mensaje: ${e.message}")
                    // Opcional: mostrar un mensaje genérico "Nueva alerta privada"
                }
            } else {
                // Si no viene cifrado, podemos procesar texto plano si lo permites
                val title = remoteMessage.data["title"] ?: "Null-Void"
                val body = remoteMessage.data["body"] ?: "Nueva notificación"
                sendNotification(title, body)
            }
        }
    }

    override fun onNewToken(token: String) {
        Log.d(TAG, "Nuevo Token FCM: $token")
        // Aquí podrías avisar a la app para que lo envíe al servidor si está abierta
        val intent = Intent("com.nullvoid.app.FCM_TOKEN")
        intent.putExtra("token", token)
        sendBroadcast(intent)
    }

    private fun sendNotification(title: String, messageBody: String) {
        val intent = Intent(this, MainActivity::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pendingIntent = PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE)

        val notificationBuilder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_refresh) // Usaremos ic_refresh temporalmente
            .setContentTitle(title)
            .setContentText(messageBody)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID,
                "Alertas del Motor",
                NotificationManager.IMPORTANCE_HIGH)
            notificationManager.createNotificationChannel(channel)
        }

        notificationManager.notify(0, notificationBuilder.build())
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
