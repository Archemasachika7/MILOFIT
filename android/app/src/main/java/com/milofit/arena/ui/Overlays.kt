package com.milofit.arena.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.milofit.arena.data.Character
import com.milofit.arena.data.Weapon
import com.milofit.arena.game.GameViewModel
import com.milofit.arena.game.PlayerView
import com.milofit.arena.game.Screen
import com.milofit.arena.net.RosterPlayer
import kotlin.math.round

/**
 * All non-world UI: the menu, the lobby, the in-match HUD and the scoreboard.
 *
 * These are ordinary composables reading the ViewModel's Compose state, so they
 * only recompose when something they show actually changes — the 60 Hz world
 * underneath is drawn on the Canvas by ArenaApp.
 */

@Composable
fun Panel(
    modifier: Modifier = Modifier,
    alpha: Float = 0.92f,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(ArenaColors.panelSolid.copy(alpha = alpha))
            .border(1.dp, ArenaColors.panelEdge, RoundedCornerShape(14.dp))
            .padding(14.dp),
    ) {
        content()
    }
}

@Composable
private fun Label(text: String, color: Color = ArenaColors.muted, size: Int = 10) {
    Text(text.uppercase(), color = color, fontSize = size.sp, fontWeight = FontWeight.Bold)
}

@Composable
private fun Field(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
) {
    Column(modifier) {
        Label(label)
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = singleLine,
            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 13.sp, color = ArenaColors.text),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color(0xFF121C2E),
                unfocusedContainerColor = Color(0xFF121C2E),
                focusedTextColor = ArenaColors.text,
                unfocusedTextColor = ArenaColors.text,
                focusedIndicatorColor = ArenaColors.accent,
                unfocusedIndicatorColor = ArenaColors.panelEdge,
                cursorColor = ArenaColors.accent,
            ),
        )
    }
}

// ---------------------------------------------------------------------- menu

