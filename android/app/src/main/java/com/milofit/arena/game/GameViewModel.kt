package com.milofit.arena.game

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import com.milofit.arena.audio.Sfx
import com.milofit.arena.data.Character
import com.milofit.arena.data.Content
import com.milofit.arena.data.GameMap
import com.milofit.arena.data.Palette
import com.milofit.arena.net.BulletSnap
import com.milofit.arena.net.ChatMsg
import com.milofit.arena.net.ConnStatus
import com.milofit.arena.net.FlagSnap
import com.milofit.arena.net.GameClient
import com.milofit.arena.net.GameEvent
import com.milofit.arena.net.PickupSnap
import com.milofit.arena.net.PlayerSnap
import com.milofit.arena.net.Roster
import com.milofit.arena.net.RosterPlayer
import com.milofit.arena.net.RoomInfo
import com.milofit.arena.net.Scores
import com.milofit.arena.net.StateMsg
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round
import kotlin.math.sin
import kotlin.random.Random

enum class Screen { MENU, LOBBY, GAME, SCOREBOARD }

/** Values the HUD shows. Published to Compose state at a throttled rate. */
data class HudState(
    val hp: Int = 100,
    val shield: Int = 0,
    val maxHp: Int = 100,
    val maxShield: Int = 50,
    val jetFuel: Double = 100.0,
    val maxJetFuel: Double = 100.0,
    val grenades: Int = 0,
    val maxGrenades: Int = 2,
    val weaponId: String? = null,
    val weaponName: String = "",
    val slot: Int = 0,
    val mag: Int = -1,
    val reserve: Int = -1,
    val hasAmmo: Boolean = true,
    val reloading: Boolean = false,
    val reloadProgress: Double = 0.0,
    val kills: Int = 0,
    val deaths: Int = 0,
    val score: Double = 0.0,
    val alive: Boolean = false,
    val spectator: Boolean = false,
    val respawnIn: Double = 0.0,
    val protectedNow: Boolean = false,
    val state: String = "lobby",
    val timeLeft: Int = 0,
    val countdown: Double = 0.0,
    val scoreLimit: Int = 25,
    val scoreRed: Double = 0.0,
    val scoreBlue: Double = 0.0,
    val scoreFfa: Double = 0.0,
    val teams: Boolean = false,
    /** Capture the flag: the running mode carries flags. */
    val modeHasFlags: Boolean = false,
    /** Capture the flag: the local player's own flag is out of its base. */
    val ownFlagAway: Boolean = false,
    /** Capture the flag: the local player is carrying the enemy flag. */
    val carryingFlag: Boolean = false,
    val modeId: String = "dm",
    val mapName: String = "",
    val rttMs: Int = 0,
    val fps: Int = 0,
)

data class Banner(val text: String, val sub: String = "", val life: Double = 2.0) {
    var t: Double = 0.0
}

data class KillFeedLine(
    val key: Long,
    val killer: String,
    val killerTeam: String?,
    val victim: String,
    val victimTeam: String?,
    val weapon: String,
    val mine: Boolean,
)

data class ChatLine(
    val key: Long,
    val from: String,
    val name: String,
    val team: String,
    val text: String,
)

/** One snapshot as it arrived, kept briefly so remote bodies can be interpolated. */
class SnapshotFrame(
    val tick: Int,
    val time: Double,
    val state: String,
    val players: List<PlayerSnap>,
    val bullets: List<BulletSnap>,
    val pickups: List<PickupSnap>,
    val flags: List<FlagSnap>,
    val receivedAtMs: Long,
    val scores: Scores,
    val teams: Boolean,
    val modeId: String,
    val mapId: String,
    val timeLeft: Int,
    val countdown: Double,
    val scoreLimit: Int,
    val format: String?,
    val roleMode: String,
    val gravityMode: String,
    val gravityScale: Double,
)

/**
 * A player ready to draw. Instances are pooled per id so the 60 Hz render loop
 * does not allocate.
 */
class PlayerView {
    var id: String = ""
    var name: String = ""
    var team: String = "ffa"
    var character: String = "recruit"
    var palette: Palette? = null
    var build: Double = 1.0
    var twitch: Double = 1.0
    var x: Double = 0.0
    var y: Double = 0.0
    var vx: Double = 0.0
    var vy: Double = 0.0
    var aim: Double = 0.0
    var facing: Int = 1
    var hp: Int = 100
    var shield: Int = 0
    var alive: Boolean = true
    var onGround: Boolean = false
    var jetting: Boolean = false
    var reloading: Boolean = false
    var protectedNow: Boolean = false
    var spectator: Boolean = false
    var weaponId: String? = null
    var slot: Int = 0
    var kills: Int = 0
    var deaths: Int = 0
    var score: Double = 0.0
    var walk: Double = 0.0
    var local: Boolean = false
    var respawnIn: Double = 0.0
    var jetFuel: Double = 100.0
    var grenades: Int = 0
    var mag: Int = -1
    var reserve: Int = -1
    var ping: Int = 0
}

