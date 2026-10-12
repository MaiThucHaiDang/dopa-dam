package com.dang.dopadam.logic

import com.dang.dopadam.core.Settings
import com.dang.dopadam.core.StudySource
import com.dang.dopadam.core.StudyStatus
import com.dang.dopadam.data.SettingsCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GuardLogicTest {
    private val now = 1_791_810_000_000L
    private val minute = 60_000L
    private val s = Settings()
    private val studying = StudyStatus(true, StudySource.MANUAL, "Ôn Hệ điều hành", now + 30 * minute)

    @Test
    fun planEscalatesWithRecentWarnings() {
        assertEquals(0, planWarning(emptyList(), now, StudyStatus.NONE, 0.0, s).level)
        assertEquals(1, planWarning(listOf(now - minute), now, StudyStatus.NONE, 0.0, s).level)
        val plan = planWarning(listOf(now - 3 * minute, now - 2 * minute, now - minute), now, StudyStatus.NONE, 0.0, s)
        assertEquals(2, plan.level)
        assertEquals(20, plan.lockSeconds)
        assertEquals(3, plan.n)
        // Older than an hour does not count.
        assertEquals(0, planWarning(listOf(now - 61 * minute), now, StudyStatus.NONE, 0.0, s).level)
    }

    @Test
    fun planUsesLevelThreeWhenStudyingOrOverBudget() {
        val study = planWarning(emptyList(), now, studying, 0.0, s)
        assertEquals(3, study.level)
        assertEquals(listOf(5, 10), study.allowOptions)
        assertEquals("Ôn Hệ điều hành", study.studyLabel)
        assertEquals(3, planWarning(emptyList(), now, StudyStatus.NONE, 90.0, s).level)
        assertEquals(0, planWarning(emptyList(), now, StudyStatus.NONE, 89.9, s).level)
        assertEquals(0, planWarning(emptyList(), now, StudyStatus.NONE, 500.0, s.copy(budgetMinutes = 0)).level)
    }

    @Test
    fun enterNeedsTheLockToBeOverAndAValidOption() {
        fun check(at: Long, minutes: Int?, level: Int = 0) =
            checkDecision(Decision.ENTER, null, now, 5, level, minutes, null, null, s, at)
        assertEquals(ErrorCode.LOCKED, check(now + 2000, 5))
        assertNull(check(now + 4600, 5))
        assertEquals(ErrorCode.INVALID, check(now + 6000, 7))
        assertEquals(ErrorCode.INVALID, check(now + 6000, 15, level = 3))
        assertNull(check(now + 6000, 10, level = 3))
        assertEquals(ErrorCode.INVALID, check(now + 6000, null))
    }

    @Test
    fun alternativeAndRepeatedDecisions() {
        assertNull(checkDecision(Decision.ALTERNATIVE, null, now, 5, 0, null, "Hít đất", 3, s, now))
        assertEquals(ErrorCode.INVALID, checkDecision(Decision.ALTERNATIVE, null, now, 5, 0, null, "Ngủ", 3, s, now))
        assertEquals(ErrorCode.INVALID, checkDecision(Decision.ALTERNATIVE, null, now, 5, 0, null, "Hít đất", 11, s, now))
        assertNull(checkDecision(Decision.EXIT, null, now, 30, 3, null, null, null, s, now))
        assertNull(checkDecision(Decision.EXIT, "exit", now, 5, 0, null, null, null, s, now))
        assertEquals(ErrorCode.ALREADY_DECIDED, checkDecision(Decision.ENTER, "exit", now, 5, 0, 5, null, null, s, now + 9000))
    }

    @Test
    fun tagChanges() {
        assertEquals(ErrorCode.NEEDS_CONFIRM, checkTagChange("entertainment", "study", false, false))
        assertNull(checkTagChange("entertainment", "study", true, false))
        assertNull(checkTagChange(null, "entertainment", false, false))
        assertEquals(ErrorCode.STUDY_LOCKED, checkTagChange(null, "entertainment", true, true))
        assertNull(checkTagChange("game", "game", false, true))
    }

    @Test
    fun appDelayWeakensWhenEffectiveDelayGrows() {
        assertEquals(ErrorCode.NEEDS_CONFIRM, checkAppDelay("game", null, 60, s, false, false))
        assertNull(checkAppDelay("game", null, 10, s, false, false))
        assertNull(checkAppDelay("game", 60, null, s, false, false))
        assertEquals(ErrorCode.NEEDS_CONFIRM, checkAppDelay("entertainment", null, 5, s, false, false))
        assertEquals(ErrorCode.INVALID, checkAppDelay("game", null, 500, s, true, false))
        assertEquals(ErrorCode.STUDY_LOCKED, checkAppDelay("game", null, 10, s, true, true))
    }

    @Test
    fun frictionChanges() {
        assertNull(checkFriction(s, s.copy(lockSeconds = listOf(5, 10, 25, 40)), false, false))
        assertEquals(ErrorCode.NEEDS_CONFIRM, checkFriction(s, s.copy(lockSeconds = listOf(5, 5, 20, 30)), false, false))
        assertEquals(ErrorCode.NEEDS_CONFIRM, checkFriction(s, s.copy(budgetMinutes = 120), false, false))
        assertEquals(ErrorCode.NEEDS_CONFIRM, checkFriction(s, s.copy(budgetMinutes = 0), false, false))
        assertNull(checkFriction(s, s.copy(budgetMinutes = 60), false, false))
        assertEquals(ErrorCode.NEEDS_CONFIRM, checkFriction(s, s.copy(tagDelays = mapOf("game" to 60)), false, false))
        assertNull(checkFriction(s, s.copy(tagDelays = mapOf("game" to 10)), false, false))
        assertEquals(ErrorCode.INVALID, checkFriction(s, s.copy(lockSeconds = listOf(5, 10)), true, false))
        assertEquals(ErrorCode.STUDY_LOCKED, checkFriction(s, s.copy(budgetMinutes = 60), true, true))
    }

    @Test
    fun protection() {
        assertEquals(ErrorCode.NEEDS_CONFIRM, checkProtection(true, false, false, false))
        assertNull(checkProtection(true, false, true, false))
        assertEquals(ErrorCode.STUDY_LOCKED, checkProtection(true, false, true, true))
        assertNull(checkProtection(false, true, false, true))
    }

    @Test
    fun settingsCodecRoundTripsAndRepairs() {
        val custom = Settings(listOf(3, 6, 9, 45), listOf(10, 20), listOf(3), 120, mapOf("game" to 40))
        assertEquals(custom, SettingsCodec.decode(SettingsCodec.encode(custom)))
        assertEquals(Settings(), SettingsCodec.decode("not json"))
        assertEquals(Settings(), SettingsCodec.decode(null))
        assertEquals(Settings().lockSeconds, SettingsCodec.decode("""{"lockSeconds":[1,2]}""").lockSeconds)
    }
}

