package com.nullvoid.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.view.Gravity
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.util.Log
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.Toolbar
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.core.view.*
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.google.firebase.messaging.FirebaseMessaging
import java.net.URLEncoder
import java.util.Locale

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "NullVoidApp"
    }

    private lateinit var webView: WebView
    private lateinit var toolbar: Toolbar
    private lateinit var loadingBar: android.widget.ProgressBar
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    // Petición web (cámara/micrófono) esperando a que el usuario acepte el permiso nativo
    private var pendingPermissionRequest: PermissionRequest? = null

    // Decisiones de permisos web por origen (persistidas: se pregunta una sola vez)
    private val webPermissionPrefs by lazy {
        getSharedPreferences("web_permissions", Context.MODE_PRIVATE)
    }

    // Receptor para tokens FCM
    private val tokenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val token = intent?.getStringExtra("token")
            token?.let {
                notifyWebAboutToken(it)
            }
        }
    }

    // Solicitud de permisos del sistema (notificaciones, micro/cámara para la web)
    private val requestPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.entries.all { it.value }
        // Si había una petición web en espera (micro/cámara), resolverla ahora
        pendingPermissionRequest?.let { req ->
            if (allGranted) req.grant(req.resources) else req.deny()
            pendingPermissionRequest = null
        }
    }

    // Selector de archivos para múltiples (la web pide modo múltiple)
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        if (uris != null && uris.isNotEmpty()) {
            filePathCallback?.onReceiveValue(uris.toTypedArray())
        } else {
            filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
    }

    // Selector de archivos para un único documento (modo por defecto de las web)
    private val singleFileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            filePathCallback?.onReceiveValue(arrayOf(uri))
        } else {
            filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        WindowCompat.setDecorFitsSystemWindows(window, false)
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        
        setContentView(R.layout.activity_main)

        val rootLayout = findViewById<View>(R.id.rootLayout)
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { view, windowInsets ->
            val insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
            WindowInsetsCompat.CONSUMED
        }

        toolbar = findViewById(R.id.toolbar)
        setSupportActionBar(toolbar)

        loadingBar = findViewById(R.id.loadingBar)

        // Back moderno: gestiona la pila de navegación de la web y cierra la app desde el shell local.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val currentUrl = webView.url ?: ""
                if (currentUrl.contains("android_asset/www/index.html")) {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                } else if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        webView = findViewById(R.id.webView)
        
        webView.addJavascriptInterface(object {
            @JavascriptInterface
            @Suppress("unused")
            fun closeApp() {
                // Solo se permite desde el shell local de la app,
                // nunca desde una web remota abierta en el WebView.
                if (!isLocalOrigin()) return
                finishAffinity()
            }

            @JavascriptInterface
            @Suppress("unused")
            fun getFcmToken() {
                if (!isLocalOrigin()) return
                // El usuario está conectándose a una instancia: momento apropiado
                // para pedir el permiso de notificaciones (Android 13+).
                runOnUiThread { requestNotificationPermission() }
                FirebaseMessaging.getInstance().token
                    .addOnSuccessListener { token -> notifyWebAboutToken(token) }
                    .addOnFailureListener { e ->
                        Log.w(TAG, "FCM: no se pudo obtener el token", e)
                    }
            }
        }, "Android")
        
        setupWebView()

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        updateWebViewTheme()
        createNotificationChannel()

        // La petición de POST_NOTIFICATIONS ya no se hace al arrancar:
        // se pide justo cuando el usuario abre una instancia (ver getFcmToken).

        // Registrar receptor de tokens (ajustado para API 34+)
        val filter = IntentFilter("com.nullvoid.app.FCM_TOKEN")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(tokenReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(tokenReceiver, filter)
        }

        // Si Android destruyó la Activity (falta de memoria, giro...), restaurar la página web;
        // si no, arrancamos por el shell local de la app.
        val restored = savedInstanceState != null && webView.restoreState(savedInstanceState) != null
        if (!restored) {
            webView.loadUrl("file:///android_asset/www/index.html")
        }
    }

    private fun requestNotificationPermission() {
        // Solo pedimos lo imprescindible para FCM (Android 13+).
        // Nada de cámara/micrófono/ubicación/almacenamiento al arrancar.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissionsLauncher.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
        }
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
        // Batería: pausar timers y render del WebView cuando la app no es visible
        webView.onPause()
        webView.pauseTimers()
        CookieManager.getInstance().flush()
    }

    override fun onResume() {
        super.onResume()
        webView.resumeTimers()
        webView.onResume()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(tokenReceiver)
    }

    private fun setFullScreenMode(enable: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (enable) {
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    @Suppress("SetJavaScriptEnabled")
    private fun setupWebView() {
        // User-Agent real del WebView + marca propia (sin suplantar otro dispositivo).
        val defaultUA = webView.settings.userAgentString

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true

            // Nunca permitir que una web remota (o local) lea otros ficheros file://
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false

            // Nada de identidad falsa: UA del dispositivo + marca de la app.
            userAgentString = if (defaultUA.contains("NVMobile")) defaultUA else "$defaultUA NVMobile/2.0"
            textZoom = 100
            useWideViewPort = true
            loadWithOverviewMode = true
            layoutAlgorithm = WebSettings.LayoutAlgorithm.NORMAL
            cacheMode = WebSettings.LOAD_DEFAULT
            setGeolocationEnabled(false)
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK_STRATEGY)) {
            // Nota: estrategia de oscurecimiento web. Con FORCE_DARK_OFF apenas influye,
            // pero dejamos el ajuste en su valor por defecto para no sorprender a la web.
            WebSettingsCompat.setForceDarkStrategy(webView.settings, WebSettingsCompat.DARK_STRATEGY_WEB_THEME_DARKENING_ONLY)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                loadingBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                loadingBar.visibility = View.GONE
                
                val isLocal = url != null && url.startsWith("file:///android_asset/")
                if (isLocal) {
                    toolbar.visibility = View.GONE
                    setFullScreenMode(false)
                } else {
                    toolbar.visibility = View.VISIBLE
                    val uri = url?.toUri()
                    val netName = uri?.getQueryParameter("nv_name")
                    if (netName != null) {
                        supportActionBar?.title = netName
                    }
                    setFullScreenMode(true)
                }
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                return false
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return false
            }

            @SuppressLint("WebViewClientOnReceivedSslError")
            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                val host = error?.url?.let { Uri.parse(it).host }
                // Solo toleramos certificados no confiables en hosts PRIVADOS/locales
                // (LAN, CGNAT, localhost). En internet el error bloquea la conexión.
                if (host != null && isPrivateAddress(host) && error.isSelfSignedLike()) {
                    handler?.proceed()
                } else {
                    handler?.cancel()
                    Toast.makeText(
                        this@MainActivity,
                        "Conexión no segura ($host). Revisa el certificado SSL del servidor.",
                        Toast.LENGTH_LONG
                    ).show()
                }
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
// Permisos web (cámara, micrófono...): ya no se conceden automáticamente.
            // Primera vez se pregunta al usuario y la decisión se recuerda por origen.
            override fun onPermissionRequest(request: PermissionRequest?) {
                runOnUiThread {
                    if (request == null) return@runOnUiThread
                    val host = request.origin?.host ?: "sitio web"

                    // Si la web pide micro/cámara, primero hay que tener el permiso
                    // nativo de la app (lo pide el sistema una única vez).
                    val appPerms = mutableListOf<String>()
                    if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
                        ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
                    ) {
                        appPerms.add(Manifest.permission.RECORD_AUDIO)
                    }
                    if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
                        ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
                    ) {
                        appPerms.add(Manifest.permission.CAMERA)
                    }

                    if (appPerms.isNotEmpty()) {
                        pendingPermissionRequest = request
                        requestPermissionsLauncher.launch(appPerms.toTypedArray())
                        return@runOnUiThread
                    }

                    when (webPermissionPrefs.getString("host:$host", null)) {
                        "yes" -> request.grant(request.resources)
                        "no" -> request.deny()
                        else -> showWebPermissionDialog(request, host)
                    }
                }
            }

            // Nota: onGeolocationPermissionsShowPrompt se deja por defecto,
            // así cada web muestra su propio diálogo nativo de ubicación.

            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                if (filePathCallback != null) {
                    filePathCallback?.onReceiveValue(null)
                }
                filePathCallback = callback

                val accepted = fileChooserParams?.acceptTypes.orEmpty().filter { it.isNotBlank() }
                val mimeTypes = if (accepted.isEmpty()) arrayOf("*/*") else accepted.toTypedArray()

                // Según cómo lo pida la web: selector único o múltiple.
                val multiple = fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE
                if (multiple) {
                    fileChooserLauncher.launch(mimeTypes)
                } else {
                    singleFileChooserLauncher.launch(mimeTypes)
                }
                return true
            }
        }

        webView.setBackgroundColor(Color.TRANSPARENT)

        webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            try {
                val request = DownloadManager.Request(Uri.parse(url))
                request.setMimeType(mimetype)
                
                val fileName = URLUtil.guessFileName(url, contentDisposition, mimetype)
                
                request.addRequestHeader("User-Agent", userAgent)
                val cookies = CookieManager.getInstance().getCookie(url)
                request.addRequestHeader("Cookie", cookies)
                
                request.setTitle(fileName)
                request.setDescription("Descargando archivo...")
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                
                Toast.makeText(this, "Iniciando descarga...", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                val intent = Intent(Intent.ACTION_VIEW)
                intent.data = Uri.parse(url)
                startActivity(intent)
            }
        }
    }

    /** Restringe el puente JS al shell local de la app */
    private fun isLocalOrigin(): Boolean =
        webView.url?.startsWith("file:///android_asset/") == true

    /** IPs/rangos privados: LAN, loopback, link-local, CGNAT 100.64/10 */
    private fun isPrivateAddress(host: String?): Boolean {
        if (host.isNullOrBlank()) return false
        val lower = host.lowercase(Locale.ROOT)
        if (lower == "localhost" ||
            lower.endsWith(".local") ||
            lower.endsWith(".internal") ||
            lower.endsWith(".lan")
        ) return true

        val parts = lower.split(".")
        if (parts.size != 4) return false
        val nums = parts.mapNotNull { it.toIntOrNull() }
        if (nums.size != 4) return false
        val (a, b) = nums
        return when (a) {
            0, 10, 127 -> true
            172 -> b in 16..31
            169 -> b == 254
            192 -> b == 168
            198 -> b in 18..19
            100 -> b in 64..127
            else -> false
        }
    }

    /** Solo errores típicos de certificado autofirmado (no caducado ni pinning) */
    private fun SslError.isSelfSignedLike(): Boolean = when (primaryError) {
        SslError.SSL_UNTRUSTED,
        SslError.SSL_IDMISMATCH,
        SslError.SSL_INVALID,
        SslError.SSL_NOTYETVALID,
        SslError.SSL_DATE_INVALID -> true
        else -> false
    }

    private fun showWebPermissionDialog(request: PermissionRequest, host: String) {
        val labels = request.resources
            .map { r ->
                when (r) {
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> "cámara"
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> "micrófono"
                    PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID -> "medios protegidos"
                    else -> r
                }
            }
            .distinct()
            .joinToString(", ")

        android.app.AlertDialog.Builder(this)
            .setTitle("Permiso de la web")
            .setMessage("\"$host\" quiere acceder a: $labels.")
            .setPositiveButton("Permitir") { _, _ ->
                webPermissionPrefs.edit().putString("host:$host", "yes").apply()
                request.grant(request.resources)
            }
            .setNegativeButton("Denegar") { _, _ ->
                webPermissionPrefs.edit().putString("host:$host", "no").apply()
                request.deny()
            }
            .setOnCancelListener { request.deny() }
            .show()
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
                Toast.makeText(this, "Recargando...", Toast.LENGTH_SHORT).show()
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

    private fun updateWebViewTheme() {
        // El "force dark" de Android reescribe los colores del CSS de la web en WebViews
        // antiguos (p.ej. Redmi 8/MIUI), aunque la web ya gestione su propio tema oscuro
        // con data-theme + prefers-color-scheme. Lo desactivamos por completo.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(webView.settings, WebSettingsCompat.FORCE_DARK_OFF)
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        updateWebViewTheme()
        webView.invalidate()
    }
}
