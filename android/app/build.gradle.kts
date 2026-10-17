plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.milofit.arena"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.milofit.arena"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    // ------------------------------------------------------------------------
    // The one and only copy of the game data lives in ../shared/game-data and is
    // consumed by the Node server *and* the web client. Rather than duplicating
    // it here (which is how content drifts), the build copies it into the APK's
    // assets. Edit the JSON in shared/ and both platforms follow.
    // ------------------------------------------------------------------------
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/gameData"))

    packaging {
        resources.excludes += setOf(
            "/META-INF/{AL2.0,LGPL2.1}",
            "/META-INF/DEPENDENCIES",
        )
    }
}

val copyGameData by tasks.registering(Copy::class) {
    description = "Copies shared/game-data into the app assets."
    group = "build"
    from(rootProject.file("../shared/game-data"))
    into(layout.buildDirectory.dir("generated/gameData"))
}

tasks.named("preBuild") { dependsOn(copyGameData) }
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }
    .configureEach { dependsOn(copyGameData) }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    debugImplementation("androidx.compose.ui:ui-tooling")

    // Pure-JVM tests: the simulation core has no Android dependencies, so the
    // parity check against shared/sim-core.js runs on the host JVM.
    testImplementation("junit:junit:4.13.2")
}
