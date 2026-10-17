package com.milofit.arena.net

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.milofit.arena.data.GameInfo
import com.milofit.arena.game.PlayerInput
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

enum class ConnStatus { IDLE, CONNECTING, CONNECTED, DISCONNECTED, CLOSED }

/**
 * WebSocket client: connection lifecycle, reconnection, ping measurement and
 * fan-out of server messages to plain callbacks. Mirrors web/src/net.js.
 *
 * Every callback fires on the main thread, so callbacks are safe to write
 * straight into Compose state without extra dispatching.
 */
class GameClient(private val url: String) {

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)     // no read timeout: the socket is idle between snapshots
        .writeTimeout(10, TimeUnit.SECONDS)
        .pingInterval(15, TimeUnit.SECONDS)        // keeps NAT/proxy mappings alive
        .retryOnConnectionFailure(true)
        .build()

    private val main = Handler(Looper.getMainLooper())

    private var socket: WebSocket? = null
    private var joinRequest: JoinReq? = null
    private var reconnectAttempts = 0
    private var manualClose = false
    private var connectTimeout: Runnable? = null
    private var pendingPingTs = 0L

    var status: ConnStatus = ConnStatus.IDLE
        private set
    var rttMs: Int = 0
        private set
    var you: You? = null
        private set
    var room: RoomInfo? = null
        private set
    var roster: Roster? = null
        private set
    var gameInfo: GameInfo? = null
        private set

    var onStatus: ((ConnStatus) -> Unit)? = null
    var onOpen: (() -> Unit)? = null
    var onWelcome: ((WelcomeMsg) -> Unit)? = null
    var onRoom: ((RoomInfo) -> Unit)? = null
    var onRoster: ((Roster) -> Unit)? = null
    var onState: ((StateMsg) -> Unit)? = null
    var onEvents: ((List<GameEvent>) -> Unit)? = null
    var onChat: ((ChatMsg) -> Unit)? = null
    var onServerError: ((ErrorMsg) -> Unit)? = null

    // -------------------------------------------------------------- lifecycle

    fun connect() {
        if (status == ConnStatus.CONNECTING || status == ConnStatus.CONNECTED) return
        manualClose = false
        setStatus(ConnStatus.CONNECTING)

        val request = Request.Builder().url(url).build()
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                main.post { handleOpen(webSocket) }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                main.post { handleMessage(text) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                main.post { handleClosed() }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                main.post { handleClosed() }
            }
        }

        socket = try {
            http.newWebSocket(request, listener)
        } catch (err: Exception) {
            setStatus(ConnStatus.DISCONNECTED)
            scheduleReconnect()
            null
        }

        val timeout = Runnable {
            if (status != ConnStatus.CONNECTING) return@Runnable
            try {
                socket?.cancel()
            } catch (_: Exception) {
                // ignored: the socket is already gone
            }
            handleClosed()
        }
        connectTimeout = timeout
        main.postDelayed(timeout, CONNECT_TIMEOUT_MS)
    }

    fun close() {
        manualClose = true
        stopPinging()
        connectTimeout?.let { main.removeCallbacks(it) }
        connectTimeout = null
        try {
            socket?.close(1000, "client closed")
        } catch (_: Exception) {
            // ignored
        }
        socket = null
        setStatus(ConnStatus.CLOSED)
    }

    private fun handleOpen(webSocket: WebSocket) {
        connectTimeout?.let { main.removeCallbacks(it) }
        connectTimeout = null
        reconnectAttempts = 0
        socket = webSocket
        setStatus(ConnStatus.CONNECTED)
        startPinging()
        onOpen?.invoke()
        // Re-send the join so a reconnect lands the player back in the same room
        // with the same callsign instead of dumping them in the lobby.
        joinRequest?.let { send(it, JoinReq.serializer()) }
    }

    private fun handleClosed() {
        connectTimeout?.let { main.removeCallbacks(it) }
        connectTimeout = null
        stopPinging()
        socket = null
        if (manualClose) {
            setStatus(ConnStatus.CLOSED)
            return
        }
        setStatus(ConnStatus.DISCONNECTED)
        scheduleReconnect()
    }

    private fun scheduleReconnect() {
        if (manualClose) return
        reconnectAttempts += 1
        val delay = minOf(8000L, 600L * reconnectAttempts)
        main.postDelayed({ if (!manualClose) connect() }, delay)
    }

    private fun setStatus(next: ConnStatus) {
        if (status == next) return
        status = next
        onStatus?.invoke(next)
    }

    // ------------------------------------------------------------------- ping

    private val pingTick = object : Runnable {
        override fun run() {
            if (status != ConnStatus.CONNECTED) return
            pendingPingTs = SystemClock.elapsedRealtime()
            send(PingReq(ts = pendingPingTs), PingReq.serializer())
            main.postDelayed(this, PING_PERIOD_MS)
        }
    }

    private fun startPinging() {
        stopPinging()
        main.postDelayed(pingTick, PING_PERIOD_MS)
    }

    private fun stopPinging() {
        main.removeCallbacks(pingTick)
    }

    // --------------------------------------------------------------- outbound

    private fun <T> send(value: T, serializer: KSerializer<T>): Boolean {
        val ws = socket ?: return false
        return try {
            ws.send(Protocol.json.encodeToString(serializer, value))
        } catch (_: Exception) {
            false
        }
    }

    fun join(
        name: String,
        character: String,
        roomId: String,
        team: String = "auto",
        role: String = "raider",
        format: String = "1v1",
        roleMode: String = "roles",
        gravityMode: String = "normal",
        mapId: String? = null,
        modeId: String? = null,
    ): Boolean {
        val req = JoinReq(
            name = name, character = character, role = role, room = roomId, team = team,
            format = format, roleMode = roleMode, gravityMode = gravityMode,
            map = mapId, mode = modeId,
        )
        joinRequest = req
        return send(req, JoinReq.serializer())
    }

    fun sendInput(input: PlayerInput, seq: Int): Boolean =
        send(InputReq.of(input, seq, rttMs), InputReq.serializer())

    fun sendChat(text: String): Boolean = send(ChatReq(text = text), ChatReq.serializer())

    fun requestTeam(team: String): Boolean = send(TeamReq(team = team), TeamReq.serializer())

    fun requestSettings(
        mapId: String? = null,
        modeId: String? = null,
        format: String? = null,
        roleMode: String? = null,
        gravityMode: String? = null,
    ): Boolean = send(
        SettingsReq(map = mapId, mode = modeId, format = format, roleMode = roleMode, gravityMode = gravityMode),
        SettingsReq.serializer(),
    )

    fun requestStart(): Boolean = send(StartReq(), StartReq.serializer())

    /** Convenience: is this client id the room host? */
    fun isHost(id: String?): Boolean = id != null && room?.host == id

    // ---------------------------------------------------------------- inbound

    private fun handleMessage(raw: String) {
        val parsed = Protocol.typeAndBody(raw) ?: return
        try {
            dispatch(parsed.first, parsed.second)
        } catch (_: Exception) {
            // A malformed message must never take the client down; the socket
            // stays open and the next snapshot is very likely fine.
        }
    }

    private fun dispatch(type: String, obj: JsonObject) {
        val json = Protocol.json
        when (type) {
            MsgType.WELCOME -> {
                val msg = json.decodeFromJsonElement(WelcomeMsg.serializer(), obj)
                msg.you?.let { you = it }
                msg.room?.let { room = it }
                msg.roster?.let { roster = it }
                onWelcome?.invoke(msg)
                msg.roster?.let { onRoster?.invoke(it) }
            }

            MsgType.ROOM -> {
                val msg = json.decodeFromJsonElement(RoomMsg.serializer(), obj)
                room = msg.room
                onRoom?.invoke(msg.room)
            }

            MsgType.ROSTER -> {
                val msg = json.decodeFromJsonElement(RosterMsg.serializer(), obj)
                roster = msg.roster
                msg.room?.let { room = it }
                onRoster?.invoke(msg.roster)
            }

            MsgType.STATE -> {
                onState?.invoke(json.decodeFromJsonElement(StateMsg.serializer(), obj))
            }

            MsgType.EVENTS -> {
                val msg = json.decodeFromJsonElement(EventsMsg.serializer(), obj)
                if (msg.events.isNotEmpty()) onEvents?.invoke(msg.events)
            }

            MsgType.CHAT -> {
                onChat?.invoke(json.decodeFromJsonElement(ChatMsg.serializer(), obj))
            }

            MsgType.PONG -> {
                val msg = json.decodeFromJsonElement(PongMsg.serializer(), obj)
                val sent = msg.ts
                if (sent != null && sent == pendingPingTs) {
                    val sample = (SystemClock.elapsedRealtime() - sent).toInt().coerceIn(0, 5000)
                    // Smoothed so a single stalled tick does not jump the readout.
                    rttMs = if (rttMs > 0) (rttMs * 0.7 + sample * 0.3).toInt() else sample
                }
            }

            MsgType.ERROR -> {
                onServerError?.invoke(json.decodeFromJsonElement(ErrorMsg.serializer(), obj))
            }

            else -> Unit // forward-compatible: ignore whatever we do not know yet
        }
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 8_000L
        const val PING_PERIOD_MS = 1_000L
    }
}
