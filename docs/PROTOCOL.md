# MILOFIT Arena — wire protocol v1

One WebSocket endpoint carries everything. The web client and the Android client
speak the identical protocol, which is what makes a phone and a laptop able to
share a match.

* **Transport** — WebSocket, `ws://host:port/ws` (or `wss://` behind TLS).
* **Encoding** — JSON, one object per frame. Every message has a `"t"` string that
  selects its shape. There is no polymorphic envelope and no schema negotiation.
* **Version** — `shared/game-data/index.json` → `game.protocolVersion` = **1**.
  The server reports it on `/healthz`.
* **Authoritative model** — clients send **inputs only**. They never send a
  position, a hit, a kill or a score. The server simulates at 60 Hz and broadcast
  snapshots at 20 Hz; the client predicts its own body locally and is corrected by
  the snapshots.

Why single-letter keys: a `state` message carries every player, every bullet and
every pickup, and it is sent 20 times a second to every socket. Field names are
where nearly all of the bandwidth goes, so `x`/`y`/`vx`/`vy` stay short and only
the prose fields (`name`, `text`) are spelled out.

---

## 1. Connection lifecycle

```
client                                  server
  │  ── TCP + WebSocket upgrade (/ws) ──▶ │
  │  ◀── welcome { game, maps, modes,     │   sent on connect, before any join.
  │                rooms, serverTime }    │   `you` is absent.
  │                                        │
  │  ── join { name, character, room,      │
  │            team } ────────────────────▶│
  │  ◀── welcome { you, room, roster }     │   the join reply
  │  ◀── roster { roster, host, room }     │
  │                                        │
  │  ── input { ... } ────────────────────▶│   20–60/s per client
  │  ◀── state { tick, players, … }        │   20/s
  │  ◀── events { events: [ … ] }          │   whenever something happened
  │  ◀── chat { from, name, text }         │
  │  ── ping { ts } ──────────────────────▶│   1/s
  │  ◀── pong { ts, serverTime }           │
```

If a socket drops, the client reconnects with backoff and **re-sends `join`**,
which puts the player back in the same room under the same callsign.

### HTTP endpoints (same port)

| Path | Purpose |
| --- | --- |
| `/` and `/…` | the web client (`web/`), with an SPA fallback for unknown paths |
| `/shared/…` | the shared ES modules (`shared/sim-core.js`) |
| `/api/content` | the whole content pack as one JSON document |
| `/healthz` | `{ ok, protocolVersion, rooms, players, … }` |

---

## 2. Client → server

All field names are validated; anything unknown or out of range is dropped or
clamped rather than rejected (`server/src/protocol.js`).

### `join`

```json
{ "t": "join", "name": "Ada", "character": "recruit", "role": "raider",
  "room": "A7K2QX", "team": "auto", "format": "1v1",
  "roleMode": "roles", "gravityMode": "normal", "map": "arena_core", "mode": "tdm" }
```

| Field | Rules |
| --- | --- |
| `name` | letters/digits/space/`_.-[]` only, collapsed whitespace, max `limits.nameMaxLength` (16); falls back to `Recruit` |
| `character` | `^[a-z0-9_]{1,24}$`, must exist in `characters.json`; ignored if invalid |
| `room` | existing room code; blank creates a unique six-character LAN code |
| `team` | `red` / `blue` / anything else → `auto` (auto-balance) |
| `role` | `raider`, `commander`, `scout`, `breacher`, `medic`; defaults to `raider` |
| `format` | `1v1`, `2v2`, or `4v4`; default `1v1` |
| `roleMode` | `roles` or `free`; free mode assigns `attacker` to everyone |
| `gravityMode` | `normal`, `lunar`, or `zero` |
| `map`, `mode` | initial host room settings, validated against shared content |

Room capacity is format-specific: 2 / 4 / 8 players for 1v1 / 2v2 / 4v4. An
overflow is refused with `error { code: "room_full" }`. Joining again moves the
client out of its previous room. Rooms with no sockets are reaped after 15 s.

### `input`

```json
{
  "t": "input",
  "x": 0.5, "jump": false, "jet": true, "fire": true,
  "aim": { "x": 1800, "y": 620 },
  "actions": ["reload", "switch:1"],
  "seq": 412, "rtt": 48
}
```

| Field | Meaning |
| --- | --- |
| `x` | strafe axis, clamped to `[-1, 1]` |
| `jump` | the jump/jet button. Held in the air = jetpack |
| `jet` | the same, from Android's dedicated jetpack button |
| `fire` | held fire. Automatic weapons repeat at their `rpm`; there is **no** semi-auto gate, the cooldown is the only limit |
| `aim.x` / `aim.y` | a **world point** the player is aiming at (flat `ax`/`ay` also accepted). Clamped to ±1e6. The server derives the angle itself with `atan2`, so a client cannot assert "I hit that player" |
| `actions` | whitelisted one-shots: `reload`, `melee`, `grenade`, `switch:0`, `switch:1`. Anything else is dropped; at most 6 per frame |
| `seq` | client-side tick counter, echoed by nothing today but kept for future rollback |
| `rtt` | the client's own round-trip estimate, clamped to `[0, 2000]` |

