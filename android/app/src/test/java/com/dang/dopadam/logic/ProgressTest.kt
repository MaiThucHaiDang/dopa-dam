package com.dang.dopadam.logic

import com.dang.dopadam.data.DayStat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** One to one with agent/ui/test/progress.test.ts, plus the text helpers. */
class ProgressTest {
    private val today = "2026-11-16"

    private fun day(
        offset: Int,
        enter: Int = 0,
        exit: Int = 0,
        alternative: Int = 0,
        exitSecondsSum: Double = 0.0,
        exitCount: Int = 0,
        studyWarnings: Int = 0,
    ) = DayStat(
        day = LocalDate.of(2026, 11, 16).minusDays(offset.toLong()).toString(),
        enter = enter, exit = exit, alternative = alternative,
        exitSecondsSum = exitSecondsSum, exitCount = exitCount, studyWarnings = studyWarnings,
    )

    /** One day per week with the given figures: offset 0 is this week, 7 is last week. */
    private fun weeks(thisWeek: (Int) -> DayStat, lastWeek: (Int) -> DayStat) = listOf(lastWeek(7), thisWeek(0))

    private fun verdicts(p: WeeklyProgress) = listOf(p.leaveRate, p.seconds, p.studyOpens)

    @Test
    fun comparesTwoFullWeeks() {
        val stats = (0 until 14).map { i ->
            if (i < 7) day(i, exit = 2, enter = 1, exitSecondsSum = 6.0, exitCount = 2, studyWarnings = 1)
            else day(i, exit = 1, enter = 2, exitSecondsSum = 20.0, exitCount = 1, studyWarnings = 2)
        }
        val p = weeklyProgress(stats, today)
        assertEquals(21, p.thisWeek.total)
        assertEquals(2.0 / 3, p.thisWeek.leaveRate!!, 1e-9)
        assertEquals(1.0 / 3, p.lastWeek.leaveRate!!, 1e-9)
        assertEquals(3.0, p.thisWeek.avgExitSeconds!!, 0.0)
        assertEquals(20.0, p.lastWeek.avgExitSeconds!!, 0.0)
        assertEquals(listOf(Verdict.BETTER, Verdict.BETTER, Verdict.BETTER), verdicts(p))
    }

    @Test
    fun notEnoughDataWhenAWeekHasNoInterceptions() {
        val p = weeklyProgress(weeks({ day(it, exit = 9) }, { day(it) }), today)
        assertNull(p.lastWeek.leaveRate)
        assertNull(p.lastWeek.avgExitSeconds)
        assertFalse(p.enough)
        assertEquals(List(3) { Verdict.NOT_ENOUGH_DATA }, verdicts(p))
    }

    @Test
    fun needsFiveInterceptionsInEachWeek() {
        assertFalse(weeklyProgress(weeks({ day(it, exit = 5) }, { day(it, exit = 4) }), today).enough)
        assertFalse(weeklyProgress(weeks({ day(it, exit = 4) }, { day(it, exit = 5) }), today).enough)
        assertTrue(weeklyProgress(weeks({ day(it, exit = 5) }, { day(it, exit = 5) }), today).enough)
    }

    @Test
    fun leaveRateChangesByFivePointsAtTheBoundary() {
        // last week 10/20 = 50%
        val last = { o: Int -> day(o, exit = 10, enter = 10) }
        assertEquals(Verdict.BETTER, weeklyProgress(weeks({ day(it, exit = 11, enter = 9) }, last), today).leaveRate) // +5
        assertEquals(Verdict.SAME, weeklyProgress(weeks({ day(it, exit = 10, enter = 9) }, last), today).leaveRate) // 52.6%
        assertEquals(Verdict.WORSE, weeklyProgress(weeks({ day(it, exit = 9, enter = 11) }, last), today).leaveRate) // -5
        assertEquals(Verdict.SAME, weeklyProgress(weeks({ day(it, exit = 10, alternative = 1, enter = 10) }, last), today).leaveRate) // 52.4%
    }

