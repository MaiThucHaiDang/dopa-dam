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

/**
 * Anything that can say "these are study sessions": manual sessions, the weekly rules, and later
 * TaskFlow. Adding a source means writing one of these; the blocking side does not change.
 */
interface StudySessionSource {
    val kind: StudySource
    fun sessions(now: Long, tzOffsetMinutes: Int): List<Session>
}

class SessionListSource(override val kind: StudySource, private val list: List<Session>) : StudySessionSource {
    override fun sessions(now: Long, tzOffsetMinutes: Int) = list
}

class RuleSource(private val rules: List<StudyRule>) : StudySessionSource {
    override val kind = StudySource.RULE
    override fun sessions(now: Long, tzOffsetMinutes: Int) = rules.flatMap { ruleOccurrences(it, now, tzOffsetMinutes) }
}

/** Studying when any source has a session running; the label comes from manual, then TaskFlow, then rules. */
fun resolveSources(now: Long, tzOffsetMinutes: Int, sources: List<StudySessionSource>): StudyStatus {
    for (kind in StudySource.entries) {
        val session = pickActive(sources.filter { it.kind == kind }.flatMap { it.sessions(now, tzOffsetMinutes) }, now)
        if (session != null) {
            val label = session.label?.takeIf { it.isNotEmpty() } ?: kind.defaultLabel
            return StudyStatus(true, kind, label, session.end)
        }
    }
    return StudyStatus.NONE
}

/** Combines study sources with priority manual > taskflow > rule. */
fun resolveStudy(
    now: Long,
    tzOffsetMinutes: Int,
    manual: List<Session>,
    rules: List<StudyRule>,
    external: List<Session>,
): StudyStatus = resolveSources(
    now,
    tzOffsetMinutes,
    listOf(SessionListSource(StudySource.MANUAL, manual), SessionListSource(StudySource.TASKFLOW, external), RuleSource(rules)),
)

/** A rule window that is running, with the local date it started on (the exception that skips it). */
data class RuleOccurrence(val ruleId: String, val date: String)

/** Rule windows running at `now`, in rule order. Ending study early adds these as exceptions. */
fun activeRuleOccurrences(rules: List<StudyRule>, now: Long, tzOffsetMinutes: Int): List<RuleOccurrence> {
    val offsetMs = tzOffsetMinutes * MINUTE_MS
    return rules.flatMap { rule ->
        ruleOccurrences(rule, now, tzOffsetMinutes)
            .filter { it.start <= now && now < it.end }
            .map { RuleOccurrence(rule.id, formatLocalDate(Math.floorDiv(it.start + offsetMs, DAY_MS) * DAY_MS)) }
    }
}

/** Start and end in minutes after the start day's midnight; an end at or before the start is next day. */
private fun windowMinutes(rule: StudyRule): Pair<Int, Int>? {
    val start = parseHm(rule.start) ?: return null
    val end = parseHm(rule.end) ?: return null
    return start to if (end > start) end else end + 24 * 60
}

/**
 * Editing a weekly rule. Weakens: removing it, dropping days, a shorter window, or skipping today or a
 * session that is running. Adding a rule, more days, a longer window or skipping a later date does not.
 */
fun studyRuleChangeWeakens(old: StudyRule?, new: StudyRule?, now: Long, tzOffsetMinutes: Int): Boolean {
    if (old == null) return false
    if (new == null) return true
    if (old.days.any { it !in new.days }) return true
    val ow = windowMinutes(old)
    val nw = windowMinutes(new)
    if (ow != null && (nw == null || nw.first > ow.first || nw.second < ow.second)) return true
    val offsetMs = tzOffsetMinutes * MINUTE_MS
    val protectedDates = activeRuleOccurrences(listOf(old), now, tzOffsetMinutes).map { it.date }.toSet() +
        formatLocalDate(Math.floorDiv(now + offsetMs, DAY_MS) * DAY_MS)
    return new.exceptions.any { it !in old.exceptions && it in protectedDates }
}

const val STUDY_LABEL_MAX = 60
private val DATE_REGEX = Regex("""^\d{4}-\d{2}-\d{2}$""")
val MANUAL_STUDY_MINUTES = listOf(25, 50, 90)

/** Cleans a rule typed by the user; null when it cannot be a rule (no day, bad time, empty window). */
fun normalizeStudyRule(rule: StudyRule): StudyRule? {
    val days = rule.days.filter { it in 1..7 }.distinct().sorted()
    val start = parseHm(rule.start) ?: return null
    val end = parseHm(rule.end) ?: return null
    if (days.isEmpty() || start == end) return null
    fun hm(m: Int) = "${(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}"
    val label = rule.label.orEmpty().trim().take(STUDY_LABEL_MAX).ifEmpty { null }
    val exceptions = rule.exceptions.filter { DATE_REGEX.matches(it) }.distinct().sorted()
    return StudyRule(rule.id, days, hm(start), hm(end), label, exceptions)
}

private val DAY_NAMES = listOf("", "T2", "T3", "T4", "T5", "T6", "T7", "CN")

/** "T2–T6", "T2, T4, T6", "Mỗi ngày": consecutive weekdays collapse into a range. */
fun formatStudyDays(days: List<Int>): String {
    val sorted = days.filter { it in 1..7 }.distinct().sorted()
    if (sorted.size == 7) return "Mỗi ngày"
    val parts = mutableListOf<String>()
    var i = 0
    while (i < sorted.size) {
        var j = i
        while (j + 1 < sorted.size && sorted[j + 1] == sorted[j] + 1) j++
        parts += if (j - i >= 2) "${DAY_NAMES[sorted[i]]}–${DAY_NAMES[sorted[j]]}" else sorted.subList(i, j + 1).joinToString(", ") { DAY_NAMES[it] }
        i = j + 1
    }
    return parts.joinToString(", ")
}

/** "2026-10-14" → "14/10". */
fun shortDate(date: String): String {
    val parts = date.split("-")
    return "${parts[2].toInt()}/${parts[1].toInt()}"
}
