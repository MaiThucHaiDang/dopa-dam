// Weekly progress: the last 7 days against the 7 before, for the three trends the product aims at.
// Port of agent/ui/src/progress.ts and the text helpers of agent/ui/src/main/StatsPage.tsx; keep them in step.
package com.dang.dopadam.logic

import com.dang.dopadam.data.DayStat
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate

enum class Verdict { BETTER, WORSE, SAME, NOT_ENOUGH_DATA }

data class WeekFigures(
    val total: Int,
    /** (exit + alternative) / total, or null with no interceptions. */
    val leaveRate: Double?,
    /** Average seconds from the warning to Thoát, or null with no Thoát. */
    val avgExitSeconds: Double?,
    val studyOpens: Int,
)

data class WeeklyProgress(
    val thisWeek: WeekFigures,
    val lastWeek: WeekFigures,
    /** Both weeks have at least [MIN_INTERCEPTIONS] interceptions. */
    val enough: Boolean,
    val leaveRate: Verdict,
    val seconds: Verdict,
    val studyOpens: Verdict,
)

const val MIN_INTERCEPTIONS = 5
private const val RATE_STEP = 0.05
private const val SECONDS_STEP = 1.0

// Tolerance for floating point at the thresholds (0.55 - 0.5 is not exactly 0.05).
private const val EPS = 1e-9

private fun figures(days: List<DayStat>): WeekFigures {
    val enter = days.sumOf { it.enter }
    val exit = days.sumOf { it.exit }
    val alternative = days.sumOf { it.alternative }
    val secondsSum = days.sumOf { it.exitSecondsSum }
    val exitCount = days.sumOf { it.exitCount }
    val total = enter + exit + alternative
    return WeekFigures(
        total = total,
        leaveRate = if (total > 0) (exit + alternative).toDouble() / total else null,
        avgExitSeconds = if (exitCount > 0) secondsSum / exitCount else null,
        studyOpens = days.sumOf { it.studyWarnings },
    )
}

/** [today] is the app's day key ("YYYY-MM-DD", 04:00 boundary); days missing from [stats] count as zero. */
fun weeklyProgress(stats: List<DayStat>, today: String): WeeklyProgress {
    val byDay = stats.associateBy { it.day }
    val base = LocalDate.parse(today)
    fun week(offset: Int) = figures((0 until 7).mapNotNull { byDay[base.minusDays((offset + it).toLong()).toString()] })
    val thisWeek = week(0)
    val lastWeek = week(7)
    val enough = thisWeek.total >= MIN_INTERCEPTIONS && lastWeek.total >= MIN_INTERCEPTIONS
    if (!enough) {
        val none = Verdict.NOT_ENOUGH_DATA
        return WeeklyProgress(thisWeek, lastWeek, false, none, none, none)
    }
    var leaveRate = Verdict.SAME
    if (thisWeek.leaveRate != null && lastWeek.leaveRate != null) {
        val diff = thisWeek.leaveRate - lastWeek.leaveRate
        leaveRate = when {
            diff >= RATE_STEP - EPS -> Verdict.BETTER
            diff <= -(RATE_STEP - EPS) -> Verdict.WORSE
            else -> Verdict.SAME
        }
    }
    var seconds = Verdict.NOT_ENOUGH_DATA
    if (thisWeek.avgExitSeconds != null && lastWeek.avgExitSeconds != null) {
        val diff = thisWeek.avgExitSeconds - lastWeek.avgExitSeconds
        seconds = when {
            diff <= -(SECONDS_STEP - EPS) -> Verdict.BETTER
            diff >= SECONDS_STEP - EPS -> Verdict.WORSE
            else -> Verdict.SAME
        }
    }
    val studyOpens = when {
        thisWeek.studyOpens < lastWeek.studyOpens -> Verdict.BETTER
        thisWeek.studyOpens > lastWeek.studyOpens -> Verdict.WORSE
        else -> Verdict.SAME
    }
    return WeeklyProgress(thisWeek, lastWeek, true, leaveRate, seconds, studyOpens)
}

// ---- Text (same sentences and number format as the agent's card) ------------------------------

private fun verdictText(v: Verdict) = when (v) {
    Verdict.BETTER -> "Tốt hơn tuần trước"
    Verdict.WORSE -> "Chưa tốt bằng tuần trước"
    Verdict.SAME -> "Gần như tuần trước"
    Verdict.NOT_ENOUGH_DATA -> "Cần ít nhất $MIN_INTERCEPTIONS lần bị chặn mỗi tuần để so sánh"
}

/** "67%", or "–" without data. Rounds half up like JavaScript's Math.round. */
fun formatPercent(v: Double?): String = if (v == null) "–" else "${Math.round(v * 100)}%"

/** Vietnamese writes decimals with a comma: "2,5 giây" below 10 seconds, whole seconds from 10. */
fun formatSeconds(v: Double?): String {
    if (v == null) return "–"
    if (v >= 10) return "${Math.round(v)} giây"
    // Exact decimal value rounded half up, like JavaScript's toFixed(1).
    val text = BigDecimal(v).setScale(1, RoundingMode.HALF_UP).toPlainString().replace('.', ',')
    return "$text giây"
}

data class ProgressRow(val label: String, val now: String, val before: String, val text: String)

fun progressRows(p: WeeklyProgress): List<ProgressRow> {
    // Changed seconds are stated as a plain difference, e.g. "Chậm hơn tuần trước 2 giây".
    var secondsText = verdictText(p.seconds)
    val nowSeconds = p.thisWeek.avgExitSeconds
    val beforeSeconds = p.lastWeek.avgExitSeconds
    if (nowSeconds != null && beforeSeconds != null && p.seconds != Verdict.SAME && p.seconds != Verdict.NOT_ENOUGH_DATA) {
        val diff = Math.round(Math.abs(nowSeconds - beforeSeconds))
        secondsText = "${if (p.seconds == Verdict.BETTER) "Nhanh hơn" else "Chậm hơn"} tuần trước $diff giây"
    }
    return listOf(
        ProgressRow("Tỉ lệ rời đi", formatPercent(p.thisWeek.leaveRate), formatPercent(p.lastWeek.leaveRate), verdictText(p.leaveRate)),
        ProgressRow("Số giây đến lúc Thoát", formatSeconds(nowSeconds), formatSeconds(beforeSeconds), secondsText),
        ProgressRow("Mở giải trí trong giờ học", "${p.thisWeek.studyOpens} lần", "${p.lastWeek.studyOpens} lần", verdictText(p.studyOpens)),
    )
}
