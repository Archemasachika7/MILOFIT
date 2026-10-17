package com.milofit.game

import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var gameView: GameView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val engine = GameEngine(Content.maps[0], Content.weapons[0])
        gameView = GameView(this, engine)
        setContentView(gameView)
        hideSystemBars()
    }

    override fun onResume() { super.onResume(); gameView.start() }
    override fun onPause() { super.onPause(); gameView.stop() }

    private fun hideSystemBars() {
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
    }
}
