package com.ksprintexpress.fitfusion

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.libraries.places.api.net.PlacesStatusCodes
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.ktx.auth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.ktx.firestore
import com.google.firebase.ktx.Firebase
import java.io.ByteArrayInputStream
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import kotlin.coroutines.cancellation.CancellationException

/**
 * Keys the shop changes on the admin site's App Keys page (keys.html), so the app can be handed to a shop with
 * its own accounts without a new build: the Snap Camera Kit token, Lens Group and Lens (AR try-on), and the
 * Cloudinary cloud and unsigned upload preset (image uploads).
 *
 * They are kept in Firestore at `appConfig/keys`, which signed-in users can read and only a super admin can
 * change. A blank or missing field means "use the value built into the app" (the constants in ARTryOnScreen.kt,
 * the token in AndroidManifest.xml, the Cloudinary values in local.properties). The last values read are kept
 * on the phone, so the app has them before Firestore answers and while offline.
 *
 * The same page also holds the Google key for address search and the payment server's address (the PayMongo
 * secret key itself stays on that server). Keys that can't change after the app is built (the Google map picture,
 * Firebase itself) are explained on the same admin page.
 */
object AppKeys {
    private const val TAG = "AppKeys"
    private const val PREFS = "app_keys"

    // Field names in appConfig/keys (same as keys.html on the admin site)
    private const val K_SNAP_TOKEN = "snapApiToken"
    private const val K_SNAP_GROUP = "snapLensGroupId"
    private const val K_SNAP_LENS_NAME = "snapLensName"
    private const val K_SNAP_LENS_ID = "snapLensId"
    private const val K_CLOUD_NAME = "cloudinaryCloudName"
    private const val K_UPLOAD_PRESET = "cloudinaryUploadPreset"
    private const val K_MAPS_KEY = "mapsApiKey"
    private const val K_PAY_SERVER = "paymentServerUrl"
    private val FIELDS = listOf(K_SNAP_TOKEN, K_SNAP_GROUP, K_SNAP_LENS_NAME, K_SNAP_LENS_ID, K_CLOUD_NAME, K_UPLOAD_PRESET, K_MAPS_KEY, K_PAY_SERVER)

    private var prefs: SharedPreferences? = null
    private var listener: ListenerRegistration? = null

    /** Only the fields the shop has filled in. */
    @Volatile
    private var saved: Map<String, String> = emptyMap()

    /** Called once from MainActivity: loads the copy on the phone, then follows Firestore while someone is signed in. */
    fun init(context: Context) {
        if (prefs != null) return
        val p = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs = p
        saved = FIELDS.mapNotNull { key -> p.getString(key, null)?.takeIf { it.isNotBlank() }?.let { key to it } }.toMap()
        val appContext = context.applicationContext
        Firebase.auth.addAuthStateListener { auth ->
            if (auth.currentUser != null) {
                listen()
                AppStatus.reportBuild(appContext)
            } else {
                stopListening()
            }
        }
    }

    private fun listen() {
        if (listener != null) return
        listener = Firebase.firestore.collection("appConfig").document("keys")
            .addSnapshotListener { snap, error ->
                if (error != null || snap == null) {
                    // Most likely the Firestore rule for appConfig isn't published yet; keep the last values.
                    Log.w(TAG, "Couldn't read appConfig/keys; using the last saved or built-in keys", error)
                    return@addSnapshotListener
                }
                val fresh = FIELDS.mapNotNull { key ->
                    snap.getString(key)?.trim()?.takeIf { it.isNotEmpty() }?.let { key to it }
                }.toMap()
                if (fresh != saved) Log.i(TAG, "Keys from the admin site: ${fresh.keys.ifEmpty { setOf("none") }}")
                saved = fresh
                prefs?.edit()?.apply {
                    clear()
                    fresh.forEach { (k, v) -> putString(k, v) }
                    apply()
                }
            }
    }

    private fun stopListening() {
        listener?.remove()
        listener = null
    }

    // ── Snap Camera Kit (AR try-on) ─────────────────────────────────────────────────────────────────────────
    // The token and the Lens Group must come from the same Camera Kit app, so they're only used as a pair.

    private val hasOwnSnap: Boolean
        get() = saved[K_SNAP_TOKEN] != null && saved[K_SNAP_GROUP] != null

