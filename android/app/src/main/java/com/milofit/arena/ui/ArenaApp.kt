package com.milofit.arena.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.text.rememberTextMeasurer
import com.milofit.arena.audio.Sfx
import com.milofit.arena.game.GameViewModel
import com.milofit.arena.game.Screen
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

/**
 * Root composable: one Canvas that draws the arena, plus the overlay UI on top.
 *
 * The frame loop is a `withFrameNanos` coroutine rather than a timer, so it is
 * vsync-locked and pauses automatically when the app goes to the background. Each
 * frame hands the elapsed time to the ViewModel (which runs the fixed-step
 * simulation) and then bumps a counter that only invalidates the Canvas *draw* —
 * no recomposition happens 60 times a second.
 */
@Composable
fun ArenaApp(vm: GameViewModel) {
    val measurer = rememberTextMeasurer()

    // Bumped every frame; read inside the draw block so only the draw is redrawn.
    val frameNanos = remember { mutableLongStateOf(0L) }

    LaunchedEffect(Unit) {
        var lastMs = 0L
        while (true) {
            withFrameNanos { nanos ->
                val nowMs = nanos / 1_000_000L
                val delta = if (lastMs == 0L) 1.0 / 60.0 else (nowMs - lastMs) / 1000.0
                lastMs = nowMs
                vm.onFrame(nowMs, delta)
                frameNanos.longValue = nanos
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose { Sfx.setJetIntensity(0.0) }
    }

    Box(Modifier.fillMaxSize()) {
        Canvas(Modifier.fillMaxSize()) {
            val nanos = frameNanos.longValue
            val nowMs = nanos / 1_000_000L
            val time = nanos / 1_000_000_000.0
            val map = vm.map

            // Zoom: at least this much of the arena is visible, so a phone in
            // landscape sees a useful amount of the map without extreme fisheye.
            val scale = max(size.width / 1200f, size.height / 620f).coerceIn(1.15f, 2.8f)
            val viewW = (size.width / scale).toDouble()
            val viewH = (size.height / scale).toDouble()
            vm.setViewport(viewW, viewH)

            // ---- sky (screen space)
            val sky = map.ambient.sky
            val top = hexColor(sky.getOrElse(0) { "#101a2e" }, Color(0xFF101A2E))
            val bottom = hexColor(sky.getOrElse(1) { "#1c2f4a" }, Color(0xFF1C2F4A))
            drawRect(
                brush = Brush.verticalGradient(listOf(top, bottom)),
                topLeft = Offset.Zero,
                size = Size(size.width, size.height),
            )

            // ---- camera (with a shake that decays in the ViewModel)
            val shake = vm.shakeMag
            val shakeX = if (shake > 0.0) cos(time * 37.0) * shake else 0.0
            val shakeY = if (shake > 0.0) sin(time * 53.0) * shake else 0.0
            val camX = vm.cameraX + shakeX * 0.4
            val camY = vm.cameraY + shakeY * 0.4

            val gridColor = hexColor(map.ambient.grid, Color(0xFF22334F))
            val glow = hexColor(map.ambient.glow, Color(0xFF4CC9F0))

            withTransform({
                scale(scale, scale, pivot = Offset.Zero)
                translate(-camX.toFloat(), -camY.toFloat())
            }) {
                val left = camX
                val right = camX + viewW
                val topWorld = camY
                val bottomWorld = camY + viewH

                // ---- floor grid
                var gx = (Math.floor(left / 80.0) * 80.0)
                while (gx < right) {
                    drawLine(
                        gridColor.copy(alpha = 0.5f),
                        Offset(gx.toFloat(), topWorld.toFloat()),
                        Offset(gx.toFloat(), bottomWorld.toFloat()),
                        1f,
                    )
                    gx += 80.0
                }
                var gy = (Math.floor(topWorld / 80.0) * 80.0)
                while (gy < bottomWorld) {
                    drawLine(
                        gridColor.copy(alpha = 0.5f),
                        Offset(left.toFloat(), gy.toFloat()),
                        Offset(right.toFloat(), gy.toFloat()),
                        1f,
                    )
                    gy += 80.0
                }

                // ---- arena border
                drawRect(
                    color = Color(0x2E78A0DC),
                    topLeft = Offset.Zero,
                    size = Size(map.mapSize.width.toFloat(), map.mapSize.height.toFloat()),
                    style = Stroke(2f),
                )

                // ---- solids
                for (s in map.solids) {
                    if (s.x + s.w < left - 40 || s.x > right + 40) continue
                    if (s.y + s.h < topWorld - 40 || s.y > bottomWorld + 40) continue
                    solid(s, glow, gridColor)
                }

                // ---- decorations
                for (d in map.decorations) {
                    if (d.type != "glow" && (d.x < left - 400 || d.x > right + 400)) continue
                    decoration(d, time, measurer)
                }

                // ---- pickups
                for (p in vm.pickups()) {
                    if (p.x < left - 40 || p.x > right + 40) continue
                    pickup(p, hexColor(vm.content.pickupColor(p.t)), time)
                }

                // ---- projectiles
                for (b in vm.bullets()) {
                    if (b.x < left - 60 || b.x > right + 60) continue
                    projectile(b, time)
                }

                // ---- soldiers: everyone else first, the local player last so
                //      their own body is never hidden behind a team-mate.
                val views = vm.renderViews(nowMs)

                // ---- capture-the-flag banners. A carried flag rides the body
                //      holding it, so it is positioned from that view.
                for (f in vm.flags()) {
                    val color = if (f.team == "red") Color(0xFFFF5D5D) else Color(0xFF4CC9F0)
                    if (!f.atBase) flagBase(f.bx, f.by, color, time)
                    val carrier = if (f.c != null) views.firstOrNull { it.id == f.c } else null
                    flag(
                        x = carrier?.x ?: f.x,
                        y = carrier?.y ?: f.y,
                        color = color,
                        atBase = f.atBase,
                        carried = carrier != null,
                        t = time,
                    )
                }

                for (v in views) {
                    if (v.local || v.spectator) continue
                    if (v.x < left - 120 || v.x > right + 120) continue
                    soldier(v, time, vm.content.weapon(v.weaponId))
                    drawNameplate(v)
                }
                for (v in views) {
                    if (!v.local) continue
                    soldier(v, time, vm.content.weapon(v.weaponId))
                }

                // ---- transient effects
                for (e in vm.effects) {
                    effect(e, measurer)
                }

                // ---- crosshair at the aim point
                val spread = if (vm.hud.reloading) 14f else 0f
                crosshair(
                    vm.aimPointX,
                    vm.aimPointY,
                    if (vm.hud.reloading) ArenaColors.warn else ArenaColors.accent.copy(alpha = 0.9f),
                    spread,
                )
            }

            // ---- screen-space hit feedback. Drawn here rather than in the HUD
            //      composable so it animates at the frame rate instead of at the
            //      rate the HUD state happens to change.
            if (vm.hitMarker > 0.01) {
                val a = vm.hitMarker.toFloat().coerceIn(0f, 1f)
                val c = ArenaColors.warn.copy(alpha = a)
                val cx = size.width / 2f
                val cy = size.height / 2f
                val gap = 6f
                val len = 10f
                drawLine(c, Offset(cx - gap - len, cy - gap - len), Offset(cx - gap, cy - gap), 3f)
                drawLine(c, Offset(cx + gap + len, cy - gap - len), Offset(cx + gap, cy - gap), 3f)
                drawLine(c, Offset(cx - gap - len, cy + gap + len), Offset(cx - gap, cy + gap), 3f)
                drawLine(c, Offset(cx + gap + len, cy + gap + len), Offset(cx + gap, cy + gap), 3f)
            }
            if (vm.damageFlash > 0.01) {
                val a = (vm.damageFlash * 0.35).toFloat().coerceIn(0f, 1f)
                drawRect(ArenaColors.danger.copy(alpha = a), Offset.Zero, Size(size.width, size.height))
            }
        }

        if (vm.screen != Screen.MENU) {
            ControlLayer(vm, enabled = vm.screen == Screen.GAME && vm.hud.alive)
        }
        Overlays(vm)
    }
}

/** Name + health bar above a remote soldier. */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawNameplate(v: com.milofit.arena.game.PlayerView) {
    val x = v.x.toFloat()
    val y = (v.y - v.build * 30.0).toFloat()
    val team = ArenaColors.team(v.team)

    if (!v.alive) {
        drawCircle(ArenaColors.muted.copy(alpha = 0.5f), 3f, Offset(x, y))
        return
    }

    val w = 46f
    val h = 4f
    drawRect(ArenaColors.bg.copy(alpha = 0.6f), Offset(x - w / 2f, y), Size(w, h))
    val hp = (v.hp / 100f).coerceIn(0f, 1f)
    drawRect(ArenaColors.hpBar, Offset(x - w / 2f, y), Size(w * hp, h))
    if (v.shield > 0) {
        val sh = (v.shield / 50f).coerceIn(0f, 1f)
        drawRect(ArenaColors.shieldBar, Offset(x - w / 2f, y - h - 1f), Size(w * sh, 2.5f))
    }
    drawRect(team.copy(alpha = 0.8f), Offset(x - w / 2f, y + h + 1f), Size(w, 1.5f))
}
