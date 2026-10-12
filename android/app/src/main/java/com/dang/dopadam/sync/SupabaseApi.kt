// Supabase client (GoTrue auth + PostgREST) over plain HttpURLConnection and org.json.
package com.dang.dopadam.sync

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** What survives a restart (encrypted with a Keystore key, see SessionStore). */
data class StoredSession(val refreshToken: String, val userId: String, val email: String?)

data class Session(val accessToken: String, val expiresAt: Long, val stored: StoredSession)

class AuthException(message: String) : Exception(message)

sealed class SyncException(message: String) : Exception(message) {
    class Unauthorized : SyncException("Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.")
    class Failed(message: String) : SyncException(message)
}

/** The REST calls the sync engine needs (an interface so the engine can be tested without a server). */
interface RestApi {
    fun upsert(table: String, rows: List<JSONObject>, ignoreDuplicates: Boolean, token: String)
    fun pull(table: String, since: String?, token: String, limit: Int): List<JSONObject>
}

/** Turns GoTrue's English error messages into what the user sees. */
fun friendlyAuthError(raw: String): String {
    val lower = raw.lowercase()
    return when {
        "invalid login credentials" in lower -> "Sai email hoặc mật khẩu."
        "email not confirmed" in lower -> "Email chưa được xác nhận. Mở thư xác nhận rồi đăng nhập lại."
        "already registered" in lower || "already been registered" in lower -> "Email này đã có tài khoản. Hãy đăng nhập."
        "password" in lower && ("at least" in lower || "short" in lower) -> "Mật khẩu cần ít nhất 6 ký tự."
        "rate limit" in lower -> "Gửi email quá nhiều lần, thử lại sau ít phút."
        raw.isEmpty() -> "Không kết nối được tới server."
        else -> raw
    }
}

class SupabaseApi(private val baseUrl: String, private val anonKey: String) : RestApi {
    private fun open(path: String, method: String, token: String? = null): HttpURLConnection =
        (URL("${baseUrl.trimEnd('/')}/$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("apikey", anonKey)
            setRequestProperty("Content-Type", "application/json")
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
        }

    private fun HttpURLConnection.send(body: String?) {
        if (body != null) {
            doOutput = true
            outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
    }

    private fun HttpURLConnection.text(): String {
        val stream = if (responseCode in 200..299) inputStream else errorStream
        return stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
    }

    private fun errorText(body: String): String = try {
        val o = JSONObject(body)
        listOf("error_description", "msg", "message", "error").firstNotNullOfOrNull { k -> o.optString(k).takeIf { it.isNotEmpty() } } ?: ""
    } catch (e: org.json.JSONException) {
        ""
    }

    private fun authPost(path: String, body: JSONObject): JSONObject {
        val conn = try {
            open("auth/v1/$path", "POST").apply { send(body.toString()) }
        } catch (e: IOException) {
            throw AuthException(friendlyAuthError(""))
        }
        try {
            val code = conn.responseCode
            val text = conn.text()
            if (code !in 200..299) throw AuthException(friendlyAuthError(errorText(text)))
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        } catch (e: IOException) {
            throw AuthException(friendlyAuthError(""))
        } finally {
            conn.disconnect()
        }
    }

    private fun sessionFrom(o: JSONObject, now: Long): Session? {
        val access = o.optString("access_token").takeIf { it.isNotEmpty() } ?: return null
        val refresh = o.optString("refresh_token").takeIf { it.isNotEmpty() } ?: return null
        val user = o.optJSONObject("user") ?: return null
        return Session(
            access,
            now + o.optLong("expires_in", 3600) * 1000,
            StoredSession(refresh, user.getString("id"), user.optString("email").takeIf { it.isNotEmpty() }),
        )
    }

    private fun token(grant: String, body: JSONObject, now: Long): Session =
        sessionFrom(authPost("token?grant_type=$grant", body), now) ?: throw AuthException("Server trả về phiên đăng nhập không hợp lệ.")

    fun signIn(email: String, password: String, now: Long) =
        token("password", JSONObject().put("email", email).put("password", password), now)

    /** null means the account was created and waits for the confirmation email. */
    fun signUp(email: String, password: String, now: Long): Session? =
        sessionFrom(authPost("signup", JSONObject().put("email", email).put("password", password)), now)

    fun refresh(refreshToken: String, now: Long) = token("refresh_token", JSONObject().put("refresh_token", refreshToken), now)

    /** Google ID token from Credential Manager; `nonce` is the raw nonce whose SHA-256 went into the request. */
    fun signInWithGoogle(idToken: String, nonce: String, now: Long) =
        token("id_token", JSONObject().put("provider", "google").put("id_token", idToken).put("nonce", nonce), now)

    private fun <T> rest(path: String, method: String, token: String, body: String?, prefer: String?, read: (String) -> T): T {
        val conn = try {
            open("rest/v1/$path", method, token).apply {
                if (prefer != null) setRequestProperty("Prefer", prefer)
                send(body)
            }
        } catch (e: IOException) {
            throw SyncException.Failed("Không kết nối được tới server.")
        }
        try {
            val code = conn.responseCode
            val text = conn.text()
            if (code == 401) throw SyncException.Unauthorized()
            if (code !in 200..299) throw SyncException.Failed("Server lỗi $code: ${errorText(text)}")
            return read(text)
        } catch (e: IOException) {
            throw SyncException.Failed("Không kết nối được tới server.")
        } finally {
            conn.disconnect()
        }
    }

    override fun upsert(table: String, rows: List<JSONObject>, ignoreDuplicates: Boolean, token: String) {
        if (rows.isEmpty()) return
        val resolution = if (ignoreDuplicates) "ignore-duplicates" else "merge-duplicates"
        rest("$table?on_conflict=user_id,id", "POST", token, JSONArray(rows).toString(), "resolution=$resolution,return=minimal") { }
    }

    override fun pull(table: String, since: String?, token: String, limit: Int): List<JSONObject> {
        val filter = since?.let { "&server_updated_at=gt.${URLEncoder.encode(it, "UTF-8")}" } ?: ""
        return rest("$table?select=*&order=server_updated_at.asc&limit=$limit$filter", "GET", token, null, null) { text ->
            val arr = JSONArray(text)
            (0 until arr.length()).map { arr.getJSONObject(it) }
        }
    }

    fun rpc(name: String, token: String) {
        rest("rpc/$name", "POST", token, "{}", null) { }
    }
}
