# MILOFIT Arena — game design

A side-view jetpack arena shooter. Players share a LAN room, fly with limited
jetpack fuel, and fight over weapon and health pickups in 1v1, 2v2, or 4v4 matches.

This document covers what the game *is* and the numbers behind it. The numbers
themselves live in `shared/game-data/tuning.json`, which the server and both
clients read, so this file is the explanation rather than the source of truth.

Everything here — weapons, characters, maps, sounds, art — is original to this
project. There are no third-party assets (see "Provenance" in the root README).

---

## 1. The pitch

* **Fast, floaty, readable.** Movement is the skill: you cross the map by
  chaining jumps and jetpack burns, not by running.
* **One authoritative arena, two clients.** A phone and a laptop play the same
  match with the same physics because movement is one shared function.
* **Small, learnable kit.** Ten weapons, five maps, three match modes, and three
  squad sizes. Depth comes from the maps and fuel economy, not unlock grinding.
* **No grind.** Roles define a small match profile; all players can select them
  immediately, and weapons are available in the arena.

---

## 2. Movement

The feel of the game is these eight numbers:

| Constant | Value | Why |
| --- | --- | --- |
| `player.width` × `height` | 30 × 46 | narrow enough to thread gaps, tall enough to read at a glance |
| `player.gravity` | 2000 px/s² | heavy; falling is a commitment |
| `player.runSpeed` | 285 px/s | noticeably slower than you can fly, so the floor is not safe |
| `player.jumpVelocity` | −620 px/s | one jump clears ~20 px more than a body height |
| `player.maxFallSpeed` | 1500 px/s | terminal velocity, so a long drop is predictable |
| `jetpack.thrust` | −2200 px/s² | beats gravity by ~10 %, so hovering costs fuel |
| `jetpack.maxUpSpeed` | −540 px/s | you ascend slower than you fall |
| `jetpack.horizontalThrust` | 340 px/s² | air control: enough to dodge, not enough to ignore gravity |

Ground acceleration is 3600 px/s²; in the air it is 1900 px/s². Letting go of the
stick applies ground friction of `0.0009^dt` — effectively an instant stop — or,
in the air, `0.55^dt`, a gentler drag that preserves momentum.

### Fuel is the whole economy

* `jetpack.maxFuel` = 100, drained at `44/s` → **2.27 s** of continuous thrust.
* Regeneration is `26/s` → **3.85 s** from empty to full, and only when either
  you are on the ground, or you have been off the button for longer than
  `rechargeDelaySeconds` (0.45 s).

That last clause is deliberate and is the one rule the code comments call out.
Without the `!upHeld` guard, holding the button with zero fuel would still count
as "idling" and let you hover forever at the cost of nothing. The rule is:
**no free altitude.** Once the tank is dry you are committed to the drop unless
you touch something solid.

The practical consequence is a rhythm — burn, coast, land, burn — that makes maps
with platforms much stronger than maps with open air. It also means a player who
has just flown across the arena is at their most vulnerable when they arrive.

### Jump and jet are the same button

Tap on the ground to jump; hold in the air to burn fuel. They are separate fields
on the wire (`jump` and `jet`) only because the Android client has a dedicated
jetpack button bound to `jet`. Any client may set either.

### Collision

Bodies are axis-aligned boxes storing their **centre**. Movement resolves one axis
at a time (X first, then Y) against the map's solids, which is why a diagonal
slide along a wall works and why you cannot clip a corner.

`oneWay` platforms are jump-through catwalks: ignored entirely on the X axis, and
on the Y axis they only stop a body that is moving **down** whose feet were
already above the platform's top edge before the step. Fly up through one freely;
land on it from above. This is what makes the arenas three-dimensional without
needing a z axis.

---

## 3. Weapons

Ten weapons, no unlocks, all found on the map. Damage is per bullet unless said
otherwise. Everything below is `shared/game-data/weapons.json`.

| Weapon | Slot | Kind | Dmg | RPM | Auto | Mag / reserve | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Basher** | melee | melee | 44 | — | — | ∞ | 62 px cone, 55° half-angle, 0.5 s cooldown, 210 knockback |
| **Sidearm** | sidearm | bullet | 15 | 330 | no | 12 / 120 | the spawn weapon; 1.4° spread |
| **Ripper** | primary | bullet | 9 | 800 | yes | 40 / 240 | 3.2° spread, 18 knockback |
| **Bulldog** | primary | bullet | 14 | 560 | yes | 30 / 210 | the all-rounder; 2° spread |
| **Boomstick** | primary | bullet | 10 ×8 | 72 | no | 6 / 48 | 11° spread; ~80 damage point blank, ~20 at range |
| **Longshot** | primary | bullet | 72 | 44 | no | 5 / 30 | 0.25° spread, 2400 px/s; two shots to kill |
| **Shredder** | primary | bullet | 8 | 1100 | yes | 75 / 300 | 6.5° spread; suppression, not precision |
| **Flamer** | primary | flame | 5 | 900 | yes | 120 / 360 | 520 px/s × 0.28 s ≈ **146 px** reach; 9° spread |
| **Frag** | grenade | projectile | 65 splash | 60 | no | 1 / 1 | 130 px blast, 1.9 s fuse, 42 % bounce |
| **Rocket** | primary | projectile | 88 splash | 40 | no | 1 / 5 | 145 px blast, no gravity drop |

