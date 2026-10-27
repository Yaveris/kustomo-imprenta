package com.ksprintexpress.fitfusion

import android.util.Base64
import android.util.Log
import com.google.firebase.auth.ktx.auth
import com.google.firebase.ktx.Firebase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * PayMongo API helper — GCash Sources + Payments.
 *
 * Normally every step goes through FitFusion's payment server (the FitFusionServer folder, running on Render),
 * which holds PayMongo's secret key: the shop saves the key and the server's address on the admin site's App Keys
 * page, and the key never reaches the phone. Changing the PayMongo account needs no new app build.
 *
 * Until the server's address and a key are saved there, the app falls back to the older way: calling PayMongo
 * itself with `paymongo.secret.key` from local.properties, if this build has one. Once payments work through the
 * server, leave that line empty in local.properties so the next build carries no secret at all.
 */
object PayMongoService {
    private const val TAG = "PayMongo"

    /** What the payment server answered with an error code (see server.js), or couldn't be reached. */
    private class ServerError(val status: Int, val code: String, message: String) : Exception(message)

    /** Render's free plan sleeps after 15 quiet minutes; waking it can take up to a minute. */
    private val serverClient = OkHttpClient.Builder()
        .connectTimeout(90, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    /** Wakes the payment server while the customer is still in the cart, so paying isn't slowed down. */
    suspend fun wakeServer() {
        val url = AppKeys.paymentServerUrl ?: return
        withContext(Dispatchers.IO) {
            try {
                serverClient.newCall(Request.Builder().url("$url/health").get().build()).execute().close()
            } catch (e: Exception) {
                Log.w(TAG, "Couldn't reach the payment server yet", e)
            }
        }
    }

    /** True when the server can't take the call yet (no address saved, not deployed there, or no key saved). */
    private fun serverNotReady(e: ServerError): Boolean =
        e.status == 404 || e.code == "failed-precondition"

    /** One step on the payment server, signed in as the customer. */
    private suspend fun post(url: String, step: String, data: Map<String, Any>): JSONObject {
        val user = Firebase.auth.currentUser ?: throw Exception("Please sign in again to pay.")
        val token = user.getIdToken(false).await().token ?: throw Exception("Please sign in again to pay.")
        return withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$url/paymongo/$step")
                .addHeader("Authorization", "Bearer $token")
                .post(JSONObject(data).toString().toRequestBody(JSON_MEDIA))
                .build()
            val response = try {
                serverClient.newCall(request).execute()
            } catch (e: IOException) {
                throw Exception("Couldn't reach the payment server. Check your connection and try again.", e)
            }
            response.use {
                val raw = it.body?.string().orEmpty()
                val json = try { JSONObject(raw) } catch (e: Exception) { null }
                if (!it.isSuccessful || json == null) {
                    // Render answers 404 with a plain page when nothing is deployed at that address
                    throw ServerError(it.code, json?.optString("error").orEmpty(), json?.optString("message").orEmpty().ifBlank { "HTTP ${it.code}" })
                }
                json
            }
        }
    }

    /** Calls the payment server; null when it isn't ready and this build can do it the old way. */
    private suspend fun callServer(step: String, data: Map<String, Any>): JSONObject? {
        val url = AppKeys.paymentServerUrl
        if (url == null) {
            if (BuildConfig.PAYMONGO_SECRET_KEY.isNotBlank()) return null
            throw Exception("GCash payments aren't set up yet. Please contact the shop.")
        }
        return try {
            post(url, step, data)
        } catch (e: ServerError) {
            if (serverNotReady(e) && BuildConfig.PAYMONGO_SECRET_KEY.isNotBlank()) {
                Log.w(TAG, "Payment server not ready ($step: ${e.status} ${e.code}); using the key built into the app")
                return null
            }
            Log.w(TAG, "Payment server refused $step: ${e.status} ${e.code} ${e.message}")
            when {
                e.message == "paymongo-key-rejected" -> {
                    AppStatus.reportPayMongo(accepted = false)
                    throw Exception("GCash payments aren't available right now. Please try again later or contact the shop.")
                }
                serverNotReady(e) -> throw Exception("GCash payments aren't set up yet. Please contact the shop.")
                e.message == "account-disabled" -> throw Exception("This account can't place orders. Please contact the shop.")
                e.status == 401 -> throw Exception("Please sign in again to pay.")
                else -> throw Exception("The payment didn't go through (${e.message}). Please try again.")
            }
        }
    }

    /** Built in from `paymongo.secret.key` in local.properties (see app/build.gradle.kts); only the fallback. */
    private val SECRET_KEY: String
        get() = BuildConfig.PAYMONGO_SECRET_KEY.ifBlank {
            throw IllegalStateException(
                "GCash payments aren't set up yet: add paymongo.secret.key to local.properties and rebuild the app."
            )
        }

    private const val BASE_URL = "https://api.paymongo.com/v1"

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

    /** Basic-auth header value for PayMongo (base64 of "secretKey:") */
    private fun authHeader(): String =
        "Basic " + Base64.encodeToString(
            "$SECRET_KEY:".toByteArray(Charsets.UTF_8),
            Base64.NO_WRAP
        )

    // ── Result types ──────────────────────────────────────────────────────────

    data class GCashSource(
        val id: String,
        val checkoutUrl: String,
        val status: String          // "pending" right after creation
    )

