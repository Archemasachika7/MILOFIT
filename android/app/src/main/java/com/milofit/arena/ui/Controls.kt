package com.milofit.arena.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.milofit.arena.game.GameViewModel
import com.milofit.arena.game.InputState
import kotlin.math.hypot
import kotlin.math.min

/**
 * On-screen controls: two floating-capable thumb sticks plus a button cluster.
 *
 * Each control owns its own `pointerInput`, which is what makes multi-touch work
 * without any bookkeeping — Compose routes each finger to the composable it is
 * over, so the move stick, the aim stick and every button can all be held down
 * at the same time.
 */

@Composable
fun VirtualStick(
    diameter: Dp,
    tint: Color,
    hint: String,
    onChange: (dx: Float, dy: Float, active: Boolean) -> Unit,
) {
    // Normalised stick deflection; also what the drawing reads to place the knob.
    var knob by remember { mutableStateOf(Offset.Zero) }
    var active by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .size(diameter)
            .pointerInput(Unit) {
                val half = min(size.width, size.height) / 2f
                val centre = Offset(size.width / 2f, size.height / 2f)
                fun update(pos: Offset) {
                    var v = Offset((pos.x - centre.x) / half, (pos.y - centre.y) / half)
                    val len = hypot(v.x, v.y)
                    // Cap at the rim and add a small dead zone so a resting thumb
                    // does not creep the character across the floor.
                    if (len > 0.12f) {
                        val clamped = min(len, 1f)
                        v = Offset(v.x / len * clamped, v.y / len * clamped)
                    } else {
                        v = Offset.Zero
                    }
                    knob = v
                    onChange(v.x, v.y, true)
                }

                // Hand-rolled rather than detectDragGestures(): that helper only
                // reports a drag once the finger has passed the touch slop, which
                // would make a pressed-but-still thumb read as "not touching".
                // Starting from the raw down event makes the stick — and with it
                // the auto-fire trigger — respond on contact.
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    active = true
                    update(down.position)
                    while (true) {
                        val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id }
                            ?: break
                        if (!change.pressed) break
                        change.consume()
                        update(change.position)
                    }
                    active = false
                    knob = Offset.Zero
                    onChange(0f, 0f, false)
                }
            },
    ) {
        androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2f
            val centre = Offset(size.width / 2f, size.height / 2f)
            val alpha = if (active) 0.30f else 0.16f
            drawCircle(Color.White.copy(alpha = alpha * 0.6f), r, centre)
            drawCircle(tint.copy(alpha = if (active) 0.85f else 0.45f), r, centre, style = Stroke(2f))
            drawCircle(
                tint.copy(alpha = 0.20f),
                r * 0.30f,
                centre,
                style = Stroke(1.5f),
            )
            // knob
            val knobCentre = centre + knob * (r * 0.62f)
            drawCircle(
                brush = androidx.compose.ui.graphics.Brush.radialGradient(
                    colors = listOf(
                        Color.White.copy(alpha = if (active) 0.95f else 0.55f),
                        tint.copy(alpha = if (active) 0.85f else 0.4f),
                    ),
                    center = knobCentre,
                    radius = r * 0.34f,
                ),
                radius = r * 0.28f,
                center = knobCentre,
            )
            drawCircle(tint.copy(alpha = 0.7f), r * 0.30f, knobCentre, style = Stroke(1.5f))
        }
        Text(
            text = hint,
            color = tint.copy(alpha = if (active) 0.8f else 0.5f),
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.align(Alignment.Center).padding(top = 46.dp),
        )
    }
}

/** A button that reports press and release (jetpack, fire). */
@Composable
fun HoldButton(
    label: String,
    sub: String,
    size: Dp,
    tint: Color,
    onChange: (Boolean) -> Unit,
) {
    var held by remember { mutableStateOf(false) }
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(tint.copy(alpha = if (held) 0.42f else 0.18f))
            .border(2.dp, tint.copy(alpha = if (held) 1f else 0.55f), CircleShape)
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown()
                    held = true
                    onChange(true)
                    waitForUpOrCancellation()
                    held = false
                    onChange(false)
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(label, color = ArenaColors.text, fontSize = 13.sp, fontWeight = FontWeight.Black)
            if (sub.isNotEmpty()) {
                Text(sub, color = tint, fontSize = 9.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** A button that fires once per tap (reload, melee, grenade, weapon swap). */
@Composable
fun TapButton(
    label: String,
    sub: String,
    size: Dp,
    tint: Color,
    onTap: () -> Unit,
) {
    var flash by remember { mutableStateOf(false) }
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(tint.copy(alpha = if (flash) 0.40f else 0.16f))
            .border(2.dp, tint.copy(alpha = if (flash) 1f else 0.5f), CircleShape)
            .pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        flash = true
                        tryAwaitRelease()
                        flash = false
                    },
                    onTap = { onTap() },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(label, color = ArenaColors.text, fontSize = 12.sp, fontWeight = FontWeight.Black)
            if (sub.isNotEmpty()) {
                Text(sub, color = tint, fontSize = 9.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/**
 * The whole control layer for a live match. Hidden while dead so a player cannot
 * queue up inputs they will not be able to use.
 */
@Composable
fun ControlLayer(vm: GameViewModel, enabled: Boolean) {
    val input: InputState = vm.input

    Box(Modifier.fillMaxSize()) {
        if (!enabled) return@Box

        Box(Modifier.align(Alignment.BottomStart).padding(start = 20.dp, bottom = 18.dp)) {
            VirtualStick(
                diameter = 168.dp,
                tint = ArenaColors.accent,
                hint = "MOVE",
                onChange = { dx, _, _ -> input.moveX = dx.toDouble() },
            )
        }

        Box(Modifier.align(Alignment.BottomEnd).padding(end = 20.dp, bottom = 18.dp)) {
            VirtualStick(
                diameter = 168.dp,
                tint = ArenaColors.warn,
                hint = "AIM",
                onChange = { dx, dy, active ->
                    input.aimActive = active
                    input.aimDirX = dx.toDouble()
                    input.aimDirY = dy.toDouble()
                    // Holding the aim stick is also the trigger, which is what
                    // makes a touch shooter playable with two thumbs.
                    input.autoFire = active
                },
            )
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 22.dp, bottom = 206.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TapButton("MELEE", "cone", 58.dp, Color(0xFFFF8A5C)) { input.push("melee") }
                TapButton("NADE", "${vm.hud.grenades}", 58.dp, Color(0xFFF2E14C)) { input.push("grenade") }
                TapButton("RELOAD", "R", 58.dp, ArenaColors.muted) { input.push("reload") }
                TapButton("SWAP", if (vm.hud.slot == 0) "1" else "2", 58.dp, ArenaColors.good) {
                    input.push(if (vm.hud.slot == 0) "switch:1" else "switch:0")
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HoldButton("JET", "jump", 78.dp, ArenaColors.warn) { input.jetHeld = it }
                HoldButton("FIRE", "", 88.dp, ArenaColors.danger) { input.fireButton = it }
            }
        }
    }
}
