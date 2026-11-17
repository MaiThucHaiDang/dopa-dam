// Risk hours (docs/thiet-ke-ky-thuat.md, 2.5). Port of extension/src/core/risk.ts; shared/test-vectors/risk.json
// is the contract. Integer arithmetic only, so the three platforms always pick the same suggestion.
package com.dang.dopadam.core

/** A weekly window in which the friction level is raised by one. */
data class RiskWindow(
    val id: String,
    /** ISO weekdays: 1 = Monday ... 7 = Sunday. */
    val days: List<Int>,
    /** Local time "HH:MM". If end <= start the window runs past midnight. */
    val start: String,
    val end: String,
)

const val MAX_RISK_WINDOWS = 12

/** A suggested block needs at least this many warnings. */
const val RISK_MIN_OPENS = 6

/** Length of a suggested block, in hours. */
const val RISK_BLOCK_HOURS = 2

private val WEEKDAYS = listOf(1, 2, 3, 4, 5)
private val WEEKEND = listOf(6, 7)
private const val WEEK_MINUTES = 7 * 1440

private fun hm(minutes: Int) = "${(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}"

/**
 * Cleans a window typed by the user: days deduplicated, sorted and limited to 1..7; times written "HH:MM".
 * Null when it cannot be a window (no day, bad time, start == end). The id is kept as given.
 */
fun normalizeRiskWindow(window: RiskWindow): RiskWindow? {
    val days = window.days.filter { it in 1..7 }.distinct().sorted()
    val start = parseHm(window.start) ?: return null
    val end = parseHm(window.end) ?: return null
    if (days.isEmpty() || start == end) return null
    return RiskWindow(window.id, days, hm(start), hm(end))
}

/** A valid window with its times as minutes; the end is after the start (next day when it wraps). */
private class Span(val days: List<Int>, val start: Int, val end: Int)

private fun validSpans(windows: List<RiskWindow>): List<Span> = windows.mapNotNull { w ->
    val n = normalizeRiskWindow(w) ?: return@mapNotNull null
    val start = parseHm(n.start)!!
    val end = parseHm(n.end)!!
    Span(n.days, start, if (end > start) end else end + 1440)
}

/** ISO weekday (1 = Monday) of a "local ms" value. 1970-01-01 was a Thursday. */
private fun localWeekday(localMs: Long): Int = Math.floorMod(Math.floorDiv(localMs, DAY_MS) + 3, 7L).toInt() + 1

private fun localMinuteOfDay(localMs: Long): Int = (Math.floorMod(localMs, DAY_MS) / MINUTE_MS).toInt()

/**
 * True when `now` is inside an occurrence of at least one window: start counted, end not counted; a window
 * that starts on a listed day and runs past midnight still counts after midnight. Invalid windows are ignored.
 */
fun inRiskWindow(windows: List<RiskWindow>, now: Long, tzOffsetMinutes: Int): Boolean {
    val local = now + tzOffsetMinutes * MINUTE_MS
    val weekday = localWeekday(local)
    val minute = localMinuteOfDay(local)
    val yesterday = if (weekday == 1) 7 else weekday - 1
    return validSpans(windows).any { w ->
        (weekday in w.days && w.start <= minute && minute < w.end) ||
            // Yesterday's occurrence seen after midnight (only windows that run past midnight reach this far).
            (yesterday in w.days && w.end > 1440 && minute + 1440 < w.end)
    }
}

data class RiskCell(val opens: Int = 0, val enters: Int = 0)

/** 7 rows (0 = Monday ... 6 = Sunday) of 24 columns (local hour 0..23). */
typealias RiskHeatmap = List<List<RiskCell>>

/** The part of a warning the heat map needs. */
data class RiskEvent(val shownAt: Long, val decision: String?)

fun emptyHeatmap(): RiskHeatmap = List(7) { List(24) { RiskCell() } }

/**
 * Warnings with now - days * 24h <= shownAt <= now (both ends counted), by local weekday and hour of
 * `shownAt` (the 04:00 day boundary is not used). `opens` counts every warning, `enters` those decided "enter".
 */
