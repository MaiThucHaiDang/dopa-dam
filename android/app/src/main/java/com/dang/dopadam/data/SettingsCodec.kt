package com.dang.dopadam.data

import com.dang.dopadam.core.Settings
import org.json.JSONArray
import org.json.JSONObject

/** Settings are stored and synced as one JSON document, the same shape on every platform. */
object SettingsCodec {
    fun encode(s: Settings): String = JSONObject()
        .put("lockSeconds", JSONArray(s.lockSeconds))
        .put("allowOptionsNormal", JSONArray(s.allowOptionsNormal))
        .put("allowOptionsRestricted", JSONArray(s.allowOptionsRestricted))
        .put("budgetMinutes", s.budgetMinutes)
        .put("tagDelays", JSONObject(s.tagDelays as Map<*, *>))
        .toString()

    /** Unknown or malformed fields fall back to the defaults. */
    fun decode(json: String?): Settings {
        val defaults = Settings()
        if (json.isNullOrBlank()) return defaults
        return try {
            val o = JSONObject(json)
            fun ints(key: String, size: Int? = null): List<Int>? {
                val a = o.optJSONArray(key) ?: return null
                val list = (0 until a.length()).map { a.getInt(it) }
                return if (list.isEmpty() || (size != null && list.size != size)) null else list
            }
            val delays = o.optJSONObject("tagDelays")?.let { d -> d.keys().asSequence().associateWith { d.getInt(it) } }
            Settings(
                lockSeconds = ints("lockSeconds", 4) ?: defaults.lockSeconds,
                allowOptionsNormal = ints("allowOptionsNormal") ?: defaults.allowOptionsNormal,
                allowOptionsRestricted = ints("allowOptionsRestricted") ?: defaults.allowOptionsRestricted,
                budgetMinutes = if (o.has("budgetMinutes")) o.getInt("budgetMinutes") else defaults.budgetMinutes,
                tagDelays = delays ?: defaults.tagDelays,
            )
        } catch (e: org.json.JSONException) {
            defaults
        }
    }
}
