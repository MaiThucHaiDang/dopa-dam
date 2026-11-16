// One sync round, independent of Android so it can be unit-tested: push local changes, record this
// device, pull everything newer than the per-table cursors. Same algorithm as the agent (sync.rs).
package com.dang.dopadam.sync

import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
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

    private val TS_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'").withZone(ZoneOffset.UTC)

    /** Always six fractional digits and a Z, like the agent ("2026-10-12T05:00:00.000000Z"). */
    fun formatTs(instant: Instant): String = TS_FORMAT.format(instant.truncatedTo(ChronoUnit.MICROS))

    private fun stampOf(row: JSONObject): Instant? = row.optString("server_updated_at").takeIf { it.isNotEmpty() }?.let(::parseTs)

    /**
     * Pulls one table (same algorithm as pull_table in the agent's sync.rs). Pages are asked for with
     * `server_updated_at >= since`, oldest first, ties by id.
     * - A page that is not full ends the pull; the cursor is the newest `server_updated_at` seen.
     * - A full page whose first and last rows differ continues from the last row's stamp (the rows at that
     *   stamp are read again, which is harmless: see RoomSyncStore.applyRemote).
     * - A full page of one single stamp keeps `since` and moves `offset` on, so a group of rows with equal
     *   stamps larger than a page is still read to the end.
     * Returns the number of rows pulled and the number that changed local data.
     */
    suspend fun pullTable(store: SyncStore, api: RestApi, token: String, table: String, deviceId: String, page: Int): Pair<Int, Int> {
        var pulled = 0
        var changed = 0
        val cursor = store.cursor(table)?.let(::parseTs)
        var newest = cursor
        var since = cursor?.minus(OVERLAP_MINUTES, ChronoUnit.MINUTES)?.let(::formatTs)
        var offset = 0
        while (true) {
            val rows = api.pull(table, since, offset, token, page)
            for (row in rows) {
                if (store.applyRemote(table, row, deviceId)) changed++
                val ts = stampOf(row)
                if (ts != null && (newest == null || ts.isAfter(newest))) newest = ts
            }
            newest?.let { store.setCursor(table, formatTs(it)) }
            pulled += rows.size
            if (rows.size < page) break
            val first = rows.first().let(::stampOf)
            val last = rows.last().let(::stampOf)
            if (first != null && last != null && first != last) {
                since = formatTs(last)
                offset = 0
            } else {
                offset += rows.size
            }
        }
        return pulled to changed
    }

    suspend fun syncOnce(store: SyncStore, api: RestApi, token: String, device: DeviceInfo, now: Long, page: Int = PAGE): SyncReport {
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
            val (p, c) = pullTable(store, api, token, table, deviceId, page)
            pulled += p
            changed += c
        }
        return SyncReport(pushed, pulled, changed)
    }
}
