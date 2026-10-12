package com.dang.dopadam.logic

import com.dang.dopadam.core.MINUTE_MS

/**
 * Tracks how long each app has been in front during its current "open", for the warning delay (FR10).
 *
 * An open starts when an app comes to the front after being away for more than [freshGapMs]
 * (a cold start where a game needs time to load). Switching away pauses the count; coming back
 * within the gap continues it. The delay only applies to the first warning of an open: once a
 * warning has been shown, coming back shows it again right away.
 */
class OpenTracker(private val freshGapMs: Long = 10 * MINUTE_MS) {
    private class State(var accumulatedMs: Long, var enteredAt: Long?, var lastSeenAt: Long, var warned: Boolean)

    private val states = HashMap<String, State>()

    fun enter(pkg: String, now: Long) {
        val st = states[pkg]
        if (st == null || now - st.lastSeenAt > freshGapMs) {
            states[pkg] = State(0, now, now, false)
        } else if (st.enteredAt == null) {
            st.enteredAt = now
            st.lastSeenAt = now
        }
    }

    fun leave(pkg: String, now: Long) {
        val st = states[pkg] ?: return
        st.enteredAt?.let { st.accumulatedMs += now - it }
        st.enteredAt = null
        st.lastSeenAt = now
    }

    fun foregroundMs(pkg: String, now: Long): Long {
        val st = states[pkg] ?: return 0
        return st.accumulatedMs + (st.enteredAt?.let { now - it } ?: 0)
    }

    fun markWarned(pkg: String) {
        states[pkg]?.warned = true
    }

    /** Whether the warning is due now for an app in front with the given delay. */
    fun isDue(pkg: String, now: Long, delayMs: Long): Boolean {
        val st = states[pkg] ?: return false
        return st.warned || foregroundMs(pkg, now) >= delayMs
    }
}
