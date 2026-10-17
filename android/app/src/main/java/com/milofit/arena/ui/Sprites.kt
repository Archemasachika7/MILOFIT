package com.milofit.arena.ui

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.milofit.arena.data.Decoration
import com.milofit.arena.data.Palette
import com.milofit.arena.data.Solid
import com.milofit.arena.data.Weapon
import com.milofit.arena.game.Effect
import com.milofit.arena.game.PlayerView
import com.milofit.arena.net.BulletSnap
import com.milofit.arena.net.PickupSnap
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * All arena artwork, drawn procedurally from the content files.
 *
 * There are no image assets in this project: soldiers come from the palettes in
 * characters.json, weapons from the shapes below keyed by weapon id, and the
 * world from the map's solids and decorations. This mirrors web/src/sprites.js —
 * the two should look like the same game.
 *
 * Everything here is a DrawScope extension so it can be called from inside a
 * single Canvas draw pass without allocating composables.
 */

private const val TAU = (PI * 2).toFloat()

// ------------------------------------------------------------------ solids

fun DrawScope.solid(s: Solid, glow: Color, gridColor: Color) {
    val x = s.x.toFloat()
    val y = s.y.toFloat()
    val w = s.w.toFloat()
    val h = s.h.toFloat()
    when (s.type) {
        "wall" -> {
            drawRect(Color(0xFF1B2334), Offset(x, y), Size(w, h))
            drawRect(glow.copy(alpha = 0.67f), Offset(x, y), Size(w, 2f))
            drawRect(Color.Black.copy(alpha = 0.35f), Offset(x, y + h - 2f), Size(w, 2f))
            // vertical strap detail
            var sx = x + 14f
            while (sx < x + w - 8f) {
                drawRect(Color.Black.copy(alpha = 0.22f), Offset(sx, y + 4f), Size(4f, max(0f, h - 8f)))
                sx += 46f
            }
        }

        "ground" -> {
            val gradH = min(h, 220f)
            drawRect(
                brush = Brush.linearGradient(
                    colors = listOf(Color(0xFF3B4A66), Color(0xFF2A3650), Color(0xFF161E2E)),
                    start = Offset(x, y),
                    end = Offset(x, y + gradH),
                ),
                topLeft = Offset(x, y),
                size = Size(w, h),
            )
            drawRect(Color(0xFF7F96BD), Offset(x, y), Size(w, 3f))
            var ly = y + 16f
            while (ly < y + h) {
                drawRect(Color.White.copy(alpha = 0.05f), Offset(x, ly), Size(w, 1f))
                ly += 34f
            }
            // A few surface details so a large slab does not read as a flat
            // rectangle; positions are derived from the solid's own origin.
            if (h > 46f) {
                val grain = gridColor.copy(alpha = 0.14f)
                var gx = x + 34f
                while (gx < x + w - 20f) {
                    drawRect(grain, Offset(gx, y + 25f), Size(1.5f, min(h - 30f, 96f)))
                    gx += 78f
                }
                var gy2 = y + 120f
                while (gy2 < y + h - 26f) {
                    drawRect(grain, Offset(x + 12f, gy2), Size(w - 24f, 1.5f))
                    gy2 += 88f
                }
                drawRect(Color.Black.copy(alpha = 0.18f), Offset(x, y + h - 10f), Size(w, 10f))
            }
        }

        else -> {
            // one-way platform
            drawRect(Color(0xFF212C42), Offset(x, y), Size(w, h))
            drawRect(Color(0xFF3A4864), Offset(x, y), Size(w, 3f))
            var py = y + 24f
            while (py < y + h) {
                drawRect(Color.Black.copy(alpha = 0.28f), Offset(x, py), Size(w, 2f))
                py += 44f
            }
        }
    }
}

// ------------------------------------------------------------- decorations

