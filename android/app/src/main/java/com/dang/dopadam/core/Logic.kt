// Kotlin port of the shared core logic. Must give the same results as shared/test-vectors.
package com.dang.dopadam.core

import java.time.Instant
import java.time.ZoneOffset
import java.util.TimeZone

const val MINUTE_MS = 60_000L
const val HOUR_MS = 3_600_000L
const val DAY_MS = 86_400_000L
const val MAX_DELAY_SECONDS = 120

data class LevelResult(val level: Int, val lockSeconds: Int, val allowOptions: List<Int>)

/** Friction level from warnings in the previous hour, study mode and the daily budget. */
fun computeLevel(n: Int, inStudy: Boolean, overBudget: Boolean, settings: FrictionSettings): LevelResult {
    val level = when {
        inStudy || overBudget -> 3
        n <= 0 -> 0
        n <= 2 -> 1
        else -> 2
    }
    val options = if (level == 3) settings.allowOptionsRestricted else settings.allowOptionsNormal
    return LevelResult(level, settings.lockSeconds[level], options.toList())
}

/** Number of timestamps t with now - 1h < t <= now. */
fun recentCount(timestamps: Iterable<Long>, now: Long): Int = timestamps.count { it > now - HOUR_MS && it <= now }

/** YYYY-MM-DD of a "local ms" value (epoch ms already shifted by the timezone offset). */
fun formatLocalDate(localMs: Long): String =
    Instant.ofEpochMilli(localMs).atOffset(ZoneOffset.UTC).toLocalDate().toString()

/** The app's day starts at 04:00 local time so staying up past midnight does not reset the budget. */
fun dayKey(t: Long, tzOffsetMinutes: Int): String = formatLocalDate(t + tzOffsetMinutes * MINUTE_MS - 4 * HOUR_MS)

/** Minutes east of UTC for the device timezone at instant t (Vietnam: 420). */
fun localTzOffsetMinutes(t: Long): Int = TimeZone.getDefault().getOffset(t) / 60_000

data class BudgetStatus(val over: Boolean, val remainingMinutes: Double?)

/** A budget <= 0 means the daily budget is turned off. */
fun budgetStatus(usedMinutes: Double, budgetMinutes: Int): BudgetStatus =
    if (budgetMinutes <= 0) {
        BudgetStatus(false, null)
    } else {
        BudgetStatus(usedMinutes >= budgetMinutes, maxOf(0.0, budgetMinutes - usedMinutes))
    }

/** Per-app delay (even 0) overrides the tag default; result is clamped to 0..120 seconds. */
fun effectiveDelay(appDelaySeconds: Int?, tag: String, tagDelays: Map<String, Int>): Int =
    (appDelaySeconds ?: tagDelays[tag] ?: 0).coerceIn(0, MAX_DELAY_SECONDS)

// ---- Friction ---------------------------------------------------------------

const val CONFIRM_PHRASE = "tôi chọn giảm bảo vệ"
const val CONFIRM_WAIT_SECONDS = 60

enum class NumberField { LOCK_SECONDS, BUDGET_MINUTES, DELAY_SECONDS }

private fun isBlockedTagId(id: String?): Boolean = id == Tag.ENTERTAINMENT.id || id == Tag.GAME.id

/** True when the change weakens protection and needs the 60-second confirmation. */
fun tagChangeWeakens(oldTag: String?, newTag: String?): Boolean =
    (isBlockedTagId(oldTag) && !isBlockedTagId(newTag)) || (oldTag == Tag.ENTERTAINMENT.id && newTag == Tag.GAME.id)

fun numberChangeWeakens(field: NumberField, old: Int, new: Int): Boolean = when (field) {
    NumberField.LOCK_SECONDS -> new < old
    NumberField.BUDGET_MINUTES -> old > 0 && (new <= 0 || new > old)
    NumberField.DELAY_SECONDS -> new > old
}

fun isConfirmPhrase(input: String): Boolean =
    java.text.Normalizer.normalize(input, java.text.Normalizer.Form.NFC)
        .trim().lowercase().replace(Regex("\\s+"), " ") == CONFIRM_PHRASE
