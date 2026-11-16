package com.dang.dopadam.data

import com.dang.dopadam.core.Settings
import org.json.JSONArray
import org.json.JSONException
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

    /**
     * Unknown or malformed fields fall back to the defaults, each one on its own (same as the agent's
     * Settings::from_json): a bad array is replaced by the default array, a bad tagDelays entry is dropped,
     * and everything else in the document is kept. Only whole numbers count; 36.5 or "x" are bad values.
     */
    fun decode(json: String?): Settings {
        val defaults = Settings()
        if (json.isNullOrBlank()) return defaults
        val o = try {
            JSONObject(json)
        } catch (e: JSONException) {
            return defaults
        }
        fun int(v: Any?): Int? = when (v) {
            is Int -> v
            is Long -> v.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()
            else -> null
        }
        fun ints(key: String, size: Int? = null): List<Int>? {
            val a = o.optJSONArray(key) ?: return null
            val list = (0 until a.length()).map { int(a.opt(it)) ?: return null }
            return if (list.isEmpty() || (size != null && list.size != size)) null else list
        }
        val delays = o.optJSONObject("tagDelays")?.let { d ->
            d.keys().asSequence().mapNotNull { k -> int(d.opt(k))?.let { k to it } }.toMap()
        }
        return Settings(
            lockSeconds = ints("lockSeconds", 4) ?: defaults.lockSeconds,
            allowOptionsNormal = ints("allowOptionsNormal") ?: defaults.allowOptionsNormal,
            allowOptionsRestricted = ints("allowOptionsRestricted") ?: defaults.allowOptionsRestricted,
            budgetMinutes = int(o.opt("budgetMinutes")) ?: defaults.budgetMinutes,
            tagDelays = delays ?: defaults.tagDelays,
        )
    }
}
