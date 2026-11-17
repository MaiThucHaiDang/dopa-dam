package com.dang.dopadam.data

import com.dang.dopadam.core.RiskWindow
import com.dang.dopadam.core.Settings
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsCodecRiskTest {
    private val a = RiskWindow("a", listOf(1, 2, 3, 4, 5), "22:00", "00:00")
    private val b = RiskWindow("b", listOf(6, 7), "10:00", "12:00")

    @Test
    fun roundTrip() {
        val s = Settings(budgetMinutes = 45, riskWindows = listOf(a, b))
        assertEquals(s, SettingsCodec.decode(SettingsCodec.encode(s)))
        val json = JSONObject(SettingsCodec.encode(s))
        assertEquals(2, json.getJSONArray("riskWindows").length())
        assertEquals("22:00", json.getJSONArray("riskWindows").getJSONObject(0).getString("start"))
    }

    @Test
    fun missingKeyMeansNoWindows() {
        val old = """{"lockSeconds":[1,2,3,4],"allowOptionsNormal":[5],"allowOptionsRestricted":[5],"budgetMinutes":10,"tagDelays":{}}"""
        val s = SettingsCodec.decode(old)
        assertEquals(emptyList<RiskWindow>(), s.riskWindows)
        assertEquals(10, s.budgetMinutes)
        assertEquals(emptyList<RiskWindow>(), SettingsCodec.decode("""{"riskWindows":"x"}""").riskWindows)
        assertEquals(emptyList<RiskWindow>(), SettingsCodec.decode(null).riskWindows)
    }

    @Test
    fun aBadEntryIsDroppedAndNothingElseIsTouched() {
        val json = """{"lockSeconds":[1,2,3,4],"budgetMinutes":10,"riskWindows":[
            {"id":"a","days":[5,1,1],"start":"7:05","end":"09:00"},
            {"id":"bad-time","days":[1],"start":"24:00","end":"09:00"},
            {"id":"same","days":[1],"start":"08:00","end":"08:00"},
            {"id":"no-days","days":[],"start":"08:00","end":"09:00"},
            {"id":"bad-day","days":["x"],"start":"08:00","end":"09:00"},
            {"id":"no-id","days":[1],"start":"08:00","end":"09:00"},
            "junk",
            {"id":"b","days":[6,7],"start":"10:00","end":"12:00"}
        ]}""".replace("{\"id\":\"no-id\"", "{\"idd\":\"no-id\"")
        val s = SettingsCodec.decode(json)
        assertEquals(listOf(RiskWindow("a", listOf(1, 5), "07:05", "09:00"), b), s.riskWindows)
        assertEquals(listOf(1, 2, 3, 4), s.lockSeconds)
        assertEquals(10, s.budgetMinutes)
    }

    @Test
    fun onlyTheFirstTwelveAreKept() {
        val many = (1..15).joinToString(",") { """{"id":"$it","days":[1],"start":"08:00","end":"09:00"}""" }
        val s = SettingsCodec.decode("""{"riskWindows":[$many]}""")
        assertEquals(12, s.riskWindows.size)
        assertEquals("12", s.riskWindows.last().id)
        assertTrue(s.riskWindows.all { it.days == listOf(1) })
    }
}