fun riskHeatmap(events: List<RiskEvent>, now: Long, tzOffsetMinutes: Int, days: Int): RiskHeatmap {
    val opens = Array(7) { IntArray(24) }
    val enters = Array(7) { IntArray(24) }
    val from = now - days * DAY_MS
    for (e in events) {
        if (e.shownAt < from || e.shownAt > now) continue
        val local = e.shownAt + tzOffsetMinutes * MINUTE_MS
        val row = localWeekday(local) - 1
        val hour = localMinuteOfDay(local) / 60
        opens[row][hour]++
        if (e.decision == "enter") enters[row][hour]++
    }
    return List(7) { r -> List(24) { h -> RiskCell(opens[r][h], enters[r][h]) } }
}

data class RiskSuggestion(val days: List<Int>, val start: String, val end: String, val opens: Int, val enters: Int)

/** Which minutes of the week (0 = Monday 00:00) the windows cover; a window running past Sunday wraps to Monday. */
private fun weekCoverage(windows: List<RiskWindow>): BooleanArray {
    val covered = BooleanArray(WEEK_MINUTES)
    for (w in validSpans(windows)) {
        for (d in w.days) {
            for (m in w.start until w.end) covered[((d - 1) * 1440 + m) % WEEK_MINUTES] = true
        }
    }
    return covered
}

/** Does any minute of hours h .. h + RISK_BLOCK_HOURS - 1, on any day of the group, lie in the coverage? */
private fun blockTouched(covered: BooleanArray, group: List<Int>, h: Int): Boolean =
    group.any { d -> (h * 60 until (h + RISK_BLOCK_HOURS) * 60).any { m -> covered[(d - 1) * 1440 + m] } }

/**
 * The two-hour block (a group of days, starting hour h, hours h and h+1) with the highest opens per day of the
 * group, among blocks with at least [RISK_MIN_OPENS] warnings that do not touch any existing window (no minute
 * of the block, on any day of the group, is covered). Ties: higher enters per day, then weekdays before weekend, then the smaller h. `cells` is a 7 x 24 grid as from
 * [riskHeatmap]; missing cells count as zero.
 */
fun suggestRiskWindow(cells: List<List<RiskCell>>, existing: List<RiskWindow>): RiskSuggestion? {
    val covered = weekCoverage(existing)
    var bestDays: List<Int>? = null
    var bestH = 0
    var bestOpens = 0
    var bestEnters = 0
    for (group in listOf(WEEKDAYS, WEEKEND)) {
        for (h in 0..24 - RISK_BLOCK_HOURS) {
            var opens = 0
            var enters = 0
            for (d in group) {
                for (x in h until h + RISK_BLOCK_HOURS) {
                    val cell = cells.getOrNull(d - 1)?.getOrNull(x)
                    opens += cell?.opens ?: 0
                    enters += cell?.enters ?: 0
                }
            }
            if (opens < RISK_MIN_OPENS) continue
            if (blockTouched(covered, group, h)) continue
            val best = bestDays
            if (best != null) {
                // Per-day comparison by cross-multiplication: a / group.size > b / best.size.
                val l = group.size
                val r = best.size
                val byOpens = opens * r - bestOpens * l
                val byEnters = enters * r - bestEnters * l
                // Group order (weekdays first) and h order follow from the loop order: only strictly better replaces.
                if (byOpens < 0 || (byOpens == 0 && byEnters <= 0)) continue
            }
            bestDays = group
            bestH = h
            bestOpens = opens
            bestEnters = enters
        }
    }
    val days = bestDays ?: return null
    return RiskSuggestion(days.toList(), hm(bestH * 60), hm(((bestH + RISK_BLOCK_HOURS) % 24) * 60), bestOpens, bestEnters)
}

/**
 * True ("weaken") when some minute of the week was covered by the old list and is not covered by the new one
 * (a window removed, fewer days, shorter); false ("ok") when a window was added, lengthened, split or reordered.
 */
fun riskWindowsChangeWeakens(old: List<RiskWindow>, new: List<RiskWindow>): Boolean {
    val a = weekCoverage(old)
    val b = weekCoverage(new)
    return a.indices.any { a[it] && !b[it] }
}

/** Every window cleaned; null when the list is too long or one window is invalid (user input is refused whole). */
fun cleanRiskWindows(windows: List<RiskWindow>): List<RiskWindow>? {
    if (windows.size > MAX_RISK_WINDOWS) return null
    return windows.map { normalizeRiskWindow(it) ?: return null }
}
