package com.milofit.game

// Original map and weapon data (mirrors web/maps.js and web/weapons.js).

data class Rect(val x: Float, val y: Float, val w: Float, val h: Float)
data class Point(val x: Float, val y: Float)

data class GameMap(val name: String, val platforms: List<Rect>, val spawns: List<Point>)

data class Weapon(
    val name: String,
    val damage: Float,
    val speed: Float,
    val spread: Float,
    val pellets: Int,
    val cooldownMs: Long,
    val magSize: Int,
    val reloadMs: Long,
    val auto: Boolean,
    val color: Int
)

object Content {
    const val WORLD_W = 960f
    const val WORLD_H = 540f

    val maps = listOf(
        GameMap(
            "Sandstone Pit",
            listOf(
                Rect(0f, 510f, 960f, 30f), Rect(120f, 420f, 180f, 18f), Rect(660f, 420f, 180f, 18f),
                Rect(380f, 340f, 200f, 18f), Rect(40f, 260f, 120f, 18f), Rect(800f, 260f, 120f, 18f),
                Rect(430f, 180f, 100f, 18f)
            ),
            listOf(Point(80f, 470f), Point(860f, 470f), Point(470f, 130f), Point(440f, 300f))
        ),
        GameMap(
            "Frozen Tower",
            listOf(
                Rect(0f, 510f, 960f, 30f), Rect(0f, 380f, 260f, 18f), Rect(700f, 380f, 260f, 18f),
                Rect(330f, 300f, 300f, 18f), Rect(430f, 220f, 100f, 18f), Rect(150f, 160f, 80f, 18f),
                Rect(730f, 160f, 80f, 18f)
            ),
            listOf(Point(60f, 330f), Point(880f, 330f), Point(470f, 170f), Point(180f, 110f))
        ),
        GameMap(
            "Jungle Ruins",
            listOf(
                Rect(0f, 510f, 300f, 30f), Rect(660f, 510f, 300f, 30f), Rect(300f, 470f, 360f, 18f),
                Rect(60f, 360f, 140f, 18f), Rect(760f, 360f, 140f, 18f), Rect(360f, 260f, 240f, 18f),
                Rect(20f, 200f, 120f, 18f), Rect(820f, 200f, 120f, 18f)
            ),
            listOf(Point(100f, 310f), Point(860f, 310f), Point(480f, 210f), Point(60f, 150f))
        )
    )

    val weapons = listOf(
        Weapon("Pistol", 12f, 14f, 0.02f, 1, 220, 12, 900, false, 0xFFF2CC60.toInt()),
        Weapon("Shotgun", 8f, 12f, 0.22f, 5, 700, 6, 1400, false, 0xFFFF7B72.toInt()),
        Weapon("SMG", 7f, 16f, 0.08f, 1, 90, 30, 1200, true, 0xFF79C0FF.toInt())
    )
}