    /** The shop's Camera Kit token, or null for the one in AndroidManifest.xml. */
    val snapApiToken: String?
        get() = if (hasOwnSnap) saved[K_SNAP_TOKEN] else null

    val snapLensGroupId: String
        get() = if (hasOwnSnap) saved.getValue(K_SNAP_GROUP) else SNAP_LENS_GROUP_ID

    val snapLensName: String
        get() = saved[K_SNAP_LENS_NAME] ?: SNAP_SHIRT_LENS_NAME

    /** Whether the Lens group in use is the one built into the app (also true when the admin site saved that one). */
    private val usesBuiltInGroup: Boolean
        get() = snapLensGroupId == SNAP_LENS_GROUP_ID

    /** A Lens id to pin, or null to find the Lens by [snapLensName]. */
    val snapLensId: String?
        get() = saved[K_SNAP_LENS_ID] ?: if (usesBuiltInGroup) SNAP_SHIRT_LENS_ID else null

    // ── Cloudinary (image uploads) ──────────────────────────────────────────────────────────────────────────

    private val hasOwnCloudinary: Boolean
        get() = saved[K_CLOUD_NAME] != null && saved[K_UPLOAD_PRESET] != null

    val cloudinaryCloudName: String
        get() = if (hasOwnCloudinary) saved.getValue(K_CLOUD_NAME) else BuildConfig.CLOUDINARY_CLOUD_NAME

    val cloudinaryUploadPreset: String
        get() = if (hasOwnCloudinary) saved.getValue(K_UPLOAD_PRESET) else BuildConfig.CLOUDINARY_UPLOAD_PRESET

    // ── Google (address search) ─────────────────────────────────────────────────────────────────────────────

    /** The shop's Google key for address search, or null for the one built into the app (maps.api.key). The map
     *  picture itself always uses the built-in key: Google's map only reads its key from the app file. */
    val mapsApiKey: String?
        get() = saved[K_MAPS_KEY]

    // ── Payment server (PayMongo, on Render) ────────────────────────────────────────────────────────────────

    /** The address of the shop's payment server (like https://fitfusion-payments.onrender.com), without a
     *  trailing slash, or null when it isn't set up yet (then the app uses the PayMongo key built into it). */
    val paymentServerUrl: String?
        get() = saved[K_PAY_SERVER]?.trim()?.trimEnd('/')?.takeIf { Regex("^https://[^\\s/?#]+(/[^\\s?#]*)?$").matches(it) }
}

/**
 * Feeds the admin site's App Keys checklist. PayMongo, Google Maps and the signing key are built into the app,
 * so the admin site can't check them itself; the app says which kind it was built with and whether each one
 * worked the last time it was used. Saved on the signed-in user's own users/{uid}.appStatus (like the usage
 * counts), and only as labels such as "test", "missing" or "denied", never a key itself.
 */
object AppStatus {
    private const val TAG = "AppStatus"

    /** What this run of the app already sent, so the same result isn't written over and over. */
    private val sent = HashMap<String, String>()

    /** Which keys this build carries. Once per run, after sign-in. */
    fun reportBuild(context: Context) {
        if (!once("build", "sent")) return
        val payMongo = BuildConfig.PAYMONGO_SECRET_KEY
        val mapsKey = context.getString(R.string.maps_api_key)
        write(
            mapOf(
                "version" to "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                "firebaseProject" to (FirebaseApp.getInstance().options.projectId ?: ""),
                "signing" to when (signedWithDebugKey(context)) {
                    true -> "debug"
                    false -> "release"
                    null -> "unknown"
                },
                "paymongoKey" to when {
                    payMongo.isBlank() -> "missing"
                    payMongo.startsWith("sk_live_") -> "live"
                    payMongo.startsWith("sk_test_") -> "test"
                    else -> "unknown"
                },
                "mapsKey" to when {
                    mapsKey.isBlank() -> "missing"
                    mapsKey.startsWith("AIza") -> "set"
                    else -> "unknown"
                },
                // Whether this build sends payments through the Cloud Function (PayMongoService)
                "paymentsVia" to "server",
                "reportedAt" to FieldValue.serverTimestamp()
            )
        )
    }

