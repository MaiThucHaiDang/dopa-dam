// Sign-in (Google through Credential Manager, or email + password) and sync status, part of Settings.
package com.dang.dopadam.ui

import android.annotation.SuppressLint
import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dang.dopadam.BuildConfig
import com.dang.dopadam.DopaDamApp
import com.dang.dopadam.sync.DeviceRow
import com.dang.dopadam.sync.SyncManager
import com.dang.dopadam.ui.theme.Tokens
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import kotlinx.coroutines.launch

private val PLATFORM = mapOf("android" to "Điện thoại Android", "windows" to "Máy tính Windows", "extension" to "Extension")

private fun ago(at: Long): String {
    val minutes = (System.currentTimeMillis() - at) / 60_000
    return when {
        minutes < 1 -> "vừa xong"
        minutes < 60 -> "$minutes phút trước"
        minutes < 48 * 60 -> "${minutes / 60} giờ trước"
        else -> "${minutes / 1440} ngày trước"
    }
}

/** Google account picker (Credential Manager), then the ID token goes to Supabase with the raw nonce. */
// The lint check misses the GoogleIdTokenCredential use below (it is reached through a CustomCredential).
@SuppressLint("CredentialManagerSignInWithGoogle")
private suspend fun googleSignIn(activity: Activity?, sync: SyncManager): String? {
    if (activity == null) return "Không mở được đăng nhập Google."
    val (raw, hashed) = sync.newNonce()
    val option = GetGoogleIdOption.Builder()
        .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
        .setFilterByAuthorizedAccounts(false)
        .setNonce(hashed)
        .build()
    return try {
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val credential = CredentialManager.create(activity).getCredential(activity, request).credential
        if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            sync.signInWithGoogle(GoogleIdTokenCredential.createFrom(credential.data).idToken, raw)
        } else {
            "Tài khoản Google không hợp lệ."
        }
    } catch (e: GetCredentialCancellationException) {
        null
    } catch (e: GetCredentialException) {
        "Đăng nhập Google không thành công: ${e.message ?: e.type}"
    } catch (e: GoogleIdTokenParsingException) {
        "Đăng nhập Google không thành công."
    }
}

@Composable
fun AccountSection(vm: MainViewModel) {
    val context = LocalContext.current
    val sync = (context.applicationContext as DopaDamApp).sync
    val state by sync.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var devices by remember { mutableStateOf<List<DeviceRow>>(emptyList()) }

    LaunchedEffect(state.signedIn, state.lastSync) {
        devices = if (state.signedIn) sync.devices() else emptyList()
    }

    fun run(block: suspend () -> String?) {
        scope.launch {
            busy = true
            message = block()
            busy = false
        }
    }

    SectionCard("Tài khoản và đồng bộ") {
        when {
            !state.configured -> Muted(
                "Chưa cấu hình server đồng bộ. DopaDam vẫn chạy đầy đủ trên điện thoại; để đồng bộ với máy tính, làm theo mục Supabase trong README rồi build lại.",
            )
            state.signedIn -> {
                Text("Đã đăng nhập: ${state.email ?: "tài khoản Google"}")
                Muted(
                    when {
                        state.syncing -> "Đang đồng bộ…"
                        state.lastSync != null -> "Đồng bộ lần cuối ${ago(state.lastSync!!)}"
                        else -> "Chưa đồng bộ lần nào"
                    },
                )
                for (d in devices) {
                    Muted("${PLATFORM[d.platform] ?: d.platform} · ${d.name} · ${if (d.thisDevice) "máy này" else "lần cuối ${ago(d.lastSeen)}"}")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
                    OutlinedButton(onClick = { run { sync.syncNow() ?: "Đã đồng bộ." } }, enabled = !busy && !state.syncing) { Text("Đồng bộ ngay") }
                    TextButton(onClick = { sync.signOut() }) { Text("Đăng xuất") }
                }
                TextButton(onClick = { vm.deleteServerData() }) { Text("Xóa dữ liệu trên server") }
            }
            else -> {
                Muted("Đăng nhập để dùng chung tag, Chế độ Học và bộ đếm với máy tính. Không đăng nhập thì mọi dữ liệu chỉ nằm trên điện thoại.")
                if (sync.googleConfigured) {
                    Button(onClick = { run { googleSignIn(context as? Activity, sync) } }, enabled = !busy) { Text("Đăng nhập bằng Google") }
                }
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Mật khẩu (ít nhất 6 ký tự)") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Tokens.SpaceSm)) {
                    OutlinedButton(onClick = { run { sync.signIn(email, password) } }, enabled = !busy) { Text("Đăng nhập") }
                    TextButton(onClick = {
                        run {
                            when (val r = sync.signUp(email, password)) {
                                "confirm-email" -> "Đã tạo tài khoản. Mở email xác nhận rồi bấm Đăng nhập."
                                "signed-in" -> null
                                else -> r.removePrefix("!")
                            }
                        }
                    }, enabled = !busy) { Text("Tạo tài khoản") }
                }
            }
        }
        (message ?: state.lastError)?.let { Text(it, color = Tokens.Accent) }
    }
}
