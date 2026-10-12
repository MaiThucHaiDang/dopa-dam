package com.dang.dopadam.data

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface TagRuleDao {
    @Query("SELECT * FROM tag_rules WHERE deleted = 0 ORDER BY pattern")
    fun observeAll(): Flow<List<TagRuleEntity>>

    @Query("SELECT * FROM tag_rules WHERE deleted = 0 AND kind = :kind")
    suspend fun byKind(kind: String): List<TagRuleEntity>

    @Query("SELECT * FROM tag_rules WHERE id = :id")
    suspend fun get(id: String): TagRuleEntity?

    @Query("SELECT COUNT(*) FROM tag_rules")
    suspend fun count(): Int

    @Upsert
    suspend fun upsert(rule: TagRuleEntity)

    @Upsert
    suspend fun upsertAll(rules: List<TagRuleEntity>)

    @Query("SELECT * FROM tag_rules WHERE dirty = 1")
    suspend fun dirty(): List<TagRuleEntity>

    @Query("UPDATE tag_rules SET dirty = 0 WHERE id = :id AND updatedAt = :updatedAt")
    suspend fun markClean(id: String, updatedAt: Long)
}

@Dao
interface SettingsDao {
    @Query("SELECT * FROM settings WHERE id = 'settings'")
    suspend fun get(): SettingsEntity?

    @Query("SELECT * FROM settings WHERE id = 'settings'")
    fun observe(): Flow<SettingsEntity?>

    @Upsert
    suspend fun upsert(settings: SettingsEntity)

    @Query("UPDATE settings SET dirty = 0 WHERE id = 'settings' AND updatedAt = :updatedAt")
    suspend fun markClean(updatedAt: Long)
}

@Dao
interface EventDao {
    @Query("SELECT shownAt FROM intercept_events WHERE shownAt > :since")
    suspend fun shownSince(since: Long): List<Long>

    @Query("SELECT * FROM intercept_events WHERE id = :id")
    suspend fun get(id: String): InterceptEventEntity?

    @Query("SELECT * FROM intercept_events WHERE shownAt >= :since ORDER BY shownAt")
    fun observeSince(since: Long): Flow<List<InterceptEventEntity>>

    @Query("SELECT * FROM intercept_events WHERE shownAt >= :since ORDER BY shownAt")
    suspend fun since(since: Long): List<InterceptEventEntity>

    @Upsert
    suspend fun upsert(event: InterceptEventEntity)

    @Upsert
    suspend fun upsertAll(events: List<InterceptEventEntity>)

    /** Undecided events are pushed only once they are decided (or a few minutes old). */
    @Query("SELECT * FROM intercept_events WHERE dirty = 1 AND (decision IS NOT NULL OR shownAt < :undecidedBefore)")
    suspend fun dirtyReady(undecidedBefore: Long): List<InterceptEventEntity>

    @Query("UPDATE intercept_events SET dirty = 0 WHERE id = :id AND decision IS :decision")
    suspend fun markClean(id: String, decision: String?)

    @Query("UPDATE intercept_events SET decision = 'exit', decidedAt = :at, dirty = 1 WHERE decision IS NULL AND shownAt < :before")
    suspend fun closeAbandoned(before: Long, at: Long)

    @Query("DELETE FROM intercept_events WHERE shownAt < :before")
    suspend fun deleteBefore(before: Long)

    @Query("DELETE FROM intercept_events")
    suspend fun deleteAll()
}

@Dao
interface UsageDao {
    @Query("SELECT * FROM usage_daily WHERE id = :id")
    suspend fun get(id: String): UsageDailyEntity?

    @Query("SELECT COALESCE(SUM(seconds), 0) FROM usage_daily WHERE day = :day AND tag IN (:tags)")
    suspend fun secondsFor(day: String, tags: List<String>): Double

    @Query("SELECT * FROM usage_daily WHERE day >= :fromDay")
    fun observeFrom(fromDay: String): Flow<List<UsageDailyEntity>>

    @Upsert
    suspend fun upsert(usage: UsageDailyEntity)

    @Upsert
    suspend fun upsertAll(rows: List<UsageDailyEntity>)

