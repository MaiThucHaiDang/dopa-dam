package com.dang.dopadam.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        TagRuleEntity::class,
        SettingsEntity::class,
        InterceptEventEntity::class,
        UsageDailyEntity::class,
        AllowWindowEntity::class,
        StudyRuleEntity::class,
        StudySessionEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun tagRules(): TagRuleDao
    abstract fun settings(): SettingsDao
    abstract fun events(): EventDao
    abstract fun usage(): UsageDao
    abstract fun allowWindows(): AllowWindowDao
    abstract fun study(): StudyDao
    abstract fun syncMaintenance(): SyncMaintenanceDao

    companion object {
        fun open(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "dopadam.db").build()
    }
}