fun DrawScope.decoration(d: Decoration, time: Double, measurer: TextMeasurer) {
    val x = d.x.toFloat()
    val y = d.y.toFloat()
    when (d.type) {
        "pylon" -> {
            val h = (if (d.h > 0) d.h else 160.0).toFloat()
            val color = hexColor(d.color, Color(0xFF2B5AA0))
            drawRect(color, Offset(x - 12f, y - h), Size(24f, h))
            drawRect(Color.White.copy(alpha = 0.14f), Offset(x - 12f, y - h), Size(6f, h))
            drawCircle(Color.White.copy(alpha = 0.6f), 5f, Offset(x, y - h - 8f))
        }

        "girder" -> {
            val w = (if (d.w > 0) d.w else 100.0).toFloat()
            val color = hexColor(d.color, Color(0xFF5C4632))
            drawLine(color, Offset(x, y), Offset(x + w, y), 6f, StrokeCap.Round)
            var gx = x
            while (gx < x + w) {
                val p = Path().apply {
                    moveTo(gx, y - 7f)
                    lineTo(gx + 13f, y + 7f)
                    lineTo(gx + 26f, y - 7f)
                }
                drawPath(p, color, style = Stroke(2f))
                gx += 26f
            }
        }

        "stalactite" -> {
            val h = (if (d.h > 0) d.h else 140.0).toFloat()
            val p = Path().apply {
                moveTo(x - 22f, y)
                lineTo(x + 22f, y)
                lineTo(x, y + h)
                close()
            }
            drawPath(p, hexColor(d.color, Color(0xFF243352)))
            val shine = Path().apply {
                moveTo(x - 22f, y)
                lineTo(x - 6f, y)
                lineTo(x, y + h)
                close()
            }
            drawPath(shine, Color.White.copy(alpha = 0.05f))
        }

        "glow" -> {
            val r = (if (d.radius > 0) d.radius else 240.0).toFloat()
            val color = hexColor(d.color, Color(0xFF4CC9F0))
            val a = (if (d.alpha > 0) d.alpha else 0.1).toFloat()
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(color.copy(alpha = a), Color.Transparent),
                    center = Offset(x, y),
                    radius = r,
                ),
                radius = r,
                center = Offset(x, y),
            )
        }

        "sign" -> {
            val alpha = (0.5 + sin(time * 1.8) * 0.14).toFloat().coerceIn(0f, 1f)
            val style = TextStyle(
                color = Color(0xFF9FB6DD).copy(alpha = alpha),
                fontWeight = FontWeight.Bold,
                fontSize = 26f.sp,
            )
            // Measure first so the label can be centred on the decoration.
            val layout = measurer.measure(AnnotatedString(d.text), style)
            drawText(
                textMeasurer = measurer,
                text = d.text,
                topLeft = Offset(
                    x - layout.size.width / 2f,
                    y - layout.size.height / 2f,
                ),
                style = style,
            )
        }
    }
}

// ---------------------------------------------------------------- pickups

fun DrawScope.pickup(p: PickupSnap, color: Color, t: Double) {
    val bob = sin(t * 2.6 + p.x * 0.01) * 3.0
    val y = p.y + bob

    translate(p.x.toFloat(), y.toFloat()) {
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(color.copy(alpha = 0.4f), Color.Transparent),
                center = Offset.Zero,
                radius = 26f,
            ),
            radius = 26f,
            center = Offset.Zero,
        )

        val pulse = (0.72 + sin(t * 3.4) * 0.1).toFloat()
        rotate((t * 0.9 * 180.0 / PI).toFloat(), Offset.Zero) {
            val diamond = Path().apply {
                moveTo(0f, -13f)
                lineTo(13f, 0f)
                lineTo(0f, 13f)
                lineTo(-13f, 0f)
                close()
            }
            drawPath(diamond, color.copy(alpha = pulse))
            drawPath(diamond, Color(0xE60A0E18), style = Stroke(2f))
        }

        // Glyph drawn as geometry so the world pass needs no text measuring.
        val glyph = Color(0xFF08111C)
        when (p.t) {
            "health" -> {
                drawRect(glyph, Offset(-1.5f, -5f), Size(3f, 10f))
                drawRect(glyph, Offset(-5f, -1.5f), Size(10f, 3f))
            }

            "shield" -> {
                val p2 = Path().apply {
                    moveTo(0f, -6f)
                    lineTo(6f, 0f)
                    lineTo(0f, 6f)
                    lineTo(-6f, 0f)
                    close()
                }
                drawPath(p2, glyph, style = Stroke(2f))
            }

            "ammo" -> {
                for (i in -1..1) {
                    drawRect(glyph, Offset(-4f + i * 4f, -4f), Size(2f, 8f))
                }
            }

            else -> {
                val p2 = Path().apply {
                    moveTo(0f, -6f)
                    lineTo(2.2f, -1.6f)
                    lineTo(6f, -1.2f)
                    lineTo(3.2f, 1.6f)
                    lineTo(4.2f, 6f)
                    lineTo(0f, 3.4f)
                    lineTo(-4.2f, 6f)
                    lineTo(-3.2f, 1.6f)
                    lineTo(-6f, -1.2f)
                    lineTo(-2.2f, -1.6f)
                    close()
                }
                drawPath(p2, glyph)
            }
        }
    }
}

