package com.dang.dopadam.core

enum class Tag(val id: String, val label: String) {
    ENTERTAINMENT("entertainment", "Giải trí"),
    GAME("game", "Game"),
    WORK("work", "Công việc"),
    STUDY("study", "Học tập"),
    COMMUNICATION("communication", "Liên lạc"),
    UTILITY("utility", "Tiện ích"),
    IGNORE("ignore", "Không theo dõi");

    /** Entertainment and game trigger the warning; game only differs by its default delay. */
    val blocked: Boolean get() = this == ENTERTAINMENT || this == GAME

    companion object {
        fun fromId(id: String?): Tag? = entries.firstOrNull { it.id == id }
    }
}

data class FrictionSettings(
    /** Seconds the Enter button stays locked, indexed by level 0..3. */
    val lockSeconds: List<Int>,
    val allowOptionsNormal: List<Int>,
    val allowOptionsRestricted: List<Int>,
)

data class Settings(
    val lockSeconds: List<Int> = listOf(5, 10, 20, 30),
    val allowOptionsNormal: List<Int> = listOf(5, 15, 30),
    val allowOptionsRestricted: List<Int> = listOf(5, 10),
    /** Daily entertainment budget in minutes; <= 0 turns it off. */
    val budgetMinutes: Int = 90,
    /** Default warning delay per tag id, in seconds. */
    val tagDelays: Map<String, Int> = mapOf(Tag.GAME.id to 30),
) {
    val friction: FrictionSettings get() = FrictionSettings(lockSeconds, allowOptionsNormal, allowOptionsRestricted)
}
