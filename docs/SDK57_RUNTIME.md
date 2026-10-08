# SDK 57 native runtime

The launch checkout includes the existing SDK 57 and Expo Observe work from the primary workspace. Expo-compatible patch versions are locked. Observe waits for auth/profile loading and callback verification before marking the entry route interactive. Recovery does not require a successful profile read to make the password form usable.

Unsupported `newArchEnabled`, Android `edgeToEdgeEnabled`, and legacy `splash` configuration were removed. Splash assets and background now use the `expo-splash-screen` plugin. `expo-modules-core` is provided transitively by Expo.

Fingerprint compatibility requires a fresh binary. Never publish this SDK upgrade to appVersion 1.0.0 builds. Use the release-test profile and production environment after combining the native release configuration PR.

Before release, verify startup, deep links/recovery, photo permissions/uploads, animations, offline logging and restart on installed Android and iOS binaries. Web export and Jest do not prove native runtime behavior.