/** Transient visual: muzzle flash, impact, explosion, floating damage, ring. */
class Effect(
    var kind: String,
    var x: Double,
    var y: Double,
    var life: Double = 0.3,
) {
    var t: Double = 0.0
    var angle: Double = 0.0
    var radius: Double = 0.0
    var text: String = ""
    var color: Int = 0xFFFFFFFF.toInt()
    var shield: Boolean = false
    var flesh: Boolean = false
    var seed: Double = 0.0

    val progress: Double get() = if (life <= 0.0) 1.0 else (t / life).coerceIn(0.0, 1.0)
    val alpha: Double get() = (1.0 - progress).coerceIn(0.0, 1.0)
}

/**
 * Touch state written by the Compose controls and read by the fixed-step loop.
 * Both run on the main thread (frame callbacks are dispatched there), so plain
 * fields are enough — no locks, no atomics.
 */
class InputState {
    var moveX: Double = 0.0
    var jetHeld: Boolean = false
    var aimActive: Boolean = false
    var aimX: Double = 0.0
    var aimY: Double = 0.0
    var aimDirX: Double = 1.0
    var aimDirY: Double = 0.0

    /** Set while the aim stick is held: aiming at somebody fires at them. */
    var autoFire: Boolean = false

    /** Set while the dedicated fire button is held. */
    var fireButton: Boolean = false

    val fireHeld: Boolean get() = autoFire || fireButton

    private val queued = ArrayDeque<String>()

    fun push(action: String) {
        if (queued.size < 8) queued.addLast(action)
    }

    fun drain(): List<String> {
        if (queued.isEmpty()) return emptyList()
        val out = ArrayList<String>(queued.size)
        while (queued.isNotEmpty()) out.add(queued.removeFirst())
        return out
    }

    /** Called on respawn: drop anything queued while dead and re-centre the sticks. */
    fun clearTransient() {
        moveX = 0.0
        jetHeld = false
        autoFire = false
        fireButton = false
        aimActive = false
        queued.clear()
    }
}

/**
 * The client's brain: owns the socket, the predictor, the snapshot buffer and all
 * per-frame state, and publishes a small amount of Compose state for the UI.
 *
 * Per-frame data (player views, effects, camera, bullets) is deliberately *not*
 * Compose state — mutating that 60 times a second would trigger 60 recompositions
 * a second. The renderer reads those fields directly from inside a Canvas draw.
 */
class GameViewModel(app: Application) : AndroidViewModel(app) {

    val content: Content = Content.load(app)
    val input = InputState()

    private val prefs: SharedPreferences = app.getSharedPreferences("milofit", Context.MODE_PRIVATE)

    // -------------------------------------------------------- Compose-observed

    var screen by mutableStateOf(Screen.MENU)
        private set
    var connStatus by mutableStateOf(ConnStatus.IDLE)
        private set
    var statusMessage by mutableStateOf("")
        private set
    var serverError by mutableStateOf<String?>(null)
        private set
    var room by mutableStateOf<RoomInfo?>(null)
        private set
    var roster by mutableStateOf<Roster?>(null)
        private set
    var myId by mutableStateOf<String?>(null)
        private set
    var isHost by mutableStateOf(false)
        private set
    var hud by mutableStateOf(HudState())
        private set
    var banner by mutableStateOf<Banner?>(null)
        private set
    var scoreboard by mutableStateOf<List<RosterPlayer>>(emptyList())
        private set
    var scoreboardWinner by mutableStateOf<String?>(null)
        private set
    var scoreboardReason by mutableStateOf("")
        private set

    val killFeed = mutableStateListOf<KillFeedLine>()
    val chatLog = mutableStateListOf<ChatLine>()

    var playerName by mutableStateOf(prefs.getString("name", "") ?: "")
    var serverUrl by mutableStateOf(prefs.getString("server", DEFAULT_SERVER) ?: DEFAULT_SERVER)
    var roomId by mutableStateOf((prefs.getString("room", "") ?: "").let { if (it == "lobby") "" else it })
    var characterId by mutableStateOf(prefs.getString("character", "recruit") ?: "recruit")
    var roleId by mutableStateOf(prefs.getString("role", "raider") ?: "raider")
    var matchFormat by mutableStateOf(prefs.getString("format", "1v1") ?: "1v1")
    var roleMode by mutableStateOf(prefs.getString("roleMode", "roles") ?: "roles")
    var gravityMode by mutableStateOf(prefs.getString("gravityMode", "normal") ?: "normal")
    var teamPreference by mutableStateOf(prefs.getString("team", "auto") ?: "auto")
    var muted by mutableStateOf(prefs.getBoolean("muted", false))

