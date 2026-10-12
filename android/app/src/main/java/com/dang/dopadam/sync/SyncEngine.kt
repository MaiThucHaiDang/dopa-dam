// One sync round, independent of Android so it can be unit-tested: push local changes, record this
// device, pull everything newer than the per-table cursors. Same algorithm as the agent (sync.rs).
package com.dang.dopadam.sync

import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit

val SYNC_TABLES = listOf("tag_rules", "settings", "study_rules", "study_sessions", "usage_daily", "intercept_events")

/** The local side of sync (Room in the app, in-memory in tests). */
interface SyncStore {
    suspend fun deviceId(): String
    suspend fun dirtyRows(table: String, deviceId: String, now: Long): List<JSONObject>
    suspend fun markClean(table: String, rows: List<JSONObject>)
    /** Merges one pulled row; true when local data changed. */
    suspend fun applyRemote(table: String, row: JSONObject, myDevice: String): Boolean
    suspend fun cursor(table: String): String?
    suspend fun setCursor(table: String, value: String)
}

data class DeviceInfo(val name: String, val version: String)

data class SyncReport(val pushed: Int, val pulled: Int, val changed: Int)

object SyncEngine {
    const val PAGE = 1000
    /** Pull again a little before the cursor: rows committed late with an earlier stamp are not missed. */
    private const val OVERLAP_MINUTES = 5L

    fun parseTs(value: String): Instant? = try {
        OffsetDateTime.parse(value).toInstant()
    } catch (e: java.time.format.DateTimeParseException) {
        null
    }

    fun formatTs(instant: Instant): String = instant.truncatedTo(ChronoUnit.MICROS).toString()

    suspend fun syncOnce(store: SyncStore, api: RestApi, token: String, device: DeviceInfo, now: Long): SyncReport {
        var pushed = 0
        var pulled = 0
        var changed = 0
        val deviceId = store.deviceId()
        for (table in SYNC_TABLES) {
            for (chunk in store.dirtyRows(table, deviceId, now).chunked(500)) {
                api.upsert(table, chunk, ignoreDuplicates = table == "intercept_events", token = token)
                store.markClean(table, chunk)
                pushed += chunk.size
            }
        }
        val me = JSONObject()
            .put("id", deviceId)
            .put("platform", "android")
            .put("name", device.name)
            .put("version", device.version)
            .put("last_seen", now)
            .put("updated_at", now)
        api.upsert("devices", listOf(me), ignoreDuplicates = false, token = token)

        for (table in SYNC_TABLES) {
            val cursor = store.cursor(table)?.let(::parseTs)
            var since = cursor?.minus(OVERLAP_MINUTES, ChronoUnit.MINUTES)?.let(::formatTs)
            var newest = cursor
            while (true) {
                val rows = api.pull(table, since, token, PAGE)
                for (row in rows) {
                    if (store.applyRemote(table, row, deviceId)) changed++
                    val ts = row.optString("server_updated_at").takeIf { it.isNotEmpty() }?.let(::parseTs)
                    if (ts != null && (newest == null || ts.isAfter(newest))) newest = ts
                }
                newest?.let { store.setCursor(table, formatTs(it)) }
                pulled += rows.size
                if (rows.size < PAGE) break
                since = newest?.let(::formatTs)
            }
        }
        return SyncReport(pushed, pulled, changed)
    }
}