Rate limiting is a token bucket: 240 tokens, refilled at 240/s (4 per 60 Hz tick).
Exhausting it produces `error { code: "rate_limited" }`. At 60 inputs/s plus pings
a client sits far below the cap; the bucket only catches floods.

### `chat`

```json
{ "t": "chat", "text": "gg" }
```

Control characters are stripped, the length is capped at
`limits.chatMaxLength` (120), and messages are limited to one per
`limits.chatCooldownSeconds` (1.5 s). Empty messages are ignored silently.

### `team`

```json
{ "t": "team", "team": "blue" }
```

`red` / `blue` only. Requests an explicit side; `auto` returns the player to
auto-balancing. Rejected outside a team mode.

### `settings`

```json
{ "t": "settings", "map": "caverns", "mode": "tdm" }
```

Host only, lobby state only. Either field may be omitted to leave it alone. Both
are re-validated against the content pack, so an unknown id is ignored rather
than pointed at a missing map.

### `start`

```json
{ "t": "start" }
```

Host only. Skips the warm-up countdown and starts the match immediately.
A non-host gets `error { code: "not_host" }`.

### `ping`

```json
{ "t": "ping", "ts": 1712345678901 }
```

`ts` is an opaque client timestamp. It comes straight back on the `pong`.

### `hello`

```json
{ "t": "hello" }
```

Returns a fresh `welcome`. Used by the web client to refresh the room list without
reconnecting.

---

## 3. Server → client

### `welcome`

Sent on connect (no `you`) and again in reply to `join` (with `you`).

```json
{
  "t": "welcome",
  "you":   { "id": "9f3ac21b", "name": "Ada", "character": "recruit", "room": "lobby", "host": true },
  "room":  { …see room… },
  "roster": { …see roster… },
  "game":  { "id": "milofit-arena", "title": "MILOFIT Arena", "protocolVersion": 1 },
  "maps":  ["arena_core", "foundry", "caverns", "outpost", "outpost_ridge"],
  "modes": [{ "id": "dm", "name": "Deathmatch", "teams": false, "flags": false, "teamScoreFromKills": true }],
  "rooms": [{ "id": "lobby", "players": 3, "max": 12, "mapId": "arena_core", "modeId": "dm", "state": "lobby" }],
  "serverTime": 1712345678901
}
```

Both forms carry the same content summary — the pre-join greeting and the
post-join reply — so a client that joins immediately still learns the map list
and the mode rules:

| Key | Notes |
| --- | --- |
| `game` | title + `protocolVersion` |
| `maps` | map ids |
| `modes` | `id`, `name`, `teams`, `flags`, `teamScoreFromKills` |
| `rooms` | lobby list (greeting only; the join reply carries `you`/`room`/`roster`) |

`modes[].flags` says the mode carries flags, and `teamScoreFromKills: false` says
the team score counts captures rather than kills — enough for a lobby to explain
`ctf` before the full content pack is fetched from `/api/content`.

When the host role moves, the server also sends
`{ "t": "welcome", "you": null, "host": "9f3ac21b", "reassigned": true }` to
everyone in the room.

### `room`

The room's settings, re-sent whenever they change.

```json
{
  "t": "room",
  "room": {
    "id": "a7k2qx", "mapId": "arena_core", "modeId": "tdm", "format": "1v1",
    "roleMode": "roles", "gravityMode": "normal", "state": "lobby",
    "host": "9f3ac21b",
    "map":  { "id": "arena_core", "name": "Arena Core", "size": { "width": 2400, "height": 1200 } },
    "mode": { "id": "dm", "name": "Deathmatch", "teams": false, "scorePerKill": 1, "scorePerAssist": 0.25 },
    "maxPlayers": 2, "scoreLimit": 10, "timeLimitSeconds": 180
  }
}
```

`state` is one of `lobby`, `countdown`, `playing`, `ended`.

### `roster`

Sent when membership, teams, characters, names or the match state change — not on
a timer.

```json
{
  "t": "roster",
  "host": "9f3ac21b",
  "room": { …same shape as room… },
  "roster": {
    "id": "lobby", "mapId": "arena_core", "modeId": "dm", "state": "lobby",
    "players": [
      { "id": "9f3ac21b", "name": "Ada", "team": "red", "character": "recruit",
        "alive": true, "spectator": false, "kills": 4, "deaths": 3,
        "score": 4.25, "ping": 42 }
    ]
  }
}
```

