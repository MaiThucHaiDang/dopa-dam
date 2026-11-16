package com.dang.dopadam.logic

/** What the periodic check should tell the user. */
enum class GuardAlert {
    NONE,

    /** The Accessibility permission has been switched off. */
    PERMISSION_LOST,

    /** Still enabled in settings, but the system has not bound the service (seen on some Xiaomi phones). */
    NOT_RUNNING,
}

data class GuardWatchResult(val alert: GuardAlert, val missedChecks: Int)

/** Enabled-but-not-running must be seen this many checks in a row before the user is told. */
const val NOT_RUNNING_CHECKS_BEFORE_ALERT = 2

/**
 * One periodic check of the guard (FR14: warn as soon as protection is lost). One check where the service is
 * enabled but not running can be a restart in progress, so the second one in a row raises the alert.
 * [previousMissedChecks] is the count returned by the previous check; store [GuardWatchResult.missedChecks] for the next.
 */
fun guardWatch(
    protectionEnabled: Boolean,
    accessibilityEnabled: Boolean,
    serviceRunning: Boolean,
    previousMissedChecks: Int,
): GuardWatchResult = when {
    !protectionEnabled -> GuardWatchResult(GuardAlert.NONE, 0)
    !accessibilityEnabled -> GuardWatchResult(GuardAlert.PERMISSION_LOST, 0)
    serviceRunning -> GuardWatchResult(GuardAlert.NONE, 0)
    else -> {
        val missed = previousMissedChecks.coerceAtLeast(0) + 1
        GuardWatchResult(if (missed >= NOT_RUNNING_CHECKS_BEFORE_ALERT) GuardAlert.NOT_RUNNING else GuardAlert.NONE, missed)
    }
}