    // ── API calls ─────────────────────────────────────────────────────────────

    /**
     * Step 1 — Create a GCash source.
     * Returns a [GCashSource] whose [GCashSource.checkoutUrl] should be opened
     * in a Chrome Custom Tab so the customer can authenticate with GCash.
     *
     * @param amountCentavos  Amount in Philippine centavos (₱1 = 100 centavos).
     * @param successUrl      Deep-link that PayMongo will redirect to on success.
     * @param failedUrl       Deep-link that PayMongo will redirect to on failure.
     */
    suspend fun createGCashSource(
        amountCentavos: Long,
        successUrl: String,
        failedUrl: String
    ): GCashSource {
        callServer(
            "create-source",
            mapOf("amountCentavos" to amountCentavos, "successUrl" to successUrl, "failedUrl" to failedUrl)
        )?.let { r ->
            AppStatus.reportPayMongo(accepted = true)
            return GCashSource(
                id = r.getString("id"),
                checkoutUrl = r.getString("checkoutUrl"),
                status = r.optString("status", "pending")
            )
        }
        return createGCashSourceDirect(amountCentavos, successUrl, failedUrl)
    }

    private suspend fun createGCashSourceDirect(
        amountCentavos: Long,
        successUrl: String,
        failedUrl: String
    ): GCashSource = withContext(Dispatchers.IO) {

        val body = JSONObject().apply {
            put("data", JSONObject().apply {
                put("attributes", JSONObject().apply {
                    put("amount", amountCentavos)
                    put("currency", "PHP")
                    put("type", "gcash")
                    put("redirect", JSONObject().apply {
                        put("success", successUrl)
                        put("failed", failedUrl)
                    })
                })
            })
        }.toString()

        val request = Request.Builder()
            .url("$BASE_URL/sources")
            .addHeader("Authorization", authHeader())
            .post(body.toRequestBody(JSON_MEDIA))
            .build()

        val response = client.newCall(request).execute()
        val raw = response.body?.string() ?: throw Exception("Empty response from PayMongo")

        if (!response.isSuccessful) {
            if (response.code == 401) AppStatus.reportPayMongo(accepted = false, via = "app")
            throw Exception("PayMongo /sources error ${response.code}: $raw")
        }
        AppStatus.reportPayMongo(accepted = true, via = "app")

        val data  = JSONObject(raw).getJSONObject("data")
        val attrs = data.getJSONObject("attributes")

        GCashSource(
            id          = data.getString("id"),
            checkoutUrl = attrs.getJSONObject("redirect").getString("checkout_url"),
            status      = attrs.getString("status")
        )
    }

    /**
     * Step 1b — Poll source status after the customer finishes in GCash.
     * Returns "pending", "chargeable", "cancelled", or "expired".
     * Proceed with createPayment() only when status == "chargeable".
     */
    suspend fun retrieveSource(sourceId: String): String {
        callServer("source-status", mapOf("sourceId" to sourceId))?.let { return it.optString("status", "pending") }
        return retrieveSourceDirect(sourceId)
    }

    private suspend fun retrieveSourceDirect(sourceId: String): String = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$BASE_URL/sources/$sourceId")
            .addHeader("Authorization", authHeader())
            .get()
            .build()

        val response = client.newCall(request).execute()
        val raw = response.body?.string() ?: throw Exception("Empty response from PayMongo")

        if (!response.isSuccessful)
            throw Exception("PayMongo /sources GET error ${response.code}: $raw")

        JSONObject(raw)
            .getJSONObject("data")
            .getJSONObject("attributes")
            .getString("status")
    }

    /**
     * Step 2 — Capture the payment after the customer authorises in GCash.
     * Call this once [PayMongoState.PaymentResult.SUCCESS] is received via deep-link.
     *
     * @return `true` if the payment status is "paid".
     */
    suspend fun createPayment(
        sourceId: String,
        amountCentavos: Long,
        description: String
    ): Boolean {
        // The server charges the amount the customer approved in GCash
        callServer("create-payment", mapOf("sourceId" to sourceId, "description" to description))
            ?.let { return it.optBoolean("paid", false) }
        return createPaymentDirect(sourceId, amountCentavos, description)
    }

    private suspend fun createPaymentDirect(
        sourceId: String,
        amountCentavos: Long,
        description: String
    ): Boolean = withContext(Dispatchers.IO) {

        val body = JSONObject().apply {
            put("data", JSONObject().apply {
                put("attributes", JSONObject().apply {
                    put("amount", amountCentavos)
                    put("currency", "PHP")
                    put("description", description)
                    put("source", JSONObject().apply {
                        put("id", sourceId)
                        put("type", "source")
                    })
                })
            })
        }.toString()

        val request = Request.Builder()
            .url("$BASE_URL/payments")
            .addHeader("Authorization", authHeader())
            .post(body.toRequestBody(JSON_MEDIA))
            .build()

        val response = client.newCall(request).execute()
        val raw = response.body?.string() ?: throw Exception("Empty response from PayMongo")

        if (!response.isSuccessful)
            throw Exception("PayMongo /payments error ${response.code}: $raw")

        val status = JSONObject(raw)
            .getJSONObject("data")
            .getJSONObject("attributes")
            .getString("status")

        status == "paid"
    }
}