    /** How AR try-on went: the Lens loaded, the group has no shirt Lens, or Snap refused the token. */
    fun reportSnap(state: SnapLensState) {
        val (result, detail) = when (state) {
            is SnapLensState.Active -> "active" to state.lensName
            is SnapLensState.NoShirtLens -> "no-shirt-lens" to ""
            is SnapLensState.Error -> (if (state.tokenRejected) "token-rejected" else "error") to state.message.take(160)
            else -> return
        }
        val group = AppKeys.snapLensGroupId
        if (!once("snap", "$result|$detail|$group")) return
        write(mapOf("snapCheck" to result, "snapDetail" to detail, "snapGroup" to group, "snapAt" to FieldValue.serverTimestamp()))
    }

    /** How an address search went; [error] is null when it worked. Connection problems aren't the key's fault. */
    fun reportPlaces(error: Exception?) {
        val keySource = if (AppKeys.mapsApiKey != null) "admin" else "build"
        val result = when {
            error == null -> "ok"
            error is CancellationException -> return
            error is MissingMapsKeyException -> "missing-key"
            error is ApiException && error.statusCode == PlacesStatusCodes.REQUEST_DENIED -> "denied"
            error is ApiException && error.statusCode == CommonStatusCodes.NETWORK_ERROR -> return
            error is ApiException -> "error"
            else -> return
        }
        if (!once("places", "$result|$keySource")) return
        write(mapOf("placesCheck" to result, "placesKey" to keySource, "placesAt" to FieldValue.serverTimestamp()))
    }

    /**
     * Whether PayMongo accepted the secret key when a GCash payment was started, and where the key was:
     * "server" (saved on the admin site, used by the Cloud Function) or "app" (built in, the older way).
     */
    fun reportPayMongo(accepted: Boolean, via: String = "server") {
        val result = if (accepted) "ok" else "rejected"
        if (!once("paymongo", "$result|$via")) return
        write(mapOf("paymongoCheck" to result, "paymongoVia" to via, "paymongoAt" to FieldValue.serverTimestamp()))
    }

    /** True the first time [value] is reported for [what] in this run. */
    private fun once(what: String, value: String): Boolean = synchronized(sent) {
        if (sent[what] == value) false else { sent[what] = value; true }
    }

    private fun write(fields: Map<String, Any?>) {
        val uid = Firebase.auth.currentUser?.uid ?: return
        Firebase.firestore.collection("users").document(uid)
            .set(mapOf("appStatus" to fields), SetOptions.merge())
            .addOnFailureListener { Log.w(TAG, "Couldn't save the app status for the admin site", it) }
    }

    /** Whether the installed app is signed with an Android debug key (fine for testing, not for Google Play). */
    @Suppress("DEPRECATION")
    private fun signedWithDebugKey(context: Context): Boolean? = try {
        val pm = context.packageManager
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
        } else {
            pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures
        }
        val factory = CertificateFactory.getInstance("X.509")
        signatures?.any { signature ->
            val cert = factory.generateCertificate(ByteArrayInputStream(signature.toByteArray())) as X509Certificate
            cert.subjectX500Principal.name.contains("CN=Android Debug")
        }
    } catch (e: Exception) {
        Log.w(TAG, "Couldn't read the signing certificate", e)
        null
    }
}

/**
 * Checkout prices and rules set on the admin site's Shop Settings page (Firestore `appConfig/shop`, which signed-in
 * users can read and a super admin changes): the shipping fee, the subtotal that ships free, and the downpayment
 * offer. A missing or invalid value keeps the default below (the amounts the app always used). The last values read
 * are kept on the phone. Compose state, so the cart updates as soon as the shop changes them.
 */
object ShopSettings {
    private const val TAG = "ShopSettings"
    private const val PREFS = "shop_settings"

    var shippingFee by mutableStateOf(99.0)
        private set
    /** Subtotal from which shipping is free; 0 = never free. */
    var freeShippingMin by mutableStateOf(1500.0)
        private set
    var downpaymentEnabled by mutableStateOf(true)
        private set
    /** Share paid at checkout, in percent (10–90). */
    var downpaymentPercent by mutableStateOf(50)
        private set
    /** Items in the cart before the downpayment is offered. */
    var downpaymentMinItems by mutableStateOf(10)
        private set
    /** The shop's own Terms & Privacy text (title to body), set on Shop Settings; empty = the app's built-in text. */
    var terms by mutableStateOf<List<Pair<String, String>>>(emptyList())
        private set