### `state`

The snapshot. 20 Hz. This is the only message that carries positions.

```json
{
  "t": "state",
  "tick": 18320, "time": 305.33,
  "state": "playing", "mapId": "arena_core", "mode": "tdm", "teams": true,
  "format": "1v1", "roleMode": "roles", "gravityMode": "normal", "gravityScale": 1,
  "timeLeft": 118, "timeLimitSeconds": 180, "countdown": 0, "scoreLimit": 10,
  "scores": { "ffa": 12 },
  "players": [ … ],
  "bullets": [ … ],
  "pickups": [ … ],
  "flags": [ … ]
}
```

`scores` is `{ red, blue }` in a team mode and `{ ffa }` (the leader's score)
otherwise. In a flag mode `scores.red` / `scores.blue` count **captures**, and
`scoreLimit` is the capture limit rather than a kill limit.

#### Player

| Key | Type | Notes |
| --- | --- | --- |
| `i` | string | client id (8 hex chars) |
| `n` | string | display name |
| `tm` | string | `red`, `blue` or `ffa` |
| `c` | string | character id |
| `r` | string | gameplay role (`attacker` in role-free matches) |
| `mh` | int | this role's max health |
| `mj` | int | this role's max jet fuel |
| `x`, `y` | number | **centre** of the body, rounded to 1 dp |
| `vx`, `vy` | number | px/s, 1 dp |
| `hp` | int | 0…`maxHealth` |
| `sh` | int | shield |
| `f` | int | facing, `1` or `-1` |
| `a` | number | aim angle in radians, 2 dp |
| `fl` | int | bitfield, see below |
| `s` | int | selected slot (0 or 1) |
| `w` | string? | current weapon id (`null` if none) |
| `m` | int | rounds in the magazine, `-1` when the weapon has no ammo |
| `rr` | int | reserve rounds, `-1` likewise |
| `rl` | number | **seconds remaining** of the current reload, `0` when not reloading |
| `j` | number | jetpack fuel, rounded to an integer |
| `g` | int | grenades carried |
| `k`, `d` | int | kills, deaths |
| `sc` | number | score |
| `rd` | number | seconds until respawn, `0` while alive |
| `pg` | int | ping in ms as measured by the server |

`fl` flags:

| Bit | Value | Meaning |
| --- | --- | --- |
| 0 | 1 | alive |
| 1 | 2 | on ground |
| 2 | 4 | jetpack firing this tick |
| 3 | 8 | reloading |
| 4 | 16 | spawn protection |
| 5 | 32 | spectator |

#### Bullet / grenade

| Key | Type | Notes |
| --- | --- | --- |
| `i` | int | projectile id |
| `x`, `y` | number | position, 1 dp |
| `k` | string | `bullet`, `flame`, `projectile` or `grenade` |
| `w` | string? | weapon id |
| `o` | string | owner client id |
| `a` | number | heading in radians |

#### Pickup

| Key | Type | Notes |
| --- | --- | --- |
| `i` | int | pickup id |
| `x`, `y` | number | position |
| `t` | string | `health`, `shield`, `ammo`, `weapon` |
| `w` | string? | weapon id for `weapon` pickups |

Inactive (respawning) pickups are omitted from the snapshot entirely.

#### Flag

Only present in a mode with `flags: true` — currently `ctf`. The array is empty
in every other mode, so a client can always read it.

| Key | Type | Notes |
| --- | --- | --- |
| `tm` | string | `red` or `blue` — whose flag this is |
| `x`, `y` | number | current position: the base while at home, else the flag's own position |
| `bx`, `by` | number | that team's home base |
| `c` | string? | carrying client id, `null` when the flag is loose or at home |
| `a` | int | `1` only while the flag is standing at its base |

That gives three states: `a == 1` is **at home**, `c != null` is **carried**,
and neither is **lying on the ground** — a dropped flag returns to base by
itself after `tuning.ctf.returnSeconds`. A client that wants to draw a carrier
simply looks the id up among the snapshot's players.

### `events`

A batch of things that happened since the previous tick. Two audiences:

* **shared** events are broadcast to the whole room;
* **targeted** events carry `to: <clientId>` and are sent only to that player.

The batch is sent on the tick the event was raised, so latency is at most one
60 Hz step.

| `type` | Audience | Fields |
| --- | --- | --- |
| `fire` | shared | `id, x, y, angle, weapon` |
| `impact` | shared | `x, y, weapon, flesh` |
| `explosion` | shared | `x, y, radius, weapon` |
| `throw` | shared | `id, x, y` |
| `melee` | shared | `id, x, y, angle` |
| `spawn` | shared | `id, x, y` |
| `pickup` | shared | `id, x, y, pickup, pickupType, weapon` |
| `capture` | shared | `team, id, name, score, x, y` |
| `flag` | shared | `action, team, x, y` (+ `id, name` when `action: "taken"`) |
| `kill` | shared | `killer, killerName, killerTeam, victim, victimName, victimTeam, weapon, assist, streak` |
| `reload` | shared | `id, weapon, duration` |
| `reloaded` | shared | `id, weapon` |
| `countdown` | shared | `seconds` |
| `matchStart` | shared | `mapId, mode` |
| `matchEnd` | shared | `reason, winner, teams, scoreboard` |
| `lobby` | shared | — (the match returned to the lobby) |
| `hitMark` | **targeted** | `to, x, y, amount, shield, lethal` |
| `hurt` | **targeted** | `to, amount, lethal` |

`reason` is `score` or `time`. `winner` is a team name in a team mode and a client
id otherwise (it is `null` for a draw). `teams` is `{ red, blue }` or `null`.
`scoreboard` is an array of roster players with `streak` / `bestStreak` added.

`flag.action` is `taken`, `dropped` or `returned` (`returned` also covers the
touch-to-return case). `capture.score` is the capturing team's total after the
capture, so a client can show the new standing without waiting for a snapshot.

### `chat`

```json
{ "t": "chat", "from": "9f3ac21b", "name": "Ada", "team": "red", "text": "gg", "at": 1712345678901 }
```

System messages use `from: "system"`, `name: "system"`, `team: "system"`.

### `pong`

```json
{ "t": "pong", "ts": 1712345678901, "serverTime": 1712345678912 }
```

`ts` is echoed verbatim; the client computes `now - ts` for its RTT readout. The
Android client only accepts a pong whose `ts` matches the ping it last sent.

### `error`

```json
{ "t": "error", "code": "room_full", "message": "room \"lobby\" is full" }
```

| Code | Cause |
| --- | --- |
| `bad_message` | not a JSON object, or no string `t` |
| `unknown_type` | unrecognised `t` |
| `rate_limited` | token bucket exhausted |
| `room_full` | the selected format's slots (2 / 4 / 8) are already filled |
| `not_host` | a non-host sent `start` |
| `not_enough_players` | fewer than two players in an online room; solo practice is allowed |
| `server_error` | a handler threw; the socket stays open |

Errors are advisory. The socket is not closed; a client should surface `message`
and carry on.

---

## 4. Client-side prediction contract

The reason the protocol carries no positions from the client is that both clients
run the server's own movement code locally:

| Platform | File | Status |
| --- | --- | --- |
| Server | `shared/sim-core.js` → `server/src/sim.js` | authoritative |
| Web | `web/src/predict.js` imports `shared/sim-core.js` | **the same file** |
| Android | `android/…/game/SimCore.kt` | a hand-written mirror |

The Android port is verified by `app/src/test/…/SimCoreTest.kt`, which replays a
600-tick trajectory generated by the JavaScript core and asserts the Kotlin port
lands within 0.05 px of it. Change `shared/sim-core.js` and that test fails until
`SimCore.kt` is updated to match — which is the point.

Reconciliation is deliberately simple: no input acks, no rewind-and-replay.

1. Any input the client sends is applied to the predicted body immediately.
2. On every snapshot, the local body is compared with the authoritative one.
3. Error ≤ 1 px — ignored.
4. Error ≤ `net.reconcilePx` (26 px) — corrected with a proportional rate of
   `clamp(err/limit, 0, 1) * 6 * dt` per frame, so a small drift is smoothed away
   rather than snapped.
5. Error > 4 × `net.reconcilePx` — the body is hard-snapped (respawn, teleport,
   explosion knockback).
6. Server-owned fields always win: `onGround` comes from the `fl` bitfield, fuel
   from `j`, and a dead player is pinned where the server put them.

Remote players are drawn `net.interpDelayMs` (110 ms) in the past and lerped
between the two snapshots bracketing that instant, including a shortest-path
angle blend. The local player is never drawn from a snapshot, so your own
movement never lags your input.

---

## 5. Compatibility rules

* Adding a field is a **non-breaking** change: both clients ignore unknown keys
  (`ignoreUnknownKeys = true`).
* Removing or renaming a field, or changing its type, **is** breaking — bump
  `game.protocolVersion` in `shared/game-data/index.json`.
* New `events` types are safe to add: an unknown `type` is skipped client-side.
* New `t` values are safe to add server→client. A new client→server `t` from an
  old client cannot happen, and an unknown one yields `unknown_type`.
* Tuning values are **not** versioned. If you change `tuning.json`, both clients
  pick it up on their next load; ship the content and both clients together, or
  prediction will drift by however much the constants changed.