// ------------------------------------------------------------- projectiles

fun DrawScope.projectile(b: BulletSnap, t: Double) {
    val angle = if (b.a != 0.0) b.a else atan2(0.0, 1.0)
    translate(b.x.toFloat(), b.y.toFloat()) {
        rotate((angle * 180.0 / PI).toFloat(), Offset.Zero) {
            when (b.k) {
                "flame" -> {
                    drawCircle(
                        brush = Brush.radialGradient(
                            colors = listOf(
                                Color(0xF2FFF5C8),
                                Color(0xCCFF9628),
                                Color.Transparent,
                            ),
                            center = Offset.Zero,
                            radius = 12f,
                        ),
                        radius = 12f,
                        center = Offset.Zero,
                    )
                }

                "grenade" -> {
                    drawCircle(Color(0xFF3F5230), 5.5f, Offset.Zero)
                    drawCircle(Color(0xFF151B26), 5.5f, Offset.Zero, style = Stroke(1.6f))
                    drawCircle(Color(0xFFF2E14C), 2.2f, Offset.Zero)
                }

                "projectile" -> {
                    drawRect(
                        brush = Brush.linearGradient(
                            colors = listOf(Color.Transparent, Color(0xF2FFB450)),
                            start = Offset(-18f, 0f),
                            end = Offset(4f, 0f),
                        ),
                        topLeft = Offset(-18f, -2.4f),
                        size = Size(22f, 4.8f),
                    )
                    val nose = Path().apply {
                        moveTo(9f, 0f)
                        lineTo(0f, -4.4f)
                        lineTo(0f, 4.4f)
                        close()
                    }
                    drawPath(nose, Color(0xFFFF6B35))
                }

                else -> {
                    // The snapshot carries a bullet's angle but never its
                    // velocity, so the trail is a fixed length rather than
                    // scaling with speed.
                    val len = 24f
                    drawRect(
                        brush = Brush.linearGradient(
                            colors = listOf(Color.Transparent, Color(0xF2FFF6C8)),
                            start = Offset(-len, 0f),
                            end = Offset(4f, 0f),
                        ),
                        topLeft = Offset(-len, -1.5f),
                        size = Size(len + 4f, 3f),
                    )
                    drawCircle(Color(0xFFFFF8DC), 2f, Offset.Zero)
                }
            }
        }
    }
}

// ---------------------------------------------------------------- soldiers

/**
 * The soldier, drawn from the centre of its AABB with +y pointing down, so the
 * body spans -23 (head) .. +23 (feet) for the default 46px tall body.
 */
