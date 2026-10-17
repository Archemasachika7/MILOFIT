# kotlinx.serialization keeps generated serializers on the companion object;
# the plugin emits the @Serializable metadata, so we only need to keep names
# that are referenced reflectively (none, currently) and the OkHttp internals.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class ** {
    public static ** Companion;
}
