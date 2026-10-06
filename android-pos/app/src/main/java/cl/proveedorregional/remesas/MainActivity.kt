package cl.proveedorregional.remesas

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * Remesas on a TUU POS. The screens live in the web platform (/remesas); this app hosts them
 * in a WebView and hands the card payment to the TUU payment app (inter-app, Intent.ACTION_SEND).
 * The result goes back to the page, which reports it to the server. The server confirms the
 * sale in TUU reports before sending anything through Global66.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val prefs by lazy { getSharedPreferences("remesas", MODE_PRIVATE) }

    private val paymentLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val json = result.data?.getStringExtra("transactionResult") ?: "{}"
        deliver(result.resultCode == Activity.RESULT_OK, json)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)
        if (baseUrl().isEmpty() || serialNumber().isEmpty()) askSettings() else start()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun start() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = object : WebViewClient() {
            // Stay on the platform. Anything else opens outside the app.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (sameOrigin(request.url)) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
        }
        webView.addJavascriptInterface(TuuBridge(), "TuuBridge")
        webView.loadUrl("${baseUrl()}/remesas")
    }

    inner class TuuBridge {
        /** Called by the page with the JSON the server prepared (`tuuPayment`). */
        @JavascriptInterface
        fun pay(paymentJson: String) {
            runOnUiThread {
                if (!sameOrigin(Uri.parse(webView.url ?: ""))) return@runOnUiThread
                val intent = packageManager.getLaunchIntentForPackage(BuildConfig.TUU_PACKAGE)
                if (intent == null) {
                    deliver(false, JSONObject().put("errorMessage", "La app de pago TUU no está instalada").toString())
                    return@runOnUiThread
                }
                // Validates it is JSON before handing it over.
                val payload = try { JSONObject(paymentJson).toString() } catch (e: Exception) {
                    deliver(false, JSONObject().put("errorMessage", "Pago mal formado").toString())
                    return@runOnUiThread
                }
                intent.action = Intent.ACTION_SEND
                intent.flags = 0
                intent.putExtra(Intent.EXTRA_TEXT, payload)
                intent.type = "text/json"
                paymentLauncher.launch(intent)
            }
        }
    }

    private fun deliver(ok: Boolean, resultJson: String) {
        val script = "window.onTuuResult && window.onTuuResult($ok, ${JSONObject.quote(resultJson)}, ${JSONObject.quote(serialNumber())})"
        webView.evaluateJavascript(script, null)
    }

    private fun sameOrigin(uri: Uri): Boolean {
        val base = Uri.parse(baseUrl())
        return uri.scheme == "https" && uri.host == base.host && uri.port == base.port
    }

    private fun baseUrl(): String = prefs.getString("baseUrl", "")!!.trimEnd('/')
    private fun serialNumber(): String = prefs.getString("serialNumber", "")!!

    /** First run: platform address and the POS serial number (as registered in TUU). */
    private fun askSettings() {
        val url = EditText(this).apply {
            hint = "https://tu-plataforma.cl"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.getString("baseUrl", ""))
        }
        val serial = EditText(this).apply {
            hint = "Número de serie del POS"
            setText(prefs.getString("serialNumber", ""))
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 0)
            addView(url)
            addView(serial)
        }
        AlertDialog.Builder(this)
            .setTitle("Configurar POS")
            .setView(layout)
            .setCancelable(false)
            .setPositiveButton("Guardar") { _, _ ->
                val value = url.text.toString().trim().trimEnd('/')
                if (!value.startsWith("https://") || serial.text.isBlank()) {
                    askSettings()
                    return@setPositiveButton
                }
                prefs.edit().putString("baseUrl", value).putString("serialNumber", serial.text.toString().trim()).apply()
                start()
            }
            .show()
    }

    @Deprecated("Back navigation inside the WebView")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
