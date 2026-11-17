package com.dang.dopadam.logic

import com.dang.dopadam.core.RiskCell
import com.dang.dopadam.core.RiskSuggestion
import com.dang.dopadam.core.RiskWindow
import com.dang.dopadam.core.Settings
import com.dang.dopadam.core.StudySource
import com.dang.dopadam.core.StudyStatus
import com.dang.dopadam.core.emptyHeatmap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiskLogicTest {
    private val evening = RiskWindow("a", listOf(1, 2, 3, 4, 5), "19:00", "21:00")
    private val wider = evening.copy(end = "22:00")
    private val other = RiskWindow("b", listOf(6, 7), "10:00", "12:00")

    // ---- The decision for replacing the list -----------------------------------

    @Test
    fun strengtheningIsSavedAtOnce() {
        assertNull(checkRiskWindowsChange(emptyList(), listOf(evening), confirmed = false, studyActive = false))
        assertNull(checkRiskWindowsChange(listOf(evening), listOf(wider, other), confirmed = false, studyActive = false))
        // Adding is allowed during study too: it only strengthens.
        assertNull(checkRiskWindowsChange(listOf(evening), listOf(evening, other), confirmed = false, studyActive = true))
    }

    @Test
    fun weakeningNeedsTheConfirmation() {
        for (new in listOf(emptyList(), listOf(evening.copy(end = "20:00")), listOf(evening.copy(days = listOf(1, 2))))) {
            assertEquals(ErrorCode.NEEDS_CONFIRM, checkRiskWindowsChange(listOf(evening), new, confirmed = false, studyActive = false))
            assertNull(checkRiskWindowsChange(listOf(evening), new, confirmed = true, studyActive = false))
        }
    }

    @Test
    fun weakeningIsLockedDuringStudyEvenWhenConfirmed() {
        assertEquals(ErrorCode.STUDY_LOCKED, checkRiskWindowsChange(listOf(evening), emptyList(), confirmed = false, studyActive = true))
        assertEquals(ErrorCode.STUDY_LOCKED, checkRiskWindowsChange(listOf(evening), emptyList(), confirmed = true, studyActive = true))
    }

    @Test
    fun invalidListsAreRefused() {
        assertEquals(ErrorCode.INVALID, checkRiskWindowsChange(emptyList(), listOf(evening.copy(start = "19:00", end = "19:00")), true, false))
        assertEquals(ErrorCode.INVALID, checkRiskWindowsChange(emptyList(), List(13) { evening.copy(id = "$it") }, true, false))
        assertEquals(ErrorCode.INVALID, checkRiskWindowsChange(listOf(evening), emptyList<RiskWindow>() + evening.copy(days = emptyList()), true, false))
    }

    @Test
    fun anUnchangedListNeedsNothing() {
        assertNull(checkRiskWindowsChange(listOf(evening), listOf(evening), confirmed = false, studyActive = true))
    }

    // ---- planWarning --------------------------------------------------------------

    @Test
    fun planSaysWhenTheRaiseApplied() {
        val s = Settings()
        val now = 1_791_810_000_000L
        val raised = planWarning(emptyList(), now, StudyStatus.NONE, 0.0, s, inRisk = true)
        assertEquals(1, raised.level)
        assertEquals(10, raised.lockSeconds)
        assertTrue(raised.riskRaised)
        assertFalse(planWarning(emptyList(), now, StudyStatus.NONE, 0.0, s).riskRaised)
        // Already level 3 (study or budget): nothing was raised, so the screen says nothing.
        val studying = StudyStatus(true, StudySource.MANUAL, "x", now + 60_000)
        assertFalse(planWarning(emptyList(), now, studying, 0.0, s, inRisk = true).riskRaised)
        assertFalse(planWarning(emptyList(), now, StudyStatus.NONE, 90.0, s, inRisk = true).riskRaised)
        val three = planWarning(listOf(now - 3000, now - 2000, now - 1000), now, StudyStatus.NONE, 0.0, s, inRisk = true)
        assertEquals(3, three.level)
        assertTrue(three.riskRaised)
    }

    // ---- Wording -------------------------------------------------------------------

    @Test
    fun dayLists() {
        assertEquals("thứ 2 đến thứ 6", riskDaysText(listOf(5, 4, 3, 2, 1, 1)))
        assertEquals("thứ 7 và Chủ nhật", riskDaysText(listOf(7, 6)))
        assertEquals("mỗi ngày", riskDaysText(listOf(1, 2, 3, 4, 5, 6, 7)))
        assertEquals("thứ 4", riskDaysText(listOf(3)))
        assertEquals("Chủ nhật", riskDaysText(listOf(7)))
        assertEquals("thứ 2 và thứ 4", riskDaysText(listOf(1, 3)))
        assertEquals("thứ 2, thứ 4 và thứ 6", riskDaysText(listOf(1, 3, 5)))
        assertEquals("thứ 2 đến thứ 4", riskDaysText(listOf(1, 2, 3)))
        assertEquals("thứ 6 đến Chủ nhật", riskDaysText(listOf(5, 6, 7)))
        assertEquals("thứ 2, thứ 3, thứ 4, thứ 6 và thứ 7", riskDaysText(listOf(1, 2, 3, 5, 6)))
        assertEquals("thứ 6 và thứ 7", riskDaysText(listOf(5, 6)))
        assertEquals("", riskDaysText(listOf(0, 8)))
    }

    @Test
    fun timeRangeShowsMidnightAs2400() {
        assertEquals("22:00–24:00", riskTimeText("22:00", "00:00"))
        assertEquals("19:00–21:00", riskTimeText("19:00", "21:00"))
        assertEquals("23:00–02:00", riskTimeText("23:00", "02:00"))
    }

    @Test
    fun sentences() {
        val s = RiskSuggestion(listOf(1, 2, 3, 4, 5), "22:00", "00:00", 17, 9)
        assertEquals("Hay mở nhất: 22:00–24:00, thứ 2 đến thứ 6 (17 lần mở, 9 lần Vào).", riskSuggestionText(s))
        assertEquals(
            "22:00–24:00 · thứ 2 đến thứ 6 · thời gian chờ dài hơn một cấp",
            riskWindowLine(RiskWindow("a", listOf(1, 2, 3, 4, 5), "22:00", "00:00")),
        )
    }

    @Test
    fun heatmapDescriptionNamesTheBusiestCell() {
        val empty = emptyHeatmap()
        assertEquals("Bản đồ nhiệt giờ mở giải trí, 4 tuần gần nhất. Chưa có lần mở nào.", riskHeatmapDescription(empty))
        assertNull(busiestCell(empty))
        val grid = empty.map { it.toMutableList() }.toMutableList()
        grid[6][23] = RiskCell(5, 2)
        grid[2][8] = RiskCell(5, 1) // same opens, earlier row: wins the tie
        grid[0][1] = RiskCell(3, 3)
        assertEquals(2 to 8, busiestCell(grid))
        assertEquals(
            "Bản đồ nhiệt giờ mở giải trí, 4 tuần gần nhất. Ô đậm nhất: thứ 4, 08:00–09:00, 5 lần mở, 1 lần Vào.",
            riskHeatmapDescription(grid),
        )
        grid[2][8] = RiskCell(0, 0)
        assertEquals("Bản đồ nhiệt giờ mở giải trí, 4 tuần gần nhất. Ô đậm nhất: Chủ nhật, 23:00–24:00, 5 lần mở, 2 lần Vào.", riskHeatmapDescription(grid))
    }

    @Test
    fun intensityIsRelativeToTheBusiestCell() {
        assertEquals(0f, riskIntensity(0, 10), 0f)
        assertEquals(0f, riskIntensity(3, 0), 0f)
        assertEquals(0.5f, riskIntensity(5, 10), 1e-6f)
        assertEquals(1f, riskIntensity(10, 10), 0f)
    }
}
