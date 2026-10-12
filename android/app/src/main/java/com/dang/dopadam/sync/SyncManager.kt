package com.dang.dopadam.sync

import android.content.Context
import android.os.Build
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.dang.dopadam.BuildConfig
import com.dang.dopadam.DopaDamApp
import com.dang.dopadam.data.Repository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

data class AccountState(
    val configured: Boolean,
    val signedIn: Boolean = false,
    val email: String? = null,
    val lastSync: Long? = null,
    val syncing: Boolean = false,
    val lastError: String? = null,
)

data class DeviceRow(val platform: String, val name: String, val lastSeen: Long, val thisDevice: Boolean)

/** Sign-in and background sync for the phone. Without Supabase settings everything here stays off. */
class SyncManager(context: Context, private val repo: Repository) {
    private val sessions = SessionStore(context)
    private val store = RoomSyncStore(repo.db, repo.prefs)
    private val api: SupabaseApi? =
        if (BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()) {
            SupabaseApi(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY)
        } else {
            null
        }
    private val mutex = Mutex()
    private var session: Session? = null
    private var lastSyncAt = 0L

    private val _state = MutableStateFlow(AccountState(configured = api != null, lastSync = repo.prefs.getLong("lastSync").takeIf { it > 0 }))
    val state: StateFlow<AccountState> = _state.asStateFlow()

    val googleConfigured: Boolean get() = api != null && BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank()

    private fun now() = System.currentTimeMillis()

    private fun publish() = _state.update {
        it.copy(signedIn = session != null, email = session?.stored?.email, lastSync = repo.prefs.getLong("lastSync").takeIf { t -> t > 0 })
    }

    /** Restores the stored sign-in (refreshing it needs the network; failures are retried at the next sync). */
    suspend fun restore() = withContext(Dispatchers.IO) {
        val stored = sessions.load() ?: return@withContext
        session = Session("", 0, stored)
        publish()
    }

    private suspend fun start(newSession: Session) {
        if (repo.prefs.getString("lastUserId") != newSession.stored.userId) {
            store.resetForNewAccount()
            repo.prefs.putString("lastUserId", newSession.stored.userId)
        }
        sessions.save(newSession.stored)
        session = newSession
        _state.update { it.copy(lastError = null) }
        publish()
    }

    private fun validate(email: String, password: String): String? = when {
        !email.contains('@') || email.trim().length < 5 -> "Email không hợp lệ."
        password.length < 6 -> "Mật khẩu cần ít nhất 6 ký tự."
        else -> null
    }

    /** Returns an error message, or null when signed in. */
    suspend fun signIn(email: String, password: String): String? = withContext(Dispatchers.IO) {
        val api = api ?: return@withContext "Chưa cấu hình server đồng bộ."
        validate(email, password)?.let { return@withContext it }
        try {
            start(api.signIn(email.trim(), password, now()))
            syncNow()
            null
        } catch (e: AuthException) {
            e.message
        }
    }

    /** "signed-in", "confirm-email", or an error message prefixed with "!". */
    suspend fun signUp(email: String, password: String): String = withContext(Dispatchers.IO) {
        val api = api ?: return@withContext "!Chưa cấu hình server đồng bộ."
        validate(email, password)?.let { return@withContext "!$it" }
        try {
            val s = api.signUp(email.trim(), password, now())
            if (s == null) {
                "confirm-email"
            } else {
                start(s)
                syncNow()
                "signed-in"
            }
        } catch (e: AuthException) {
            "!${e.message}"
        }
    }

    /** A nonce pair for Google sign-in: the hash goes into the Google request, the raw value to Supabase. */
    fun newNonce(): Pair<String, String> {
        val raw = UUID.randomUUID().toString()
        val hashed = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray()).joinToString("") { "%02x".format(it) }
        return raw to hashed
    }

    suspend fun signInWithGoogle(idToken: String, rawNonce: String): String? = withContext(Dispatchers.IO) {
        val api = api ?: return@withContext "Chưa cấu hình server đồng bộ."
        try {
            start(api.signInWithGoogle(idToken, rawNonce, now()))
            syncNow()
            null
        } catch (e: AuthException) {
            e.message
        }
    }

    fun signOut() {
        sessions.clear()
        session = null
        publish()
    }

    private suspend fun freshToken(force: Boolean): String {
        val api = api ?: throw SyncException.Failed("Chưa cấu hình server đồng bộ.")
        val s = session ?: throw SyncException.Failed("Chưa đăng nhập.")
        if (!force && s.expiresAt - now() > 60_000) return s.accessToken
        val fresh = try {
            api.refresh(s.stored.refreshToken, now())
        } catch (e: AuthException) {
            if ("refresh token" in (e.message ?: "").lowercase()) throw SyncException.Unauthorized()
            throw SyncException.Failed(e.message ?: "")
        }
        sessions.save(fresh.stored)
        session = fresh
        return fresh.accessToken
    }

    /** Runs one sync now; returns an error message or null. */
    suspend fun syncNow(): String? = withContext(Dispatchers.IO) {
        val api = api ?: return@withContext "Chưa cấu hình server đồng bộ."
        if (session == null) return@withContext "Chưa đăng nhập."
        if (!mutex.tryLock()) return@withContext null
        _state.update { it.copy(syncing = true) }
        val device = DeviceInfo("${Build.MANUFACTURER} ${Build.MODEL}".trim(), BuildConfig.VERSION_NAME)
        val error = try {
            try {
                SyncEngine.syncOnce(store, api, freshToken(false), device, now())
            } catch (e: SyncException.Unauthorized) {
                SyncEngine.syncOnce(store, api, freshToken(true), device, now())
            }
            repo.prefs.putLong("lastSync", now())
            null
        } catch (e: SyncException.Unauthorized) {
            signOut()
            e.message
        } catch (e: SyncException) {
            e.message
        } finally {
            lastSyncAt = now()
            mutex.unlock()
        }
        _state.update { it.copy(syncing = false, lastError = error) }
        publish()
        error
    }

    /** Called every minute while the screen is on, and by the background worker. */
    suspend fun maybeSync(minIntervalMs: Long = 60_000) {
        if (api == null || session == null || now() - lastSyncAt < minIntervalMs) return
        syncNow()
    }

    suspend fun devices(): List<DeviceRow> = withContext(Dispatchers.IO) {
        val api = api ?: return@withContext emptyList()
        try {
            val me = repo.deviceId
            api.pull("devices", null, freshToken(false), 100).map {
                DeviceRow(it.optString("platform"), it.optString("name"), it.optLong("last_seen"), it.optString("id") == me)
            }
        } catch (e: SyncException) {
            emptyList()
        }
    }

    /** Deletes the account's data on the server and the log on this phone, then signs out. */
    suspend fun deleteServerData(): String? = withContext(Dispatchers.IO) {
        val api = api ?: return@withContext "Chưa cấu hình server đồng bộ."
        try {
            api.rpc("delete_my_data", freshToken(false))
            repo.clearLog(true)
            signOut()
            null
        } catch (e: SyncException) {
            e.message
        }
    }
}

/** Background sync every 15 minutes when there is a network. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        (applicationContext as DopaDamApp).sync.maybeSync(minIntervalMs = 0)
        return Result.success()
    }

    companion object {
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
