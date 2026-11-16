package com.dang.dopadam.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AbandonedTest {
    @Test
    fun anUndecidedWarningIsOnlyClosedAfterTwelveHours() {
        val now = 1_791_810_000_000L
        assertEquals(12 * 3_600_000L, ABANDONED_AFTER_MS)
        // closeAbandoned closes events with shownAt < abandonedBefore(now).
        assertTrue(now - 60 * 60_000L >= abandonedBefore(now)) // an hour old stays open
        assertTrue(now - 11 * 3_600_000L >= abandonedBefore(now))
        assertTrue(now - 12 * 3_600_000L - 1 < abandonedBefore(now)) // just over twelve hours is closed
    }
}
