package com.dang.dopadam.service

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.dang.dopadam.DopaDamApp
import com.dang.dopadam.logic.GuardAlert
import com.dang.dopadam.logic.guardWatch
import java.util.concurrent.TimeUnit

/** Every 15 minutes: warn when the guard has stopped (permission off, or enabled but not running; FR14), and tidy old data. */
class PermissionWatchWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as DopaDamApp
        val prefs = app.repository.prefs
        val check = guardWatch(
            protectionEnabled = prefs.protectionEnabled,
            accessibilityEnabled = Permissions.accessibilityEnabled(applicationContext),
            serviceRunning = GuardService.isRunning,
            previousMissedChecks = prefs.getLong(MISSED_KEY).toInt(),
        )
        prefs.putLong(MISSED_KEY, check.missedChecks.toLong())
        when (check.alert) {
            GuardAlert.PERMISSION_LOST -> Notifier.accessibilityLost(applicationContext)
            GuardAlert.NOT_RUNNING -> Notifier.guardNotRunning(applicationContext)
            GuardAlert.NONE -> Unit
        }
        app.repository.prune(System.currentTimeMillis(), GuardService.shownEventId)
        return Result.success()
    }

    companion object {
        private const val MISSED_KEY = "guardMissedChecks"

        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "permission-watch",
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<PermissionWatchWorker>(15, TimeUnit.MINUTES).build(),
            )
        }
    }
}
