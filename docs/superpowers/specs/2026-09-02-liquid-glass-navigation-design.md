# Liquid Glass Navigation Design

## Goal

Make the primary navigation feel smaller and sit higher above the device edge without changing destinations or behavior.

## Design

Replace the full-width 88px tab bar with a compact, 64px floating dock. It stays at the bottom navigation position, is inset from the screen edges, and retains Home and Plan.

Use a dark translucent surface with a fine border, rounded corners, and soft shadow. Existing icon, label, active-state, and accessibility behavior remain unchanged.

## Scope

- Update `app/(tabs)/_layout.tsx` styles only.
- Add a renderer test for the compact dock dimensions and floating placement.

## Non-goals

- No new routes, destinations, animation, blur dependency, or global theme changes.
