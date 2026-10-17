package com.milofit.arena.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * Every sound in the game, synthesised to PCM in-process.
 *
 * The project ships no audio files, so — exactly like the web client, which uses
 * WebAudio — each effect is generated from shaped noise and pitched tones. The
 * sounds here are the same recipes as web/src/audio.js: gunshots are filtered
 * noise bursts with a pitched thump, explosions add a falling sine, pickups are
 * short FM blips, and the jetpack is a band-passed noise loop whose gain follows
 * how hard the player is thrusting.
 *
 * Implementation: one [AudioTrack] in stream mode (22.05 kHz mono) fed by a
 * writer thread that mixes a small pool of pre-rendered voices. Each effect is
 * rendered once on first use and reused, so firing a 1100 rpm machine gun costs
 * no allocation at all.
 *
 * Playback is best-effort. If the device refuses an AudioTrack (or audio is
 * unavailable), every call becomes a no-op rather than a crash — sound is not
 * worth taking the game down for.
 */
object Sfx {

    private const val SAMPLE_RATE = 22_050
    private const val CHUNK = 1024
    private const val VOICES = 32
    private const val MASTER = 0.55f

    @Volatile
    var muted: Boolean = false

    private var track: AudioTrack? = null
    private var writer: Thread? = null
    private var running = false

    private val cache = HashMap<String, ShortArray>()

    // Voice pool. Preallocated so triggering a sound never allocates.
    private val voiceData = arrayOfNulls<ShortArray>(VOICES)
    private val voicePos = IntArray(VOICES)
    private val voiceGain = FloatArray(VOICES)
    private val voiceActive = BooleanArray(VOICES)
    private var voiceCursor = 0

    // The jetpack loop owns a fixed slot of its own.
    private var jetData: ShortArray = ShortArray(0)
    private var jetPos = 0
    @Volatile
    private var jetGain = 0f

    @Synchronized
    fun init() {
        if (running) return
        val minBuffer = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer <= 0) return