fun DrawScope.soldier(
    view: PlayerView,
    time: Double,
    weapon: Weapon?,
    alpha: Float = 1f,
) {
    val palette = view.palette ?: return
    val outline = hexColor(palette.outline, Color(0xFF0D1420))
    val skin = hexColor(palette.skin)
    val torso = hexColor(palette.torso)
    val limbs = hexColor(palette.limbs)
    val accent = hexColor(palette.accent)
    val build = view.build.toFloat().coerceIn(0.8f, 1.3f)

    withTransform({
        translate(view.x.toFloat(), view.y.toFloat())
        scale((if (view.facing >= 0) 1f else -1f) * build, build, pivot = Offset.Zero)
    }) {
        val localAim = atan2(sin(view.aim), (if (view.facing >= 0) 1 else -1) * cos(view.aim))
        val aimF = localAim.toFloat()
        val dead = !view.alive
        val bodyAlpha = if (dead) 0.35f else alpha

        val lineW = 5.2f

        // legs ---------------------------------------------------------
        val swing = if (view.onGround && !view.jetting) sin(view.walk) * 7.0 else if (view.jetting) 2.5 else 4.0
        fun leg(hipX: Float, footX: Float, footY: Float) {
            drawLine(outline, Offset(hipX, 4f), Offset(footX, footY), lineW + 1.6f, StrokeCap.Round, alpha = bodyAlpha)
            drawLine(limbs, Offset(hipX, 4f), Offset(footX, footY), lineW, StrokeCap.Round, alpha = bodyAlpha)
        }
        if (view.jetting || !view.onGround) {
            leg(-2f, (-7f - swing * 0.2).toFloat(), 22f)
            leg(2f, (7f + swing * 0.2).toFloat(), 22f)
        } else {
            leg(-2f, (-2f + swing).toFloat(), (22f - max(0.0, swing) * 0.55).toFloat())
            leg(2f, (2f - swing).toFloat(), (22f - max(0.0, -swing) * 0.55).toFloat())
        }

        // jetpack + flame ----------------------------------------------
        if (view.jetting) {
            val pack = Path().apply {
                moveTo(-9f, -6f)
                lineTo(-4f, -4f)
                lineTo(-4f, 6f)
                lineTo(-9f, 8f)
                close()
            }
            drawPath(pack, Color(0xFF2C3648).copy(alpha = bodyAlpha))
            drawPath(pack, outline.copy(alpha = bodyAlpha), style = Stroke(1.6f))

            val flicker = 10.0 + (sin(time * 47.0) * 0.5 + 0.5) * 9.0 + min(10.0, abs(view.vy) / 60.0)
            val flame = Path().apply {
                moveTo(-9f, 8f)
                quadraticTo(-6.5f, (8f + flicker * 0.7).toFloat(), -6.5f, (8f + flicker).toFloat())
                quadraticTo(-5.5f, (8f + flicker * 0.7).toFloat(), -4f, 8f)
                close()
            }
            drawPath(
                flame,
                Brush.linearGradient(
                    colors = listOf(Color(0xFFFFF3B0), Color(0xFFFFB703), Color.Transparent),
                    start = Offset(-7f, 8f),
                    end = Offset(-7f, (8f + flicker).toFloat()),
                ),
            )
        }

        // torso --------------------------------------------------------
        drawLine(outline, Offset(0f, 6f), Offset(0f, -8f), lineW + 3f, StrokeCap.Round, alpha = bodyAlpha)
        drawLine(torso, Offset(0f, 6f), Offset(0f, -8f), lineW + 1f, StrokeCap.Round, alpha = bodyAlpha)
        drawLine(accent, Offset(-3.4f, -2f), Offset(3.4f, 2.5f), 2.4f, StrokeCap.Round, alpha = bodyAlpha)

        // arms + weapon -------------------------------------------------
        val shoulder = Offset(0f, -7f)
        val armLen = 15f
        val hand = Offset(
            shoulder.x + cos(aimF) * armLen,
            shoulder.y + sin(aimF) * armLen,
        )
        fun arm(from: Offset, to: Offset) {
            drawLine(outline, from, to, lineW - 0.6f + 1.6f, StrokeCap.Round, alpha = bodyAlpha)
            drawLine(limbs, from, to, lineW - 0.6f, StrokeCap.Round, alpha = bodyAlpha)
        }
        arm(
            Offset(shoulder.x - 1f, shoulder.y + 1f),
            Offset(shoulder.x + cos(aimF - 0.5f) * 7f, shoulder.y + 4f),
        )
        arm(shoulder, hand)

        translate(hand.x, hand.y) {
            rotate(aimF * 180f / PI.toFloat(), Offset.Zero) {
                if (view.reloading) {
                    // A small dip reads as "working the action".
                    translate(0f, 3f) { gun(weapon, palette, bodyAlpha) }
                } else {
                    gun(weapon, palette, bodyAlpha)
                }
            }
        }

        // head ---------------------------------------------------------
        drawCircle(skin.copy(alpha = bodyAlpha), 7.2f, Offset(0f, -14f))
        drawCircle(outline.copy(alpha = bodyAlpha), 7.2f, Offset(0f, -14f), style = Stroke(1.8f))

        // Helmet: a slightly larger disc behind the head reads as a shell.
        drawCircle(torso.copy(alpha = bodyAlpha), 7.1f, Offset(0f, -15.4f))
        drawLine(accent.copy(alpha = bodyAlpha), Offset(2.4f, -14.6f), Offset(7f, -13.8f), 2.6f, StrokeCap.Round)

        // spawn shield -------------------------------------------------
        if (view.protectedNow) {
            val dashPhase = (time * 60.0).toFloat()
            drawCircle(
                color = Color(0xBF7EE0FF),
                radius = 26f,
                center = Offset(0f, -4f),
                style = Stroke(
                    width = 2f,
                    pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(
                        floatArrayOf(6f, 6f),
                        dashPhase,
                    ),
                ),
            )
        }
    }
}