    @Test
    fun secondsChangeByOneAtTheBoundaryAndNeedAnAverageInBothWeeks() {
        val last = { o: Int -> day(o, exit = 5, exitCount = 5, exitSecondsSum = 15.0) } // 3 s
        fun now(sum: Double) = { o: Int -> day(o, exit = 5, exitCount = 5, exitSecondsSum = sum) }
        assertEquals(Verdict.BETTER, weeklyProgress(weeks(now(10.0), last), today).seconds) // 2 s
        assertEquals(Verdict.SAME, weeklyProgress(weeks(now(11.0), last), today).seconds) // 2.2 s
        assertEquals(Verdict.WORSE, weeklyProgress(weeks(now(20.0), last), today).seconds) // 4 s
        assertEquals(Verdict.SAME, weeklyProgress(weeks(now(19.0), last), today).seconds) // 3.8 s
        assertEquals(Verdict.NOT_ENOUGH_DATA, weeklyProgress(weeks({ day(it, enter = 5) }, last), today).seconds)
    }

    @Test
    fun studyOpensLowerIsBetterHigherIsWorseEqualIsSame() {
        fun p(now: Int, before: Int) =
            weeklyProgress(weeks({ day(it, exit = 5, studyWarnings = now) }, { day(it, exit = 5, studyWarnings = before) }), today).studyOpens
        assertEquals(Verdict.BETTER, p(1, 2))
        assertEquals(Verdict.WORSE, p(3, 2))
        assertEquals(Verdict.SAME, p(2, 2))
    }

    @Test
    fun countsMissingDaysAsZeroAndIgnoresDaysOutsideTheTwoWeeks() {
        val p = weeklyProgress(listOf(day(0, exit = 5), day(6, exit = 1), day(7, exit = 5), day(13, enter = 1), day(14, enter = 50)), today)
        assertEquals(6, p.thisWeek.total)
        assertEquals(6, p.lastWeek.total)
        assertFalse(weeklyProgress(emptyList(), today).enough)
    }

    @Test
    fun numbersUseTheDecimalComma() {
        assertEquals("–", formatSeconds(null))
        assertEquals("3,0 giây", formatSeconds(3.0))
        assertEquals("2,5 giây", formatSeconds(2.54))
        assertEquals("0,1 giây", formatSeconds(0.15)) // 0.15 is just under 0.15, like toFixed(1)
        assertEquals("10,0 giây", formatSeconds(9.96)) // toFixed(1) of 9.96
        assertEquals("10 giây", formatSeconds(10.0))
        assertEquals("13 giây", formatSeconds(12.5))
        assertEquals("–", formatPercent(null))
        assertEquals("67%", formatPercent(2.0 / 3))
        assertEquals("50%", formatPercent(0.5))
    }

    @Test
    fun cardSentencesMatchTheAgent() {
        val better = progressRows(
            weeklyProgress(
                (0 until 14).map { i ->
                    if (i < 7) day(i, exit = 2, enter = 1, exitSecondsSum = 6.0, exitCount = 2, studyWarnings = 1)
                    else day(i, exit = 1, enter = 2, exitSecondsSum = 20.0, exitCount = 1, studyWarnings = 2)
                },
                today,
            ),
        )
        assertEquals(
            listOf(
                ProgressRow("Tỉ lệ rời đi", "67%", "33%", "Tốt hơn tuần trước"),
                ProgressRow("Số giây đến lúc Thoát", "3,0 giây", "20 giây", "Nhanh hơn tuần trước 17 giây"),
                ProgressRow("Mở giải trí trong giờ học", "7 lần", "14 lần", "Tốt hơn tuần trước"),
            ),
            better,
        )
        val worse = progressRows(weeklyProgress(weeks({ day(it, exit = 5, exitCount = 5, exitSecondsSum = 20.0) }, { day(it, exit = 5, exitCount = 5, exitSecondsSum = 15.0) }), today))
        assertEquals("Chậm hơn tuần trước 1 giây", worse[1].text)
        assertEquals("Gần như tuần trước", worse[0].text)
        val none = progressRows(weeklyProgress(emptyList(), today))
        assertEquals("Cần ít nhất 5 lần bị chặn mỗi tuần để so sánh", none[0].text)
        assertEquals("–", none[1].now)
        assertEquals("0 lần", none[2].now)
    }
}
