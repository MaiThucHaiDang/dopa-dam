package com.dang.dopadam.sync

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.time.Instant

/** PostgREST as the migration defines it: newest updated_at wins, events are never overwritten, a stamp per write. */
private class FakeServer : RestApi {
    val tables = mutableMapOf<String, MutableMap<String, JSONObject>>()
    var clock: Instant = Instant.parse("2026-10-12T00:00:00Z")
    var rejectToken: String? = null
    val pulls = mutableListOf<Pair<String, String?>>()

    private fun stamp(): String {
        clock = clock.plusMillis(1)
        return SyncEngine.formatTs(clock)
    }

    override fun upsert(table: String, rows: List<JSONObject>, ignoreDuplicates: Boolean, token: String) {
        if (token == rejectToken) throw SyncException.Unauthorized()
        val t = tables.getOrPut(table) { linkedMapOf() }
        for (row in rows) {
            val id = row.getString("id")
            val existing = t[id]
            if (existing != null && (ignoreDuplicates || existing.optLong("updated_at") > row.optLong("updated_at"))) continue
            t[id] = JSONObject(row.toString()).put("server_updated_at", stamp())
        }
    }

    override fun pull(table: String, since: String?, token: String, limit: Int): List<JSONObject> {
        if (token == rejectToken) throw SyncException.Unauthorized()
        pulls += table to since
        val after = since?.let { SyncEngine.parseTs(it) }
        return (tables[table]?.values ?: emptyList())
            .filter { after == null || SyncEngine.parseTs(it.getString("server_updated_at"))!!.isAfter(after) }
            .sortedBy { SyncEngine.parseTs(it.getString("server_updated_at")) }
            .take(limit)
            .map { JSONObject(it.toString()) }
    }
}

/** A device's local data with the same merge rules as RoomSyncStore. */
private class MemoryStore(private val device: String) : SyncStore {
    val rows = mutableMapOf<String, MutableMap<String, JSONObject>>()
    val dirty = mutableMapOf<String, MutableSet<String>>()
    val cursors = mutableMapOf<String, String>()

    fun write(table: String, row: JSONObject) {
        rows.getOrPut(table) { linkedMapOf() }[row.getString("id")] = row
        dirty.getOrPut(table) { mutableSetOf() } += row.getString("id")
    }

    fun get(table: String, id: String) = rows[table]?.get(id)

    override suspend fun deviceId() = device
    override suspend fun dirtyRows(table: String, deviceId: String, now: Long) =
        dirty[table].orEmpty().mapNotNull { rows[table]?.get(it) }

    override suspend fun markClean(table: String, rows: List<JSONObject>) {
        dirty[table]?.removeAll(rows.map { it.getString("id") }.toSet())
    }

    override suspend fun applyRemote(table: String, row: JSONObject, myDevice: String): Boolean {
        val id = row.getString("id")
        val local = get(table, id)
        val accept = when (table) {
            "intercept_events" -> local == null
            "usage_daily" -> row.getString("device_id") != myDevice && (local == null || row.getLong("updated_at") > local.getLong("updated_at"))
            else -> local == null || row.getLong("updated_at") > local.getLong("updated_at")
        }
        if (accept) rows.getOrPut(table) { linkedMapOf() }[id] = row
        return accept
    }

    override suspend fun cursor(table: String) = cursors[table]
    override suspend fun setCursor(table: String, value: String) {
        cursors[table] = value
    }
}

private fun rule(pattern: String, tag: String, at: Long) = JSONObject()
    .put("id", "app:$pattern").put("kind", "app").put("pattern", pattern).put("tag", tag)
    .putN("delay_seconds", null).put("updated_at", at).put("deleted", false)

private fun event(id: String, device: String, at: Long) = JSONObject()
    .put("id", id).put("device_id", device).put("object", "com.example.video").put("tag", "entertainment")
    .put("level", 0).put("lock_seconds", 5).put("n", 0).put("shown_at", at).put("decision", "exit").put("decided_at", at + 4000)

class SyncEngineTest {
    private val now = 1_791_810_000_000L
    private val info = DeviceInfo("Test phone", "0.1.0")

