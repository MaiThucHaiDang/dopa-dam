// The phone's side of sync, over Room. Same rules as the agent (syncstore.rs): configuration tables are
// "newest updated_at wins", events are append only, and usage rows belong to the device that wrote them.
package com.dang.dopadam.sync

import com.dang.dopadam.data.AppDatabase
import com.dang.dopadam.data.InterceptEventEntity
import com.dang.dopadam.data.Prefs
import com.dang.dopadam.data.SettingsEntity
import com.dang.dopadam.data.StudyRuleEntity
import com.dang.dopadam.data.StudySessionEntity
import com.dang.dopadam.data.TagRuleEntity
import com.dang.dopadam.data.UsageDailyEntity
import org.json.JSONObject

/** org.json drops keys whose value is null; Supabase needs an explicit null. */
fun JSONObject.putN(key: String, value: Any?): JSONObject = put(key, value ?: JSONObject.NULL)

fun JSONObject.str(key: String): String? = if (isNull(key)) null else optString(key)
fun JSONObject.long(key: String): Long? = if (isNull(key) || !has(key)) null else optLong(key)
fun JSONObject.int(key: String): Int? = if (isNull(key) || !has(key)) null else optInt(key)

/** Undecided events are pushed once decided, or after this long (they are closed as Thoát by then). */
private const val UNDECIDED_PUSH_AFTER_MS = 10 * 60_000L

class RoomSyncStore(private val db: AppDatabase, private val prefs: Prefs) : SyncStore {
    override suspend fun deviceId(): String = prefs.deviceId

    override suspend fun dirtyRows(table: String, deviceId: String, now: Long): List<JSONObject> = when (table) {
        "tag_rules" -> db.tagRules().dirty().map {
            JSONObject().put("id", it.id).put("kind", it.kind).put("pattern", it.pattern).put("tag", it.tag)
                .putN("delay_seconds", it.delaySeconds).put("updated_at", it.updatedAt).put("deleted", it.deleted)
        }
        "settings" -> listOfNotNull(db.settings().get()?.takeIf { it.dirty }).map {
            JSONObject().put("id", it.id).put("json", JSONObject(it.json)).put("updated_at", it.updatedAt)
        }
        "study_rules" -> db.study().dirtyRules().map {
            JSONObject().put("id", it.id).put("days", it.days).put("start", it.start).put("end", it.end).putN("label", it.label)
                .put("exceptions", it.exceptions).put("updated_at", it.updatedAt).put("deleted", it.deleted)
        }
        "study_sessions" -> db.study().dirtySessions().map {
            JSONObject().put("id", it.id).put("source", it.source).put("start", it.start).put("end", it.end).putN("label", it.label)
                .putN("external_id", it.externalId).put("updated_at", it.updatedAt).put("deleted", it.deleted)
        }
        "usage_daily" -> db.usage().dirty().filter { it.deviceId == deviceId }.map {
            JSONObject().put("id", it.id).put("day", it.day).put("device_id", it.deviceId).put("tag", it.tag)
                .put("seconds", it.seconds).put("updated_at", it.updatedAt)
        }
        "intercept_events" -> db.events().dirtyReady(now - UNDECIDED_PUSH_AFTER_MS).filter { it.deviceId == deviceId }.map {
            JSONObject().put("id", it.id).put("device_id", it.deviceId).put("object", it.obj).put("tag", it.tag)
                .put("level", it.level).put("lock_seconds", it.lockSeconds).put("n", it.n).put("shown_at", it.shownAt)
                .putN("study_label", it.studyLabel).putN("decision", it.decision).putN("decided_at", it.decidedAt)
                .putN("allow_minutes", it.allowMinutes).putN("activity", it.activity).putN("activity_minutes", it.activityMinutes)
        }
        else -> emptyList()
    }

