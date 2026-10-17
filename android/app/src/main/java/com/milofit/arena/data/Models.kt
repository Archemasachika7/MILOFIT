package com.milofit.arena.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Content models mirroring the JSON files in shared/game-data.
 *
 * NOTE: Kotlin nests block comments, so never write a "slash-star" pair inside
 * a comment — the old wording here ("shared/game-data" + a glob) opened a nested
 * comment and silently swallowed every declaration to the end of the file.
 *
 * Numbers are Double on purpose. The authoritative simulation runs in JavaScript,
 * where every number is a 64-bit float; using Float here would accumulate a
 * different rounding error and break client-side prediction parity. Convert to
 * Float only at the drawing boundary.
 *
 * Every field has a default so that a content file may omit anything the running
 * build does not need yet — the wire format is expected to grow.
 */

@Serializable
data class GameInfo(
    val id: String = "milofit-arena",
    val title: String = "MILOFIT Arena",
    val tagline: String = "",
    val protocolVersion: Int = 1,
)

@Serializable
data class Limits(
    val maxPlayersPerRoom: Int = 12,
    val nameMaxLength: Int = 16,
    val chatMaxLength: Int = 120,
    val chatCooldownSeconds: Double = 1.5,
)

@Serializable
data class PlayerTuning(
    val width: Double = 30.0,
    val height: Double = 46.0,
    val gravity: Double = 2000.0,
    val runSpeed: Double = 285.0,
    val airControl: Double = 0.55,
    val jumpVelocity: Double = -620.0,
    val maxFallSpeed: Double = 1500.0,
    val maxHealth: Double = 100.0,
    val maxShield: Double = 50.0,
    val shieldDecayPerSecond: Double = 0.0,
    val respawnSeconds: Double = 3.0,
    val spawnProtectionSeconds: Double = 1.5,
    val selfDamageFactor: Double = 0.4,
    val friendlyFire: Boolean = false,
)

@Serializable
data class JetpackTuning(
    val maxFuel: Double = 100.0,
    val drainPerSecond: Double = 44.0,
    val rechargePerSecond: Double = 26.0,
    val rechargeDelaySeconds: Double = 0.45,
    val thrust: Double = -2200.0,
    val maxUpSpeed: Double = -540.0,
    val horizontalThrust: Double = 340.0,
)

@Serializable
data class GrenadeTuning(
    val maxCarried: Int = 2,
    val rechargeSeconds: Double = 7.0,
    val throwSpeed: Double = 640.0,
    val throwUpBias: Double = -180.0,
    val fuseSeconds: Double = 1.9,
    val radius: Double = 130.0,
    val damage: Double = 65.0,
)

@Serializable
data class MeleeTuning(
    val cooldownSeconds: Double = 0.5,
    val range: Double = 62.0,
    val halfAngleDeg: Double = 55.0,
    val damageBonus: Double = 0.0,
)

@Serializable
data class PickupTuning(
    val healthAmount: Double = 40.0,
    val shieldAmount: Double = 35.0,
    val ammoRefillFactor: Double = 0.6,
    val respawnSeconds: Double = 12.0,
)

@Serializable
data class NetTuning(
    val interpDelayMs: Double = 110.0,
    val reconcilePx: Double = 26.0,
    val inputBufferSize: Int = 24,
    val maxInputsPerMessage: Int = 8,
)

@Serializable
data class MatchTuning(
    val scoreLimit: Int = 25,
    val timeLimitSeconds: Double = 300.0,
    val warmupCountdownSeconds: Double = 5.0,
    val postMatchSeconds: Double = 10.0,
)

@Serializable
data class CtfTuning(
    val captureLimit: Int = 3,
    val returnSeconds: Double = 20.0,
    val pickupRadius: Double = 34.0,
    val captureRadius: Double = 46.0,
)

@Serializable
data class RoleTuning(
    val name: String = "Attacker",
    val maxHealth: Double = 100.0,
    val runSpeed: Double = 285.0,
    val jetpackMax: Double = 100.0,
    val jetDrainScale: Double = 1.0,
)

@Serializable
data class Tuning(
    val version: Int = 1,
    val tickRate: Int = 60,
    val snapshotRate: Int = 20,
    val limits: Limits = Limits(),
    val player: PlayerTuning = PlayerTuning(),
    val jetpack: JetpackTuning = JetpackTuning(),
    val grenades: GrenadeTuning = GrenadeTuning(),
    val melee: MeleeTuning = MeleeTuning(),
    val pickups: PickupTuning = PickupTuning(),
    val net: NetTuning = NetTuning(),
    val match: MatchTuning = MatchTuning(),
    val ctf: CtfTuning = CtfTuning(),
    val gravityModes: Map<String, Double> = mapOf("normal" to 1.0, "lunar" to 0.3157894737, "zero" to -0.1052631579),
    val matchFormats: Map<String, MatchFormatTuning> = emptyMap(),
    val roles: Map<String, RoleTuning> = emptyMap(),
) {
    val fixedDt: Double get() = 1.0 / tickRate
}

@Serializable
data class MatchFormatTuning(
    val teamSize: Int = 1,
    val maxPlayers: Int = 2,
    val scoreLimit: Int = 10,
    val timeLimitSeconds: Int = 180,
    val respawnSeconds: Double = 2.5,
)