    @Test
    fun rulesTravelBetweenDevicesAndNewestWins() = runBlocking {
        val server = FakeServer()
        val phone = MemoryStore("phone")
        val pc = MemoryStore("pc")
        phone.write("tag_rules", rule("com.example.video", "entertainment", now))
        val first = SyncEngine.syncOnce(phone, server, "t", info, now)
        assertEquals(1, first.pushed)
        assertTrue(phone.dirty["tag_rules"]!!.isEmpty())

        SyncEngine.syncOnce(pc, server, "t", info, now)
        assertEquals("entertainment", pc.get("tag_rules", "app:com.example.video")!!.getString("tag"))

        // The PC changes it later, the phone changed it earlier but syncs after: the PC's change stays.
        pc.write("tag_rules", rule("com.example.video", "game", now + 2000))
        SyncEngine.syncOnce(pc, server, "t", info, now + 2000)
        phone.write("tag_rules", rule("com.example.video", "study", now + 1000))
        SyncEngine.syncOnce(phone, server, "t", info, now + 3000)
        assertEquals("game", server.tables["tag_rules"]!!["app:com.example.video"]!!.getString("tag"))
        assertEquals("game", phone.get("tag_rules", "app:com.example.video")!!.getString("tag"))
        SyncEngine.syncOnce(pc, server, "t", info, now + 4000)
        assertEquals("game", pc.get("tag_rules", "app:com.example.video")!!.getString("tag"))
    }

    @Test
    fun eventsAreAppendOnlyAndDevicesAreRecorded() = runBlocking {
        val server = FakeServer()
        val phone = MemoryStore("phone")
        phone.write("intercept_events", event("e1", "phone", now))
        SyncEngine.syncOnce(phone, server, "t", info, now)
        // A changed copy of the same event (e.g. pushed twice) does not overwrite the first.
        phone.write("intercept_events", event("e1", "phone", now).put("decision", "enter"))
        SyncEngine.syncOnce(phone, server, "t", info, now + 1000)
        assertEquals("exit", server.tables["intercept_events"]!!["e1"]!!.getString("decision"))
        val device = server.tables["devices"]!!["phone"]!!
        assertEquals("android", device.getString("platform"))
        assertEquals(now + 1000, device.getLong("last_seen"))
    }

    @Test
    fun usageRowsFromThisDeviceAreNotPulledBack() = runBlocking {
        val server = FakeServer()
        val phone = MemoryStore("phone")
        val usage = JSONObject().put("id", "2026-10-12:phone:game").put("day", "2026-10-12").put("device_id", "phone")
            .put("tag", "game").put("seconds", 120.0).put("updated_at", now)
        phone.write("usage_daily", usage)
        SyncEngine.syncOnce(phone, server, "t", info, now)
        // The phone is the only writer of its own rows: a server copy never replaces the local count,
        // even one stamped later (e.g. restored from an old backup).
        phone.write("usage_daily", JSONObject(usage.toString()).put("seconds", 300.0).put("updated_at", now + 5000))
        phone.markClean("usage_daily", listOf(usage))
        server.upsert("usage_daily", listOf(JSONObject(usage.toString()).put("seconds", 999.0).put("updated_at", now + 9000)), false, "t")
        phone.cursors.clear()
        SyncEngine.syncOnce(phone, server, "t", info, now + 6000)
        assertEquals(300.0, phone.get("usage_daily", usage.getString("id"))!!.getDouble("seconds"), 0.0)
    }

    @Test
    fun pullsPageByPageAndOverlapsTheCursor() = runBlocking {
        val server = FakeServer()
        val pc = MemoryStore("pc")
        for (i in 0 until 1500) pc.write("intercept_events", event("e$i", "pc", now + i))
        SyncEngine.syncOnce(pc, server, "t", info, now)
        assertEquals(1500, server.tables["intercept_events"]!!.size)

        val phone = MemoryStore("phone")
        server.pulls.clear()
        val report = SyncEngine.syncOnce(phone, server, "t", info, now)
        assertEquals(1500, phone.rows["intercept_events"]!!.size)
        assertEquals(1500, report.changed)
        // Two pages: the first from the beginning, the second after the newest row of the first.
        val pages = server.pulls.filter { it.first == "intercept_events" }
        assertEquals(2, pages.size)
        assertNull(pages[0].second)
        assertTrue(pages[1].second != null)

        // Next round starts 5 minutes before the newest stamp it saw, so nothing new is changed twice.
        server.pulls.clear()
        val again = SyncEngine.syncOnce(phone, server, "t", info, now + 1000)
        assertEquals(0, again.changed)
        val since = server.pulls.first { it.first == "intercept_events" }.second!!
        val cursor = SyncEngine.parseTs(phone.cursors["intercept_events"]!!)!!
        assertEquals(cursor.minusSeconds(300), SyncEngine.parseTs(since))
    }

