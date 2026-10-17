package com.milofit.game

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

// Pure game logic (no Android deps) so it can be unit tested on the JVM.
class Player(
    val id: String,
    val isBot: Boolean,
    spawn: Point,
    var weapon: Weapon
) {
    var x = spawn.x
    var y = spawn.y
    val w = 22f
    val h = 34f
    var vx = 0f
    var vy = 0f
    var onGround = false
    var facing = 1
    var hp = 100f
    var jet = 100f
    var ammo = weapon.magSize
    var reloadDoneAt = 0L
    var lastShot = 0L
    var dead = false
    var respawnAt = 0L
    var aimX = 0f
    var aimY = 0f
    var fired = false
}

class Bullet(
    var x: Float, var y: Float, var vx: Float, var vy: Float,
    val dmg: Float, val owner: Player, val color: Int, var life: Int = 90
)

class Particle(var x: Float, var y: Float, var vx: Float, var vy: Float, var life: Int, val color: Int)

class GameEngine(var map: GameMap, private var weapon: Weapon) {
    companion object {
        const val GRAVITY = 0.6f
        const val MAX_FALL = 14f
        const val MOVE_SPEED = 4.2f
        const val JUMP_V = -11f
        const val JET_ACCEL = 0.9f
        const val JET_USE = 1.4f
        const val JET_MAX = 100f
        const val JET_REGEN = 0.6f
        const val RESPAWN_MS = 2000L
        const val ENEMY_COLOR = 0xFFFF7B72.toInt()
        const val PLAYER_COLOR = 0xFF56D364.toInt()
    }

    val players = mutableListOf<Player>()
    val bullets = mutableListOf<Bullet>()
    val particles = mutableListOf<Particle>()
    var scoreYou = 0
    var scoreBots = 0

    // Input state, set from the UI thread.
    var moveAxis = 0
    var jumpHeld = false
    var fireHeld = false
    var reloadRequested = false
    var aimX = Content.WORLD_W / 2
    var aimY = Content.WORLD_H / 2

    init { reset(map, weapon) }

    fun reset(newMap: GameMap, newWeapon: Weapon) {
        map = newMap; weapon = newWeapon
        bullets.clear(); particles.clear(); players.clear()
        val sp = map.spawns
        players.add(Player("you", false, sp[0], weapon))
        for (i in 1 until sp.size) players.add(Player("bot$i", true, sp[i], Content.weapons[0]))
    }

    private fun collides(x: Float, y: Float, w: Float, h: Float): Boolean =
        map.platforms.any { x < it.x + it.w && x + w > it.x && y < it.y + it.h && y + h > it.y }

    private fun moveEntity(e: Player) {
        e.x += e.vx
        if (collides(e.x, e.y, e.w, e.h)) { e.x -= e.vx; e.vx = 0f }
        e.onGround = false
        e.y += e.vy
        if (collides(e.x, e.y, e.w, e.h)) {
            if (e.vy > 0) e.onGround = true
            e.y -= e.vy; e.vy = 0f
        }
        e.x = e.x.coerceIn(0f, Content.WORLD_W - e.w)
        if (e.y > Content.WORLD_H) e.hp = 0f
    }

    private fun shoot(p: Player, now: Long) {
        if (p.dead) return
        if (p.ammo <= 0) { startReload(p, now); return }
        if (p.reloadDoneAt > 0) return
        if (now - p.lastShot < p.weapon.cooldownMs) return
        p.lastShot = now
        p.ammo--
        val ax = p.aimX - (p.x + p.w / 2)
        val ay = p.aimY - (p.y + p.h / 3)
        val base = atan2(ay, ax)
        repeat(p.weapon.pellets) {
            val a = base + (Random.nextFloat() - 0.5f) * 2f * p.weapon.spread
            bullets.add(
                Bullet(p.x + p.w / 2, p.y + p.h / 3, cos(a) * p.weapon.speed, sin(a) * p.weapon.speed,
                    p.weapon.damage, p, p.weapon.color)
            )
        }
        if (p.ammo == 0) startReload(p, now)
    }

