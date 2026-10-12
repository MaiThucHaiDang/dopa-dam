package com.dang.dopadam.sync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keeps the sign-in between restarts. The refresh token is encrypted with an AES key that lives in
 * the Android Keystore and never leaves it; the preferences file only holds the ciphertext.
 */
class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("dopadam_session", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    fun save(session: StoredSession) {
        val json = JSONObject()
            .put("refreshToken", session.refreshToken)
            .put("userId", session.userId)
            .putN("email", session.email)
            .toString()
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
            val sealed = cipher.iv + cipher.doFinal(json.toByteArray(Charsets.UTF_8))
            prefs.edit().putString(KEY, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
        } catch (e: GeneralSecurityException) {
            clear()
        }
    }

    fun load(): StoredSession? {
        val sealed = prefs.getString(KEY, null)?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return null
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV_SIZE))
            val o = JSONObject(String(cipher.doFinal(sealed, IV_SIZE, sealed.size - IV_SIZE), Charsets.UTF_8))
            StoredSession(o.getString("refreshToken"), o.getString("userId"), o.str("email"))
        } catch (e: GeneralSecurityException) {
            null
        } catch (e: org.json.JSONException) {
            null
        }
    }

    fun clear() = prefs.edit().remove(KEY).apply()

    private companion object {
        const val ALIAS = "dopadam-session"
        const val KEY = "session"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_SIZE = 12
    }
}