    @Test
    fun unauthorizedStopsTheRound() = runBlocking {
        val server = FakeServer().apply { rejectToken = "old" }
        val phone = MemoryStore("phone")
        phone.write("tag_rules", rule("com.example.video", "entertainment", now))
        try {
            SyncEngine.syncOnce(phone, server, "old", info, now)
            throw AssertionError("expected Unauthorized")
        } catch (e: SyncException.Unauthorized) {
            // Nothing was marked clean, so the next round (with a fresh token) pushes it.
            assertFalse(phone.dirty["tag_rules"]!!.isEmpty())
        }
        assertEquals(1, SyncEngine.syncOnce(phone, server, "new", info, now).pushed)
    }

    @Test
    fun timestampsRoundTrip() {
        val ts = "2026-10-12T03:04:05.123456+00:00"
        assertEquals("2026-10-12T03:04:05.123456Z", SyncEngine.formatTs(SyncEngine.parseTs(ts)!!))
        assertNull(SyncEngine.parseTs("not a time"))
        assertEquals("Sai email hoặc mật khẩu.", friendlyAuthError("Invalid login credentials"))
        assertEquals("Email này đã có tài khoản. Hãy đăng nhập.", friendlyAuthError("User already registered"))
    }

    /** Real HTTP against supabase/test/mock-server.mjs (the migration in PGlite); skipped unless it is running. */
    @Test
    fun roundTripAgainstMockSupabase() = runBlocking {
        val url = System.getProperty("dopadam.mockSupabase").orEmpty()
        assumeTrue("mock Supabase not running", url.isNotEmpty())
        val api = SupabaseApi(url, "anon")
        val email = "phone-${System.nanoTime()}@example.com"
        val session = api.signUp(email, "secret1", now)!!
        try {
            api.signIn(email, "wrong-pw", now)
            throw AssertionError("expected AuthException")
        } catch (e: AuthException) {
            assertEquals("Sai email hoặc mật khẩu.", e.message)
        }
        val refreshed = api.refresh(session.stored.refreshToken, now)
        assertEquals(session.stored.userId, refreshed.stored.userId)

        val phone = MemoryStore("phone-1")
        phone.write("tag_rules", rule("com.example.video", "entertainment", now))
        phone.write("intercept_events", event("ev-1", "phone-1", now))
        assertEquals(2, SyncEngine.syncOnce(phone, api, refreshed.accessToken, info, now).pushed)

        val other = MemoryStore("pc-1")
        SyncEngine.syncOnce(other, api, refreshed.accessToken, info, now + 1000)
        assertEquals("entertainment", other.get("tag_rules", "app:com.example.video")!!.getString("tag"))
        assertEquals(4000L, other.get("intercept_events", "ev-1")!!.getLong("decided_at") - now)
        assertTrue(other.get("intercept_events", "ev-1")!!.isNull("study_label"))

        // Another account sees nothing of this one.
        val stranger = api.signUp("other-${System.nanoTime()}@example.com", "secret2", now)!!
        val strangerStore = MemoryStore("x")
        assertEquals(0, SyncEngine.syncOnce(strangerStore, api, stranger.accessToken, info, now).pulled)

        api.rpc("delete_my_data", refreshed.accessToken)
        assertEquals(0, api.pull("tag_rules", null, refreshed.accessToken, 10).size)
        try {
            api.pull("tag_rules", null, "bad-token", 10)
            throw AssertionError("expected Unauthorized")
        } catch (e: SyncException.Unauthorized) {
            // expected
        }
    }
}