    // ------------------------------------------------------- per-frame (plain)

    val predictor: Predictor = Predictor(content.tuning, content.defaultMap)
    val effects = ArrayList<Effect>(128)
    private val snapshots = ArrayDeque<SnapshotFrame>()
    private val viewPool = HashMap<String, PlayerView>()
    private val views = ArrayList<PlayerView>(16)
    private val walkPhase = HashMap<String, Double>()

    var cameraX: Double = 0.0
        private set
    var cameraY: Double = 0.0
        private set
    var shakeMag: Double = 0.0
        private set
    var hitMarker: Double = 0.0
        private set
    var damageFlash: Double = 0.0
        private set
    var aimPointX: Double = 0.0
        private set
    var aimPointY: Double = 0.0
        private set
    var viewportW: Double = 0.0
        private set
    var viewportH: Double = 0.0
        private set
    var viewSeconds: Double = 0.0
        private set

    var map: GameMap = content.defaultMap
        private set

    private var client: GameClient? = null
    private var cameraReady = false
    private var acc = 0.0
    private var seq = 0
    private var hudAcc = 0.0
    private var fpsAcc = 0.0
    private var fpsFrames = 0
    private var fpsValue = 0
    private var lastFrameMs = 0L
    private var killKey = 0L
    private var chatKey = 0L
    private var countdownBeeped = -1
    private var localAlive = true

    init {
        Sfx.muted = muted
    }

    override fun onCleared() {
        client?.close()
        Sfx.release()
        super.onCleared()
    }

    // ------------------------------------------------------------ menu actions

    /**
     * Connect and join. [practice] opens a private randomly named room, which is
     * the closest thing to an offline mode a server-authoritative game can offer —
     * the simulation still runs on the server, but nobody else can wander in.
     */
    fun play(practice: Boolean = false) {
        val effectiveName = playerName.ifBlank { "Recruit" }
            .take(content.tuning.limits.nameMaxLength)
        playerName = effectiveName

        val targetRoom = if (practice) {
            "solo-" + Random.nextInt(0x10000, 0xFFFFF).toString(16)
        } else {
            roomId.trim()
        }
        roomId = targetRoom

        prefs.edit()
            .putString("name", effectiveName)
            .putString("server", serverUrl)
            .putString("room", targetRoom)
            .putString("character", characterId)
            .putString("team", teamPreference)
            .putString("role", roleId)
            .putString("format", matchFormat)
            .putString("roleMode", roleMode)
            .putString("gravityMode", gravityMode)
            .apply()

        val url = normaliseUrl(serverUrl)
        if (url == null) {
            serverError = "That does not look like a server address."
            return
        }
        serverError = null
        // Move to the lobby immediately so "Connecting…" is visible rather than
        // the button appearing to do nothing.
        screen = Screen.LOBBY
        viewSeconds = 0.0

        client?.close()
        val c = GameClient(url)
        client = c
        wire(c)
        c.onOpen = {
            c.join(
                effectiveName, characterId, targetRoom, teamPreference,
                role = roleId.ifBlank { roleForCharacter(characterId) },
                format = matchFormat,
                roleMode = roleMode,
                gravityMode = gravityMode,
            )
        }
        c.connect()
    }

    fun leave() {
        client?.close()
        client = null
        snapshots.clear()
        effects.clear()
        views.clear()
        viewPool.clear()
        walkPhase.clear()
        killFeed.clear()
        scoreboard = emptyList()
        scoreboardWinner = null
        scoreboardReason = ""
        isHost = false
        myId = null
        roster = null
        room = null
        hud = HudState()
        banner = null
        localAlive = true
        cameraReady = false
        screen = Screen.MENU
        Sfx.setJetIntensity(0.0)
    }

    fun toggleMute() {
        muted = !muted
        Sfx.muted = muted
        prefs.edit().putBoolean("muted", muted).apply()
    }

    fun sendChat(text: String) {
        val trimmed = text.trim().take(content.tuning.limits.chatMaxLength)
        if (trimmed.isEmpty()) return
        client?.sendChat(trimmed)
    }

    fun requestMap(mapId: String) = run { client?.requestSettings(mapId = mapId) }

    fun requestMode(modeId: String) = run { client?.requestSettings(modeId = modeId) }
    fun requestMatchSettings() = run {
        client?.requestSettings(format = matchFormat, roleMode = roleMode, gravityMode = gravityMode)
    }

