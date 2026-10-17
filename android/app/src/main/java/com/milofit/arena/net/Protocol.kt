package com.milofit.arena.net

import com.milofit.arena.data.GameInfo
import com.milofit.arena.data.Mode
import com.milofit.arena.game.PlayerInput
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Wire protocol v1 (see docs/PROTOCOL.md for the narrative version).
 *
 * Snapshot keys are deliberately single letters: a 12-player snapshot is sent 20
 * times a second to every socket, so the field names are where almost all of the
 * bandwidth goes. The server is the reference implementation; these classes exist
 * only to read what it writes.
 *
 * Nothing here trusts the network. Every value that reaches the simulation is
 * either derived locally or re-validated by the server; the client just needs to
 * fail softly when a field is missing or of the wrong shape.
 */

object MsgType {
    // client -> server
    const val JOIN = "join"
    const val INPUT = "input"
    const val CHAT = "chat"
    const val TEAM = "team"
    const val SETTINGS = "settings"
    const val START = "start"
    const val PING = "ping"

    // server -> client
    const val WELCOME = "welcome"
    const val ROOM = "room"
    const val ROSTER = "roster"
    const val STATE = "state"
    const val EVENTS = "events"
    const val ERROR = "error"
    const val PONG = "pong"
    const val MATCH = "match"
}

/** Player flags packed into PlayerSnap.fl. */
object Flags {
    const val ALIVE = 1
    const val GROUND = 2
    const val JET = 4
    const val RELOAD = 8
    const val PROTECTED = 16
    const val SPECTATOR = 32

    fun alive(fl: Int) = fl and ALIVE != 0
    fun ground(fl: Int) = fl and GROUND != 0
    fun jetting(fl: Int) = fl and JET != 0
    fun reloading(fl: Int) = fl and RELOAD != 0
    fun protected(fl: Int) = fl and PROTECTED != 0
    fun spectator(fl: Int) = fl and SPECTATOR != 0
}

object Protocol {
    val json: Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
        explicitNulls = false
    }

    /** Peek at `t` so the payload can be dispatched without a polymorphic codec. */
    fun typeAndBody(raw: String): Pair<String, JsonObject>? {
        if (raw.length > 64 * 1024) return null
        val element: JsonElement = try {
            json.parseToJsonElement(raw)
        } catch (_: Exception) {
            return null
        }
        val obj = element as? JsonObject ?: return null
        val type = (obj["t"] as? JsonPrimitive)?.content ?: return null
        return type to obj
    }
}

// --------------------------------------------------------------------- outbound

@Serializable
internal data class JoinReq(
    val t: String = MsgType.JOIN,
    val name: String,
    val character: String,
    val role: String = "raider",
    val room: String,
    val team: String,
    val format: String = "1v1",
    val roleMode: String = "roles",
    val gravityMode: String = "normal",
    val map: String? = null,
    val mode: String? = null,
)

@Serializable
internal data class AimPoint(val x: Double, val y: Double)

@Serializable
internal data class InputReq(
    val t: String = MsgType.INPUT,
    val x: Double,
    val jump: Boolean,
    val jet: Boolean,
    val fire: Boolean,
    val aim: AimPoint,
    val actions: List<String>,
    val seq: Int,
    val rtt: Int,
) {
    companion object {
        fun of(input: PlayerInput, seq: Int, rttMs: Int) = InputReq(
            x = input.x,
            jump = input.jump,
            jet = input.jet,
            fire = input.fire,
            aim = AimPoint(x = input.aimX, y = input.aimY),
            actions = input.actions,
            seq = seq,
            rtt = rttMs,
        )
    }
}

@Serializable
internal data class ChatReq(val t: String = MsgType.CHAT, val text: String)

@Serializable
internal data class TeamReq(val t: String = MsgType.TEAM, val team: String)

@Serializable
internal data class SettingsReq(
    val t: String = MsgType.SETTINGS,
    val map: String? = null,
    val mode: String? = null,
    val format: String? = null,
    val roleMode: String? = null,
    val gravityMode: String? = null,
)