        val built = try {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_GAME)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                )
                .setBufferSizeInBytes(max(minBuffer, CHUNK * 2 * 4))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
        } catch (_: Throwable) {
            return
        }

        if (built.state != AudioTrack.STATE_INITIALIZED) {
            built.release()
            return
        }

        jetData = cached("jet") { renderJetLoop() }
        track = built
        running = true
        try {
            built.play()
        } catch (_: Throwable) {
            running = false
            built.release()
            track = null
            return
        }

        writer = Thread({ pump() }, "milofit-audio").apply {
            isDaemon = true
            priority = Thread.NORM_PRIORITY + 1
            start()
        }
    }

    @Synchronized
    fun release() {
        running = false
        writer?.let { runCatching { it.join(200) } }
        writer = null
        track?.let { t ->
            runCatching { t.stop() }
            runCatching { t.release() }
        }
        track = null
        for (i in 0 until VOICES) {
            voiceActive[i] = false
            voiceData[i] = null
        }
    }

    // ------------------------------------------------------------------ mixing

    private fun pump() {
        val out = ShortArray(CHUNK)
        val mix = FloatArray(CHUNK)
        while (running) {
            java.util.Arrays.fill(mix, 0f)

            if (!muted) {
                // jetpack loop
                if (jetGain > 0.001f && jetData.isNotEmpty()) {
                    var p = jetPos
                    for (i in 0 until CHUNK) {
                        mix[i] += (jetData[p] / 32768f) * jetGain
                        p += 1
                        if (p >= jetData.size) p = 0
                    }
                    jetPos = p
                }

                for (v in 0 until VOICES) {
                    if (!voiceActive[v]) continue
                    val data = voiceData[v] ?: continue
                    var pos = voicePos[v]
                    val gain = voiceGain[v]
                    for (i in 0 until CHUNK) {
                        if (pos >= data.size) break
                        mix[i] += (data[pos] / 32768f) * gain
                        pos += 1
                    }
                    if (pos >= data.size) {
                        voiceActive[v] = false
                        voiceData[v] = null
                    } else {
                        voicePos[v] = pos
                    }
                }
            }

            for (i in 0 until CHUNK) {
                val s = mix[i] * MASTER
                out[i] = (when {
                    s > 1f -> 1f
                    s < -1f -> -1f
                    else -> s
                } * 32767f).toInt().toShort()
            }

            val t = track ?: break
            try {
                t.write(out, 0, CHUNK)
            } catch (_: Throwable) {
                break
            }
        }
    }

    private fun play(data: ShortArray, gain: Float) {
        if (!running || muted || data.isEmpty()) return
        val v = voiceCursor
        voiceCursor = (voiceCursor + 1) % VOICES
        voiceData[v] = data
        voicePos[v] = 0
        voiceGain[v] = gain.coerceIn(0f, 1f)
        voiceActive[v] = true
    }

    private fun cached(key: String, render: () -> ShortArray): ShortArray =
        cache.getOrPut(key) { render() }

    // ---------------------------------------------------------------- recipes

    private fun shotProfile(weaponId: String): Profile = when (weaponId) {
        "sidearm" -> Profile(0.34f, 1500.0, 0.11, 210.0, Wave.SQUARE)
        "ripper" -> Profile(0.22f, 2000.0, 0.07, 300.0, Wave.SQUARE)
        "bulldog" -> Profile(0.30f, 1250.0, 0.13, 170.0, Wave.SAW)
        "boomstick" -> Profile(0.46f, 800.0, 0.30, 90.0, Wave.SAW)
        "longshot" -> Profile(0.50f, 1900.0, 0.22, 130.0, Wave.SQUARE)
        "shredder" -> Profile(0.18f, 2400.0, 0.05, 380.0, Wave.SQUARE)
        "flamer" -> Profile(0.10f, 900.0, 0.08, 140.0, Wave.TRIANGLE)
        "rocket" -> Profile(0.44f, 500.0, 0.40, 80.0, Wave.SAW)
        "frag" -> Profile(0.30f, 700.0, 0.16, 150.0, Wave.TRIANGLE)
        "basher" -> Profile(0.24f, 2600.0, 0.09, 420.0, Wave.TRIANGLE)
        else -> Profile(0.34f, 1500.0, 0.11, 210.0, Wave.SQUARE)
    }

    private data class Profile(val gain: Float, val freq: Double, val dur: Double, val tone: Double, val wave: Wave)

    private enum class Wave { SINE, SQUARE, SAW, TRIANGLE }

    fun shot(weaponId: String, distanceGain: Double = 1.0) {
        if (!running || muted) return
        val p = shotProfile(weaponId)
        val g = max(0.02, p.gain * distanceGain).toFloat()
        // Named *Data so the call below reads unambiguously even though the
        // synth helpers happen to share these words.
        val noiseData = cached("shot.noise.${p.freq}.${p.dur}") {
            noise(p.dur, gain = 1.0, freq = p.freq, sweep = 0.35, q = 1.2)
        }
        val toneData = cached("shot.tone.${p.tone}.${p.dur}.${p.wave}") {
            tone(p.tone, p.dur * 1.2, gain = 0.5, wave = p.wave, to = p.tone * 0.55)
        }
        play(noiseData, g)
        play(toneData, g * 0.9f)
    }

    fun explosion(distanceGain: Double = 1.0) {
        if (!running || muted) return
        val g = max(0.05, distanceGain).toFloat()
        play(cached("boom.noise") { noise(0.7, 1.0, 900.0, sweep = 0.08, q = 0.7) }, 0.55f * g)
        play(cached("boom.sine") { tone(120.0, 0.65, 1.0, Wave.SINE, to = 32.0) }, 0.5f * g)
        play(cached("boom.tri") { tone(70.0, 0.9, 1.0, Wave.TRIANGLE, to = 24.0) }, 0.35f * g)
    }

    fun hitMark() = play(cached("hitmark") { tone(1500.0, 0.06, 1.0, Wave.SQUARE, to = 1100.0) }, 0.13f)

    fun hurt() {
        play(cached("hurt.noise") { noise(0.16, 1.0, 500.0, sweep = 0.4) }, 0.30f)
        play(cached("hurt.tone") { tone(180.0, 0.18, 1.0, Wave.SAW, to = 90.0) }, 0.20f)
    }

    fun death() {
        play(cached("death.tone") { tone(420.0, 0.9, 1.0, Wave.SAW, to = 60.0) }, 0.30f)
        play(cached("death.noise") { noise(0.5, 1.0, 400.0, sweep = 0.2) }, 0.20f)
    }

    fun pickup() {
        play(cached("pickup.a") { tone(880.0, 0.10, 1.0, Wave.TRIANGLE, to = 1320.0) }, 0.18f)
        play(cached("pickup.b") { tone(1320.0, 0.12, 1.0, Wave.SINE) }, 0.12f)
    }

    fun reload(stage: Int = 0) {
        play(cached("reload.click") { noise(0.05, 1.0, 3200.0, highpass = true) }, 0.16f)
        play(cached("reload.tone.$stage") { tone(if (stage == 0) 380.0 else 520.0, 0.05, 1.0, Wave.SQUARE) }, 0.10f)
    }

    fun jump() = play(cached("jump") { tone(240.0, 0.12, 1.0, Wave.TRIANGLE, to = 420.0) }, 0.14f)

    fun kill() {
        play(cached("kill.a") { tone(660.0, 0.10, 1.0, Wave.SQUARE) }, 0.20f)
        play(cached("kill.b") { tone(990.0, 0.14, 1.0, Wave.SQUARE) }, 0.18f)
    }

    fun countdownBeep(final: Boolean = false) {
        val key = if (final) "count.final" else "count"
        play(cached(key) {
            if (final) tone(1200.0, 0.4, 1.0, Wave.SQUARE) else tone(700.0, 0.12, 1.0, Wave.SQUARE)
        }, 0.22f)
    }

    fun matchEnd(win: Boolean = true) {
        val notes = if (win) doubleArrayOf(523.0, 659.0, 784.0, 1047.0)
        else doubleArrayOf(523.0, 440.0, 349.0, 262.0)
        notes.forEachIndexed { i, f ->
            play(cached("end.$win.$i") { tone(f, 0.28, 1.0, Wave.TRIANGLE) }, 0.20f)
        }
    }

    fun click() = play(cached("ui") { tone(520.0, 0.04, 1.0, Wave.SQUARE) }, 0.08f)

    fun setJetIntensity(intensity: Double) {
        jetGain = if (muted || !running) 0f
        else (intensity.coerceIn(0.0, 1.0) * 0.24).toFloat()
    }

    // ------------------------------------------------------------- synthesis

    /** Deterministic noise so a sound is byte-identical run to run. */
    private class Rng(seed: Int = 0x9e3779b9.toInt()) {
        private var s = seed
        fun next(): Double {
            s = s xor (s shl 13)
            s = s xor (s ushr 17)
            s = s xor (s shl 5)
            return ((s ushr 0) % 100000) / 100000.0 * 2.0 - 1.0
        }
    }

    private fun noise(
        duration: Double,
        gain: Double,
        freq: Double,
        sweep: Double = 0.0,
        q: Double = 1.0,
        attack: Double = 0.002,
        highpass: Boolean = false,
    ): ShortArray {
        val n = (duration * SAMPLE_RATE).toInt().coerceAtLeast(1)
        val out = ShortArray(n)
        val rng = Rng(freq.toInt())
        var lp = 0.0
        var bp = 0.0
        var prev = 0.0
        for (i in 0 until n) {
            val t = i.toDouble() / SAMPLE_RATE
            val k = (t / duration).coerceIn(0.0, 1.0)
            // Exponential frequency sweep, as in `filter.frequency.exponentialRampToValueAtTime`.
            val f = if (sweep != 0.0) max(60.0, freq * sweep.pow(k)) else freq
            val a = exp(-2.0 * PI * f / SAMPLE_RATE).coerceIn(0.0, 0.9999)
            val x = rng.next()

            lp = lp * a + x * (1 - a)
            var sample = if (highpass) x - lp else lp
            if (!highpass && q > 1.0) {
                // A single resonant band around the cutoff, cheap stand-in for a
                // biquad: blends the raw signal back in to add bite.
                bp = bp * (a * 0.94) + sample * (1 - a)
                sample = sample + bp * (q - 1.0) * 1.4
            }
            prev = sample

            out[i] = (sample * envelope(t, duration, attack) * gain * 22000.0)
                .coerceIn(-32767.0, 32767.0).toInt().toShort()
        }
        return out
    }

    private fun tone(
        freq: Double,
        duration: Double,
        gain: Double,
        wave: Wave,
        to: Double? = null,
        attack: Double = 0.004,
    ): ShortArray {
        val n = (duration * SAMPLE_RATE).toInt().coerceAtLeast(1)
        val out = ShortArray(n)
        var phase = 0.0
        for (i in 0 until n) {
            val t = i.toDouble() / SAMPLE_RATE
            val k = (t / duration).coerceIn(0.0, 1.0)
            val f = if (to != null) max(20.0, freq * (to / freq).pow(k)) else freq
            phase += f / SAMPLE_RATE
            if (phase >= 1.0) phase -= 1.0
            val s = when (wave) {
                Wave.SINE -> sin(phase * 2.0 * PI)
                Wave.SQUARE -> if (phase < 0.5) 1.0 else -1.0
                Wave.SAW -> 2.0 * phase - 1.0
                Wave.TRIANGLE -> if (phase < 0.5) 4.0 * phase - 1.0 else 3.0 - 4.0 * phase
            }
            out[i] = (s * envelope(t, duration, attack) * gain * 22000.0)
                .coerceIn(-32767.0, 32767.0).toInt().toShort()
        }
        return out
    }

    /** Fast attack, exponential release — matches the WebAudio gain ramps. */
    private fun envelope(t: Double, duration: Double, attack: Double): Double {
        val a = if (attack <= 0.0) 1.0 else min(1.0, t / attack)
        val release = exp(-6.5 * t / max(duration, 1e-4))
        return a * release
    }

    /** One second of band-passed noise, looped for the jetpack. */
    private fun renderJetLoop(): ShortArray {
        val n = SAMPLE_RATE
        val out = ShortArray(n)
        val rng = Rng(620)
        var lower = 0.0
        var upper = 0.0
        var band = 0.0
        // Two cascaded one-pole filters either side of 620 Hz gives a soft band pass.
        val aLow = exp(-2.0 * PI * 620.0 / SAMPLE_RATE)
        val aHigh = exp(-2.0 * PI * 310.0 / SAMPLE_RATE)
        for (i in 0 until n) {
            val x = rng.next()
            lower = lower * aHigh + x * (1 - aHigh)
            upper = upper * aLow + lower * (1 - aLow)
            band = upper - lower
            out[i] = (band * 6.0 * 22000.0).coerceIn(-32767.0, 32767.0).toInt().toShort()
        }
        // Cross-fade the seam so the loop does not click.
        val fade = SAMPLE_RATE / 40
        for (i in 0 until fade) {
            val k = i.toDouble() / fade
            out[i] = (out[i] * k + out[n - fade + i] * (1 - k)).toInt().toShort()
        }
        return out
    }

    /** Unused hook kept for parity with the web client's `stopAllLoops`. */
    fun stopAllLoops() = setJetIntensity(0.0)
}