/** The gun in local hand space, barrel pointing along +x. */
private fun DrawScope.gun(weapon: Weapon?, palette: Palette, alpha: Float) {
    val id = weapon?.id ?: "sidearm"
    val color = hexColor(weapon?.hud?.color ?: "#cfd8e6", Color(0xFFCFD8E6))
    val dark = Color(0xFF1B2231)

    fun part(x: Float, y: Float, w: Float, h: Float, fill: Color, r: Float = 2f) {
        drawRoundRect(fill.copy(alpha = alpha), Offset(x, y), Size(w, h), CornerRadius(r, r))
        drawRoundRect(
            dark.copy(alpha = alpha),
            Offset(x, y),
            Size(w, h),
            CornerRadius(r, r),
            style = Stroke(1.6f),
        )
    }

    when (id) {
        "basher" -> {
            val blade = Path().apply {
                moveTo(6f, -2.5f)
                lineTo(26f, -1f)
                lineTo(30f, 1f)
                lineTo(26f, 3f)
                lineTo(6f, 2.5f)
                close()
            }
            drawPath(blade, Color(0xFFDFE7F5).copy(alpha = alpha))
            drawPath(blade, hexColor(palette.outline).copy(alpha = alpha), style = Stroke(1.6f))
            drawRect(color.copy(alpha = alpha), Offset(4f, -3.5f), Size(7f, 7f))
        }

        "sidearm" -> {
            part(2f, -3.5f, 16f, 7f, dark)
            drawRect(color.copy(alpha = alpha), Offset(3f, -2.4f), Size(13f, 2f))
            part(4f, 2f, 6f, 9f, dark)
        }

        "ripper" -> {
            part(0f, -4f, 24f, 8f, dark, 2.5f)
            part(8f, 3f, 6f, 11f, dark)
            drawRect(color.copy(alpha = alpha), Offset(1f, -2.6f), Size(21f, 2.2f))
        }

        "bulldog" -> {
            part(-2f, -3.6f, 30f, 7.2f, dark, 2.5f)
            part(6f, 3f, 7f, 12f, dark)
            val stock = Path().apply {
                moveTo(-2f, -3.6f)
                lineTo(-8f, 0f)
                lineTo(-2f, 3.6f)
                close()
            }
            drawPath(stock, dark.copy(alpha = alpha))
            drawRect(color.copy(alpha = alpha), Offset(0f, -2.4f), Size(26f, 2f))
        }

        "boomstick" -> {
            part(-3f, -4.4f, 32f, 4.4f, dark)
            part(-3f, 0.4f, 30f, 4f, dark)
            part(4f, 4f, 8f, 10f, dark)
            drawRect(color.copy(alpha = alpha), Offset(0f, -3.4f), Size(28f, 1.8f))
        }

        "longshot" -> {
            part(-6f, -3.2f, 42f, 6.4f, dark, 2.5f)
            part(8f, -9f, 12f, 6f, dark)       // scope
            part(6f, 3f, 7f, 11f, dark)
            drawRect(color.copy(alpha = alpha), Offset(-2f, -1.6f), Size(34f, 1.6f))
        }

        "shredder" -> {
            part(-3f, -5.2f, 30f, 10.4f, dark, 3f)
            part(4f, 4f, 10f, 14f, dark, 3f)
            drawCircle(dark.copy(alpha = alpha), 9f, Offset(12f, 10f), style = Stroke(2f))
            drawRect(color.copy(alpha = alpha), Offset(0f, -3.4f), Size(26f, 2.4f))
        }

        "flamer" -> {
            part(0f, -4f, 22f, 8f, dark, 3f)
            val nozzle = Path().apply {
                moveTo(22f, -3f)
                lineTo(30f, -5.5f)
                lineTo(30f, 5.5f)
                lineTo(22f, 3f)
                close()
            }
            drawPath(nozzle, color.copy(alpha = alpha))
            drawPath(nozzle, dark.copy(alpha = alpha), style = Stroke(1.6f))
        }

        "rocket" -> {
            part(-6f, -5.6f, 38f, 11.2f, dark, 4f)
            drawCircle(color.copy(alpha = alpha), 4.6f, Offset(28f, 0f))
            drawCircle(dark.copy(alpha = alpha), 4.6f, Offset(28f, 0f), style = Stroke(1.4f))
        }

        "frag" -> {
            drawCircle(Color(0xFF4D6B3C).copy(alpha = alpha), 5f, Offset(6f, 0f))
            drawCircle(dark.copy(alpha = alpha), 5f, Offset(6f, 0f), style = Stroke(1.6f))
        }

        else -> part(0f, -3f, 20f, 6f, dark)
    }
}

