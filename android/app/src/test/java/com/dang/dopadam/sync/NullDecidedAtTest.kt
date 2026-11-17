package com.dang.dopadam.sync

import org.json.JSONObject
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NullDecidedAtTest {
    @Test
    fun aNullDecidedAtTravelsAsJsonNullAndComesBackNull() {
        val sent = JSONObject().put("decision", "exit").putN("decided_at", null)
        assertTrue(sent.toString().contains("\"decided_at\":null"))
        val back = JSONObject(sent.toString())
        assertNull(back.long("decided_at"))
        assertTrue(back.has("decided_at"))
    }
}
