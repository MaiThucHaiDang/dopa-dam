// Pure decision rules for the phone, mirroring extension/src/background/logic.ts.
package com.dang.dopadam.logic

import com.dang.dopadam.core.NumberField
import com.dang.dopadam.core.Settings
import com.dang.dopadam.core.StudyRule
import com.dang.dopadam.core.StudyStatus
import com.dang.dopadam.core.RiskWindow
import com.dang.dopadam.core.baseLevel
import com.dang.dopadam.core.budgetStatus
import com.dang.dopadam.core.cleanRiskWindows
import com.dang.dopadam.core.computeLevel
import com.dang.dopadam.core.riskWindowsChangeWeakens
import com.dang.dopadam.core.effectiveDelay
import com.dang.dopadam.core.numberChangeWeakens
import com.dang.dopadam.core.recentCount
import com.dang.dopadam.core.studyRuleChangeWeakens
import com.dang.dopadam.core.tagChangeWeakens

enum class ErrorCode(val message: String) {
    INVALID("Giá trị không hợp lệ."),
    NEEDS_CONFIRM("Thay đổi này làm yếu bảo vệ nên cần xác nhận."),
    STUDY_LOCKED("Đang trong phiên học nên không chỉnh được."),
    UNKNOWN_EVENT("Không tìm thấy lần chặn này."),
    ALREADY_DECIDED("Lần chặn này đã có quyết định."),
    LOCKED("Nút Vào vẫn đang bị khóa."),
}

enum class Decision(val id: String) { ENTER("enter"), EXIT("exit"), ALTERNATIVE("alternative") }

val ACTIVITIES = listOf("Nhảy dây", "Hít đất", "Đọc sách")

/** Grace for the lock check, to absorb timer jitter between the screen and the record. */
const val LOCK_TOLERANCE_MS = 500L

data class WarningPlan(
    val level: Int,
    val lockSeconds: Int,
    val allowOptions: List<Int>,
    val n: Int,
    val studyLabel: String?,
    /** The level is one higher because the warning came in a risk window (the screen says so). */
    val riskRaised: Boolean = false,
)

/** [inRisk]: `inRiskWindow(settings.riskWindows, now, tz)`, computed by the caller (it needs the timezone). */
fun planWarning(
    shownTimes: List<Long>,
    now: Long,
    study: StudyStatus,
    usedMinutes: Double,
    settings: Settings,
    inRisk: Boolean = false,
): WarningPlan {
    val n = recentCount(shownTimes, now)
    val over = budgetStatus(usedMinutes, settings.budgetMinutes).over
    val lvl = computeLevel(n, study.active, over, settings.friction, inRisk)
    val raised = inRisk && baseLevel(n, study.active, over) < 3
    return WarningPlan(lvl.level, lvl.lockSeconds, lvl.allowOptions, n, if (study.active) study.label else null, raised)
}

fun allowOptionsFor(settings: Settings, level: Int): List<Int> =
    if (level == 3) settings.allowOptionsRestricted else settings.allowOptionsNormal

fun checkDecision(
    decision: Decision,
    existingDecision: String?,
    shownAt: Long,
    lockSeconds: Int,
    level: Int,
    allowMinutes: Int?,
    activity: String?,
    activityMinutes: Int?,
    settings: Settings,
    now: Long,
): ErrorCode? {
    if (existingDecision != null) return if (existingDecision == decision.id) null else ErrorCode.ALREADY_DECIDED
    return when (decision) {
        Decision.ENTER -> when {
            now - shownAt < lockSeconds * 1000L - LOCK_TOLERANCE_MS -> ErrorCode.LOCKED
            allowMinutes == null || allowMinutes !in allowOptionsFor(settings, level) -> ErrorCode.INVALID
            else -> null
        }
        Decision.ALTERNATIVE ->
            if (activity in ACTIVITIES && activityMinutes != null && activityMinutes in 2..10) null else ErrorCode.INVALID
        Decision.EXIT -> null
    }
}

fun checkTagChange(oldTag: String?, newTag: String?, confirmed: Boolean, studyActive: Boolean): ErrorCode? = when {
    oldTag == newTag -> null
    studyActive -> ErrorCode.STUDY_LOCKED
    tagChangeWeakens(oldTag, newTag) && !confirmed -> ErrorCode.NEEDS_CONFIRM
    else -> null
}

