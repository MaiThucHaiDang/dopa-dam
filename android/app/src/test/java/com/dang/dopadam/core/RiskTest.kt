package com.dang.dopadam.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RiskTest {
    private val fri2330 = RiskWindow("a", listOf(5), "23:00", "02:00")

    @Test
    fun overnightWindowCountsAfterMidnight() {
        // 2026-10-17 is a Saturday; 01:00 Saturday local (UTC+7) belongs to Friday's window.
        val satOneAm = java.time.LocalDateTime.of(2026, 10, 17, 1, 0).toInstant(java.time.ZoneOffset.ofHours(7)).toEpochMilli()
        assertTrue(inRiskWindow(listOf(fri2330), satOneAm, 420))
        assertFalse(inRiskWindow(listOf(fri2330.copy(days = listOf(4))), satOneAm, 420))
    }

    @Test
    fun invalidWindowsAreIgnored() {
        val bad = RiskWindow("b", listOf(1, 2, 3, 4, 5, 6, 7), "08:00", "08:00")
        assertFalse(inRiskWindow(listOf(bad), 1_791_810_000_000L, 420))
    }

    @Test
    fun levelRaisesByOneUpToThree() {
        val f = Settings().friction
        assertEquals(1, computeLevel(0, false, false, f, inRisk = true).level)
        assertEquals(3, computeLevel(3, false, false, f, inRisk = true).level)
        assertEquals(3, computeLevel(0, true, false, f, inRisk = true).level)
        assertEquals(0, computeLevel(0, false, false, f).level)
    }

    @Test
    fun cleanRiskWindowsRefusesTooManyOrBadWindows() {
        val w = RiskWindow("a", listOf(1), "08:00", "09:00")
        assertEquals(12, cleanRiskWindows(List(12) { w.copy(id = "$it") })?.size)
        assertEquals(null, cleanRiskWindows(List(13) { w.copy(id = "$it") }))
        assertEquals(null, cleanRiskWindows(listOf(w, w.copy(start = "24:00"))))
        assertEquals(listOf(w.copy(start = "08:05")), cleanRiskWindows(listOf(w.copy(start = "8:05"))))
    }
}
