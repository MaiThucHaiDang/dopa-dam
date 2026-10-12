package com.dang.dopadam.core

import java.time.Instant
import java.time.ZoneOffset

data class Session(val id: String, val start: Long, val end: Long, val label: String?)

data class StudyRule(
    val id: String,
    /** ISO weekdays: 1 = Monday ... 7 = Sunday. */
    val days: List<Int>,
    /** Local time "HH:MM". If end <= start the window runs past midnight. */
    val start: String,
    val end: String,
    val label: String?,
    /** Local dates "YYYY-MM-DD" (keyed by the day the window starts) on which the rule is skipped. */
    val exceptions: List<String>,
)

enum class StudySource(val id: String, val defaultLabel: String) {
    MANUAL("manual", "Phiên học"),
    TASKFLOW("taskflow", "Phiên TaskFlow"),
    RULE("rule", "Khung giờ học"),
}

data class StudyStatus(val active: Boolean, val source: StudySource?, val label: String?, val endsAt: Long?) {
    companion object {
        val NONE = StudyStatus(false, null, null, null)
    }
}

fun parseHm(value: String): Int? {
    val m = Regex("^(\\d{1,2}):(\\d{2})$").find(value.trim()) ?: return null
    val h = m.groupValues[1].toInt()
    val min = m.groupValues[2].toInt()
    if (h > 23 || min > 59) return null
    return h * 60 + min
}

/** Occurrences of a rule that start on the local day of `now` or the day before (overnight windows). */
fun ruleOccurrences(rule: StudyRule, now: Long, tzOffsetMinutes: Int): List<Session> {
    val start = parseHm(rule.start) ?: return emptyList()
    val end = parseHm(rule.end) ?: return emptyList()
    val offsetMs = tzOffsetMinutes * MINUTE_MS
    val todayLocal = Math.floorDiv(now + offsetMs, DAY_MS) * DAY_MS
    val out = mutableListOf<Session>()
    for (shift in listOf(-1L, 0L)) {
        val dayLocal = todayLocal + shift * DAY_MS
        val weekday = Instant.ofEpochMilli(dayLocal).atOffset(ZoneOffset.UTC).dayOfWeek.value
        if (weekday !in rule.days || formatLocalDate(dayLocal) in rule.exceptions) continue
        val startLocal = dayLocal + start * MINUTE_MS
        val endLocal = if (end > start) dayLocal + end * MINUTE_MS else dayLocal + DAY_MS + end * MINUTE_MS
        out += Session(rule.id, startLocal - offsetMs, endLocal - offsetMs, rule.label)
    }
    return out
}

private fun pickActive(sessions: List<Session>, now: Long): Session? {
    var best: Session? = null
    for (s in sessions) {
        if (s.start <= now && now < s.end && (best == null || s.end > best.end)) best = s
    }
    return best
}

/** Combines study sources with priority manual > taskflow > rule. */
fun resolveStudy(
    now: Long,
    tzOffsetMinutes: Int,
    manual: List<Session>,
    rules: List<StudyRule>,
    external: List<Session>,
): StudyStatus {
    val candidates = listOf(
        StudySource.MANUAL to pickActive(manual, now),
        StudySource.TASKFLOW to pickActive(external, now),
        StudySource.RULE to pickActive(rules.flatMap { ruleOccurrences(it, now, tzOffsetMinutes) }, now),
    )
    for ((source, session) in candidates) {
        if (session != null) {
            val label = session.label?.takeIf { it.isNotEmpty() } ?: source.defaultLabel
            return StudyStatus(true, source, label, session.end)
        }
    }
    return StudyStatus.NONE
}
