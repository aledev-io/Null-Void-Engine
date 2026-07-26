package com.nullvoid.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.view.Gravity
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.WindowManager
import android.webkit.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.Toolbar
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.firebase.messaging.FirebaseMessaging
import java.net.URLEncoder

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var toolbar: Toolbar
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    // Receptor para tokens FCM
    private val tokenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val token = intent?.getStringExtra("token")
            token?.let {
                notifyWebAboutToken(it)
            }
        }
    }

    // Solicitud de permisos generales
    private val requestPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ -> }

    // Selector de archivos para la web
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val data: Intent? = result.data
            val results = if (data == null || data.data == null) null else arrayOf(data.data!!)
            filePathCallback?.onReceiveValue(results)
        } else {
            filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        setFullScreenMode()
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        
        setContentView(R.layout.activity_main)

        toolbar = findViewById(R.id.toolbar)
        setSupportActionBar(toolbar)

        webView = findViewById(R.id.webView)
        
        webView.addJavascriptInterface(object {
            @JavascriptInterface
            @Suppress("unused")
            fun closeApp() {
                finishAffinity()
            }


            @JavascriptInterface
            @Suppress("unused")
            fun getFcmToken() {
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    if (task.isSuccessful) {
                        val token = task.result
                        notifyWebAboutToken(token)
                    }
                }
            }
        }, "Android")
        
        setupWebView()
        createNotificationChannel()
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissionsLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
            }
        }

        // Registrar receptor de tokens (ajustado para API 34+)
        val filter = IntentFilter("com.nullvoid.app.FCM_TOKEN")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(tokenReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(tokenReceiver, filter)
        }

        webView.loadUrl("file:///android_asset/www/index.html")
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Alertas del Motor"
            val descriptionText = "Notificaciones privadas de Null-Void"
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel("null_void_alerts", name, importance).apply {
                description = descriptionText
            }
            val notificationManager: NotificationManager =
                getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun notifyWebAboutToken(token: String) {
        runOnUiThread {
            webView.evaluateJavascript("if(window.onFcmTokenReceived) window.onFcmTokenReceived('$token');", null)
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(tokenReceiver)
    }

    private fun setFullScreenMode() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    @Suppress("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            userAgentString = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
            textZoom = 100
            useWideViewPort = true
            loadWithOverviewMode = true 
            layoutAlgorithm = WebSettings.LayoutAlgorithm.NORMAL
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            
            setGeolocationEnabled(false)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                
                if (url != null && url.startsWith("file:///android_asset/")) {
                    toolbar.visibility = View.GONE
                } else {
                    toolbar.visibility = View.VISIBLE
                    val uri = url?.toUri()
                    val netName = uri?.getQueryParameter("nv_name")
                    supportActionBar?.title = netName ?: "Null-Void"
                }
                setFullScreenMode()
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                view.loadUrl(url)
                return true
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                view.loadUrl(request.url.toString())
                return true
            }

            @SuppressLint("WebViewClientOnReceivedSslError")
            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                // TEMPORAL: Permitir cualquier certificado SSL (incluido autofirmado)
                // Peligro de MITM, pero necesario por ahora para el desarrollo.
                handler?.proceed()
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    val errorMsg = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        error?.description?.toString() ?: "Error"
                    } else "Error"
                    handleConnectionError(view, errorMsg)
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                // request?.grant(request.resources) // PELIGRO: Concesión automática desactivada
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
                // callback?.invoke(origin, true, false) // PELIGRO: Concesión automática desactivada
            }

            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                filePathCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT)
                intent.addCategory(Intent.CATEGORY_OPENABLE)
                intent.type = "*/*"
                val chooserIntent = Intent(Intent.ACTION_CHOOSER)
                chooserIntent.putExtra(Intent.EXTRA_INTENT, intent)
                chooserIntent.putExtra(Intent.EXTRA_TITLE, "Seleccionar archivo")
                fileChooserLauncher.launch(chooserIntent)
                return true
            }
        }

        webView.setBackgroundColor(Color.TRANSPARENT)
    }

    private fun handleConnectionError(view: WebView?, message: String) {
        val encodedMsg = URLEncoder.encode(message, "UTF-8")
        val fallbackUrl = "file:///android_asset/www/index.html?error=$encodedMsg"
        view?.loadUrl(fallbackUrl)
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_refresh -> {
                webView.reload()
                true
            }
            R.id.action_settings -> {
                showInteractiveMenu()
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun showInteractiveMenu() {
        val popup = androidx.appcompat.widget.PopupMenu(this, toolbar, Gravity.END)
        popup.menu.add(Menu.NONE, 1, 1, getString(R.string.menu_edit))
        popup.menu.add(Menu.NONE, 2, 2, getString(R.string.menu_new))
        popup.menu.add(Menu.NONE, 3, 3, getString(R.string.menu_close))
        popup.menu.add(Menu.NONE, 4, 4, getString(R.string.menu_exit))

        popup.setOnMenuItemClickListener { menuItem ->
            when (menuItem.itemId) {
                1 -> { // Editar Conexión
                    val currentOrigin = webView.url?.let { 
                        val uri = it.toUri()
                        uri.scheme + "://" + uri.host + (if (uri.port != -1) ":" + uri.port else "")
                    } ?: ""
                    webView.loadUrl("file:///android_asset/www/index.html?action=edit&url=" + URLEncoder.encode(currentOrigin, "UTF-8"))
                }
                2 -> webUrl = "file:///android_asset/www/index.html?action=new" // Nueva Conexión
                3 -> webUrl = "file:///android_asset/www/index.html?action=list" // Cerrar Conexión
                4 -> finishAffinity() // Salir
            }
            true
        }
        popup.show()
    }

    private var webUrl: String
        get() = webView.url ?: ""
        set(value) { webView.loadUrl(value) }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            val currentUrl = webView.url ?: ""
            if (currentUrl.contains("android_asset/www/index.html")) super.onBackPressed()
            else webView.goBack()
        } else super.onBackPressed()
    }
}
