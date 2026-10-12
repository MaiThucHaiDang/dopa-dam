// Runs the shared test vectors (shared/test-vectors) against the Kotlin core.
package com.dang.dopadam.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class VectorsTest {
    private fun load(name: String): JSONObject {
        val dir = System.getProperty("dopadam.vectors") ?: error("dopadam.vectors not set")
        return JSONObject(File(dir, name).readText())
    }

    private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
    private fun JSONArray.ints(): List<Int> = (0 until length()).map { getInt(it) }
    private fun JSONArray.longs(): List<Long> = (0 until length()).map { getLong(it) }
    private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
    private fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else getString(key)

    private fun friction(o: JSONObject) = FrictionSettings(
        o.getJSONArray("lockSeconds").ints(),
        o.getJSONArray("allowOptionsNormal").ints(),
        o.getJSONArray("allowOptionsRestricted").ints(),
    )

    @Test
    fun level() {
        val v = load("level.json")
        for (c in v.getJSONArray("cases").objects()) {
            val s = friction(c.optJSONObject("settings") ?: v.getJSONObject("defaultSettings"))
            val i = c.getJSONObject("input")
            val e = c.getJSONObject("expected")
            val r = computeLevel(i.getInt("n"), i.getBoolean("inStudy"), i.getBoolean("overBudget"), s)
            assertEquals(c.getString("name"), LevelResult(e.getInt("level"), e.getInt("lockSeconds"), e.getJSONArray("allowOptions").ints()), r)
        }
    }

    @Test
    fun recentCount() {
        for (c in load("recent-count.json").getJSONArray("cases").objects()) {
            assertEquals(c.getString("name"), c.getInt("expected"), recentCount(c.getJSONArray("timestamps").longs(), c.getLong("now")))
        }
    }

    @Test
    fun dayKey() {
        for (c in load("day-key.json").getJSONArray("cases").objects()) {
            assertEquals(c.getString("name"), c.getString("expected"), dayKey(c.getLong("t"), c.getInt("tzOffsetMinutes")))
        }
    }

    @Test
    fun budget() {
        for (c in load("budget.json").getJSONArray("cases").objects()) {
            val e = c.getJSONObject("expected")
            val expected = BudgetStatus(e.getBoolean("over"), if (e.isNull("remainingMinutes")) null else e.getDouble("remainingMinutes"))
            assertEquals(c.getString("name"), expected, budgetStatus(c.getDouble("usedMinutes"), c.getInt("budgetMinutes")))
        }
    }

    @Test
    fun delay() {
        for (c in load("delay.json").getJSONArray("cases").objects()) {
            val delays = c.getJSONObject("tagDelays").let { o -> o.keys().asSequence().associateWith { o.getInt(it) } }
            val app = if (c.isNull("appDelaySeconds")) null else c.getInt("appDelaySeconds")
            assertEquals(c.getString("name"), c.getInt("expected"), effectiveDelay(app, c.getString("tag"), delays))
        }
    }

    @Test
    fun friction() {
        val v = load("friction.json")
        for (c in v.getJSONArray("tagCases").objects()) {
            val weakens = tagChangeWeakens(c.stringOrNull("old"), c.stringOrNull("new"))
            assertEquals("${c.opt("old")} -> ${c.opt("new")}", c.getString("expected") == "weaken", weakens)
        }
        val fields = mapOf(
            "lockSeconds" to NumberField.LOCK_SECONDS,
            "budgetMinutes" to NumberField.BUDGET_MINUTES,
            "delaySeconds" to NumberField.DELAY_SECONDS,
        )
        for (c in v.getJSONArray("numberCases").objects()) {
            val weakens = numberChangeWeakens(fields.getValue(c.getString("field")), c.getInt("old"), c.getInt("new"))
            assertEquals("${c.getString("field")} ${c.getInt("old")} -> ${c.getInt("new")}", c.getString("expected") == "weaken", weakens)
        }
    }

    @Test
    fun study() {
        val v = load("study.json")
        val rules = v.getJSONObject("rules").let { o ->
            o.keys().asSequence().associateWith { k ->
                val r = o.getJSONObject(k)
                StudyRule(
                    r.getString("id"), r.getJSONArray("days").ints(), r.getString("start"), r.getString("end"),
                    r.stringOrNull("label"), r.getJSONArray("exceptions").strings(),
                )
            }
        }
        val sessions = v.getJSONObject("sessions").let { o ->
            o.keys().asSequence().associateWith { k ->
                val s = o.getJSONObject(k)
                Session(s.getString("id"), s.getLong("start"), s.getLong("end"), s.stringOrNull("label"))
            }
        }
        for (c in v.getJSONArray("cases").objects()) {
            val e = c.getJSONObject("expected")
            val expected = StudyStatus(
                e.getBoolean("active"),
                e.stringOrNull("source")?.let { id -> StudySource.entries.first { it.id == id } },
                e.stringOrNull("label"),
                if (e.isNull("endsAt")) null else e.getLong("endsAt"),
            )
            val actual = resolveStudy(
                c.getLong("now"),
                c.getInt("tzOffsetMinutes"),
                c.getJSONArray("manual").strings().map { sessions.getValue(it) },
                c.getJSONArray("rules").strings().map { rules.getValue(it) },
                c.getJSONArray("external").strings().map { sessions.getValue(it) },
            )
            assertEquals(c.getString("name"), expected, actual)
        }
    }

    @Test
    fun studyChange() {
        val v = load("study-change.json")
        val rules = v.getJSONObject("rules").let { o ->
            o.keys().asSequence().associateWith { k ->
                val r = o.getJSONObject(k)
                StudyRule(
                    r.getString("id"), r.getJSONArray("days").ints(), r.getString("start"), r.getString("end"),
                    r.stringOrNull("label"), r.getJSONArray("exceptions").strings(),
                )
            }
        }
        for (c in v.getJSONArray("changeCases").objects()) {
            val weakens = studyRuleChangeWeakens(
                c.stringOrNull("old")?.let(rules::getValue),
                c.stringOrNull("new")?.let(rules::getValue),
                c.getLong("now"),
                c.getInt("tzOffsetMinutes"),
            )
            assertEquals(c.getString("name"), c.getString("expected") == "weaken", weakens)
        }
        for (c in v.getJSONArray("activeCases").objects()) {
            val expected = c.getJSONArray("expected").objects().map { RuleOccurrence(it.getString("ruleId"), it.getString("date")) }
            val actual = activeRuleOccurrences(c.getJSONArray("rules").strings().map(rules::getValue), c.getLong("now"), c.getInt("tzOffsetMinutes"))
            assertEquals(c.getString("name"), expected, actual)
        }
    }
}
