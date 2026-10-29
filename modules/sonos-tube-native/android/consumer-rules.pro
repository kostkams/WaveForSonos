## NewPipeExtractor (uses Rhino via reflection)
-keep class org.mozilla.javascript.** { *; }
-keep class org.mozilla.classfile.ClassFileWriter
-dontwarn org.mozilla.javascript.tools.**
-dontwarn javax.script.**
-dontwarn java.beans.**
-keep class org.schabi.newpipe.extractor.** { *; }
-dontwarn org.schabi.newpipe.extractor.**
# Rhino optional desktop-JVM integration (dynalink) - not present on Android, never used there
-dontwarn jdk.dynalink.**
