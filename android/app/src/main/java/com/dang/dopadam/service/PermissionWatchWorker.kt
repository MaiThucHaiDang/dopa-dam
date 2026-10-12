package com.dang.dopadam.service

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.dang.dopadam.DopaDamApp
import java.util.concurrent.TimeUnit

/** Every 15 minutes: warn when the Accessibility permission has been switched off (FR14), and tidy old data. */
class PermissionWatchWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as DopaDamApp
        if (app.repository.prefs.protectionEnabled && !Permissions.accessibilityEnabled(applicationContext)) {
            Notifier.accessibilityLost(applicationContext)
        }
        app.repository.prune(System.currentTimeMillis())
        return Result.success()
    }

    companion object {
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "permission-watch",
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<PermissionWatchWorker>(15, TimeUnit.MINUTES).build(),
            )
        }
    }
}