// ----------------------------------------------------------------- effects

fun DrawScope.effect(e: Effect, measurer: TextMeasurer) {
    val a = e.alpha.toFloat()
    when (e.kind) {
        "muzzle" -> translate(e.x.toFloat(), e.y.toFloat()) {
            rotate((e.angle * 180.0 / PI).toFloat(), Offset.Zero) {
                val len = 26f * a + 8f
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(Color(0xFFFFF3B0).copy(alpha = a), Color.Transparent),
                        center = Offset.Zero,
                        radius = len,
                    ),
                    radius = len,
                    center = Offset.Zero,
                )
            }
        }

        "impact" -> translate(e.x.toFloat(), e.y.toFloat()) {
            val color = if (e.flesh) Color(0xFFE63946) else Color(0xFFFFE29A)
            drawCircle(color.copy(alpha = a * 0.85f), 7f * a + 2f, Offset.Zero)
            for (i in 0 until 4) {
                val ang = e.seed + i * (TAU / 4f)
                val r = 4f + (1f - a) * 13f
                drawLine(
                    color.copy(alpha = a * 0.8f),
                    Offset((cos(ang) * 3f).toFloat(), (sin(ang) * 3f).toFloat()),
                    Offset((cos(ang) * r).toFloat(), (sin(ang) * r).toFloat()),
                    1.8f,
                    StrokeCap.Round,
                )
            }
        }

        "explosion" -> translate(e.x.toFloat(), e.y.toFloat()) {
            val r = (e.radius * (0.55f + e.progress.toFloat() * 0.6f)).toFloat()
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        Color(0xFFFFF3B0).copy(alpha = a),
                        Color(0xFFFF6B35).copy(alpha = a * 0.55f),
                        Color.Transparent,
                    ),
                    center = Offset.Zero,
                    radius = max(1f, r),
                ),
                radius = max(1f, r),
                center = Offset.Zero,
            )
        }

        "ring" -> translate(e.x.toFloat(), e.y.toFloat()) {
            val r = (e.radius * (0.35f + e.progress.toFloat() * 0.75f)).toFloat()
            drawCircle(
                color = Color(e.color).copy(alpha = a * 0.9f),
                radius = max(1f, r),
                center = Offset.Zero,
                style = Stroke(2.4f),
            )
        }

        "damage" -> translate(e.x.toFloat(), e.y.toFloat()) {
            val rise = e.progress.toFloat() * 26f
            val color = if (e.shield) Color(0xFF4CC9F0) else Color(0xFFFFD166)
            drawCircle(color.copy(alpha = a * 0.22f), 17f, Offset(0f, -rise))
            val style = TextStyle(
                color = color.copy(alpha = a.coerceIn(0f, 1f)),
                fontWeight = FontWeight.Bold,
                fontSize = 20f.sp,
            )
            val layout = measurer.measure(AnnotatedString(e.text), style)
            drawText(
                textMeasurer = measurer,
                text = e.text,
                topLeft = Offset(-layout.size.width / 2f, -rise - layout.size.height / 2f),
                style = style,
            )
        }
    }
}

/** Crosshair at the aim point. */
fun DrawScope.crosshair(x: Double, y: Double, color: Color, spread: Float = 0f) {
    translate(x.toFloat(), y.toFloat()) {
        val gap = 5f + spread
        val len = 8f
        drawLine(color, Offset(-gap - len, 0f), Offset(-gap, 0f), 2f, StrokeCap.Round)
        drawLine(color, Offset(gap, 0f), Offset(gap + len, 0f), 2f, StrokeCap.Round)
        drawLine(color, Offset(0f, -gap - len), Offset(0f, -gap), 2f, StrokeCap.Round)
        drawLine(color, Offset(0f, gap), Offset(0f, gap + len), 2f, StrokeCap.Round)
        drawCircle(color, 1.6f, Offset.Zero)
    }
}

