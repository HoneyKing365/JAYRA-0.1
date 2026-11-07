# JAYRA Android Companion Proguard rules
-keep class ai.jayra.companion.model.** { *; }
-keepclassmembers class * {
    @com.squareup.moshi.Json *;
}
