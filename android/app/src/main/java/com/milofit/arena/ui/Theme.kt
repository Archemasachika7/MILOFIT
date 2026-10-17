package com.milofit.arena.ui

import androidx.compose.ui.graphics.Color

/**
 * Colour helpers and the UI palette.
 *
 * Game content stores colours as CSS-style hex strings (the same values the web
 * client uses), so parsing lives here rather than being duplicated at each call
 * site. Parsing is cached because the render loop asks for the same handful of
 * character palettes thousands of times a second.
 */
private val hexCache = HashMap<String, Color>(64)

fun hexColor(hex: String, fallback: Color = Color.White): Color {
    hexCache[hex]?.let { return it }
    val parsed = parseHex(hex) ?: fallback
    hexCache[hex] = parsed
    return parsed
}

private fun parseHex(raw: String): Color? {
    val s = raw.trim()
    if (!s.startsWith("#")) return null
    val body = s.substring(1)
    return when (body.length) {
        3 -> {
            val r = body[0].digit() ?: return null
            val g = body[1].digit() ?: return null
            val b = body[2].digit() ?: return null
            Color(r * 17, g * 17, b * 17)
        }

        6 -> {
            val v = body.toLongOrNull(16) ?: return null
            Color((v shr 16).toInt() and 0xFF, (v shr 8).toInt() and 0xFF, v.toInt() and 0xFF)
        }

        8 -> {
            val v = body.toLongOrNull(16) ?: return null
            Color(
                ((v shr 16).toInt() and 0xFF),
                ((v shr 8).toInt() and 0xFF),
                (v.toInt() and 0xFF),
                ((v shr 24).toInt() and 0xFF),
            )
        }

        else -> null
    }
}

private fun Char.digit(): Int? {
    val c = lowercaseChar()
    return when (c) {
        in '0'..'9' -> c - '0'
        in 'a'..'f' -> c - 'a' + 10
        else -> null
    }
}

/** Chrome colours for the menu and HUD, matching web/style.css. */
object ArenaColors {
    val bg = Color(0xFF070B14)
    val panel = Color(0xE60E1626)
    val panelSolid = Color(0xFF0E1626)
    val panelEdge = Color(0x3D7F96BD)
    val text = Color(0xFFDBE6F5)
    val muted = Color(0xFF8FA6C6)
    val accent = Color(0xFF4CC9F0)
    val warn = Color(0xFFFFB703)
    val danger = Color(0xFFE63946)
    val good = Color(0xFFA8E063)
    val red = Color(0xFFE63946)
    val blue = Color(0xFF4CC9F0)
    val ffa = Color(0xFFFFD166)
    val hpBar = Color(0xFFE63946)
    val shieldBar = Color(0xFF4CC9F0)
    val jetBar = Color(0xFFFFB703)

    fun team(name: String?): Color = when (name) {
        "red" -> red
        "blue" -> blue
        "system" -> muted
        else -> ffa
    }
}
