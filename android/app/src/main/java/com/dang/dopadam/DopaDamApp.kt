package com.dang.dopadam

import android.app.Application
import com.dang.dopadam.data.AppDatabase
import com.dang.dopadam.data.Prefs
import com.dang.dopadam.data.Repository
import com.dang.dopadam.service.Notifier
import com.dang.dopadam.service.PermissionWatchWorker
import com.dang.dopadam.sync.SyncManager
import com.dang.dopadam.sync.SyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class DopaDamApp : Application() {
    lateinit var repository: Repository
        private set
    lateinit var sync: SyncManager
        private set

    /** Work that outlives a screen (sync); cancelled only with the process. */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        repository = Repository(AppDatabase.open(this), Prefs(this))
        sync = SyncManager(this, repository)
        Notifier.createChannels(this)
        PermissionWatchWorker.schedule(this)
        SyncWorker.schedule(this)
        appScope.launch {
            sync.restore()
            sync.maybeSync(minIntervalMs = 0)
        }
    }
}
