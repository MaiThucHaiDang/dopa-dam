package com.dang.dopadam

import android.app.Application
import com.dang.dopadam.data.AppDatabase
import com.dang.dopadam.data.Prefs
import com.dang.dopadam.data.Repository
import com.dang.dopadam.service.Notifier
import com.dang.dopadam.service.PermissionWatchWorker

class DopaDamApp : Application() {
    lateinit var repository: Repository
        private set

    override fun onCreate() {
        super.onCreate()
        repository = Repository(AppDatabase.open(this), Prefs(this))
        Notifier.createChannels(this)
        PermissionWatchWorker.schedule(this)
    }
}