    fun requestStart() = run { client?.requestStart() }

    fun requestTeam(team: String) {
        teamPreference = team
        prefs.edit().putString("team", team).apply()
        client?.requestTeam(team)
    }

    fun setCharacter(id: String) {
        characterId = id
        prefs.edit().putString("character", id).apply()
    }

    fun setServer(url: String) {
        serverUrl = url
    }

    fun setRoom(id: String) {
        roomId = id
    }

    private fun roleForCharacter(id: String): String = when (id) {
        "scout" -> "scout"
        "medic" -> "medic"
        "heavy" -> "breacher"
        else -> "raider"
    }

    fun setName(name: String) {
        playerName = name
    }

    // ------------------------------------------------------------------ wiring

    private fun wire(c: GameClient) {
        c.onStatus = { status ->
            connStatus = status
            statusMessage = when (status) {
                ConnStatus.IDLE -> ""
                ConnStatus.CONNECTING -> "Connecting…"
                ConnStatus.CONNECTED -> "Connected"
                ConnStatus.DISCONNECTED -> "Disconnected — retrying…"
                ConnStatus.CLOSED -> "Offline"
            }
        }
        c.onWelcome = { msg ->
            msg.you?.let { you ->
                myId = you.id
                isHost = you.host
            }
            msg.host?.let { host -> isHost = myId != null && myId == host }
            msg.room?.let { applyRoom(it) }
            if (screen == Screen.MENU) {
                screen = Screen.LOBBY
                viewSeconds = 0.0
            }
            // Audio needs a user gesture on the web; on Android this is the first
            // moment we know the player is actually in, so start the mixer here.
            Sfx.init()
        }
        c.onRoom = { applyRoom(it) }
        c.onRoster = { r ->
            roster = r
            isHost = myId != null && c.room?.host == myId
            pushHud()
        }
        c.onState = { snap -> onSnapshot(snap) }
        c.onEvents = { events -> onEvents(events) }
        c.onChat = { msg -> onChat(msg) }
        c.onServerError = { err ->
            serverError = err.message.ifBlank { err.code }
        }
    }

    private fun applyRoom(next: RoomInfo) {
        val changedMap = room?.mapId != null && room?.mapId != next.mapId
        room = next
        roomId = next.id
        matchFormat = next.format
        roleMode = next.roleMode
        gravityMode = next.gravityMode
        prefs.edit().putString("room", next.id).apply()
        isHost = myId != null && next.host == myId
        if (changedMap || map.id != next.mapId) {
            map = content.map(next.mapId)
            predictor.setMap(map)
            predictor.reset(null)
            snapshots.clear()
            effects.clear()
            cameraReady = false
        }
    }

    private fun onSnapshot(snap: StateMsg) {
        val now = SystemClock.elapsedRealtime()
        if (map.id != snap.mapId) {
            map = content.map(snap.mapId)
            predictor.setMap(map)
            predictor.reset(null)
            snapshots.clear()
            cameraReady = false
        }

        snapshots.addLast(
            SnapshotFrame(
                tick = snap.tick,
                time = snap.time,
                state = snap.state,
                players = snap.players,
                bullets = snap.bullets,
                pickups = snap.pickups,
                flags = snap.flags,
                receivedAtMs = now,
                scores = snap.scores,
                teams = snap.teams,
                modeId = snap.mode,
                mapId = snap.mapId,
                timeLeft = snap.timeLeft,
                countdown = snap.countdown,
                scoreLimit = snap.scoreLimit,
                format = snap.format,
                roleMode = snap.roleMode,
                gravityMode = snap.gravityMode,
                gravityScale = snap.gravityScale,
            ),
        )
        while (snapshots.size > content.tuning.net.inputBufferSize + 4) snapshots.removeFirst()

        val me = snap.players.firstOrNull { it.i == myId }
        predictor.setGravityScale(snap.gravityScale)
        if (me != null) {
            if (predictor.lastServer == null || !localAlive && me.alive) {
                predictor.reset(me)
                input.clearTransient()
            } else {
                predictor.setRole(me.r)
                predictor.reconcile(me, content.tuning.fixedDt)
            }
            predictor.setGravityScale(snap.gravityScale)
            localAlive = me.alive
        }

        when (snap.state) {
            "playing" -> if (screen != Screen.GAME) {
                screen = Screen.GAME
                viewSeconds = 0.0
            }

            "ended" -> if (screen == Screen.GAME) screen = Screen.SCOREBOARD
            "lobby" -> if (screen == Screen.GAME || screen == Screen.SCOREBOARD) screen = Screen.LOBBY
            else -> Unit
        }
    }

    // ------------------------------------------------------------------ events