    override suspend fun markClean(table: String, rows: List<JSONObject>) {
        for (row in rows) {
            val id = row.getString("id")
            val updatedAt = row.optLong("updated_at")
            when (table) {
                "tag_rules" -> db.tagRules().markClean(id, updatedAt)
                "settings" -> db.settings().markClean(updatedAt)
                "study_rules" -> db.study().markRuleClean(id, updatedAt)
                "study_sessions" -> db.study().markSessionClean(id, updatedAt)
                "usage_daily" -> db.usage().markClean(id, updatedAt)
                "intercept_events" -> db.events().markClean(id, row.str("decision"))
            }
        }
    }

    override suspend fun applyRemote(table: String, row: JSONObject, myDevice: String): Boolean {
        val id = row.str("id") ?: return false
        val updated = row.long("updated_at") ?: 0L
        fun newer(local: Long?) = local == null || updated > local
        when (table) {
            "tag_rules" -> {
                if (!newer(db.tagRules().get(id)?.updatedAt)) return false
                db.tagRules().upsert(
                    TagRuleEntity(
                        id, row.str("kind") ?: return false, row.str("pattern") ?: return false, row.str("tag") ?: return false,
                        row.int("delay_seconds"), updated, row.optBoolean("deleted"), dirty = false,
                    ),
                )
            }
            "settings" -> {
                if (!newer(db.settings().get()?.updatedAt)) return false
                db.settings().upsert(SettingsEntity(id, row.optJSONObject("json")?.toString() ?: "{}", updated, dirty = false))
            }
            "study_rules" -> {
                if (!newer(db.study().rule(id)?.updatedAt)) return false
                db.study().upsertRule(
                    StudyRuleEntity(
                        id, row.str("days") ?: "", row.str("start") ?: return false, row.str("end") ?: return false,
                        row.str("label"), row.str("exceptions") ?: "", updated, row.optBoolean("deleted"), dirty = false,
                    ),
                )
            }
            "study_sessions" -> {
                if (!newer(db.study().session(id)?.updatedAt)) return false
                db.study().upsertSession(
                    StudySessionEntity(
                        id, row.str("source") ?: return false, row.long("start") ?: return false, row.long("end") ?: return false,
                        row.str("label"), row.str("external_id"), updated, row.optBoolean("deleted"), dirty = false,
                    ),
                )
            }
            "usage_daily" -> {
                val device = row.str("device_id") ?: return false
                if (device == myDevice || !newer(db.usage().get(id)?.updatedAt)) return false
                db.usage().upsert(
                    UsageDailyEntity(id, row.str("day") ?: return false, device, row.str("tag") ?: return false, row.optDouble("seconds", 0.0), updated, dirty = false),
                )
            }
            "intercept_events" -> {
                if (db.events().get(id) != null) return false
                db.events().upsert(
                    InterceptEventEntity(
                        id = id,
                        deviceId = row.str("device_id") ?: return false,
                        obj = row.str("object") ?: return false,
                        tag = row.str("tag") ?: return false,
                        level = row.int("level") ?: 0,
                        lockSeconds = row.int("lock_seconds") ?: 0,
                        n = row.int("n") ?: 0,
                        shownAt = row.long("shown_at") ?: return false,
                        studyLabel = row.str("study_label"),
                        decision = row.str("decision"),
                        decidedAt = row.long("decided_at"),
                        allowMinutes = row.int("allow_minutes"),
                        activity = row.str("activity"),
                        activityMinutes = row.int("activity_minutes"),
                        dirty = false,
                    ),
                )
            }
            else -> return false
        }
        return true
    }

    override suspend fun cursor(table: String): String? = prefs.getString("cursor:$table")

    override suspend fun setCursor(table: String, value: String) = prefs.putString("cursor:$table", value)

    /** After switching accounts: pull everything again and push this phone's data to the new account. */
    suspend fun resetForNewAccount() {
        for (t in SYNC_TABLES) prefs.putString("cursor:$t", null)
        db.syncMaintenance().markAllDirty()
    }
}