@Composable
fun MenuOverlay(vm: GameViewModel) {
    Box(
        Modifier
            .fillMaxSize()
            .background(ArenaColors.bg.copy(alpha = 0.72f)),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .fillMaxSize()
                .padding(18.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // ---- left: identity + connection
            Panel(Modifier.width(300.dp).fillMaxHeight()) {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text(
                        "MILOFIT ARENA",
                        color = ArenaColors.text,
                        fontSize = 26.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Text(
                        vm.content.manifest.game.tagline.ifBlank { "Jetpack arena shooter" },
                        color = ArenaColors.accent,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(14.dp))

                    Field("Callsign", vm.playerName, vm::setName)
                    Spacer(Modifier.height(8.dp))
                    Field("Server", vm.serverUrl, vm::setServer)
                    Text(
                        "ws://<your-pc-lan-ip>:8080/ws — 10.0.2.2 reaches the host from an emulator.",
                        color = ArenaColors.muted,
                        fontSize = 10.sp,
                    )
                    Spacer(Modifier.height(8.dp))
                     Field("Room code (blank creates one)", vm.roomId, vm::setRoom)
                     Spacer(Modifier.height(10.dp))
                     Label("Match format", size = 10)
                     Row(Modifier.horizontalScroll(rememberScrollState())) {
                         listOf("1v1", "2v2", "4v4").forEach { format ->
                             Selectable(format, vm.matchFormat == format, ArenaColors.accent) {
                                 vm.matchFormat = format
                                 if (format == "4v4" && vm.roleMode == "roles") vm.roleMode = "free"
                                 if (format != "4v4" && vm.roleMode == "free") vm.roleMode = "roles"
                             }
                             Spacer(Modifier.width(6.dp))
                         }
                     }
                     Spacer(Modifier.height(8.dp))
                     Label("Role rules", size = 10)
                     Row(Modifier.horizontalScroll(rememberScrollState())) {
                         listOf("roles" to "Roles", "free" to "All attackers").forEach { (value, label) ->
                             Selectable(label, vm.roleMode == value, ArenaColors.warn) { vm.roleMode = value }
                             Spacer(Modifier.width(6.dp))
                         }
                     }
                     if (vm.roleMode == "roles") {
                         Spacer(Modifier.height(8.dp))
                         Label("Default role", size = 10)
                         Row(Modifier.horizontalScroll(rememberScrollState())) {
                             listOf("raider", "commander", "scout", "breacher", "medic").forEach { role ->
                                 Selectable(role.replaceFirstChar { it.uppercase() }, vm.roleId == role, ArenaColors.good) {
                                     vm.roleId = role
                                 }
                                 Spacer(Modifier.width(6.dp))
                             }
                         }
                     }
                     Spacer(Modifier.height(8.dp))
                     Label("Gravity mutator", size = 10)
                     Row(Modifier.horizontalScroll(rememberScrollState())) {
                         listOf("normal", "lunar", "zero").forEach { gravity ->
                             Selectable(gravity.replaceFirstChar { it.uppercase() }, vm.gravityMode == gravity, ArenaColors.accent) {
                                 vm.gravityMode = gravity
                             }
                             Spacer(Modifier.width(6.dp))
                         }
                     }

                     Spacer(Modifier.height(14.dp))
                    Button(
                        onClick = { vm.play() },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = ArenaColors.accent,
                            contentColor = Color(0xFF04121C),
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("PLAY ONLINE", fontWeight = FontWeight.Black)
                    }
                    Spacer(Modifier.height(8.dp))
                    androidx.compose.material3.OutlinedButton(
                        onClick = { vm.play(practice = true) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("SOLO PRACTICE", fontWeight = FontWeight.Bold, color = ArenaColors.text)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Solo practice opens a private room on the server, so the physics stay authoritative.",
                        color = ArenaColors.muted,
                        fontSize = 10.sp,
                    )

                    Spacer(Modifier.height(14.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Label("Team")
                        Spacer(Modifier.width(8.dp))
                        listOf("auto", "red", "blue").forEach { team ->
                            Selectable(
                                text = team,
                                selected = vm.teamPreference == team,
                                tint = ArenaColors.team(if (team == "auto") "ffa" else team),
                                onClick = { vm.teamPreference = team },
                            )
                            Spacer(Modifier.width(6.dp))
                        }
                    }

                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Label("Audio")
                        Spacer(Modifier.width(8.dp))
                        Selectable(
                            text = if (vm.muted) "muted" else "on",
                            selected = true,
                            tint = if (vm.muted) ArenaColors.muted else ArenaColors.good,
                            onClick = { vm.toggleMute() },
                        )
                    }

                    Spacer(Modifier.height(14.dp))
                    Text(vm.statusMessage, color = ArenaColors.muted, fontSize = 11.sp)
                    vm.serverError?.let {
                        Spacer(Modifier.height(4.dp))
                        Text(it, color = ArenaColors.danger, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }

            // ---- right: character picker
            Panel(Modifier.width(360.dp).fillMaxHeight()) {
                Column {
                    Label("Character", size = 11)
                    Spacer(Modifier.height(8.dp))
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        vm.content.characters.chunked(3).forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                row.forEach { character ->
                                    CharacterChip(
                                        character = character,
                                        weapon = vm.content.weapon(vm.content.spawnSlots.firstOrNull()),
                                        selected = character.id == vm.characterId,
                                        onClick = { vm.setCharacter(character.id) },
                                    )
                                }
                            }
                            Spacer(Modifier.height(8.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Selectable(
    text: String,
    selected: Boolean,
    tint: Color,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(tint.copy(alpha = if (selected) 0.28f else 0.10f))
            .border(1.dp, tint.copy(alpha = if (selected) 0.9f else 0.35f), RoundedCornerShape(8.dp))
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Text(text, color = ArenaColors.text, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}

/** A procedural character preview — no image assets anywhere in the project. */
@Composable
fun CharacterChip(
    character: Character,
    weapon: Weapon?,
    selected: Boolean,
    onClick: () -> Unit,
    size: Dp = 104.dp,
) {
    val view = remember(character.id) {
        PlayerView().apply {
            id = character.id
            name = character.name
            palette = character.palette
            build = character.build
            twitch = character.twitch
            facing = 1
            aim = -0.35
            onGround = true
            alive = true
        }
    }
    Column(
        Modifier
            .width(size)
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) ArenaColors.accent.copy(alpha = 0.20f) else Color(0xFF121C2E))
            .border(
                2.dp,
                if (selected) ArenaColors.accent else ArenaColors.panelEdge,
                RoundedCornerShape(12.dp),
            )
            .clickable { onClick() }
            .padding(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Canvas(Modifier.size(size, 74.dp)) {
            val previewScale = 0.95f
            // `size` here is the composable's Dp parameter, and the withTransform
            // lambda's receiver is DrawTransform, so the DrawScope size has to be
            // read explicitly before entering it.
            val centerX = this.size.width / 2f - 4f
            val centerY = this.size.height / 2f + 8f
            withTransform({
                translate(centerX, centerY)
                scale(previewScale, previewScale, pivot = Offset.Zero)
            }) {
                soldier(view, time = 1.3, weapon = weapon)
            }
        }
        Text(
            character.name,
            color = if (selected) ArenaColors.text else ArenaColors.muted,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
    }
}

// --------------------------------------------------------------------- lobby

@Composable
fun LobbyOverlay(vm: GameViewModel) {
    Box(Modifier.fillMaxSize().background(ArenaColors.bg.copy(alpha = 0.55f))) {
        Row(
            Modifier.fillMaxSize().padding(20.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Panel(Modifier.width(320.dp).fillMaxHeight()) {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text("ROOM", color = ArenaColors.muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text(
                        vm.room?.id ?: vm.roomId,
                        color = ArenaColors.text,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "${vm.room?.mode?.name ?: vm.hud.modeId} · ${vm.room?.map?.name ?: vm.hud.mapName}",
                        color = ArenaColors.accent,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(12.dp))

                    val cd = vm.hud.countdown
                    if (cd > 0.0) {
                        Text(
                            "Match starting in ${round(cd).toInt()}s",
                            color = ArenaColors.warn,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Black,
                        )
                    } else {
                        Text("Waiting for players…", color = ArenaColors.muted, fontSize = 13.sp)
                        Text(
                            "Room code is shown above. Online matches need two players; practice can run solo.",
                            color = ArenaColors.muted,
                            fontSize = 10.sp,
                        )
                    }

                    Spacer(Modifier.height(14.dp))
                    if (vm.isHost) {
                        Label("Arena (host)", size = 10)
                        Row(Modifier.horizontalScroll(rememberScrollState())) {
                            vm.content.maps.forEach { map ->
                                Selectable(
                                    text = map.name,
                                    selected = vm.room?.mapId == map.id,
                                    tint = ArenaColors.accent,
                                    onClick = { vm.requestMap(map.id) },
                                )
                                Spacer(Modifier.width(6.dp))
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        Label("Mode (host)", size = 10)
                        Row(Modifier.horizontalScroll(rememberScrollState())) {
                            vm.content.manifest.modes.forEach { mode ->
                                Selectable(
                                    text = mode.name,
                                    selected = vm.room?.modeId == mode.id,
                                    tint = ArenaColors.warn,
                                    onClick = { vm.requestMode(mode.id) },
                                )
                                Spacer(Modifier.width(6.dp))
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        Label("Format", size = 10)
                        Row(Modifier.horizontalScroll(rememberScrollState())) {
                            listOf("1v1", "2v2", "4v4").forEach { format ->
                                Selectable(format, vm.room?.format == format, ArenaColors.accent) { vm.matchFormat = format }
                                Spacer(Modifier.width(6.dp))
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                        Row(Modifier.horizontalScroll(rememberScrollState())) {
                            Selectable("Roles", vm.room?.roleMode == "roles", ArenaColors.warn) { vm.roleMode = "roles" }
                            Spacer(Modifier.width(6.dp))
                            Selectable("All attackers", vm.room?.roleMode == "free", ArenaColors.warn) { vm.roleMode = "free" }
                        }
                        Spacer(Modifier.height(6.dp))
                        Row(Modifier.horizontalScroll(rememberScrollState())) {
                            listOf("normal", "lunar", "zero").forEach { gravity ->
                                Selectable(gravity.replaceFirstChar { it.uppercase() }, vm.room?.gravityMode == gravity, ArenaColors.accent) {
                                    vm.gravityMode = gravity
                                }
                                Spacer(Modifier.width(6.dp))
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        androidx.compose.material3.OutlinedButton(
                            onClick = { vm.requestMatchSettings() },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("APPLY MATCH SETTINGS", fontWeight = FontWeight.Bold, color = ArenaColors.text)
                        }
                        Spacer(Modifier.height(10.dp))
                        Button(
                            onClick = { vm.requestStart() },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = ArenaColors.good,
                                contentColor = Color(0xFF08130A),
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("START NOW", fontWeight = FontWeight.Black)
                        }
                    } else {
                        Text(
                            "The host picks the arena and starts the match.",
                            color = ArenaColors.muted,
                            fontSize = 10.sp,
                        )
                    }

                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Label("Team")
                        Spacer(Modifier.width(8.dp))
                        listOf("auto", "red", "blue").forEach { team ->
                            Selectable(
                                text = team,
                                selected = vm.teamPreference == team,
                                tint = ArenaColors.team(if (team == "auto") "ffa" else team),
                                onClick = { vm.requestTeam(team) },
                            )
                            Spacer(Modifier.width(6.dp))
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(vm.statusMessage, color = ArenaColors.muted, fontSize = 11.sp)
                    vm.serverError?.let {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            it,
                            color = ArenaColors.danger,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    androidx.compose.material3.OutlinedButton(
                        onClick = { vm.leave() },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("LEAVE", color = ArenaColors.text, fontWeight = FontWeight.Bold)
                    }
                }
            }

            Panel(Modifier.fillMaxHeight().widthIn(min = 260.dp)) {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Label("Roster (${vm.roster?.players?.size ?: 0}/${vm.room?.maxPlayers ?: 12})", size = 11)
                    Spacer(Modifier.height(8.dp))
                    val players = vm.roster?.players ?: emptyList()
                    if (players.isEmpty()) {
                        Text("Nobody here yet.", color = ArenaColors.muted, fontSize = 11.sp)
                    }
                    players.forEach { p ->
                        RosterRow(p, isYou = p.id == vm.myId, isHost = p.id == vm.room?.host)
                    }
                }
            }
        }
    }
}

@Composable
private fun RosterRow(p: RosterPlayer, isYou: Boolean, isHost: Boolean) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(10.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(ArenaColors.team(p.team)),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            p.name + if (isYou) " (you)" else "",
            color = if (isYou) ArenaColors.text else ArenaColors.muted,
            fontSize = 12.sp,
            fontWeight = if (isYou) FontWeight.Bold else FontWeight.Normal,
            modifier = Modifier.weight(1f),
        )
        if (isHost) {
            Text("HOST", color = ArenaColors.warn, fontSize = 9.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(8.dp))
        Text("${p.ping}ms", color = ArenaColors.muted, fontSize = 10.sp)
    }
}

// ----------------------------------------------------------------------- HUD

@Composable
fun HudOverlay(vm: GameViewModel) {
    val hud = vm.hud

    Box(Modifier.fillMaxSize()) {
        // ---- top left: vitals
        Panel(Modifier.align(Alignment.TopStart).padding(14.dp).width(286.dp), alpha = 0.72f) {
            Column {
                StatBar("HEALTH", hud.hp.toDouble(), hud.maxHp.toDouble(), ArenaColors.hpBar, "${hud.hp}")
                Spacer(Modifier.height(5.dp))
                StatBar("SHIELD", hud.shield.toDouble(), hud.maxShield.toDouble(), ArenaColors.shieldBar, "${hud.shield}")
                Spacer(Modifier.height(5.dp))
                StatBar("JET", hud.jetFuel, hud.maxJetFuel, ArenaColors.jetBar, "${hud.jetFuel.toInt()}")
                Spacer(Modifier.height(9.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Canvas(Modifier.size(44.dp, 22.dp)) {
                        weaponIcon(vm.content.weapon(hud.weaponId), 40f, hexColor(vm.content.weapon(hud.weaponId)?.hud?.color ?: "#cfd8e6"))
                    }
                    Spacer(Modifier.width(6.dp))
                    Column {
                        Text(
                            hud.weaponName.ifBlank { "—" },
                            color = ArenaColors.text,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Black,
                        )
                        Text(
                            when {
                                !hud.hasAmmo -> "melee"
                                hud.reloading -> "reloading…"
                                hud.mag < 0 -> "—"
                                else -> "${hud.mag} / ${hud.reserve}"
                            },
                            color = if (hud.reloading) ArenaColors.warn else ArenaColors.muted,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        "×${hud.grenades}",
                        color = ArenaColors.warn,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("K ${hud.kills}  D ${hud.deaths}", color = ArenaColors.muted, fontSize = 11.sp)
                }
            }
        }

        // ---- top centre: score, clock, banner
        Column(
            Modifier.align(Alignment.TopCenter).padding(top = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Panel(alpha = 0.72f) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (hud.teams) {
                        ScorePill(hud.scoreRed.toInt(), ArenaColors.red, "RED")
                        Spacer(Modifier.width(8.dp))
                        Text(
                            formatClock(hud.timeLeft),
                            color = ArenaColors.text,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Black,
                        )
                        Spacer(Modifier.width(8.dp))
                        ScorePill(hud.scoreBlue.toInt(), ArenaColors.blue, "BLUE")
                        if (hud.modeHasFlags) {
                            Spacer(Modifier.width(8.dp))
                            // Capture the flag: the team score counts captures.
                            Text("to ${hud.scoreLimit}", color = ArenaColors.muted, fontSize = 11.sp)
                        }
                    } else {
                        ScorePill(hud.scoreFfa.toInt(), ArenaColors.ffa, "LEAD")
                        Spacer(Modifier.width(10.dp))
                        Text(
                            formatClock(hud.timeLeft),
                            color = ArenaColors.text,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Black,
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "to ${hud.scoreLimit}",
                            color = ArenaColors.muted,
                            fontSize = 11.sp,
                        )
                    }
                }
            }
            if (hud.modeHasFlags) {
                Spacer(Modifier.height(6.dp))
                val flagText: String
                val flagColor: androidx.compose.ui.graphics.Color
                when {
                    hud.carryingFlag -> {
                        flagText = "YOU HAVE THEIR FLAG"
                        flagColor = ArenaColors.accent
                    }
                    hud.ownFlagAway -> {
                        flagText = "YOUR FLAG IS AWAY"
                        flagColor = ArenaColors.red
                    }
                    else -> {
                        flagText = "FLAG AT BASE"
                        flagColor = ArenaColors.muted
                    }
                }
                Text(flagText, color = flagColor, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
            vm.banner?.let { banner ->
                Spacer(Modifier.height(10.dp))
                val fade = (1.0 - (banner.t / banner.life).coerceIn(0.0, 1.0)).toFloat()
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        banner.text,
                        color = ArenaColors.text.copy(alpha = fade.coerceIn(0f, 1f)),
                        fontSize = 34.sp,
                        fontWeight = FontWeight.Black,
                    )
                    if (banner.sub.isNotEmpty()) {
                        Text(
                            banner.sub,
                            color = ArenaColors.warn.copy(alpha = fade.coerceIn(0f, 1f)),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }

        // ---- top right: connection + kill feed + chat
        Column(
            Modifier.align(Alignment.TopEnd).padding(14.dp).width(300.dp),
            horizontalAlignment = Alignment.End,
        ) {
            Panel(alpha = 0.66f) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "${hud.fps} fps · ${hud.rttMs} ms",
                        color = ArenaColors.muted,
                        fontSize = 10.sp,
                    )
                    Spacer(Modifier.width(8.dp))
                    Box(
                        Modifier
                            .size(8.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(
                                when (vm.connStatus) {
                                    com.milofit.arena.net.ConnStatus.CONNECTED -> ArenaColors.good
                                    com.milofit.arena.net.ConnStatus.CONNECTING -> ArenaColors.warn
                                    else -> ArenaColors.danger
                                },
                            ),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        if (vm.muted) "unmute" else "mute",
                        color = ArenaColors.accent,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable { vm.toggleMute() },
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
            vm.killFeed.forEach { line ->
                Row(
                    Modifier
                        .padding(vertical = 2.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(ArenaColors.panelSolid.copy(alpha = if (line.mine) 0.88f else 0.6f))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(line.killer, color = ArenaColors.team(line.killerTeam), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(6.dp))
                    Text(line.weapon, color = ArenaColors.muted, fontSize = 9.sp)
                    Spacer(Modifier.width(6.dp))
                    Text(line.victim, color = ArenaColors.team(line.victimTeam), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }

            Spacer(Modifier.height(8.dp))
            ChatBox(vm)
        }

        // ---- bottom centre: state notices
        val notice = when {
            hud.spectator -> "Spectating — the next match starts automatically"
            !hud.alive && hud.respawnIn > 0 -> "Respawning in ${hud.respawnIn.toInt() + 1}"
            else -> null
        }
        notice?.let {
            Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 30.dp)) {
                Panel(alpha = 0.85f) {
                    Text(
                        it,
                        color = ArenaColors.warn,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Black,
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatBox(vm: GameViewModel) {
    var open by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf("") }

    Column(horizontalAlignment = Alignment.End) {
        val recent = vm.chatLog.takeLast(4)
        recent.forEach { line ->
            val isSystem = line.from == "system"
            Row(
                Modifier.padding(vertical = 1.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (isSystem) "•" else line.name,
                    color = if (isSystem) ArenaColors.muted else ArenaColors.team(line.team),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.width(5.dp))
                Text(
                    line.text,
                    color = if (isSystem) ArenaColors.muted else ArenaColors.text,
                    fontSize = 10.sp,
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        if (open) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it.take(120) },
                    singleLine = true,
                    placeholder = { Text("Message…", color = ArenaColors.muted, fontSize = 11.sp) },
                    textStyle = androidx.compose.ui.text.TextStyle(fontSize = 12.sp, color = ArenaColors.text),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color(0xFF121C2E),
                        unfocusedContainerColor = Color(0xFF121C2E),
                        focusedTextColor = ArenaColors.text,
                        unfocusedTextColor = ArenaColors.text,
                        cursorColor = ArenaColors.accent,
                    ),
                    modifier = Modifier.width(200.dp),
                )
                Spacer(Modifier.width(6.dp))
                Button(
                    onClick = {
                        vm.sendChat(draft)
                        draft = ""
                        open = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = ArenaColors.accent),
                ) {
                    Text("SEND", color = Color(0xFF04121C), fontSize = 11.sp, fontWeight = FontWeight.Black)
                }
            }
        } else {
            Selectable("CHAT", selected = false, tint = ArenaColors.accent) { open = true }
        }
    }
}

@Composable
private fun ScorePill(score: Int, tint: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(9.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(tint),
        )
        Spacer(Modifier.width(5.dp))
        Text(label, color = ArenaColors.muted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.width(5.dp))
        Text("$score", color = ArenaColors.text, fontSize = 18.sp, fontWeight = FontWeight.Black)
    }
}

@Composable
private fun StatBar(label: String, value: Double, max: Double, color: Color, trailing: String) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, color = ArenaColors.muted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            Text(trailing, color = ArenaColors.text, fontSize = 11.sp, fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.height(3.dp))
        val fraction = if (max <= 0.0) 0f else (value / max).coerceIn(0.0, 1.0).toFloat()
        Box(
            Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(Color(0xFF1A2436)),
        ) {
            Box(
                Modifier
                    .fillMaxWidth(fraction)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(4.dp))
                    .background(color),
            )
        }
    }
}

private fun formatClock(seconds: Int): String {
    val m = seconds / 60
    val s = seconds % 60
    return "%d:%02d".format(m, s)
}

// ---------------------------------------------------------------- scoreboard

@Composable
fun ScoreboardOverlay(vm: GameViewModel) {
    Box(
        Modifier.fillMaxSize().background(ArenaColors.bg.copy(alpha = 0.72f)),
        contentAlignment = Alignment.Center,
    ) {
        Panel(Modifier.width(560.dp).heightIn(max = 420.dp)) {
            Column {
                val mode = vm.content.mode(vm.hud.modeId)
                val winnerText = vm.scoreboardWinner?.let { winner ->
                    when {
                        mode?.teams == true -> "Team $winner wins"
                        else -> vm.roster?.players?.firstOrNull { it.id == winner }?.name
                            ?.let { "$it wins" } ?: "Match over"
                    }
                } ?: "Match over"

                Text(
                    winnerText,
                    color = ArenaColors.warn,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Black,
                )
                Text(
                    if (vm.scoreboardReason == "time") "Time expired" else "Score limit reached",
                    color = ArenaColors.muted,
                    fontSize = 11.sp,
                )
                Spacer(Modifier.height(12.dp))

                Row(Modifier.fillMaxWidth()) {
                    HeaderCell("PLAYER", 2.2f)
                    HeaderCell("K", 0.6f)
                    HeaderCell("D", 0.6f)
                    HeaderCell("SCORE", 1f)
                    HeaderCell("PING", 0.8f)
                }
                Spacer(Modifier.height(6.dp))

                Column(Modifier.verticalScroll(rememberScrollState())) {
                    vm.scoreboard.sortedByDescending { it.score }.forEach { p ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 3.dp)
                                .background(
                                    if (p.id == vm.myId) ArenaColors.accent.copy(alpha = 0.12f) else Color.Transparent,
                                ),
                        ) {
                            Row(Modifier.weight(2.2f), verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    Modifier
                                        .size(9.dp)
                                        .clip(RoundedCornerShape(3.dp))
                                        .background(ArenaColors.team(p.team)),
                                )
                                Spacer(Modifier.width(7.dp))
                                Text(
                                    p.name,
                                    color = ArenaColors.text,
                                    fontSize = 12.sp,
                                    fontWeight = if (p.id == vm.myId) FontWeight.Black else FontWeight.Normal,
                                )
                            }
                            BodyCell("${p.kills}", 0.6f)
                            BodyCell("${p.deaths}", 0.6f)
                            BodyCell(formatScore(p.score), 1f)
                            BodyCell("${p.ping}ms", 0.8f)
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))
                Text(
                    "The next match starts automatically. Leaving now is fine — nobody loses a score.",
                    color = ArenaColors.muted,
                    fontSize = 10.sp,
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = { vm.leave() },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = ArenaColors.accent,
                        contentColor = Color(0xFF04121C),
                    ),
                ) {
                    Text("BACK TO MENU", fontWeight = FontWeight.Black)
                }
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.HeaderCell(text: String, weight: Float) {
    Text(
        text,
        color = ArenaColors.muted,
        fontSize = 9.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.weight(weight),
    )
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.BodyCell(text: String, weight: Float) {
    Text(
        text,
        color = ArenaColors.text,
        fontSize = 12.sp,
        modifier = Modifier.weight(weight),
    )
}

private fun formatScore(score: Double): String =
    if (score == round(score)) score.toInt().toString() else "%.1f".format(score)

/** Chooses which overlay is on top of the world right now. */
@Composable
fun Overlays(vm: GameViewModel) {
    when (vm.screen) {
        Screen.MENU -> MenuOverlay(vm)
        Screen.LOBBY -> LobbyOverlay(vm)
        Screen.GAME -> HudOverlay(vm)
        Screen.SCOREBOARD -> {
            HudOverlay(vm)
            ScoreboardOverlay(vm)
        }
    }
}