class OpenTrackerTest {
    private val t0 = 1_000_000L

    @Test
    fun delayCountsOnlyWhileInFrontAndContinuesAfterSwitching() {
        val tr = OpenTracker()
        tr.enter("game", t0)
        assertFalse(tr.isDue("game", t0 + 20_000, 30_000))
        tr.leave("game", t0 + 20_000)
        // Away for two minutes: the count pauses.
        tr.enter("game", t0 + 140_000)
        assertFalse(tr.isDue("game", t0 + 145_000, 30_000))
        assertTrue(tr.isDue("game", t0 + 150_000, 30_000))
    }

    @Test
    fun aLongAbsenceStartsANewOpen() {
        val tr = OpenTracker()
        tr.enter("game", t0)
        tr.leave("game", t0 + 25_000)
        tr.enter("game", t0 + 25_000 + 11 * 60_000)
        assertFalse(tr.isDue("game", t0 + 25_000 + 11 * 60_000 + 10_000, 30_000))
    }

    @Test
    fun afterAWarningComingBackIsImmediate() {
        val tr = OpenTracker()
        tr.enter("game", t0)
        assertTrue(tr.isDue("game", t0 + 30_000, 30_000))
        tr.markWarned("game")
        tr.leave("game", t0 + 31_000)
        tr.enter("game", t0 + 60_000)
        assertTrue(tr.isDue("game", t0 + 60_000, 30_000))
    }

    @Test
    fun zeroDelayIsDueAtOnce() {
        val tr = OpenTracker()
        tr.enter("yt", t0)
        assertTrue(tr.isDue("yt", t0, 0))
        assertFalse(tr.isDue("unknown", t0, 0))
    }
}
