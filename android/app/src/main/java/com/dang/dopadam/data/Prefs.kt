package com.dang.dopadam.data

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

/** Small per-device values that are not synced. */
class Prefs(context: Context) {
    private val sp: SharedPreferences = context.getSharedPreferences("dopadam", Context.MODE_PRIVATE)

    val deviceId: String
        get() = sp.getString(KEY_DEVICE, null) ?: UUID.randomUUID().toString().also {
            sp.edit().putString(KEY_DEVICE, it).apply()
        }

    /** Protection is per device: turning it off on the phone does not affect the computer. */
    var protectionEnabled: Boolean
        get() = sp.getBoolean(KEY_PROTECTION, true)
        set(value) = sp.edit().putBoolean(KEY_PROTECTION, value).apply()

    var defaultsApplied: Boolean
        get() = sp.getBoolean(KEY_DEFAULTS, false)
        set(value) = sp.edit().putBoolean(KEY_DEFAULTS, value).apply()

    /** Xiaomi steps cannot be detected by the app, so the user ticks them off by hand. */
    fun manualStepDone(step: String): Boolean = sp.getBoolean("step:$step", false)

    fun setManualStepDone(step: String, done: Boolean) = sp.edit().putBoolean("step:$step", done).apply()

    fun getString(key: String): String? = sp.getString(key, null)

    fun putString(key: String, value: String?) = sp.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()

    fun getLong(key: String, default: Long = 0): Long = sp.getLong(key, default)

    fun putLong(key: String, value: Long) = sp.edit().putLong(key, value).apply()

    private companion object {
        const val KEY_DEVICE = "deviceId"
        const val KEY_PROTECTION = "protectionEnabled"
        const val KEY_DEFAULTS = "defaultsApplied"
    }
}