    private fun onEvents(events: List<GameEvent>) {
        val me = myId
        for (ev in events) {
            when (ev.type) {
                "fire" -> {
                    addEffect("muzzle", ev.x, ev.y, 0.07).angle = ev.angle
                    Sfx.shot(ev.weapon ?: "sidearm", distGain(ev.x, ev.y))
                    if (ev.id == me) {
                        predictor.body.facing = if (cos(ev.angle) >= 0) 1 else -1
                        shake(0.5)
                    } else {
                        shake(0.25 * distGain(ev.x, ev.y))
                    }
                }

                "impact" -> addEffect("impact", ev.x, ev.y, 0.30).apply {
                    flesh = ev.flesh
                    seed = Random.nextDouble(0.0, 6.28)
                }

                "explosion" -> {
                    addEffect("explosion", ev.x, ev.y, 0.55).radius = ev.radius
                    addEffect("ring", ev.x, ev.y, 0.45).apply {
                        radius = ev.radius * 1.7
                        color = 0xFFFFB703.toInt()
                    }
                    Sfx.explosion(distGain(ev.x, ev.y))
                    shake(9 * distGain(ev.x, ev.y) + 3)
                }

                "hitMark" -> if (ev.to == me) {
                    hitMarker = 1.0
                    addEffect("damage", ev.x, ev.y, 0.70).apply {
                        text = ev.amount.toString()
                        shield = ev.shield
                    }
                    Sfx.hitMark()
                }

                "hurt" -> if (ev.to == me) {
                    damageFlash = 1.0
                    Sfx.hurt()
                    shake(3.0)
                }

                "kill" -> {
                    addKillFeed(ev)
                    if (ev.killer == me) Sfx.kill()
                    if (ev.victim == me) Sfx.death()
                }

                "pickup" -> {
                    if (ev.id == me) Sfx.pickup()
                    addEffect("ring", ev.x, ev.y, 0.40).apply {
                        radius = 42.0
                        color = 0xFFFFD166.toInt()
                    }
                }

                "capture" -> {
                    val localTeam = roster?.players?.firstOrNull { it.id == me }?.team
                    banner = Banner(
                        if (ev.team != null && ev.team == localTeam) "YOU SCORED"
                        else "${(ev.team ?: "").uppercase()} SCORED",
                        "${ev.name ?: "Someone"} captured the flag — ${ev.score} / ${content.tuning.ctf.captureLimit}",
                        3.2,
                    )
                    Sfx.kill()
                    shake(6.0)
                    addEffect("ring", ev.x, ev.y, 0.75).apply {
                        radius = 96.0
                        color = if (ev.team == "red") 0xFFFF5D5D.toInt() else 0xFF4CC9F0.toInt()
                    }
                }

                "flag" -> if (ev.action == "taken" || ev.action == "returned") Sfx.pickup()

                "reload" -> if (ev.id == me) Sfx.reload(0)
                "reloaded" -> if (ev.id == me) Sfx.reload(1)

                "melee" -> {
                    Sfx.shot("basher", distGain(ev.x, ev.y))
                    addEffect("ring", ev.x, ev.y, 0.22).apply {
                        radius = 60.0
                        color = 0xFFFF8A5C.toInt()
                    }
                }

                "throw" -> Sfx.shot("frag", distGain(ev.x, ev.y))

                "spawn" -> addEffect("ring", ev.x, ev.y, 0.60).apply {
                    radius = 90.0
                    color = 0xFF7EE0FF.toInt()
                }

                "matchStart" -> {
                    effects.clear()
                    banner = Banner("FIGHT", "", 2.2)
                    Sfx.countdownBeep(true)
                    countdownBeeped = -1
                }

                "countdown" -> {
                    banner = Banner("GET READY", "Match starts in ${round(ev.seconds).toInt()}s", ev.seconds)
                    Sfx.countdownBeep(false)
                }

                "matchEnd" -> {
                    scoreboard = ev.scoreboard
                    scoreboardWinner = ev.winnerId
                    scoreboardReason = ev.reason ?: ""
                    val iWon = if (ev.teams != null) {
                        roster?.players?.firstOrNull { it.id == me }?.team == ev.winnerId
                    } else {
                        ev.winnerId != null && ev.winnerId == me
                    }
                    Sfx.matchEnd(iWon)
                    banner = Banner(
                        if (iWon) "VICTORY" else "MATCH OVER",
                        if (ev.reason == "time") "Time expired" else "Score limit reached",
                        5.0,
                    )
                }

                "lobby" -> {
                    scoreboard = emptyList()
                    scoreboardWinner = null
                    banner = Banner("WAITING FOR PLAYERS", "Match starts automatically", 3.5)
                }

                else -> Unit
            }
        }
    }

