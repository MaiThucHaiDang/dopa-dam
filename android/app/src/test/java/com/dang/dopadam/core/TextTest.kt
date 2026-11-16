package com.dang.dopadam.core

import org.junit.Assert.assertEquals
import org.junit.Test

class StudyLabelTest {
    private val emoji = "😀" // one code point, two UTF-16 units

    @Test
    fun cutsByCodePointNotByUtf16Unit() {
        assertEquals("a".repeat(59) + emoji, ("a".repeat(59) + emoji).takeCodePoints(STUDY_LABEL_MAX))
        assertEquals("a".repeat(60), ("a".repeat(60) + emoji).takeCodePoints(STUDY_LABEL_MAX))
        assertEquals("abc", "abc".takeCodePoints(60))
        assertEquals("", "abc".takeCodePoints(0))
        assertEquals("", "".takeCodePoints(5))
    }

    @Test
    fun ruleLabelsAreCutWholeToo() {
        fun label(text: String) =
            normalizeStudyRule(StudyRule("r", listOf(1), "19:00", "20:00", text, emptyList()))?.label
        assertEquals("a".repeat(59) + emoji, label("a".repeat(59) + emoji))
        assertEquals("a".repeat(60), label("a".repeat(60) + emoji))
        assertEquals("a".repeat(60), label("  " + "a".repeat(60) + emoji))
    }
}
