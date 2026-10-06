plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "cl.proveedorregional.remesas"
    compileSdk = 34

    defaultConfig {
        applicationId = "cl.proveedorregional.remesas"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "TUU_PACKAGE", "\"${project.findProperty("tuuPackage") ?: "com.haulmer.paymentapp"}\"")
    }

    buildTypes {
        debug {
            buildConfigField("String", "TUU_PACKAGE", "\"com.haulmer.paymentapp.dev\"")
        }
        release {
            isMinifyEnabled = false
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
