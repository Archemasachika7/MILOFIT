package com.milofit.arena

import com.milofit.arena.data.GameMap
import com.milofit.arena.data.Manifest
import com.milofit.arena.data.Tuning
import com.milofit.arena.game.Body
import com.milofit.arena.game.PlayerInput
import com.milofit.arena.game.SimCore
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * Parity check between kotlin/…/game/SimCore.kt and shared/sim-core.js.
 *
 * The expected numbers below were produced by running the *JavaScript* core for
 * the same number of ticks with the same input sequence, so this test fails the
 * moment the two implementations disagree. That is the whole point: client-side
 * prediction only works while the server's movement rules and the client's are
 * the same function, and the two are maintained by hand.
 *
 * If you change shared/sim-core.js, regenerate these values by driving it with
 * [inputAt] for 600 ticks, then update the constants here.
 */
class SimCoreTest {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    /** Repository-relative content dir, found by walking up from the test workdir. */
    private fun gameDataDir(): File {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "shared/game-data")
            if (File(candidate, "tuning.json").isFile) return candidate
            dir = dir.parentFile
        }
        throw IllegalStateException(
            "shared/game-data not found from ${System.getProperty("user.dir")}; " +
                "run the tests from the repository (cd android && ./gradlew :app:test)",
        )
    }

    private fun tuning(): Tuning = json.decodeFromString(Tuning.serializer(), File(gameDataDir(), "tuning.json").readText())

    private fun map(name: String): GameMap =
        json.decodeFromString(GameMap.serializer(), File(gameDataDir(), "maps/$name.json").readText())

    /** Identical to the pattern used to generate the reference trajectory. */
    private fun inputAt(i: Int) = PlayerInput(
        x = sin(i * 0.05) * 1.4,             // out of range on purpose: exercises the clamp
        jump = i % 37 < 3,
        jet = i % 53 < 7,
        aimX = 1200.0 + cos(i * 0.011) * 400.0,
        aimY = 700.0 + sin(i * 0.011) * 300.0,
    )

    private fun freshBody(t: Tuning, x: Double, y: Double) = Body(x, y, t.player.width, t.player.height).apply {
        jetFuel = t.jetpack.maxFuel
        jetIdle = 1.0
    }

    @Test
    fun `600 tick trajectory matches the JavaScript core`() {
        val t = tuning()
        val arena = map("arena_core")
        val dt = t.fixedDt

        val body = freshBody(t, 1200.0, 400.0)
        for (i in 0 until 600) {
            SimCore.stepPlayerMovement(body, inputAt(i), dt, t, arena.solids)
        }

        // Reference: shared/sim-core.js, 600 ticks on arena_core.
        assertEquals("x", 1301.59855, body.x, 0.05)
        assertEquals("y", 281.721222, body.y, 0.05)
        assertEquals("vx", -285.0, body.vx, 0.05)
        assertEquals("vy", -316.666667, body.vy, 0.05)
        assertEquals("aim", 1.067784, body.aim, 1e-3)
        assertEquals("facing", -1L, body.facing.toLong())
        assertTrue("onGround", !body.onGround)
        assertEquals("jetFuel", 61.966667, body.jetFuel, 0.05)
        assertEquals("jetIdle", 0.083333, body.jetIdle, 0.05)
    }

    @Test
    fun `jetpack hover matches the JavaScript core`() {
        val t = tuning()
        val arena = map("arena_core")
        val dt = t.fixedDt

        val body = freshBody(t, 300.0, 200.0)
        repeat(180) {
            SimCore.stepPlayerMovement(
                body,
                PlayerInput(x = 1.0, jet = true, aimX = 9999.0, aimY = 200.0),
                dt,
                t,
                arena.solids,
            )
        }

        // Reference: shared/sim-core.js, 180 ticks.
        assertEquals("x", 1151.45, body.x, 0.05)
        assertEquals("y", 365.665667, body.y, 0.05)
        assertEquals("vx", 285.0, body.vx, 0.05)
        assertEquals("vy", -340.0, body.vy, 0.05)
        assertEquals("jetFuel", 0.0, body.jetFuel, 0.05)
    }

    /**
     * Regression guard for a real bug: an earlier version recharged fuel in the
     * air regardless of whether the thrust button was still held, which let a
     * player hover forever at zero fuel.
     */
    @Test
    fun `no infinite hover at zero fuel`() {
        val t = tuning()
        val arena = map("arena_core")
        val dt = t.fixedDt

        // High above the floor, in open air away from any platform. Fuel lasts
        // ~2.3 s; by 160 ticks it is long gone and the body is in free fall.
        val body = freshBody(t, 1200.0, 150.0)
        val hold = PlayerInput(x = 0.0, jet = true, aimX = 1200.0, aimY = 150.0)

        repeat(160) { SimCore.stepPlayerMovement(body, hold, dt, t, arena.solids) }

        // Reference: shared/sim-core.js, 160 ticks -> fuel 0, y 216.33, vy 766.67.
        assertEquals("fuel fully spent", 0.0, body.jetFuel, 0.05)
        assertTrue("jetpack reports not firing", !body.jetting)
        assertTrue("must not still be pinned to the ceiling (y=${body.y})", body.y > 200.0)
        assertTrue("and must be falling (vy=${body.vy})", body.vy > 0.0)
    }

    @Test
    fun `one way platforms are passed from below and landed on from above`() {
        val t = tuning()
        val arena = map("arena_core")
        val dt = t.fixedDt
        // The arena_core platform at y=300 spanning x=240..560.
        val platformTop = 300.0
        val solid = arena.solids.first { it.oneWay && abs(it.y - platformTop) < 0.001 }

        // Rising through it: no collision.
        val rising = freshBody(t, solid.x + solid.w / 2, platformTop + 60.0)
        rising.vy = -400.0
        repeat(15) { SimCore.moveAndCollide(rising, 0.0, rising.vy * dt, arena.solids) }
        assertTrue(
            "a body moving up passes through a one-way platform (y=${rising.y})",
            rising.y < platformTop,
        )

        // Falling onto it from above: lands.
        val falling = freshBody(t, solid.x + solid.w / 2, platformTop - 80.0)
        falling.vy = 600.0
        var landed = false
        repeat(40) {
            if (!landed) {
                SimCore.moveAndCollide(falling, 0.0, falling.vy * dt, arena.solids)
                if (falling.onGround) landed = true
            }
        }
        assertTrue("a body falling onto a one-way platform lands on it", landed)
        assertEquals(platformTop - t.player.height / 2 - SimCore.EPS, falling.y, 0.01)
    }

    @Test
    fun `horizontal movement is clamped to the run speed`() {
        val t = tuning()
        val arena = map("arena_core")
        val dt = t.fixedDt

        // A clear stretch of floor on the left half of arena_core.
        val body = freshBody(t, 300.0, 1000.0)
        body.onGround = true
        repeat(20) {
            SimCore.stepPlayerMovement(
                body,
                PlayerInput(x = 5.0, aimX = 1300.0, aimY = 1000.0),
                dt,
                t,
                arena.solids,
            )
        }

        // Reference: shared/sim-core.js, 20 ticks -> x 379.78, vx exactly 285.
        assertEquals("vx settles on runSpeed", t.player.runSpeed, body.vx, 1e-6)
        assertTrue("and stays clamped there", abs(body.vx) <= t.player.runSpeed + 1e-6)
        assertTrue("and the body actually moved right", body.x > 300.0)
    }

    @Test
    fun `movement in a solid map never leaves the arena`() {
        val t = tuning()
        val arena = map("arena_core")
        val dt = t.fixedDt

        // Random-ish but deterministic inputs for 20 seconds of play.
        val body = freshBody(t, 1200.0, 400.0)
        var i = 0
        while (i < 1200) {
            val input = PlayerInput(
                x = sin(i * 0.37) * 3.0,
                jet = i % 11 < 6,
                aimX = 1200.0,
                aimY = 600.0,
            )
            SimCore.stepPlayerMovement(body, input, dt, t, arena.solids)
            i += 1
        }

        val halfW = t.player.width / 2
        val halfH = t.player.height / 2
        assertTrue("body stayed inside the arena horizontally", body.x in halfW..(arena.mapSize.width - halfW))
        assertTrue("body stayed inside the arena vertically", body.y in halfH..(arena.mapSize.height - halfH))
        assertTrue("body is a finite position", body.x.isFinite() && body.y.isFinite())
    }

    @Test
    fun `every map has solids, spawns and a sane size`() {
        val tuning = tuning()
        val dir = gameDataDir()
        val names = listOf("arena_core", "foundry", "caverns", "outpost", "outpost_ridge")
        for (name in names) {
            val m = map(name)
            assertTrue("$name needs solids", m.solids.isNotEmpty())
            assertTrue("$name needs spawn points", m.spawnPoints.isNotEmpty())
            assertTrue("$name needs a playable size", m.mapSize.width > 800 && m.mapSize.height > 600)

            // Every spawn must be reachable: spawn points are body centres and must
            // not be buried inside a solid.
            for (sp in m.spawnPoints) {
                val halfW = tuning.player.width / 2
                val halfH = tuning.player.height / 2
                for (s in m.solids) {
                    if (s.oneWay) continue
                    val overlaps = sp.x + halfW > s.x && sp.x - halfW < s.x + s.w &&
                        sp.y + halfH > s.y && sp.y - halfH < s.y + s.h
                    assertTrue("$name spawn (${sp.x}, ${sp.y}) is inside solid (${s.x}, ${s.y})", !overlaps)
                }
            }
        }
    }

    @Test
    fun `capture the flag content parses and every map has clear flag bases`() {
        val tuning = tuning()
        assertTrue("tuning.json needs a usable ctf block", tuning.ctf.captureLimit > 0)
        assertTrue("ctf flags must come home on a timer", tuning.ctf.returnSeconds > 0.0)

        val manifest = json.decodeFromString(
            Manifest.serializer(),
            File(gameDataDir(), "index.json").readText(),
        )
        val ctf = manifest.modes.firstOrNull { it.id == "ctf" }
        assertTrue("index.json must define the ctf mode", ctf != null)
        assertTrue("ctf must be a team mode", ctf!!.teams)
        assertTrue("ctf must carry flags", ctf.flags)
        assertTrue("ctf must not score teams on kills", !ctf.teamScoreFromKills)

        // The typed Map<String, FlagBase> is the one field that would throw at
        // runtime rather than degrade, so decode every map and check the bases
        // are both present and reachable.
        for (name in listOf("arena_core", "foundry", "caverns", "outpost", "outpost_ridge")) {
            val m = map(name)
            assertTrue("$name needs a red flag base", m.flagBases.containsKey("red"))
            assertTrue("$name needs a blue flag base", m.flagBases.containsKey("blue"))

            for ((team, base) in m.flagBases) {
                val halfW = tuning.player.width / 2
                val halfH = tuning.player.height / 2
                for (s in m.solids) {
                    if (s.oneWay) continue
                    val overlaps = base.x + halfW > s.x && base.x - halfW < s.x + s.w &&
                        base.y + halfH > s.y && base.y - halfH < s.y + s.h
                    assertTrue("$name $team flag base is buried in solid (${s.x}, ${s.y})", !overlaps)
                }
            }
        }
    }
}