@Serializable
internal data class PingReq(val t: String = MsgType.PING, val ts: Long)

@Serializable
internal data class StartReq(val t: String = MsgType.START)

// ---------------------------------------------------------------------- inbound

@Serializable
data class Scores(
    val red: Double = 0.0,
    val blue: Double = 0.0,
    val ffa: Double = 0.0,
)

@Serializable
data class PlayerSnap(
    val i: String = "",
    val n: String = "",
    @SerialName("tm") val team: String = "ffa",
    val c: String = "recruit",
    val r: String = "raider",
    val x: Double = 0.0,
    val y: Double = 0.0,
    val vx: Double = 0.0,
    val vy: Double = 0.0,
    val hp: Int = 0,
    val mh: Int = 100,
    val mj: Double = 100.0,
    val sh: Int = 0,
    val f: Int = 1,
    val a: Double = 0.0,
    val fl: Int = 0,
    val s: Int = 0,
    val w: String? = null,
    val m: Int = -1,
    val rr: Int = -1,
    val rl: Double = 0.0,
    val j: Double = 100.0,
    val g: Int = 0,
    val k: Int = 0,
    val d: Int = 0,
    val sc: Double = 0.0,
    val rd: Double = 0.0,
    val pg: Int = 0,
) {
    val alive: Boolean get() = Flags.alive(fl)
    val onGround: Boolean get() = Flags.ground(fl)
    val jetting: Boolean get() = Flags.jetting(fl)
    val reloading: Boolean get() = Flags.reloading(fl)
    val protectedNow: Boolean get() = Flags.protected(fl)
    val spectator: Boolean get() = Flags.spectator(fl)
}

@Serializable
data class BulletSnap(
    val i: Int = 0,
    val x: Double = 0.0,
    val y: Double = 0.0,
    val k: String = "bullet",
    val w: String? = null,
    val o: String = "",
    val a: Double = 0.0,
)

@Serializable
data class PickupSnap(
    val i: Int = 0,
    val x: Double = 0.0,
    val y: Double = 0.0,
    val t: String = "ammo",
    val w: String? = null,
)

/** One capture-the-flag flag. `a` is 1 only at home; `c` is the carrier id. */
@Serializable
data class FlagSnap(
    @SerialName("tm") val team: String = "red",
    val x: Double = 0.0,
    val y: Double = 0.0,
    val bx: Double = 0.0,
    val by: Double = 0.0,
    val c: String? = null,
    val a: Int = 0,
) {
    val atBase: Boolean get() = a == 1
}

@Serializable
data class StateMsg(
    val tick: Int = 0,
    val time: Double = 0.0,
    val state: String = "lobby",
    val mapId: String = "arena_core",
    val mode: String = "dm",
    val teams: Boolean = false,
    val format: String? = null,
    val roleMode: String = "roles",
    val gravityMode: String = "normal",
    val gravityScale: Double = 1.0,
    val timeLeft: Int = 0,
    val timeLimitSeconds: Int = 300,
    val countdown: Double = 0.0,
    val scoreLimit: Int = 25,
    val scores: Scores = Scores(),
    val players: List<PlayerSnap> = emptyList(),
    val bullets: List<BulletSnap> = emptyList(),
    val pickups: List<PickupSnap> = emptyList(),
    /** Empty unless the running mode uses flags. */
    val flags: List<FlagSnap> = emptyList(),
)

@Serializable
data class You(
    val id: String = "",
    val name: String = "",
    val character: String = "recruit",
    val role: String = "raider",
    val room: String = "",
    val host: Boolean = false,
)

@Serializable
data class RoomMapInfo(
    val id: String = "",
    val name: String = "",
    val size: com.milofit.arena.data.MapSize = com.milofit.arena.data.MapSize(),
)

@Serializable
data class RoomInfo(
    val id: String = "lobby",
    val mapId: String = "arena_core",
    val modeId: String = "tdm",
    val format: String = "1v1",
    val roleMode: String = "roles",
    val gravityMode: String = "normal",
    val state: String = "lobby",
    val host: String? = null,
    val map: RoomMapInfo? = null,
    val mode: Mode? = null,
    val maxPlayers: Int = 2,
    val scoreLimit: Int = 25,
    val timeLimitSeconds: Double = 300.0,
)

