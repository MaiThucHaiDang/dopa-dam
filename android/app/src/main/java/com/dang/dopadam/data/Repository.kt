package com.dang.dopadam.data

import com.dang.dopadam.core.DAY_MS
import com.dang.dopadam.core.Session
import com.dang.dopadam.core.Settings
import com.dang.dopadam.core.StudyRule
import com.dang.dopadam.core.StudyStatus
import com.dang.dopadam.core.Tag
import com.dang.dopadam.core.budgetStatus
import com.dang.dopadam.core.dayKey
import com.dang.dopadam.core.localTzOffsetMinutes
import com.dang.dopadam.core.resolveStudy
import com.dang.dopadam.logic.Decision
import com.dang.dopadam.logic.ErrorCode
import com.dang.dopadam.logic.WarningPlan
import com.dang.dopadam.logic.checkAppDelay
import com.dang.dopadam.logic.checkDecision
import com.dang.dopadam.logic.checkFriction
import com.dang.dopadam.logic.checkProtection
import com.dang.dopadam.logic.checkTagChange
import com.dang.dopadam.logic.planWarning
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

const val KIND_APP = "app"
const val RETENTION_DAYS = 14

fun ruleId(kind: String, pattern: String) = "$kind:$pattern"

data class BudgetView(val usedMinutes: Double, val budgetMinutes: Int, val remainingMinutes: Double?, val over: Boolean)

/** All reads and writes of the phone's data. Writes that read first go through one mutex. */
class Repository(val db: AppDatabase, val prefs: Prefs) {
    private val mutex = Mutex()

    val deviceId: String get() = prefs.deviceId

    // ---- Rules and settings -------------------------------------------------

    fun observeRules(): Flow<List<TagRuleEntity>> = db.tagRules().observeAll()

    suspend fun appRule(pkg: String): TagRuleEntity? = db.tagRules().get(ruleId(KIND_APP, pkg))?.takeIf { !it.deleted }

    suspend fun appRules(): Map<String, TagRuleEntity> = db.tagRules().byKind(KIND_APP).associateBy { it.pattern }

    suspend fun settings(): Settings = SettingsCodec.decode(db.settings().get()?.json)

    fun observeSettings(): Flow<Settings> = db.settings().observe().map { SettingsCodec.decode(it?.json) }

    // ---- Study and budget ---------------------------------------------------

    suspend fun studyStatus(now: Long): StudyStatus {
        val sessions = db.study().sessionsEndingAfter(now - DAY_MS)
        fun of(source: String) = sessions.filter { it.source == source }.map { Session(it.id, it.start, it.end, it.label) }
        val rules = db.study().rules().map { it.toRule() }
        return resolveStudy(now, localTzOffsetMinutes(now), of("manual"), rules, of("taskflow"))
    }

    suspend fun budgetView(now: Long): BudgetView {
        val used = db.usage().secondsFor(dayKey(now, localTzOffsetMinutes(now)), BLOCKED_TAGS) / 60.0
        val budget = settings().budgetMinutes
        val status = budgetStatus(used, budget)
        return BudgetView(used, budget, status.remainingMinutes, status.over)
    }

    // ---- Warnings -------------------------------------------------------------

    suspend fun recordWarning(id: String, obj: String, tag: String, now: Long): Pair<InterceptEventEntity, WarningPlan> =
        mutex.withLock {
            val plan = planWarning(
                db.events().shownSince(now - DAY_MS),
                now,
                studyStatus(now),
                budgetView(now).usedMinutes,
                settings(),
            )
            val event = InterceptEventEntity(
                id = id,
                deviceId = deviceId,
                obj = obj,
                tag = tag,
                level = plan.level,
                lockSeconds = plan.lockSeconds,
                n = plan.n,
                shownAt = now,
                studyLabel = plan.studyLabel,
                decision = null,
                decidedAt = null,
                allowMinutes = null,
                activity = null,
                activityMinutes = null,
            )
            db.events().upsert(event)
            event to plan
        }

    suspend fun decide(
        eventId: String,
        decision: Decision,
        allowMinutes: Int?,
        activity: String?,
        activityMinutes: Int?,
        now: Long,
    ): ErrorCode? = mutex.withLock {
        val event = db.events().get(eventId) ?: return@withLock ErrorCode.UNKNOWN_EVENT
        val error = checkDecision(
            decision, event.decision, event.shownAt, event.lockSeconds, event.level,
            allowMinutes, activity, activityMinutes, settings(), now,
        )
        if (error != null || event.decision != null) return@withLock error
        db.events().upsert(
            event.copy(
                decision = decision.id,
                decidedAt = now,
                allowMinutes = if (decision == Decision.ENTER) allowMinutes else null,
                activity = if (decision == Decision.ALTERNATIVE) activity else null,
                activityMinutes = if (decision == Decision.ALTERNATIVE) activityMinutes else null,
                dirty = true,
            ),
        )
        if (decision == Decision.ENTER && allowMinutes != null) {
            db.allowWindows().upsert(AllowWindowEntity(event.obj, now + allowMinutes * 60_000L))
        }
        null
    }

    /** A warning left without a decision (the user went home with a gesture) counts as leaving. */
    suspend fun autoExit(eventId: String, now: Long) = mutex.withLock {
        val event = db.events().get(eventId) ?: return@withLock
        if (event.decision == null) db.events().upsert(event.copy(decision = Decision.EXIT.id, decidedAt = now, dirty = true))
    }