Both explosives use `selfDamageFactor` 0.4, so shooting a wall at your feet hurts
you less than it hurts the person next to you — but it does hurt.

**Knockback** is a real mechanic, not decoration. A Longshot or a rocket will
push a player off a platform, and a rocket jump (fire down while falling) is a
legitimate way to cross a map at the cost of most of your health.

### Damage model

* Shield absorbs damage first and, per `tuning.player.shieldDecayPerSecond`, does
  **not** decay on its own (`0`), so a shield pickup keeps working until it is
  spent.
* Health pickups restore 40, shields restore 35, and a consumed pickup respawns
  after `pickups.respawnSeconds` = 12.
* `player.friendlyFire` is `false`: in a team mode you cannot hurt your own side.
* Spawn protection lasts 1.5 s and is shown as a dashed ring.
* Death costs 3 s of respawn time.

### Melee

Melee ignores the ammo system entirely. It is a 62 px cone at a 55° half-angle
from the aim direction, on a 0.5 s cooldown, and it knocks the victim back hard.
Because there is no "ammo: none" magazine, the HUD shows `∞` — this is why the
snapshot sends `m` and `rr` of `-1` for a weapon with `ammo: "none"`.

---

## 4. Characters

Twelve characters, all cosmetic, all available from the start
(`shared/game-data/characters.json`). Each is a palette plus two modifiers:

* **`build`** (0.86 – 1.18) scales the drawn body only. It is *not* a hitbox
  change — the collision box is always `player.width × player.height`. A
  deliberate choice: cosmetic silhouettes should not be a balance lever, and a
  per-character hitbox would have to be mirrored in the Kotlin core.
* **`twitch`** (0.86 – 1.12) scales how lively the idle animation reads.

Art is drawn procedurally at runtime from these palettes — there is not a single
image file in the repository. The same palettes drive the web Canvas renderer and
the Android Compose renderer.

---

## 5. Maps

| Map | Size | Solids | Spawns | Pickups | Character |
| --- | --- | --- | --- | --- | --- |
| **Arena Core** | 2400 × 1200 | 22 | 9 | 13 | the default: a central pillar, two flanking catwalk stacks |
| **Foundry** | 2000 × 1100 | 19 | 6 | 13 | compact, industrial, close-range |
| **Caverns** | 2600 × 1300 | 22 | 6 | 15 | the largest; stalactites and vertical shafts |

Maps are plain JSON: `solids` (collision), `decorations` (drawn, no collision),
`spawnPoints` (`red` / `blue` / `any`) and `pickups` (`health`, `shield`, `ammo`,
`weapon`). `ambient` supplies the sky gradient, grid and glow colours.

A validator in `server/test/sim.js` enforces the two rules that make a map fair:

1. no pickup may be **buried inside a wall**;
2. every pickup must be **reachable by a player-sized box** (probed ±90 px
   vertically at that spot).

That check exists because it is exactly the mistake you make by hand when moving
a platform: the pickup stays where it was and ends up inside the new geometry.
Adding a map means adding it to `index.json`, and the validator then covers it.

---

## 6. Modes and match formats

Match format is separate from the scoring mode. `format` sets team size and the
format-specific capacity, score goal, clock, and respawn interval:

| Format | Capacity | Score goal | Clock | Respawn |
| --- | ---: | ---: | ---: | ---: |
| `1v1` | 2 | 10 | 3 min | 2.5 s |
| `2v2` | 4 | 25 | 5 min | 3 s |
| `4v4` | 8 | 30 | 5 min | 5 s |

Roles are enabled by default in 1v1 and 2v2, with **Raider** as the default
selection. 4v4 defaults to `roleMode: "free"`: everyone is an **Attacker** and
the team score is earned through eliminations. The host can switch the role mode
in the lobby. Role profiles are data-driven in `tuning.json`; the current first
pass differentiates max health, run speed, and jet fuel/drain.

`gravityMode` is shared room state: `normal`, `lunar`, or `zero`. Its scale is
published in each snapshot, so web prediction uses the same mutator as the server.
The supplied prototype's gravity ratios seed the playable variants; they are not
claimed to be values recovered from the Mini Militia APK.

Room IDs are six-character codes generated when the room field is blank. Share
the code with players on the same LAN; web and mobile browser clients join the
same WebSocket server and room.

