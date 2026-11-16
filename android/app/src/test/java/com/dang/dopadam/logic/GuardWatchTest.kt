package com.dang.dopadam.logic

import org.junit.Assert.assertEquals
import org.junit.Test

class GuardWatchTest {
    private fun check(protection: Boolean = true, enabled: Boolean = true, running: Boolean = true, missed: Int = 0) =
        guardWatch(protection, enabled, running, missed)

    @Test
    fun aHealthyGuardSaysNothingAndForgetsEarlierMisses() {
        assertEquals(GuardWatchResult(GuardAlert.NONE, 0), check(missed = 1))
    }

    @Test
    fun lostPermissionIsReportedAtOnce() {
        assertEquals(GuardWatchResult(GuardAlert.PERMISSION_LOST, 0), check(enabled = false, running = false))
        assertEquals(GuardWatchResult(GuardAlert.PERMISSION_LOST, 0), check(enabled = false, running = true, missed = 1))
    }

    @Test
    fun enabledButNotRunningNeedsTwoChecksInARow() {
        val first = check(running = false)
        assertEquals(GuardWatchResult(GuardAlert.NONE, 1), first)
        val second = check(running = false, missed = first.missedChecks)
        assertEquals(GuardWatchResult(GuardAlert.NOT_RUNNING, 2), second)
        assertEquals(GuardAlert.NOT_RUNNING, check(running = false, missed = second.missedChecks).alert)
    }

    @Test
    fun aRunningCheckBetweenTwoMissesStartsTheCountAgain() {
        val first = check(running = false)
        val recovered = check(running = true, missed = first.missedChecks)
        assertEquals(GuardWatchResult(GuardAlert.NONE, 0), recovered)
        assertEquals(GuardWatchResult(GuardAlert.NONE, 1), check(running = false, missed = recovered.missedChecks))
    }

    @Test
    fun nothingIsReportedWhileProtectionIsOff() {
        assertEquals(GuardWatchResult(GuardAlert.NONE, 0), check(protection = false, enabled = false, running = false, missed = 5))
    }
}