    private fun startReload(p: Player, now: Long) {
        if (p.reloadDoneAt == 0L) p.reloadDoneAt = now + p.weapon.reloadMs
    }

    private fun killPlayer(p: Player) {
        if (p.dead) return
        p.dead = true
        p.respawnAt = System.currentTimeMillis() + RESPAWN_MS
        repeat(20) {
            particles.add(Particle(p.x + p.w / 2, p.y + p.h / 2,
                (Random.nextFloat() - 0.5f) * 8f, (Random.nextFloat() - 1f) * 8f, 40, if (p.isBot) ENEMY_COLOR else PLAYER_COLOR))
        }
        if (p.isBot) scoreYou++ else scoreBots++
    }

    private fun respawn(p: Player) {
        val sp = map.spawns.random()
        p.x = sp.x; p.y = sp.y; p.vx = 0f; p.vy = 0f
        p.hp = 100f; p.jet = JET_MAX; p.dead = false
        p.ammo = p.weapon.magSize; p.reloadDoneAt = 0L
    }

    private fun botAI(b: Player, now: Long, target: Player) {
        if (target.dead) return
        val dx = (target.x - b.x)
        b.facing = if (dx >= 0) 1 else -1
        b.vx = if (abs(dx) > 160f) Math.signum(dx) * 2f else 0f
        if (target.y < b.y - 60f && b.onGround) b.vy = JUMP_V
        b.aimX = target.x + target.w / 2
        b.aimY = target.y + target.h / 3
        if (abs(dx) < 500f) shoot(b, now)
    }

    fun update() {
        val now = System.currentTimeMillis()
        val you = players[0]
        if (!you.dead) {
            you.vx = moveAxis * MOVE_SPEED
            if (moveAxis != 0) you.facing = moveAxis
            if (jumpHeld && you.onGround) you.vy = JUMP_V
            if (jumpHeld && !you.onGround && you.jet > 0f) { you.vy -= JET_ACCEL; you.jet -= JET_USE }
            you.aimX = aimX; you.aimY = aimY
            if (fireHeld) {
                if (you.weapon.auto || !you.fired) { shoot(you, now); you.fired = true }
            } else you.fired = false
            if (reloadRequested) { startReload(you, now); reloadRequested = false }
        }

        for (p in players) {
            if (p.isBot && !p.dead) botAI(p, now, you)
            if (p.reloadDoneAt > 0 && now >= p.reloadDoneAt) { p.ammo = p.weapon.magSize; p.reloadDoneAt = 0L }
            if (!p.dead) {
                p.vy = minOf(p.vy + GRAVITY, MAX_FALL)
                p.jet = minOf(JET_MAX, p.jet + if (p.onGround) JET_REGEN * 2 else JET_REGEN * 0.3f)
                moveEntity(p)
                if (p.hp <= 0f) killPlayer(p)
            } else if (now >= p.respawnAt) respawn(p)
        }

        for (b in bullets) {
            b.x += b.vx; b.y += b.vy; b.life--
            if (b.x < 0 || b.x > Content.WORLD_W || b.y < 0 || b.y > Content.WORLD_H || collides(b.x, b.y, 2f, 2f)) {
                b.life = 0; continue
            }
            for (p in players) {
                if (p === b.owner || p.dead) continue
                if (b.x > p.x && b.x < p.x + p.w && b.y > p.y && b.y < p.y + p.h) {
                    p.hp -= b.dmg; b.life = 0
                    if (p.hp <= 0f) killPlayer(p)
                    break
                }
            }
        }
        bullets.removeAll { it.life <= 0 }
        for (q in particles) { q.x += q.vx; q.y += q.vy; q.vy += 0.3f; q.life-- }
        particles.removeAll { it.life <= 0 }
    }
}