    private fun onChat(msg: ChatMsg) {
        chatLog.add(ChatLine(chatKey++, msg.from, msg.name, msg.team, msg.text))
        while (chatLog.size > 40) chatLog.removeAt(0)
    }

    private fun addKillFeed(ev: GameEvent) {
        val weaponName = ev.weapon?.let { content.weapon(it)?.name } ?: "—"
        killFeed.add(
            KillFeedLine(
                key = killKey++,
                killer = ev.killerName ?: "the arena",
                killerTeam = ev.killerTeam,
                victim = ev.victimName ?: "?",
                victimTeam = ev.victimTeam,
                weapon = weaponName,
                mine = ev.killer == myId || ev.victim == myId,
            ),
        )
        while (killFeed.size > 6) killFeed.removeAt(0)
    }

    private fun addEffect(kind: String, x: Double, y: Double, life: Double): Effect {
        val e = Effect(kind = kind, x = x, y = y, life = life)
        if (effects.size < 240) effects.add(e)
        return e
    }

    private fun distGain(x: Double, y: Double): Double {
        val d = hypot(x - cameraX - viewportW / 2, y - cameraY - viewportH / 2)
        return SimCore.clamp(1.0 - d / 1400.0, 0.06, 1.0)
    }

    private fun shake(mag: Double) {
        shakeMag = min(26.0, shakeMag + mag)
    }

    // ------------------------------------------------------------------- frame

    fun setViewport(w: Double, h: Double) {
        viewportW = w
        viewportH = h
    }

    /**
     * Called once per display frame from the render loop. Runs the fixed-step
     * simulation so prediction does not depend on the display refresh rate — a
     * 120 Hz phone and a 60 Hz one predict identical trajectories.
     */
    fun onFrame(nowMs: Long, deltaSeconds: Double) {
        val dt = deltaSeconds.coerceIn(0.0, 0.25)
        viewSeconds += dt

        if (lastFrameMs != 0L && nowMs > lastFrameMs) {
            fpsAcc += (nowMs - lastFrameMs) / 1000.0
            fpsFrames += 1
            if (fpsAcc >= 0.5) {
                fpsValue = (fpsFrames / fpsAcc).toInt()
                fpsAcc = 0.0
                fpsFrames = 0
            }
        }
        lastFrameMs = nowMs

        updateAim()

        val tuning = content.tuning
        val fixed = tuning.fixedDt
        var jetting = false

        if (localAlive) {
            acc = min(acc + dt, 0.5)
            var steps = 0
            var actions = input.drain()
            while (acc >= fixed && steps < 8) {
                val frame = PlayerInput(
                    x = input.moveX,
                    jump = false,
                    jet = input.jetHeld,
                    fire = input.fireHeld,
                    aimX = input.aimX,
                    aimY = input.aimY,
                    actions = actions,
                )
                actions = emptyList()
                jetting = SimCore.stepPlayerMovement(predictor.body, frame, fixed, tuning, map.solids)
                client?.sendInput(frame, seq++)
                acc -= fixed
                steps += 1
            }
        } else {
            acc = 0.0
            input.drain()
        }

        Sfx.setJetIntensity(if (jetting) 1.0 else 0.0)

        updateEffects(dt)
        updateWalk(dt)
        updateCamera(dt)

        hitMarker = (hitMarker - dt * 3.2).coerceAtLeast(0.0)
        damageFlash = (damageFlash - dt * 2.6).coerceAtLeast(0.0)
        shakeMag *= Math.pow(0.002, dt)
        if (shakeMag < 0.05) shakeMag = 0.0

        banner?.let { b ->
            b.t += dt
            if (b.t >= b.life) banner = null
        }

        hudAcc += dt
        if (hudAcc >= 0.08) {
            hudAcc = 0.0
            pushHud()
        }
    }

    /**
     * The aim point is a world position, not an angle: the server derives the
     * firing angle from it, so a client cannot simply assert "I hit that player".
     * With no stick held we keep the last point but slide it along with the body so
     * the crosshair does not detach from the player.
     */
    private fun updateAim() {
        val body = predictor.body
        if (input.aimActive) {
            val len = hypot(input.aimDirX, input.aimDirY)
            if (len > 0.001) {
                val nx = input.aimDirX / len
                val ny = input.aimDirY / len
                aimPointX = body.x + nx * 600.0
                aimPointY = body.y + ny * 600.0
            }
        } else if (aimPointX == 0.0 && aimPointY == 0.0) {
            aimPointX = body.x + 100.0
            aimPointY = body.y
        }
        input.aimX = aimPointX
        input.aimY = aimPointY
    }

