package com.milofit.arena.data

import android.content.Context
import kotlinx.serialization.json.Json

/**
 * Everything the client needs to render and predict, loaded once at startup.
 *
 * The JSON is not duplicated in this repository: the Gradle `copyGameData` task
 * copies `shared/game-data/` into the APK assets, so the Android build, the web
 * client and the Node server all read the exact same files.
 *
 * Index lookups are exposed as maps built here rather than being recomputed in
 * the render loop.
 */
class Content private constructor(
    val manifest: Manifest,
    val tuning: Tuning,
    val weapons: List<Weapon>,
    val characters: List<Character>,
    val maps: List<GameMap>,
    val spawnSlots: List<String>,
    val spawnGrenades: Int,
) {
    val weaponById: Map<String, Weapon> = weapons.associateBy { it.id }
    val characterById: Map<String, Character> = characters.associateBy { it.id }
    val mapById: Map<String, GameMap> = maps.associateBy { it.id }
    val modeById: Map<String, Mode> = manifest.modes.associateBy { it.id }
    val defaultMap: GameMap = maps.firstOrNull() ?: error("no maps in content")
    val defaultCharacter: Character = characters.firstOrNull() ?: error("no characters in content")
    val teamsEnabled: Boolean = manifest.modes.any { it.teams }

    fun weapon(id: String?): Weapon? = id?.let { weaponById[it] }
    fun character(id: String?): Character = (id?.let { characterById[it] }) ?: defaultCharacter
    fun map(id: String?): GameMap = (id?.let { mapById[it] }) ?: defaultMap
    fun mode(id: String?): Mode? = id?.let { modeById[it] }

    fun pickupColor(type: String): String =
        manifest.pickupTypes[type]?.color ?: "#ffd166"

    fun pickupLabel(type: String): String =
        manifest.pickupTypes[type]?.label ?: type.replaceFirstChar { it.uppercase() }

    companion object {
        private val json = Json {
            ignoreUnknownKeys = true   // content files carry "$comment" keys and may grow
            isLenient = true
            explicitNulls = false
        }

        /** Load from the APK assets. Throws [IllegalStateException] with a useful message. */
        fun load(context: Context): Content {
            val assets = context.assets
            fun read(path: String): String =
                try {
                    assets.open(path).bufferedReader().use { it.readText() }
                } catch (err: Exception) {
                    throw IllegalStateException(
                        "game data asset \"$path\" is missing from the APK. " +
                            "The Gradle task copyGameData should place shared/game-data " +
                            "into build/generated/gameData — check that it ran.",
                        err,
                    )
                }

            fun <T> decode(path: String, deserializer: kotlinx.serialization.DeserializationStrategy<T>): T =
                try {
                    json.decodeFromString(deserializer, read(path))
                } catch (err: Exception) {
                    throw IllegalStateException("game data asset \"$path\" is not valid: ${err.message}", err)
                }

            val manifest = decode("index.json", Manifest.serializer())
            val tuning = decode(
                manifest.files["tuning"] ?: "tuning.json",
                Tuning.serializer(),
            )
            val weaponsFile = decode(
                manifest.files["weapons"] ?: "weapons.json",
                WeaponsFile.serializer(),
            )
            val characters = decode(
                manifest.files["characters"] ?: "characters.json",
                CharactersFile.serializer(),
            ).characters

            val maps = manifest.maps.map { decode(it, GameMap.serializer()) }

            check(weaponsFile.weapons.isNotEmpty()) { "weapons.json contains no weapons" }
            check(characters.isNotEmpty()) { "characters.json contains no characters" }
            check(maps.isNotEmpty()) { "index.json lists no maps" }

            val spawnSlots = weaponsFile.spawnSlots.ifEmpty {
                weaponsFile.defaultLoadout.spawnSlots
            }.ifEmpty {
                listOf("sidearm", "basher")
            }.filter { id -> weaponsFile.weapons.any { it.id == id } }

            check(spawnSlots.isNotEmpty()) { "no valid spawn loadout weapons" }

            return Content(
                manifest = manifest,
                tuning = tuning,
                weapons = weaponsFile.weapons,
                characters = characters,
                maps = maps,
                spawnSlots = spawnSlots,
                spawnGrenades = weaponsFile.spawnGrenades,
            )
        }
    }
}
