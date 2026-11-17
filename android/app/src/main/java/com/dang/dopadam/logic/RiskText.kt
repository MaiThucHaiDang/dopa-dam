// Wording of the "Giờ nguy cơ" card, kept pure so it can be tested. Same sentences as the agent and the extension.
package com.dang.dopadam.logic

import com.dang.dopadam.core.RiskCell
import com.dang.dopadam.core.RiskSuggestion
import com.dang.dopadam.core.RiskWindow

const val RISK_NO_SUGGESTION = "Chưa có khung giờ nào nổi bật."
const val RISK_RAISE_SUFFIX = "thời gian chờ dài hơn một cấp"

private val DAY_WORDS = listOf("", "thứ 2", "thứ 3", "thứ 4", "thứ 5", "thứ 6", "thứ 7", "Chủ nhật")

/** Row labels of the heat map, row 0 = Monday. */
val RISK_ROW_LABELS = listOf("T2", "T3", "T4", "T5", "T6", "T7", "CN")

/**
 * "thứ 2 đến thứ 6", "thứ 7 và Chủ nhật", "mọi ngày"; otherwise a list: "thứ 2", "thứ 2 và thứ 4",
 * "thứ 2, thứ 4 và thứ 6". Days are sorted, deduplicated and limited to 1..7.
 */
fun riskDaysText(days: List<Int>): String {
    val d = days.filter { it in 1..7 }.distinct().sorted()
    return when {
        d.isEmpty() -> ""
        d == listOf(1, 2, 3, 4, 5) -> "thứ 2 đến thứ 6"
        d == listOf(6, 7) -> "thứ 7 và Chủ nhật"
        d.size == 7 -> "mọi ngày"
        d.size == 1 -> DAY_WORDS[d[0]]
        else -> d.dropLast(1).joinToString(", ") { DAY_WORDS[it] } + " và " + DAY_WORDS[d.last()]
    }
}

/** "22:00–24:00": an end of "00:00" is shown as "24:00" (the window ends at the end of the day). */
fun riskTimeText(start: String, end: String): String = "$start–${if (end == "00:00") "24:00" else end}"

/** "Hay mở nhất: 22:00–24:00, thứ 2 đến thứ 6 (17 lần mở, 9 lần Vào)." */
fun riskSuggestionText(s: RiskSuggestion): String =
    "Hay mở nhất: ${riskTimeText(s.start, s.end)}, ${riskDaysText(s.days)} (${s.opens} lần mở, ${s.enters} lần Vào)."

/** "22:00–24:00 · thứ 2 đến thứ 6 · thời gian chờ dài hơn một cấp" */
fun riskWindowLine(w: RiskWindow): String = "${riskTimeText(w.start, w.end)} · ${riskDaysText(w.days)} · $RISK_RAISE_SUFFIX"

/** The cell with the most opens as (row, hour), the earliest in row-then-hour order on a tie; null when all are empty. */
fun busiestCell(cells: List<List<RiskCell>>): Pair<Int, Int>? {
    var best: Pair<Int, Int>? = null
    var max = 0
    for ((r, row) in cells.withIndex()) {
        for ((h, cell) in row.withIndex()) {
            if (cell.opens > max) {
                max = cell.opens
                best = r to h
            }
        }
    }
    return best
}

/** What a screen reader says about the heat map: the busiest cell in words. */
fun riskHeatmapDescription(cells: List<List<RiskCell>>): String {
    val head = "Bản đồ nhiệt giờ mở giải trí, 4 tuần gần nhất."
    val (r, h) = busiestCell(cells) ?: return "$head Chưa có lần mở nào."
    val cell = cells[r][h]
    fun hour(x: Int) = "${x.toString().padStart(2, '0')}:00"
    val hourText = riskTimeText(hour(h), hour((h + 1) % 24))
    return "$head Ô đậm nhất: ${DAY_WORDS[r + 1]}, $hourText, ${cell.opens} lần mở, ${cell.enters} lần Vào."
}

/** 0 for an empty cell, up to 1 for the busiest; opens relative to the busiest cell. */
fun riskIntensity(opens: Int, maxOpens: Int): Float = if (opens <= 0 || maxOpens <= 0) 0f else (opens.toFloat() / maxOpens).coerceIn(0f, 1f)