@Serializable
data class RosterPlayer(
    val id: String = "",
    val name: String = "",
    val team: String = "ffa",
    val character: String = "recruit",
    val role: String = "raider",
    val alive: Boolean = false,
    val spectator: Boolean = true,
    val kills: Int = 0,
    val deaths: Int = 0,
    val score: Double = 0.0,
    val ping: Int = 0,
    /** Present on the end-of-match scoreboard only. */
    val streak: Int = 0,
    val bestStreak: Int = 0,
)

@Serializable
data class Roster(
    val id: String? = null,
    val mapId: String = "arena_core",
    val modeId: String = "dm",
    val state: String = "lobby",
    val players: List<RosterPlayer> = emptyList(),
)

@Serializable
data class RoomSummary(
    val id: String = "",
    val players: Int = 0,
    val max: Int = 12,
    val mapId: String = "",
    val modeId: String = "",
    val state: String = "",
)

@Serializable
data class WelcomeMsg(
    val you: You? = null,
    val room: RoomInfo? = null,
    val roster: Roster? = null,
    val game: GameInfo? = null,
    val serverTime: Long = 0,
    val reassigned: Boolean = false,
    /** Set when the host role moves; the payload has no `you` in that case. */
    val host: String? = null,
)

@Serializable
data class RoomMsg(val room: RoomInfo = RoomInfo())

@Serializable
data class RosterMsg(
    val roster: Roster = Roster(),
    val host: String? = null,
    val room: RoomInfo? = null,
)

@Serializable
data class EventsMsg(val events: List<GameEvent> = emptyList())

@Serializable
data class ChatMsg(
    val from: String = "",
    val name: String = "",
    val team: String = "ffa",
    val text: String = "",
    val at: Long = 0,
)

@Serializable
data class ErrorMsg(
    val code: String = "",
    val message: String = "",
)

@Serializable
data class PongMsg(
    val ts: Long? = null,
    val serverTime: Long = 0,
)

/**
 * One simulation event. The server emits a single flat shape with a `type`
 * discriminator (fire/hitMark/hurt/kill/pickup/explosion/impact/throw/melee/
 * reload/reloaded/spawn/countdown/matchStart/matchEnd/lobby) rather than a class
 * hierarchy, so unknown fields are ignored and unused ones stay at their default.
 */
@Serializable
data class GameEvent(
    val type: String = "",
    /** Targeted events carry the recipient; shared events omit it. */
    val to: String? = null,
    val id: String? = null,
    val x: Double = 0.0,
    val y: Double = 0.0,
    val angle: Double = 0.0,
    val weapon: String? = null,
    val radius: Double = 0.0,
    val amount: Int = 0,
    val shield: Boolean = false,
    val lethal: Boolean = false,
    val flesh: Boolean = false,
    val hit: Boolean = false,
    val from: String? = null,
    val mag: Int = 0,
    val duration: Double = 0.0,
    val grenades: Int = 0,
    val pickup: Int = 0,
    val pickupType: String? = null,
    val killer: String? = null,
    val killerName: String? = null,
    val killerTeam: String? = null,
    val victim: String? = null,
    val victimName: String? = null,
    val victimTeam: String? = null,
    val assist: String? = null,
    val streak: Int = 0,
    // end-of-match
    val reason: String? = null,
    val winner: JsonElement? = null,
    val teams: Scores? = null,
    val scoreboard: List<RosterPlayer> = emptyList(),
    val mapId: String? = null,
    val mode: String? = null,
    val seconds: Double = 0.0,
    // capture the flag — "capture" carries team/id/name/score, "flag" an action
    val team: String? = null,
    val name: String? = null,
    val action: String? = null,
    val score: Int = 0,
) {
    /** matchEnd carries either a team name or a player id; both arrive as a string. */
    val winnerId: String? get() = (winner as? JsonPrimitive)?.content
}