    private fun updateEffects(dt: Double) {
        var i = 0
        while (i < effects.size) {
            val e = effects[i]
            e.t += dt
            if (e.t >= e.life) effects.removeAt(i) else i += 1
        }

        val cd = latestState()?.countdown ?: 0.0
        if (cd > 0.0 && screen != Screen.GAME) {
            val whole = kotlin.math.ceil(cd).toInt()
            if (whole != countdownBeeped && whole in 1..9) {
                countdownBeeped = whole
                Sfx.countdownBeep(false)
            }
        }
    }

    private fun updateWalk(dt: Double) {
        for (v in views) {
            val speed = if (v.onGround && !v.jetting) v.vx else v.vx * 0.4
            val next = (walkPhase[v.id] ?: 0.0) + speed * 0.06 * dt
            walkPhase[v.id] = next
            v.walk = next
        }
    }

    private fun updateCamera(dt: Double) {
        val w = viewportW
        val h = viewportH
        if (w <= 1.0 || h <= 1.0) return
        val body = predictor.body
        val lead = 70.0
        val tx = body.x + cos(body.aim) * lead - w / 2
        val ty = body.y + sin(body.aim) * lead * 0.6 - h / 2
        val maxX = max(0.0, map.mapSize.width - w)
        val maxY = max(0.0, map.mapSize.height - h)
        val cx = tx.coerceIn(0.0, maxX)
        val cy = ty.coerceIn(0.0, maxY)

        if (!cameraReady) {
            cameraX = cx
            cameraY = cy
            cameraReady = true
            return
        }
        val k = SimCore.clamp(dt * 9.0, 0.0, 1.0)
        cameraX += (cx - cameraX) * k
        cameraY += (cy - cameraY) * k
    }

    private fun pushHud() {
        val latest = snapshots.lastOrNull()
        val me = latest?.players?.firstOrNull { it.i == myId }
        val weapon = content.weapon(me?.w)

        // Capture the flag readings. In every other mode the flag list is empty
        // and both of these stay false, so the HUD needs no mode check.
        val flags = latest?.flags ?: emptyList()
        val ownFlagAway = flags.firstOrNull { it.team == me?.team }?.atBase == false
        val carryingFlag = flags.any { it.c == myId }
        hud = HudState(
            hp = me?.hp ?: 0,
            shield = me?.sh ?: 0,
            maxHp = me?.mh ?: content.tuning.player.maxHealth.toInt(),
            maxShield = content.tuning.player.maxShield.toInt(),
            jetFuel = me?.j ?: predictor.body.jetFuel,
            maxJetFuel = me?.mj ?: content.tuning.jetpack.maxFuel,
            grenades = me?.g ?: 0,
            maxGrenades = content.tuning.grenades.maxCarried,
            weaponId = me?.w,
            weaponName = weapon?.name ?: "",
            slot = me?.s ?: 0,
            mag = me?.m ?: -1,
            reserve = me?.rr ?: -1,
            hasAmmo = weapon?.hasAmmo ?: true,
            reloading = me?.reloading ?: false,
            reloadProgress = if (me != null && me.rl > 0 && weapon != null && weapon.reloadSeconds > 0) {
                (1.0 - me.rl / weapon.reloadSeconds).coerceIn(0.0, 1.0)
            } else {
                0.0
            },
            kills = me?.k ?: 0,
            deaths = me?.d ?: 0,
            score = me?.sc ?: 0.0,
            alive = me?.alive ?: false,
            spectator = me?.spectator ?: false,
            respawnIn = me?.rd ?: 0.0,
            protectedNow = me?.protectedNow ?: false,
            state = latest?.state ?: "lobby",
            timeLeft = latest?.timeLeft ?: 0,
            countdown = latest?.countdown ?: 0.0,
            scoreLimit = latest?.scoreLimit ?: content.tuning.match.scoreLimit,
            scoreRed = latest?.scores?.red ?: 0.0,
            scoreBlue = latest?.scores?.blue ?: 0.0,
            scoreFfa = latest?.scores?.ffa ?: 0.0,
            teams = latest?.teams ?: false,
            modeHasFlags = flags.isNotEmpty(),
            ownFlagAway = ownFlagAway,
            carryingFlag = carryingFlag,
            modeId = latest?.modeId ?: room?.modeId ?: "dm",
            mapName = map.name,
            rttMs = client?.rttMs ?: 0,
            fps = fpsValue,
        )
    }

    // ------------------------------------------------------------------- views