    @Query("SELECT * FROM usage_daily WHERE dirty = 1")
    suspend fun dirty(): List<UsageDailyEntity>

    @Query("UPDATE usage_daily SET dirty = 0 WHERE id = :id AND updatedAt = :updatedAt")
    suspend fun markClean(id: String, updatedAt: Long)

    @Query("SELECT day, tag, SUM(seconds) AS seconds FROM usage_daily WHERE day >= :fromDay GROUP BY day, tag")
    suspend fun sumsFrom(fromDay: String): List<DayTagSeconds>

    @Query("DELETE FROM usage_daily WHERE day < :beforeDay")
    suspend fun deleteBefore(beforeDay: String)

    @Query("DELETE FROM usage_daily")
    suspend fun deleteAll()
}

@Dao
interface AllowWindowDao {
    @Query("SELECT * FROM allow_windows WHERE object = :obj")
    suspend fun get(obj: String): AllowWindowEntity?

    @Query("SELECT * FROM allow_windows")
    suspend fun all(): List<AllowWindowEntity>

    @Upsert
    suspend fun upsert(window: AllowWindowEntity)

    @Query("DELETE FROM allow_windows WHERE object = :obj")
    suspend fun delete(obj: String)
}

@Dao
interface StudyDao {
    @Query("SELECT * FROM study_rules WHERE deleted = 0")
    suspend fun rules(): List<StudyRuleEntity>

    @Query("SELECT * FROM study_rules WHERE deleted = 0")
    fun observeRules(): Flow<List<StudyRuleEntity>>

    @Query("SELECT * FROM study_rules WHERE id = :id")
    suspend fun rule(id: String): StudyRuleEntity?

    @Upsert
    suspend fun upsertRule(rule: StudyRuleEntity)

    @Upsert
    suspend fun upsertRules(rules: List<StudyRuleEntity>)

    @Query("SELECT * FROM study_sessions WHERE deleted = 0 AND `end` > :after")
    suspend fun sessionsEndingAfter(after: Long): List<StudySessionEntity>

    @Query("SELECT * FROM study_sessions WHERE deleted = 0 AND `end` > :after")
    fun observeSessionsEndingAfter(after: Long): Flow<List<StudySessionEntity>>

    @Query("SELECT * FROM study_sessions WHERE id = :id")
    suspend fun session(id: String): StudySessionEntity?

    @Upsert
    suspend fun upsertSession(session: StudySessionEntity)

    @Upsert
    suspend fun upsertSessions(sessions: List<StudySessionEntity>)

    @Query("SELECT * FROM study_rules WHERE dirty = 1")
    suspend fun dirtyRules(): List<StudyRuleEntity>

    @Query("SELECT * FROM study_sessions WHERE dirty = 1")
    suspend fun dirtySessions(): List<StudySessionEntity>

    @Query("UPDATE study_rules SET dirty = 0 WHERE id = :id AND updatedAt = :updatedAt")
    suspend fun markRuleClean(id: String, updatedAt: Long)

    @Query("UPDATE study_sessions SET dirty = 0 WHERE id = :id AND updatedAt = :updatedAt")
    suspend fun markSessionClean(id: String, updatedAt: Long)
}

data class DayTagSeconds(val day: String, val tag: String, val seconds: Double)

/** Used when switching accounts: every local row is pushed again to the new account. */
@Dao
abstract class SyncMaintenanceDao {
    @Query("UPDATE tag_rules SET dirty = 1")
    protected abstract suspend fun rules()

    @Query("UPDATE settings SET dirty = 1")
    protected abstract suspend fun settings()

    @Query("UPDATE study_rules SET dirty = 1")
    protected abstract suspend fun studyRules()

    @Query("UPDATE study_sessions SET dirty = 1")
    protected abstract suspend fun studySessions()

    @Query("UPDATE usage_daily SET dirty = 1")
    protected abstract suspend fun usage()

    @Query("UPDATE intercept_events SET dirty = 1")
    protected abstract suspend fun events()

    @Transaction
    open suspend fun markAllDirty() {
        rules()
        settings()
        studyRules()
        studySessions()
        usage()
        events()
    }
}