/** Changing an app's own delay: weakens when the effective delay grows. */
fun checkAppDelay(
    tag: String,
    oldDelay: Int?,
    newDelay: Int?,
    settings: Settings,
    confirmed: Boolean,
    studyActive: Boolean,
): ErrorCode? {
    if (newDelay != null && newDelay !in 0..120) return ErrorCode.INVALID
    val before = effectiveDelay(oldDelay, tag, settings.tagDelays)
    val after = effectiveDelay(newDelay, tag, settings.tagDelays)
    return when {
        oldDelay == newDelay -> null
        studyActive -> ErrorCode.STUDY_LOCKED
        numberChangeWeakens(NumberField.DELAY_SECONDS, before, after) && !confirmed -> ErrorCode.NEEDS_CONFIRM
        else -> null
    }
}

/** One to four allow-window lengths in minutes, each from 1 to `max` (same rule as the agent). */
private fun validAllowOptions(options: List<Int>, max: Int) = options.size in 1..4 && options.all { it in 1..max }

fun checkFriction(old: Settings, new: Settings, confirmed: Boolean, studyActive: Boolean): ErrorCode? {
    val valid = new.lockSeconds.size == 4 &&
        new.lockSeconds.all { it in 0..300 } &&
        new.budgetMinutes in 0..1440 &&
        new.tagDelays.values.all { it in 0..120 } &&
        validAllowOptions(new.allowOptionsNormal, 120) &&
        validAllowOptions(new.allowOptionsRestricted, 10)
    if (!valid) return ErrorCode.INVALID
    if (old == new) return null
    if (studyActive) return ErrorCode.STUDY_LOCKED
    val weakens = new.lockSeconds.indices.any { numberChangeWeakens(NumberField.LOCK_SECONDS, old.lockSeconds[it], new.lockSeconds[it]) } ||
        numberChangeWeakens(NumberField.BUDGET_MINUTES, old.budgetMinutes, new.budgetMinutes) ||
        (old.tagDelays.keys + new.tagDelays.keys).any {
            numberChangeWeakens(NumberField.DELAY_SECONDS, old.tagDelays[it] ?: 0, new.tagDelays[it] ?: 0)
        }
    // A longer allow window is the weaker setting.
    fun longest(v: List<Int>) = v.maxOrNull() ?: 0
    val optionsWeaken = longest(new.allowOptionsNormal) > longest(old.allowOptionsNormal) ||
        longest(new.allowOptionsRestricted) > longest(old.allowOptionsRestricted)
    return if ((weakens || optionsWeaken) && !confirmed) ErrorCode.NEEDS_CONFIRM else null
}

/**
 * Adding or widening a weekly rule is always fine; anything that weakens it waits for the
 * confirmation, and is locked while studying (ending study early goes through [checkStudyStop]).
 */
fun checkStudyRuleChange(
    old: StudyRule?,
    new: StudyRule?,
    confirmed: Boolean,
    studyActive: Boolean,
    now: Long,
    tzOffsetMinutes: Int,
): ErrorCode? = when {
    old == new || !studyRuleChangeWeakens(old, new, now, tzOffsetMinutes) -> null
    studyActive -> ErrorCode.STUDY_LOCKED
    !confirmed -> ErrorCode.NEEDS_CONFIRM
    else -> null
}

/** Ending study before its time (FR14). */
fun checkStudyStop(studyActive: Boolean, confirmed: Boolean): ErrorCode? = when {
    !studyActive -> ErrorCode.INVALID
    !confirmed -> ErrorCode.NEEDS_CONFIRM
    else -> null
}

fun checkProtection(current: Boolean, enabled: Boolean, confirmed: Boolean, studyActive: Boolean): ErrorCode? = when {
    current == enabled || enabled -> null
    studyActive -> ErrorCode.STUDY_LOCKED
    !confirmed -> ErrorCode.NEEDS_CONFIRM
    else -> null
}

/**
 * Replacing the list of risk windows. Invalid input (too many, a bad window) is refused; adding or widening
 * is always fine; anything that uncovers a minute (removing, fewer days, shorter) is locked while studying
 * and otherwise waits for the confirmation, like the other weakening settings.
 */
fun checkRiskWindowsChange(old: List<RiskWindow>, new: List<RiskWindow>, confirmed: Boolean, studyActive: Boolean): ErrorCode? {
    val clean = cleanRiskWindows(new) ?: return ErrorCode.INVALID
    return when {
        !riskWindowsChangeWeakens(old, clean) -> null
        studyActive -> ErrorCode.STUDY_LOCKED
        !confirmed -> ErrorCode.NEEDS_CONFIRM
        else -> null
    }
}