    /** Shipping for a cart worth [subtotal]. */
    fun shippingFor(subtotal: Double): Double =
        if (freeShippingMin > 0 && subtotal >= freeShippingMin) 0.0 else shippingFee

    /** How much more the cart needs for free shipping, or null when it already ships free or never can. */
    fun untilFreeShipping(subtotal: Double): Double? =
        if (freeShippingMin <= 0 || shippingFee <= 0 || subtotal >= freeShippingMin) null else freeShippingMin - subtotal

    val downpaymentFraction: Double get() = downpaymentPercent / 100.0

    /** Whether a cart of [items] pieces may pay with a downpayment. */
    fun offersDownpayment(items: Int): Boolean = downpaymentEnabled && items >= downpaymentMinItems

    private var prefs: SharedPreferences? = null
    private var listener: ListenerRegistration? = null

    /** Called once from MainActivity: loads the copy on the phone, then follows Firestore while someone is signed in. */
    fun init(context: Context) {
        if (prefs != null) return
        val p = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs = p
        applyValues(p.all.mapValues { it.value })
        Firebase.auth.addAuthStateListener { auth ->
            if (auth.currentUser != null) listen() else { listener?.remove(); listener = null }
        }
    }

    private fun listen() {
        if (listener != null) return
        listener = Firebase.firestore.collection("appConfig").document("shop").addSnapshotListener { snap, error ->
            if (error != null || snap == null) {
                Log.w(TAG, "Couldn't read appConfig/shop; keeping the last saved or default settings", error)
                return@addSnapshotListener
            }
            val d = snap.data.orEmpty()
            applyValues(d)
            prefs?.edit()?.apply {
                clear()
                (d["shippingFee"] as? Number)?.let { putFloat("shippingFee", it.toFloat()) }
                (d["freeShippingMin"] as? Number)?.let { putFloat("freeShippingMin", it.toFloat()) }
                (d["downpaymentEnabled"] as? Boolean)?.let { putBoolean("downpaymentEnabled", it) }
                (d["downpaymentPercent"] as? Number)?.let { putFloat("downpaymentPercent", it.toFloat()) }
                (d["downpaymentMinItems"] as? Number)?.let { putFloat("downpaymentMinItems", it.toFloat()) }
                putString("terms", org.json.JSONArray(terms.map { (t, b) -> org.json.JSONObject().put("title", t).put("body", b) }).toString())
                apply()
            }
        }
    }

    private fun applyValues(d: Map<String, Any?>) {
        shippingFee = (d["shippingFee"] as? Number)?.toDouble()?.takeIf { it >= 0 } ?: 99.0
        freeShippingMin = (d["freeShippingMin"] as? Number)?.toDouble()?.takeIf { it >= 0 } ?: 1500.0
        downpaymentEnabled = d["downpaymentEnabled"] as? Boolean ?: true
        downpaymentPercent = (d["downpaymentPercent"] as? Number)?.toInt()?.takeIf { it in 10..90 } ?: 50
        downpaymentMinItems = (d["downpaymentMinItems"] as? Number)?.toInt()?.takeIf { it >= 1 } ?: 10
        terms = when (val t = d["terms"]) {
            // From Firestore: a list of {title, body}
            is List<*> -> t.mapNotNull { item ->
                val m = item as? Map<*, *> ?: return@mapNotNull null
                val title = (m["title"] as? String)?.trim().orEmpty()
                val body = (m["body"] as? String)?.trim().orEmpty()
                if (title.isEmpty() && body.isEmpty()) null else title to body
            }
            // From the copy on the phone: the same as JSON text
            is String -> try {
                val arr = org.json.JSONArray(t)
                (0 until arr.length()).map { arr.getJSONObject(it).let { o -> o.optString("title") to o.optString("body") } }
            } catch (_: Exception) { emptyList() }
            else -> emptyList()
        }
    }
}

/** Pesos without centavos when there are none: 99 -> "₱99", 1500 -> "₱1,500", 99.5 -> "₱99.50". */
fun pesoText(amount: Double): String =
    if (amount % 1.0 == 0.0) "₱" + String.format(java.util.Locale.US, "%,d", amount.toLong())
    else "₱" + String.format(java.util.Locale.US, "%,.2f", amount)
