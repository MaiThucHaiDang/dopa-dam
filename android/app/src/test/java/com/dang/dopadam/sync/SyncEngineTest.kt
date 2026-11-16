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
    /** Every pull as (table, since, offset). */
    val pulls = mutableListOf<Triple<String, String?, Int>>()

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

    /** Stores a row with a chosen `server_updated_at`. */
    fun put(table: String, row: JSONObject, serverUpdatedAt: String) {
        tables.getOrPut(table) { linkedMapOf() }[row.getString("id")] = JSONObject(row.toString()).put("server_updated_at", serverUpdatedAt)
    }

    /** Like PostgREST: `server_updated_at >= since`, oldest first, ties by id, then offset and limit. */
    override fun pull(table: String, since: String?, offset: Int, token: String, limit: Int): List<JSONObject> {
        if (token == rejectToken) throw SyncException.Unauthorized()
        pulls += Triple(table, since, offset)
        val from = since?.let { SyncEngine.parseTs(it) }
        return (tables[table]?.values ?: emptyList())
            .filter { from == null || !SyncEngine.parseTs(it.getString("server_updated_at"))!!.isBefore(from) }
            .sortedWith(compareBy({ SyncEngine.parseTs(it.getString("server_updated_at")) }, { it.getString("id") }))
            .drop(offset)
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
        val state = local?.let { LocalState(it.optLong("updated_at"), id in dirty[table].orEmpty()) }
        val accept = when (table) {
            "intercept_events" -> local == null
            "usage_daily" -> row.getString("device_id") != myDevice && remoteWins(row.getLong("updated_at"), state)
            // Re-reading a row that is already here changes nothing.
            else -> remoteWins(row.getLong("updated_at"), state) && (local == null || !sameJson(local.toString(), row.toString()))
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
        assertEquals("2026-10-12T05:00:00.000000Z", SyncEngine.formatTs(SyncEngine.parseTs("2026-10-12T05:00:00Z")!!))
        assertNull(SyncEngine.parseTs("not a time"))
        assertEquals("Sai email hoặc mật khẩu.", friendlyAuthError("Invalid login credentials"))
        assertEquals("Email này đã có tài khoản. Hãy đăng nhập.", friendlyAuthError("User already registered"))
    }

    private fun serverWith(stamps: List<String>): FakeServer = FakeServer().also { s ->
        stamps.forEachIndexed { n, ts -> s.put("tag_rules", rule("r%02d.exe".format(n), "game", 1000L + n), ts) }
    }

    private fun pullRules(store: MemoryStore, server: FakeServer, page: Int) =
        runBlocking { SyncEngine.pullTable(store, server, "t", "tag_rules", "dev", page) }

    @Test
    fun aPageBoundaryInsideEqualStampsLosesNoRows() {
        val (a, b, c) = listOf("2026-10-12T05:00:00.000001Z", "2026-10-12T05:00:00.000002Z", "2026-10-12T05:00:00.000003Z")
        // Pages of 3: [a b b] ends inside the group of four b rows.
        val server = serverWith(listOf(a, b, b, b, b, c))
        val store = MemoryStore("dev")
        val (pulled, changed) = pullRules(store, server, 3)
        assertEquals(6, store.rows["tag_rules"]!!.size)
        assertEquals(c, store.cursors["tag_rules"])
        assertEquals(6, changed)
        // [a b b] -> continue at b: [b b b] is one stamp, so offset 3 -> [c].
        assertEquals(listOf(Triple("tag_rules", null, 0), Triple("tag_rules", b, 0), Triple("tag_rules", b, 3)), server.pulls)
        assertEquals(8, pulled) // 3 + 3 + 2: the b rows at the boundary are read again
    }

    @Test
    fun aWholePageOfEqualStampsIsPagedWithOffset() {
        val t = "2026-10-12T05:00:00.123456Z"
        val store = MemoryStore("dev")
        val (pulled, changed) = pullRules(store, serverWith(List(7) { t }), 3)
        assertEquals(7, store.rows["tag_rules"]!!.size)
        assertEquals(7 to 7, pulled to changed)
        assertEquals(t, store.cursors["tag_rules"])
        // A group that is an exact multiple of the page ends with an empty page.
        val store2 = MemoryStore("dev")
        pullRules(store2, serverWith(List(6) { t }), 3)
        assertEquals(6, store2.rows["tag_rules"]!!.size)
    }

    @Test
    fun rereadingTheRowsAtTheCursorChangesNothingAndPushesNothing() {
        // Hours apart, so the overlap before the cursor does not reach the older rows.
        val server = serverWith(listOf("2026-10-12T01:00:00Z", "2026-10-12T03:00:00Z", "2026-10-12T05:00:00Z"))
        val store = MemoryStore("dev")
        pullRules(store, server, 10)
        server.pulls.clear()
        val (pulled, changed) = pullRules(store, server, 10)
        assertEquals(1 to 0, pulled to changed) // only the row at the cursor is read again
        assertEquals("2026-10-12T04:55:00.000000Z", server.pulls[0].second)
        assertTrue(store.dirty["tag_rules"].orEmpty().isEmpty())
        assertEquals("2026-10-12T05:00:00.000000Z", store.cursors["tag_rules"])
    }

    @Test
    fun theRemoteRowWinsATieOnlyWhenTheLocalRowIsClean() {
        assertTrue(remoteWins(5, null))
        assertTrue(remoteWins(6, LocalState(5, dirty = true)))
        assertFalse(remoteWins(4, LocalState(5, dirty = false)))
        assertTrue(remoteWins(5, LocalState(5, dirty = false)))
        // A dirty local row with an equal stamp stays and is pushed.
        assertFalse(remoteWins(5, LocalState(5, dirty = true)))
    }

    @Test
    fun jsonThatDiffersOnlyInKeyOrderIsTheSame() {
        assertTrue(sameJson("""{"a":1,"b":[1,2],"c":{"x":1,"y":2}}""", """{"c":{"y":2,"x":1},"b":[1,2],"a":1}"""))
        assertFalse(sameJson("""{"a":1}""", """{"a":2}"""))
        assertFalse(sameJson("""{"b":[1,2]}""", """{"b":[2,1]}"""))
        assertFalse(sameJson("not json", """{"a":1}"""))
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
        assertEquals(0, api.pull("tag_rules", null, 0, refreshed.accessToken, 10).size)
        try {
            api.pull("tag_rules", null, 0, "bad-token", 10)
            throw AssertionError("expected Unauthorized")
        } catch (e: SyncException.Unauthorized) {
            // expected
        }
    }
}