### Scoring modes

Every mode scores `1` per kill and `0.25` per assist and ends on
`match.timeLimitSeconds` = 300 (5 minutes). What differs is what the *team*
score counts and when the match ends early.

| Id | Name | Teams | Team score counts | Ends early at |
| --- | --- | --- | --- | --- |
| `dm` | Deathmatch | no | free-for-all; the leader's score is shown as `scores.ffa` | 25 kills |
| `tdm` | Team Deathmatch | yes | kills + assists; friendly fire off | 25 kills |
| `ctf` | Capture the Flag | yes | **captures only** (`teamScoreFromKills: false`) | 3 captures |

The match ends when the score reaches the limit (`reason: "score"`) or the clock
hits zero (`reason: "time"`), whichever comes first. On a tie in a team mode the
`winner` is `null` and the result reads as a draw.

### Capture the flag

The mode is defined by four numbers in `tuning.ctf`:

| Value | Default | Meaning |
| --- | --- | --- |
| `captureLimit` | 3 | captures needed to win |
| `returnSeconds` | 20 | how long a dropped flag lies on the ground |
| `pickupRadius` | 34 | how close a body must be to take or return a flag |
| `captureRadius` | 46 | how close a carrier must be to their own base to score |

Bases come from the map's `flagBases` (`{ red: {x,y}, blue: {x,y} }`), and are
authored to coincide with the team spawn so that the existing spawn-reachability
check also guarantees they are clear of geometry and reachable.

The rules are the classic ones, chosen so a stalemate can always resolve:

* Touch the enemy flag to pick it up. You become visible carrying it — a captured
  flag rides its carrier rather than being hidden.
* You may only **capture** while your own flag is at its base. If your flag is
  out, you can still carry the enemy flag home, you just cannot score yet.
* A dropped flag (carrier died, or left) lies where it fell and **self-returns
  after `returnSeconds`**. Touching your own loose flag returns it immediately.
* **Kills score no team points in CTF** — they only drop flags, which is the
  pressure that breaks a stand-off between two carriers each holding the other's
  flag.
* An enemy *carrying* your flag does not block your capture; the stand-off is
  resolved by death or by the 20-second self-return, never by a deadlock.

`koth` and bots are **not implemented**. See the [roadmap](#9-roadmap).

---

## 7. Match flow

```
lobby ──(2+ online / 1 practice player)──▶ countdown 5s ──▶ playing ──▶ ended 10s ──▶ lobby
   ▲                                                              │
   └──────────────────────────────────────────────────────────────┘
```

* **lobby** — players join by six-character room code; the host picks format,
  role rules, gravity mutator, map and scoring mode; teams are auto-balanced.
  The roster is live and the server is authoritative even here.
* **countdown** — `match.warmupCountdownSeconds` = 5. Online formats wait for
  both sides to be represented; solo practice can start with one player. The host
  can force-start once the minimum is met.
  A `countdown` event fires each second so both clients can beep.
* **playing** — snapshots flow at 20 Hz, inputs are consumed at 60 Hz.
* **ended** — `match.postMatchSeconds` = 10 of scoreboard, then back to the lobby
  automatically. Nobody has to reconnect between rounds.

The host is simply the first client in the room, and the role moves on
automatically if they leave — the server sends a `welcome` with
`reassigned: true` when that happens.

---

## 8. Networking as a design constraint

The design leans on one shared simulation rather than on lag compensation, so a
few things are true by construction:

* **No client-authoritative anything.** The only way a bullet hurts you is that
  the *server* decided it did. A client cannot report a hit.
* **Aim is a point, not an angle.** Clients send a world position and the server
  derives the angle with `atan2`, so "aim snapping" is not expressible.
* **Prediction is cheap.** Because both clients run the server's movement rules,
  the local player never waits for a round trip to move. The cost is that
  `SimCore.kt` must be kept in step with `shared/sim-core.js`, which is what
  `SimCoreTest.kt` exists to enforce.
* **No input acks, no rewind.** Small errors are eased out, large ones snap. This
  is a scaffold-level decision documented in `docs/PROTOCOL.md`; full rewind and
  replay is the natural next step if the game ever needs it.

---

## 9. Roadmap

Deliberately *not* in this build, roughly in the order they would be worth doing:

1. **King of the hill** — the remaining classic mode. CTF is now implemented
   (see [Modes](#6-modes)) and proved out the flag/scoring hooks that KOTH needs;
   what is missing is the per-tick hill-ownership timer.
2. **Input acks + rewind-and-replay** — removes the last of the smoothing.
3. **Bots** — the server already owns the whole simulation, so a bot is a
   `PlayerInput` generator, nothing more.
4. **Bolt-on cosmetics** — the palette system means a new skin is four colours,
   not an asset pipeline.
5. **A real map editor** — the map format is already the editor's output format.
