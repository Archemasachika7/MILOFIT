package com.milofit.game

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView

// Draws the GameEngine state and handles on-screen touch controls.
class GameView(context: Context, var engine: GameEngine) : SurfaceView(context), SurfaceHolder.Callback, Runnable {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var running = false
    private var thread: Thread? = null
    private var scale = 1f
    private var offX = 0f
    private var offY = 0f

    init { holder.addCallback(this) }

    override fun surfaceCreated(h: SurfaceHolder) { start() }
    override fun surfaceChanged(h: SurfaceHolder, f: Int, w: Int, hh: Int) {
        scale = minOf(w / Content.WORLD_W, hh / Content.WORLD_H)
        offX = (w - Content.WORLD_W * scale) / 2f
        offY = (hh - Content.WORLD_H * scale) / 2f
    }
    override fun surfaceDestroyed(h: SurfaceHolder) { stop() }

    fun start() {
        if (running) return
        running = true
        thread = Thread(this).also { it.start() }
    }

    fun stop() {
        running = false
        thread?.join()
        thread = null
    }

    override fun run() {
        while (running) {
            val c = holder.lockCanvas() ?: continue
            try {
                engine.update()
                drawFrame(c)
            } finally {
                holder.unlockCanvasAndPost(c)
            }
            Thread.sleep(16)
        }
    }

    private fun drawFrame(c: Canvas) {
        c.drawColor(Color.parseColor("#1B2433"))
        c.save()
        c.translate(offX, offY)
        c.scale(scale, scale)

        paint.style = Paint.Style.FILL
        paint.color = Color.parseColor("#3B4A63")
        for (p in engine.map.platforms) c.drawRect(p.x, p.y, p.x + p.w, p.y + p.h, paint)
        paint.color = Color.parseColor("#56627A")
        for (p in engine.map.platforms) c.drawRect(p.x, p.y, p.x + p.w, p.y + 4, paint)

        for (p in engine.players) {
            if (p.dead) continue
            paint.color = if (p.isBot) GameEngine.ENEMY_COLOR else GameEngine.PLAYER_COLOR
            c.drawRect(p.x, p.y, p.x + p.w, p.y + p.h, paint)
            paint.color = Color.parseColor("#0D1117")
            val vx = if (p.facing > 0) p.x + 12 else p.x + 2
            c.drawRect(vx, p.y + 7, vx + 8, p.y + 13, paint)
            val cx = p.x + p.w / 2
            val cy = p.y + p.h / 3
            val a = Math.toDegrees(kotlin.math.atan2(p.aimY - cy, p.aimX - cx).toDouble()).toFloat()
            c.save(); c.rotate(a, cx, cy)
            paint.color = p.weapon.color
            c.drawRect(cx, cy - 3, cx + 18, cy + 3, paint)
            c.restore()
            paint.color = Color.parseColor("#30363D")
            c.drawRect(p.x - 4, p.y - 10, p.x + p.w + 4, p.y - 6, paint)
            paint.color = Color.parseColor("#56D364")
            c.drawRect(p.x - 4, p.y - 10, p.x - 4 + (p.w + 8) * maxOf(0f, p.hp) / 100f, p.y - 6, paint)
        }

        for (b in engine.bullets) {
            paint.color = b.color
            c.drawRect(b.x - 2, b.y - 2, b.x + 2, b.y + 2, paint)
        }
        for (q in engine.particles) {
            paint.color = q.color
            paint.alpha = (255 * q.life / 40f).toInt().coerceIn(0, 255)
            c.drawRect(q.x, q.y, q.x + 4, q.y + 4, paint)
        }
        paint.alpha = 255
        c.restore()

        // HUD (screen space)
        val you = engine.players[0]
        paint.color = Color.parseColor("#E6EDF3")
        paint.textSize = 36f
        c.drawText(
            "HP ${maxOf(0f, you.hp).toInt()}  Jet ${you.jet.toInt()}  Ammo ${you.ammo}/${you.weapon.magSize}" +
                if (you.reloadDoneAt > 0) " (reloading)" else "",
            24f, 48f, paint
        )
        c.drawText("${you.weapon.name}  Score ${engine.scoreYou} - ${engine.scoreBots}", 24f, 90f, paint)
        drawControls(c)
    }

    private val controlRects = mutableMapOf<String, RectF>()

    private fun drawControls(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val s = 140f
        controlRects.clear()
        controlRects["left"] = RectF(20f, h - s - 20f, 20f + s, h - 20f)
        controlRects["right"] = RectF(180f, h - s - 20f, 180f + s, h - 20f)
        controlRects["jump"] = RectF(w - 300f, h - s - 20f, w - 160f, h - 20f)
        controlRects["fire"] = RectF(w - 150f, h - s - 20f, w - 20f, h - 20f)
        controlRects["reload"] = RectF(w - 150f, h - 2 * s - 40f, w - 20f, h - s - 40f)
        paint.style = Paint.Style.FILL
        for ((k, r) in controlRects) {
            paint.color = Color.argb(70, 255, 255, 255)
            c.drawRoundRect(r, 24f, 24f, paint)
            paint.color = Color.WHITE
            paint.textSize = 32f
            c.drawText(k.uppercase(), r.left + 24f, r.centerY() + 12f, paint)
        }
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        engine.moveAxis = 0; engine.jumpHeld = false; engine.fireHeld = false
        for (i in 0 until e.pointerCount) {
            if (e.actionMasked == MotionEvent.ACTION_UP || e.actionMasked == MotionEvent.ACTION_POINTER_UP) {
                if (e.actionIndex == i) continue
            }
            val tx = e.getX(i); val ty = e.getY(i)
            val p = { r: RectF -> r.contains(tx, ty) }
            controlRects["left"]?.takeIf(p)?.let { engine.moveAxis = -1 }
            controlRects["right"]?.takeIf(p)?.let { engine.moveAxis = 1 }
            controlRects["jump"]?.takeIf(p)?.let { engine.jumpHeld = true }
            controlRects["fire"]?.takeIf(p)?.let { engine.fireHeld = true }
            if (e.actionMasked == MotionEvent.ACTION_DOWN || e.actionMasked == MotionEvent.ACTION_POINTER_DOWN) {
                if (i == e.actionIndex) controlRects["reload"]?.takeIf(p)?.let { engine.reloadRequested = true }
            }
            if (controlRects["fire"]?.contains(tx, ty) != true) {
                // aim with touches on the upper area
                val wx = (tx - offX) / scale; val wy = (ty - offY) / scale
                engine.aimX = wx; engine.aimY = wy
            }
        }
        return true
    }
}
