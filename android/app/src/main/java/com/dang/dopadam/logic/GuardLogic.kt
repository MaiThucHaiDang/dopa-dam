// Pure decision rules for the phone, mirroring extension/src/background/logic.ts.
package com.dang.dopadam.logic

import com.dang.dopadam.core.NumberField
import com.dang.dopadam.core.Settings
import com.dang.dopadam.core.StudyRule
import com.dang.dopadam.core.StudyStatus
import com.dang.dopadam.core.budgetStatus
import com.dang.dopadam.core.computeLevel
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
)

fun planWarning(shownTimes: List<Long>, now: Long, study: StudyStatus, usedMinutes: Double, settings: Settings): WarningPlan {
    val n = recentCount(shownTimes, now)
    val over = budgetStatus(usedMinutes, settings.budgetMinutes).over
    val lvl = computeLevel(n, study.active, over, settings.friction)
    return WarningPlan(lvl.level, lvl.lockSeconds, lvl.allowOptions, n, if (study.active) study.label else null)
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

fun checkFriction(old: Settings, new: Settings, confirmed: Boolean, studyActive: Boolean): ErrorCode? {
    val valid = new.lockSeconds.size == 4 &&
        new.lockSeconds.all { it in 0..300 } &&
        new.budgetMinutes in 0..1440 &&
        new.tagDelays.values.all { it in 0..120 }
    if (!valid) return ErrorCode.INVALID
    if (old == new) return null
    if (studyActive) return ErrorCode.STUDY_LOCKED
    val weakens = new.lockSeconds.indices.any { numberChangeWeakens(NumberField.LOCK_SECONDS, old.lockSeconds[it], new.lockSeconds[it]) } ||
        numberChangeWeakens(NumberField.BUDGET_MINUTES, old.budgetMinutes, new.budgetMinutes) ||
        (old.tagDelays.keys + new.tagDelays.keys).any {
            numberChangeWeakens(NumberField.DELAY_SECONDS, old.tagDelays[it] ?: 0, new.tagDelays[it] ?: 0)
        }
    return if (weakens && !confirmed) ErrorCode.NEEDS_CONFIRM else null
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
