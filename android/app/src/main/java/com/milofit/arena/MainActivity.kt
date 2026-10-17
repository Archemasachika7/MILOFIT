package com.milofit.arena

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.graphics.Color
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.milofit.arena.audio.Sfx
import com.milofit.arena.game.GameViewModel
import com.milofit.arena.ui.ArenaApp

/**
 * Single activity. The game is a Compose Canvas driven by a vsync frame callback,
 * so there is nothing to do here beyond setting up the window and handing control
 * to [ArenaApp].
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // A match is unplayable if the screen sleeps mid-firefight.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Landscape, immersive: the arena uses every pixel, and the on-screen
        // controls sit where the thumbs are rather than above a nav bar.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color(0xFF4CC9F0),
                    onPrimary = Color(0xFF04121C),
                    secondary = Color(0xFFFFB703),
                    background = Color(0xFF070B14),
                    onBackground = Color(0xFFDBE6F5),
                    surface = Color(0xFF0E1626),
                    onSurface = Color(0xFFDBE6F5),
                    error = Color(0xFFE63946),
                ),
            ) {
                val vm: GameViewModel = viewModel()
                ArenaApp(vm)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
    }

    override fun onPause() {
        super.onPause()
        // Silence the jetpack loop: coming back to a stuck rumble would be worse
        // than a moment of quiet.
        Sfx.setJetIntensity(0.0)
    }

    override fun onDestroy() {
        super.onDestroy()
        Sfx.release()
    }

    private fun hideSystemBars() {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }
}
