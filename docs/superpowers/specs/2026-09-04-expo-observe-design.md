# Expo Observe integration

## Goal

Collect EAS Observe startup metrics for `@mrsauron/office-gym-trainer`.

## Design

- Install Expo's `expo-observe` package, using the version compatible with the
  app's Expo SDK 57.
- Wrap the Expo Router root layout with `ObserveRoot` to collect time to first
  render automatically.
- Call `markInteractive()` after the authentication/profile gate resolves and
  the first usable route has rendered. This covers the sign-in, onboarding, and
  signed-in routes while avoiding a measurement during the loading spinner.
- Leave routing, splash-screen behavior, and user-defined events unchanged.

## Verification

- Add a focused layout test proving the interactive marker is invoked once the
  gate leaves loading.
- Run the affected test, TypeScript validation, and Expo diagnostics.
- A new EAS development or production build is required before metrics appear
  in the EAS Observe dashboard.