    /**
     * Interpolated player views for the current frame.
     *
     * Remote bodies are drawn `net.interpDelayMs` in the past and lerped between
     * the two snapshots bracketing that time, which hides jitter without adding
     * input latency to the local player — who is drawn from the predictor rather
     * than from a snapshot, so your own movement never lags the input.
     */
    fun renderViews(nowMs: Long): List<PlayerView> {
        val latest = snapshots.lastOrNull() ?: return emptyList()
        val previous = if (snapshots.size >= 2) snapshots.elementAt(snapshots.size - 2) else null

        var blend = 0.0
        if (previous != null) {
            val targetMs = nowMs - content.tuning.net.interpDelayMs.toLong()
            val span = (latest.receivedAtMs - previous.receivedAtMs).coerceAtLeast(1L)
            blend = ((targetMs - previous.receivedAtMs).toDouble() / span).coerceIn(0.0, 1.0)
        }

        views.clear()
        val live = HashSet<String>(latest.players.size * 2)
        for (p in latest.players) {
            live.add(p.i)
            val view = viewPool.getOrPut(p.i) { PlayerView() }
            val character = content.character(p.c)
            view.id = p.i
            view.name = p.n
            view.team = p.team
            view.character = p.c
            view.palette = character.palette
            view.build = character.build
            view.twitch = character.twitch
            view.local = p.i == myId

            if (view.local && p.alive) {
                val body = predictor.body
                view.x = body.x
                view.y = body.y
                view.vx = body.vx
                view.vy = body.vy
                view.aim = body.aim
                view.facing = body.facing
                view.onGround = body.onGround
                view.jetting = body.jetting
            } else if (view.local) {
                // Dead: show the body where the server left it, not where our
                // prediction would keep dragging it.
                view.x = p.x
                view.y = p.y
                view.vx = 0.0
                view.vy = 0.0
                view.aim = p.a
                view.facing = p.f
                view.onGround = false
                view.jetting = false
            } else {
                val base = previous?.players?.firstOrNull { it.i == p.i }
                if (base != null && blend > 0.0 && blend < 1.0) {
                    view.x = SimCore.lerp(base.x, p.x, blend)
                    view.y = SimCore.lerp(base.y, p.y, blend)
                    view.vx = SimCore.lerp(base.vx, p.vx, blend)
                    view.vy = SimCore.lerp(base.vy, p.vy, blend)
                    view.aim = base.a + SimCore.angleDelta(base.a, p.a) * blend
                } else {
                    view.x = p.x
                    view.y = p.y
                    view.vx = p.vx
                    view.vy = p.vy
                    view.aim = p.a
                }
                view.facing = p.f
                view.onGround = p.onGround
                view.jetting = p.jetting
            }

            view.hp = p.hp
            view.shield = p.sh
            view.alive = p.alive
            view.reloading = p.reloading
            view.protectedNow = p.protectedNow
            view.spectator = p.spectator
            view.weaponId = p.w
            view.slot = p.s
            view.kills = p.k
            view.deaths = p.d
            view.score = p.sc
            view.respawnIn = p.rd
            view.jetFuel = p.j
            view.grenades = p.g
            view.mag = p.m
            view.reserve = p.rr
            view.ping = p.pg
            views.add(view)
        }

        // Forget pooled views and walk phases for players who left.
        if (viewPool.size > live.size + 8) {
            val it = viewPool.keys.iterator()
            while (it.hasNext()) if (it.next() !in live) it.remove()
        }
        walkPhase.keys.retainAll(live)
        return views
    }

    fun bullets(): List<BulletSnap> = snapshots.lastOrNull()?.bullets ?: emptyList()

    fun pickups(): List<PickupSnap> = snapshots.lastOrNull()?.pickups ?: emptyList()

    /** Flags from the newest snapshot; empty outside capture the flag. */
    fun flags(): List<FlagSnap> = snapshots.lastOrNull()?.flags ?: emptyList()

    fun latestState(): SnapshotFrame? = snapshots.lastOrNull()

    fun character(id: String?): Character = content.character(id)

    companion object {
        /** 10.0.2.2 is the host machine as seen from the Android emulator. */
        const val DEFAULT_SERVER = "ws://10.0.2.2:8080/ws"

        /** Accepts ws://, wss://, http(s):// or a bare host and returns a /ws URL. */
        fun normaliseUrl(raw: String): String? {
            var s = raw.trim()
            if (s.isEmpty()) return null
            s = when {
                s.startsWith("ws://") || s.startsWith("wss://") -> s
                s.startsWith("https://") -> "wss://" + s.removePrefix("https://")
                s.startsWith("http://") -> "ws://" + s.removePrefix("http://")
                else -> "ws://$s"
            }
            val authorityEnd = s.indexOf("//") + 2
            if (authorityEnd > 1 && !s.substring(authorityEnd).contains('/')) s += "/ws"
            return s
        }
    }
}