@Serializable
data class WeaponHud(
    val color: String = "#ffd166",
    val pickup: String = "ammo",
)

@Serializable
data class ExplodeSpec(
    val radius: Double = 0.0,
    val damage: Double = 0.0,
    val knockback: Double = 0.0,
)

@Serializable
data class Weapon(
    val id: String,
    val name: String,
    val slot: String = "primary",
    val kind: String = "bullet",
    val damage: Double = 0.0,
    val rpm: Double = 60.0,
    val auto: Boolean = false,
    val pellets: Int = 1,
    val spreadDeg: Double = 0.0,
    val recoilKick: Double = 0.0,
    val bulletSpeed: Double = 1000.0,
    val bulletLifeSeconds: Double = 0.6,
    val magSize: Int = 1,
    val reserve: Int = 0,
    val reloadSeconds: Double = 1.0,
    val cooldownSeconds: Double = 0.5,
    val range: Double = 62.0,
    val halfAngleDeg: Double = 55.0,
    val knockback: Double = 0.0,
    val gravityScale: Double = 0.0,
    val bounciness: Double = 0.0,
    val explode: ExplodeSpec? = null,
    /** "none" for the melee weapon, whose ammo readout is an infinity symbol. */
    val ammo: String = "mag",
    val hud: WeaponHud = WeaponHud(),
) {
    val hasAmmo: Boolean get() = ammo != "none"
    val shotInterval: Double get() = 60.0 / (if (rpm <= 0.0) 60.0 else rpm)
}

@Serializable
data class DefaultLoadout(
    val note: String = "",
    val spawnSlots: List<String> = emptyList(),
)

@Serializable
data class WeaponsFile(
    val version: Int = 1,
    val weapons: List<Weapon> = emptyList(),
    val defaultLoadout: DefaultLoadout = DefaultLoadout(),
    val spawnSlots: List<String> = emptyList(),
    val spawnGrenades: Int = 2,
)

@Serializable
data class Palette(
    val skin: String,
    val torso: String,
    val limbs: String,
    val accent: String,
    val outline: String,
)

@Serializable
data class Character(
    val id: String,
    val name: String,
    val unlock: String = "default",
    val twitch: Double = 1.0,
    val build: Double = 1.0,
    val palette: Palette,
)

@Serializable
data class CharactersFile(
    val version: Int = 1,
    val characters: List<Character> = emptyList(),
)

@Serializable
data class SpawnPoint(
    val x: Double,
    val y: Double,
    val team: String = "any",
)

@Serializable
data class Solid(
    val x: Double,
    val y: Double,
    val w: Double,
    val h: Double,
    val type: String = "ground",
    /** Jump-through platform: blocks only a body falling onto its top edge. */
    val oneWay: Boolean = false,
)

@Serializable
data class Decoration(
    val type: String,
    val x: Double = 0.0,
    val y: Double = 0.0,
    val w: Double = 0.0,
    val h: Double = 0.0,
    val radius: Double = 0.0,
    val color: String = "#ffffff",
    val alpha: Double = 0.1,
    val text: String = "",
)

@Serializable
data class MapPickup(
    val x: Double,
    val y: Double,
    val type: String,
    val weapon: String? = null,
)

@Serializable
data class Ambient(
    val sky: List<String> = listOf("#101a2e", "#1c2f4a"),
    val grid: String = "#22334f",
    val glow: String = "#4cc9f0",
)

@Serializable
data class MapSize(
    val width: Double = 2400.0,
    val height: Double = 1200.0,
)

/** A team's capture-the-flag home position, from a map's `flagBases`. */
@Serializable
data class FlagBase(
    val x: Double = 0.0,
    val y: Double = 0.0,
)

@Serializable
data class GameMap(
    val id: String,
    val name: String,
    @SerialName("size") val mapSize: MapSize = MapSize(),
    val ambient: Ambient = Ambient(),
    val spawnPoints: List<SpawnPoint> = emptyList(),
    val solids: List<Solid> = emptyList(),
    val decorations: List<Decoration> = emptyList(),
    val pickups: List<MapPickup> = emptyList(),
    /** Keyed "red"/"blue". Empty on a map that has no authored CTF bases. */
    val flagBases: Map<String, FlagBase> = emptyMap(),
)

@Serializable
data class Mode(
    val id: String,
    val name: String,
    val description: String = "",
    val teams: Boolean = false,
    val scorePerKill: Double = 1.0,
    val scorePerAssist: Double = 0.25,
    /** Capture the flag: the mode carries flags instead of a kill limit. */
    val flags: Boolean = false,
    /** False in CTF, where the team score counts captures rather than kills. */
    val teamScoreFromKills: Boolean = true,
)

@Serializable
data class PickupType(
    val label: String = "",
    val color: String = "#ffd166",
    val amount: Double = 0.0,
)

@Serializable
data class Manifest(
    val version: Int = 1,
    val game: GameInfo = GameInfo(),
    /** Logical name -> asset-relative filename, e.g. "tuning" -> "tuning.json". */
    val files: Map<String, String> = emptyMap(),
    val maps: List<String> = emptyList(),
    val modes: List<Mode> = emptyList(),
    val pickupTypes: Map<String, PickupType> = emptyMap(),
)
