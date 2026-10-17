# MILOFIT

An original 2D platform shooter with a web version and a Kotlin Android version.

All graphics are drawn in code and all maps, weapons, and characters are original. No assets from any
third-party game are included.

## Layout
- `web/` - browser version (plain HTML/Canvas/JS, no build step).
  - `index.html`, `game.js` (physics, bots, rendering), `maps.js` (maps), `weapons.js` (weapons).
- `android/` - Kotlin Android app (Gradle, minSdk 24).
  - `GameEngine.kt` - pure game logic (mirrors `web/game.js`).
  - `GameView.kt` - SurfaceView renderer and on-screen touch controls.
  - `Models.kt` - maps and weapons (mirrors `maps.js` / `weapons.js`).

## Run the web version
    cd web && python3 -m http.server 8080
Open http://localhost:8080

## Build the Android app
Open `android/` in Android Studio (Hedgehog or newer) and run the `app` configuration, or:
    cd android && ./gradlew assembleDebug

Controls (web): WASD/arrows to move, W/Space to jump (hold for jetpack), mouse to aim, click to fire,
R to reload, 1-3 to switch weapons.
Controls (Android): on-screen buttons for left/right/jump/fire/reload; touch the play area to aim.