/** Small weapon silhouette for the HUD and the character/loadout pickers. */
fun DrawScope.weaponIcon(weapon: Weapon?, size: Float, tint: Color) {
    if (weapon == null) return
    val k = size / 40f
    withTransform({ scale(k, k, pivot = Offset.Zero) }) {
        val dark = tint.copy(alpha = 0.95f)
        when (weapon.id) {
            "basher" -> {
                val p = Path().apply {
                    moveTo(4f, -3f)
                    lineTo(34f, -1f)
                    lineTo(38f, 1f)
                    lineTo(34f, 3f)
                    lineTo(4f, 3f)
                    close()
                }
                drawPath(p, dark)
            }

            "boomstick", "longshot" -> {
                drawRect(dark, Offset(2f, -3.5f), Size(36f, 7f))
                drawRect(dark, Offset(8f, 3f), Size(6f, 9f))
                if (weapon.id == "longshot") drawRect(dark, Offset(14f, -10f), Size(12f, 5f))
            }

            "rocket" -> {
                drawRoundRect(dark, Offset(2f, -6f), Size(36f, 12f), CornerRadius(5f, 5f))
                drawCircle(dark, 3f, Offset(34f, 0f))
            }

            "frag" -> drawCircle(dark, 8f, Offset(20f, 0f))

            "flamer" -> {
                drawRect(dark, Offset(2f, -5f), Size(26f, 10f))
                val p = Path().apply {
                    moveTo(28f, -4f)
                    lineTo(38f, -7f)
                    lineTo(38f, 7f)
                    lineTo(28f, 4f)
                    close()
                }
                drawPath(p, dark)
            }

            "shredder" -> {
                drawRect(dark, Offset(2f, -6f), Size(32f, 12f))
                drawCircle(dark, 6f, Offset(16f, 10f))
            }

            else -> {
                drawRect(dark, Offset(2f, -4f), Size(34f, 8f))
                drawRect(dark, Offset(10f, 3f), Size(6f, 9f))
            }
        }
    }
}

// ------------------------------------------------------------ capture the flag

/**
 * The home pad, drawn at a team's base while its flag is out in the field so
 * whoever is chasing it can see where to bring it back.
 */
fun DrawScope.flagBase(x: Double, y: Double, color: Color, t: Double) {
    val pulse = 0.34f + (sin(t * 2.2) * 0.12).toFloat()
    translate(x.toFloat(), y.toFloat()) {
        drawOval(
            color = color.copy(alpha = pulse),
            topLeft = Offset(-26f, -3f),
            size = Size(52f, 18f),
            style = Stroke(
                width = 2f,
                pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(6f, 5f)),
            ),
        )
        drawOval(
            color = color.copy(alpha = pulse * 0.5f),
            topLeft = Offset(-14f, 1f),
            size = Size(28f, 10f),
            style = Stroke(width = 2f),
        )
    }
}

/**
 * A team's flag. A carried one is slung back over the runner's shoulder; a
 * planted one ripples where it stands. `x` doubles as the wave phase, so the
 * two teams' flags do not flap in lockstep.
 */
fun DrawScope.flag(x: Double, y: Double, color: Color, atBase: Boolean, carried: Boolean, t: Double) {
    translate(x.toFloat(), y.toFloat()) {
        if (carried) {
            rotate(-22f, Offset.Zero) { flagCloth(color, 30f, t, x) }
        } else {
            if (atBase) {
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(color.copy(alpha = 0.33f), Color.Transparent),
                        center = Offset(0f, -22f),
                        radius = 46f,
                    ),
                    radius = 46f,
                    center = Offset(0f, -22f),
                )
            }
            flagCloth(color, 50f, t, x)
        }
    }
}

/** The pole plus the rippling cloth, shared by the carried and planted states. */
private fun DrawScope.flagCloth(color: Color, len: Float, t: Double, phase: Double) {
    drawLine(Color(0xE6080C14), Offset(0f, 5f), Offset(0f, -len), 4f, StrokeCap.Round)
    drawLine(Color(0xFFC9D6EE), Offset(0f, 4f), Offset(0f, -len), 1.5f, StrokeCap.Round)

    val wave = (sin(t * 3.4 + phase * 0.02) * 3.0).toFloat()
    val cloth = Path().apply {
        moveTo(0f, -len)
        quadraticTo(14f, -len + 6f + wave, 27f, -len + 10f + wave)
        lineTo(27f, -len + 25f + wave)
        quadraticTo(14f, -len + 21f + wave, 0f, -len + 26f)
        close()
    }
    drawPath(cloth, color)
    drawPath(cloth, Color(0xCC080C14), style = Stroke(width = 1.5f))
}
