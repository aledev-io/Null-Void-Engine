package com.nullvoid.app

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.switchmaterial.SwitchMaterial
import com.google.android.material.textfield.TextInputEditText

class SettingsActivity : AppCompatActivity() {

    @SuppressLint("UseKtx")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val etServerAddress = findViewById<TextInputEditText>(R.id.etServerAddress)
        val etPort = findViewById<TextInputEditText>(R.id.etPort)
        val switchHttps = findViewById<SwitchMaterial>(R.id.switchHttps)
        val btnSaveConnect = findViewById<MaterialButton>(R.id.btnSaveConnect)

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)

        etServerAddress.setText(prefs.getString(KEY_SERVER, ""))
        etPort.setText(prefs.getString(KEY_PORT, ""))
        switchHttps.isChecked = prefs.getBoolean(KEY_USE_HTTPS, false)

        btnSaveConnect.setOnClickListener {
            val server = etServerAddress.text.toString().trim()
            if (server.isEmpty()) {
                Toast.makeText(this, getString(R.string.err_server_required), Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            prefs.edit()
                .putString(KEY_SERVER, server)
                .putString(KEY_PORT, etPort.text.toString().trim())
                .putBoolean(KEY_USE_HTTPS, switchHttps.isChecked)
                .apply()

            Toast.makeText(this, getString(R.string.settings_saved), Toast.LENGTH_SHORT).show()

            val intent = Intent(this, MainActivity::class.java)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            startActivity(intent)
            finish()
        }
    }

    companion object {
        const val PREFS_NAME = "nullvoid_prefs"
        const val KEY_SERVER = "server_address"
        const val KEY_PORT = "server_port"
        const val KEY_USE_HTTPS = "use_https"
    }
}
