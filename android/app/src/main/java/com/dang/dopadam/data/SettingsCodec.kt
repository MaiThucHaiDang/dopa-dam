package com.dang.dopadam.data

import com.dang.dopadam.core.MAX_RISK_WINDOWS
import com.dang.dopadam.core.RiskWindow
import com.dang.dopadam.core.Settings
import com.dang.dopadam.core.normalizeRiskWindow
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
        .put(
            "riskWindows",
            JSONArray(
                s.riskWindows.map {
                    JSONObject().put("id", it.id).put("days", JSONArray(it.days)).put("start", it.start).put("end", it.end)
                },
            ),
        )
        .toString()

    /**
     * Unknown or malformed fields fall back to the defaults, each one on its own (same as the agent's
     * Settings::from_json): a bad array is replaced by the default array, a bad tagDelays entry is dropped,
     * and everything else in the document is kept. `riskWindows` missing or not an array is an empty list; a
     * bad window (not an object, id not a string, days not whole numbers, a time that does not parse) is
     * dropped on its own, the rest are normalised, and only the first [MAX_RISK_WINDOWS] are kept. Only whole numbers count; 36.5 or "x" are bad values.
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
        fun riskWindow(v: Any?): RiskWindow? {
            val w = v as? JSONObject ?: return null
            val id = w.opt("id") as? String ?: return null
            val a = w.optJSONArray("days") ?: return null
            val days = (0 until a.length()).map { int(a.opt(it)) ?: return null }
            val start = w.opt("start") as? String ?: return null
            val end = w.opt("end") as? String ?: return null
            return normalizeRiskWindow(RiskWindow(id, days, start, end))
        }
        val riskWindows = o.optJSONArray("riskWindows")
            ?.let { a -> (0 until a.length()).mapNotNull { riskWindow(a.opt(it)) } }
            ?.take(MAX_RISK_WINDOWS)
            ?: emptyList()
        return Settings(
            lockSeconds = ints("lockSeconds", 4) ?: defaults.lockSeconds,
            allowOptionsNormal = ints("allowOptionsNormal") ?: defaults.allowOptionsNormal,
            allowOptionsRestricted = ints("allowOptionsRestricted") ?: defaults.allowOptionsRestricted,
            budgetMinutes = int(o.opt("budgetMinutes")) ?: defaults.budgetMinutes,
            tagDelays = delays ?: defaults.tagDelays,
            riskWindows = riskWindows,
        )
    }
}