    suspend fun allowWindow(obj: String): AllowWindowEntity? = db.allowWindows().get(obj)

    suspend fun allowWindows(): List<AllowWindowEntity> = db.allowWindows().all()

    suspend fun removeAllowWindow(obj: String) = db.allowWindows().delete(obj)

    suspend fun markHeadsUpSent(window: AllowWindowEntity) = db.allowWindows().upsert(window.copy(headsUpSent = true))

    // ---- Usage ----------------------------------------------------------------

    suspend fun addUsage(tag: String, seconds: Double, now: Long) = mutex.withLock {
        if (seconds <= 0) return@withLock
        val day = dayKey(now, localTzOffsetMinutes(now))
        val id = "$day|$deviceId|$tag"
        val current = db.usage().get(id)
        db.usage().upsert(
            UsageDailyEntity(id, day, deviceId, tag, (current?.seconds ?: 0.0) + seconds, now, dirty = true),
        )
    }

    // ---- Options --------------------------------------------------------------

    suspend fun setAppTag(pkg: String, tag: Tag?, confirmed: Boolean, now: Long): ErrorCode? = mutex.withLock {
        val existing = appRule(pkg)
        val error = checkTagChange(existing?.tag, tag?.id, confirmed, studyStatus(now).active)
        if (error != null || existing?.tag == tag?.id) return@withLock error
        val id = ruleId(KIND_APP, pkg)
        val rule = if (tag == null) {
            existing?.copy(deleted = true, updatedAt = now, dirty = true)
        } else {
            TagRuleEntity(id, KIND_APP, pkg, tag.id, existing?.delaySeconds, now, deleted = false, dirty = true)
        }
        rule?.let { db.tagRules().upsert(it) }
        null
    }

    suspend fun setAppDelay(pkg: String, delaySeconds: Int?, confirmed: Boolean, now: Long): ErrorCode? = mutex.withLock {
        val existing = appRule(pkg) ?: return@withLock ErrorCode.INVALID
        val error = checkAppDelay(existing.tag, existing.delaySeconds, delaySeconds, settings(), confirmed, studyStatus(now).active)
        if (error != null || existing.delaySeconds == delaySeconds) return@withLock error
        db.tagRules().upsert(existing.copy(delaySeconds = delaySeconds, updatedAt = now, dirty = true))
        null
    }

    suspend fun setSettings(new: Settings, confirmed: Boolean, now: Long): ErrorCode? = mutex.withLock {
        val old = settings()
        val error = checkFriction(old, new, confirmed, studyStatus(now).active)
        if (error != null || old == new) return@withLock error
        db.settings().upsert(SettingsEntity(json = SettingsCodec.encode(new), updatedAt = now, dirty = true))
        null
    }

    suspend fun setProtection(enabled: Boolean, confirmed: Boolean, now: Long): ErrorCode? {
        val error = checkProtection(prefs.protectionEnabled, enabled, confirmed, studyStatus(now).active)
        if (error == null) prefs.protectionEnabled = enabled
        return error
    }

    suspend fun clearLog(confirmed: Boolean): ErrorCode? {
        if (!confirmed) return ErrorCode.NEEDS_CONFIRM
        db.events().deleteAll()
        db.usage().deleteAll()
        return null
    }

    /** On first run, tag well-known entertainment apps and the phone's games so protection starts at once. */
    suspend fun applyDefaultTags(installed: List<Pair<String, Boolean>>, now: Long) = mutex.withLock {
        if (prefs.defaultsApplied) return@withLock
        val rules = installed.mapNotNull { (pkg, isGame) ->
            val tag = when {
                pkg in KNOWN_ENTERTAINMENT -> Tag.ENTERTAINMENT
                isGame -> Tag.GAME
                else -> null
            }
            tag?.let { TagRuleEntity(ruleId(KIND_APP, pkg), KIND_APP, pkg, it.id, null, now) }
        }
        db.tagRules().upsertAll(rules)
        prefs.defaultsApplied = true
    }

    suspend fun prune(now: Long) {
        db.events().closeAbandoned(before = now - 10 * 60_000L, at = now)
        db.events().deleteBefore(now - RETENTION_DAYS * DAY_MS)
        db.usage().deleteBefore(dayKey(now - RETENTION_DAYS * DAY_MS, localTzOffsetMinutes(now)))
        for (w in db.allowWindows().all()) if (w.expiresAt < now - DAY_MS) db.allowWindows().delete(w.obj)
    }

    companion object {
        val BLOCKED_TAGS = listOf(Tag.ENTERTAINMENT.id, Tag.GAME.id)

        val KNOWN_ENTERTAINMENT = setOf(
            "com.google.android.youtube",
            "com.zhiliaoapp.musically",
            "com.ss.android.ugc.trill",
            "com.facebook.katana",
            "com.facebook.lite",
            "com.instagram.android",
            "com.twitter.android",
            "com.reddit.frontpage",
            "com.netflix.mediaclient",
            "tv.twitch.android.app",
            "com.pinterest",
            "com.snapchat.android",
        )
    }
}

fun StudyRuleEntity.toRule() = StudyRule(
    id = id,
    days = days.split(",").mapNotNull { it.trim().toIntOrNull() },
    start = start,
    end = end,
    label = label,
    exceptions = exceptions.split(",").map { it.trim() }.filter { it.isNotEmpty() },
)
