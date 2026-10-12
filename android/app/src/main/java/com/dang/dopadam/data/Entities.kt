package com.dang.dopadam.data

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * A tag for an app, website or desktop program. The id is "kind:pattern" (e.g. "app:com.google.android.youtube"),
 * so the same rule created on two devices merges by "newest updatedAt wins".
 * Rules of other kinds (domain, exe) arrive through sync and are kept but not used on the phone.
 */
@Entity(tableName = "tag_rules", indices = [Index(value = ["kind", "pattern"], unique = true)])
data class TagRuleEntity(
    @PrimaryKey val id: String,
    val kind: String,
    val pattern: String,
    val tag: String,
    val delaySeconds: Int?,
    val updatedAt: Long,
    val deleted: Boolean = false,
    val dirty: Boolean = true,
)

/** Settings as JSON (see SettingsCodec), one row. */
@Entity(tableName = "settings")
data class SettingsEntity(
    @PrimaryKey val id: String = SETTINGS_ID,
    val json: String,
    val updatedAt: Long,
    val dirty: Boolean = true,
) {
    companion object {
        const val SETTINGS_ID = "settings"
    }
}

@Entity(tableName = "intercept_events", indices = [Index("shownAt")])
data class InterceptEventEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    @ColumnInfo(name = "object") val obj: String,
    val tag: String,
    val level: Int,
    val lockSeconds: Int,
    /** Warnings in the previous hour, not counting this one. */
    val n: Int,
    val shownAt: Long,
    val studyLabel: String?,
    val decision: String?,
    val decidedAt: Long?,
    val allowMinutes: Int?,
    val activity: String?,
    val activityMinutes: Int?,
    val dirty: Boolean = true,
)

/** Seconds of use per day, device and tag. Only the owning device writes its rows. */
@Entity(tableName = "usage_daily", indices = [Index("day")])
data class UsageDailyEntity(
    @PrimaryKey val id: String,
    val day: String,
    val deviceId: String,
    val tag: String,
    val seconds: Double,
    val updatedAt: Long,
    val dirty: Boolean = true,
)

/** Local only: the app may be used without a warning until expiresAt. */
@Entity(tableName = "allow_windows")
data class AllowWindowEntity(
    @PrimaryKey @ColumnInfo(name = "object") val obj: String,
    val expiresAt: Long,
    val headsUpSent: Boolean = false,
)

@Entity(tableName = "study_rules")
data class StudyRuleEntity(
    @PrimaryKey val id: String,
    /** ISO weekdays, comma separated ("1,2,3,4,5"). */
    val days: String,
    val start: String,
    val end: String,
    val label: String?,
    /** Dates "YYYY-MM-DD", comma separated. */
    val exceptions: String,
    val updatedAt: Long,
    val deleted: Boolean = false,
    val dirty: Boolean = true,
)

@Entity(tableName = "study_sessions", indices = [Index("end")])
data class StudySessionEntity(
    @PrimaryKey val id: String,
    /** "manual", "rule" or "taskflow". */
    val source: String,
    val start: Long,
    val end: Long,
    val label: String?,
    val externalId: String?,
    val updatedAt: Long,
    val deleted: Boolean = false,
    val dirty: Boolean = true,
)
