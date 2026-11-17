// Runs shared/test-vectors/risk.json against the Kotlin risk-hours core. Every case of every group is checked.
package com.dang.dopadam.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class RiskVectorsTest {
    private val vectors: JSONObject by lazy {
        val dir = System.getProperty("dopadam.vectors") ?: error("dopadam.vectors not set")
        JSONObject(File(dir, "risk.json").readText())
    }

    private fun group(name: String): List<JSONObject> =
        vectors.getJSONArray(name).let { a -> (0 until a.length()).map { a.getJSONObject(it) } }.also { assertTrue("$name is empty", it.isNotEmpty()) }

    private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

    private fun window(o: JSONObject) = RiskWindow(
        o.getString("id"),
        o.getJSONArray("days").let { a -> (0 until a.length()).map { a.getInt(it) } },
        o.getString("start"),
        o.getString("end"),
    )

    private fun windows(a: JSONArray) = a.objects().map(::window)

    /** The sparse list of non-empty cells ({row, hour, opens, enters}) as a full 7 x 24 grid. */
    private fun grid(a: JSONArray): RiskHeatmap {
        val cells = Array(7) { Array(24) { RiskCell() } }
        for (c in a.objects()) cells[c.getInt("row")][c.getInt("hour")] = RiskCell(c.getInt("opens"), c.getInt("enters"))
        return cells.map { it.toList() }
    }

    private fun sparse(h: RiskHeatmap): List<List<Int>> =
        h.flatMapIndexed { r, row -> row.mapIndexedNotNull { x, c -> if (c.opens > 0 || c.enters > 0) listOf(r, x, c.opens, c.enters) else null } }

    @Test
    fun constants() {
        val c = vectors.getJSONObject("constants")
        assertEquals(c.getInt("maxWindows"), MAX_RISK_WINDOWS)
        assertEquals(c.getInt("minOpens"), RISK_MIN_OPENS)
        assertEquals(c.getInt("blockHours"), RISK_BLOCK_HOURS)
    }

    @Test
    fun inRiskWindow() {
        for (c in group("inRiskWindow")) {
            val i = c.getJSONObject("input")
            assertEquals(c.getString("name"), c.getBoolean("expected"), inRiskWindow(windows(i.getJSONArray("windows")), i.getLong("now"), i.getInt("tzOffsetMinutes")))
        }
    }

    @Test
    fun heatmap() {
        for (c in group("heatmap")) {
            val i = c.getJSONObject("input")
            val events = i.getJSONArray("events").objects().map { RiskEvent(it.getLong("shownAt"), if (it.isNull("decision")) null else it.getString("decision")) }
            val actual = riskHeatmap(events, i.getLong("now"), i.getInt("tzOffsetMinutes"), i.getInt("days"))
            assertEquals(c.getString("name"), sparse(grid(c.getJSONArray("expected"))), sparse(actual))
            assertEquals(c.getString("name") + " (7 x 24)", listOf(7) + List(7) { 24 }, listOf(actual.size) + actual.map { it.size })
        }
    }

    @Test
    fun suggest() {
        for (c in group("suggest")) {
            val i = c.getJSONObject("input")
            val actual = suggestRiskWindow(grid(i.getJSONArray("cells")), windows(i.getJSONArray("windows")))
            val expected = if (c.isNull("expected")) null else c.getJSONObject("expected").let { e ->
                RiskSuggestion(
                    e.getJSONArray("days").let { a -> (0 until a.length()).map { a.getInt(it) } },
                    e.getString("start"), e.getString("end"), e.getInt("opens"), e.getInt("enters"),
                )
            }
            assertEquals(c.getString("name"), expected, actual)
        }
    }

    @Test
    fun classify() {
        for (c in group("classify")) {
            val i = c.getJSONObject("input")
            val weakens = riskWindowsChangeWeakens(windows(i.getJSONArray("old")), windows(i.getJSONArray("new")))
            assertEquals(c.getString("name"), c.getString("expected") == "weaken", weakens)
        }
    }

    @Test
    fun normalize() {
        for (c in group("normalize")) {
            val expected = if (c.isNull("expected")) null else window(c.getJSONObject("expected"))
            assertEquals(c.getString("name"), expected, normalizeRiskWindow(window(c.getJSONObject("input"))))
        }
    }

    @Test
    fun everyCaseHasAName() {
        for (g in listOf("inRiskWindow", "heatmap", "suggest", "classify", "normalize")) {
            for (c in group(g)) assertTrue("$g case without a name", c.optString("name").isNotEmpty())
        }
    }
}
