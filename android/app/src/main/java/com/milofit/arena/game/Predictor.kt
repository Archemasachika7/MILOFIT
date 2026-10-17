package com.milofit.arena.game

import com.milofit.arena.data.GameMap
import com.milofit.arena.data.Tuning
import com.milofit.arena.net.Flags
import com.milofit.arena.net.PlayerSnap
import kotlin.math.hypot

/**
 * Local prediction for the player's own body — the Kotlin twin of
 * web/src/predict.js.
 *
 * The movement rules come from [SimCore], which mirrors the module the server
 * runs, so predicting forward and comparing against the authoritative snapshot is
 * a meaningful check rather than a guess. Small errors are smoothed away; large
 * ones (teleport, respawn, an explosion's knockback) snap.
 */
class Predictor(
    private var tuning: Tuning,
    private var map: GameMap,
) {
    var body: Body = newBody(tuning)
        private set

    /** Last measured difference from the server, kept for the debug readout. */
    var errorX: Double = 0.0
        private set
    var errorY: Double = 0.0
        private set

    var lastServer: PlayerSnap? = null
        private set

    /** How much the camera should shake, derived from recent correction. */
    var correctionMag: Double = 0.0
        private set

    private fun newBody(t: Tuning) = Body(0.0, 0.0, t.player.width, t.player.height)
        .apply {
            jetFuel = t.jetpack.maxFuel
            jetIdle = 1.0
        }

    fun setMap(next: GameMap) {
        map = next
    }

    fun setTuning(next: Tuning) {
        tuning = next
    }

    fun setRole(roleId: String) {
        val role = tuning.roles[roleId] ?: tuning.roles["raider"] ?: return
        body.runSpeed = role.runSpeed
        body.maxHealth = role.maxHealth.toInt()
        body.maxJetFuel = role.jetpackMax
        body.jetDrainScale = role.jetDrainScale
        body.jetFuel = body.jetFuel.coerceAtMost(role.jetpackMax)
    }

    fun setGravityScale(scale: Double) {
        body.gravityScale = scale
    }

    /** Reset from an authoritative snapshot (or `null` for a fresh body). */
    fun reset(server: PlayerSnap?, w: Double? = null, h: Double? = null) {
        val b = newBody(tuning)
        b.w = w ?: tuning.player.width
        b.h = h ?: tuning.player.height
        if (server != null) {
            b.x = server.x
            b.y = server.y
            b.vx = server.vx
            b.vy = server.vy
            b.aim = server.a
            b.facing = if (server.f >= 0) 1 else -1
            b.maxHealth = server.mh
            b.maxJetFuel = server.mj
        }
        b.jetFuel = server?.j ?: b.maxJetFuel ?: tuning.jetpack.maxFuel
        b.jetIdle = 1.0
        body = b
        if (server != null) setRole(server.r)
        errorX = 0.0
        errorY = 0.0
        correctionMag = 0.0
        lastServer = server
    }

    /** Advance the predicted body one fixed step with this tick's input. */
    fun step(input: PlayerInput, dt: Double) {
        SimCore.stepPlayerMovement(body, input, dt, tuning, map.solids)
    }

    /**
     * Reconcile against an authoritative snapshot.
     *
     * Rewinding and replaying would be ideal, but that needs per-input acks (the
     * client would have to keep an unacknowledged input ring and re-run it). For
     * this build we correct smoothly instead: hard-snap on large errors, ease in
     * on small ones.
     */
    fun reconcile(server: PlayerSnap, dt: Double): Double {
        val b = body
        lastServer = server
        val dx = server.x - b.x
        val dy = server.y - b.y
        val err = hypot(dx, dy)
        val limit = tuning.net.reconcilePx

        if (err > limit * 4) {
            b.x = server.x
            b.y = server.y
            b.vx = server.vx
            b.vy = server.vy
            correctionMag = 0.0
        } else if (err > 1.0) {
            val rate = SimCore.clamp(err / limit, 0.0, 1.0) * 6.0 * dt
            b.x += dx * rate
            b.y += dy * rate
            correctionMag = err
        } else {
            correctionMag = 0.0
        }

        // Server-owned fields always win.
        b.onGround = Flags.ground(server.fl)
        b.maxHealth = server.mh
        b.maxJetFuel = server.mj
        b.jetFuel = server.j.coerceAtMost(server.mj)
        setRole(server.r)
        if (!server.alive) {
            b.vx = 0.0
            b.vy = 0.0
            b.x = server.x
            b.y = server.y
        }
        errorX = dx
        errorY = dy
        return err
    }
}
