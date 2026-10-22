# Expo Observe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send startup timing measurements for every usable Office Gym app entry route to EAS Observe.

**Architecture:** Expo Observe wraps the Expo Router root component and therefore records time to first render. A small component inside the root's providers calls `markInteractive()` only after the authentication/profile routing gate is no longer loading, which records time to interactive for the sign-in, onboarding, and ready flows without modifying routing.

**Tech Stack:** Expo SDK 57, Expo Router, React Native, `expo-observe`, Jest, React Native Testing Library.

---

### Task 1: Add the Expo Observe dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the SDK-compatible package**

Run: `npx expo install expo-observe`

Expected: `package.json` lists `expo-observe` at Expo's SDK-57-compatible version and `package-lock.json` is updated.

- [ ] **Step 2: Verify the resolved package is installed**

Run: `npm ls expo-observe`

Expected: exits with status 0 and shows one installed `expo-observe` version.

- [ ] **Step 3: Commit the dependency update**

    git add package.json package-lock.json
    git commit -m "chore: add expo observe"

### Task 2: Mark a usable entry route interactive

**Files:**
- Create: `__tests__/observe.test.tsx`
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Write the failing root-layout test**

Create `__tests__/observe.test.tsx` with an `expo-observe` mock that returns a `markInteractive` spy from `useObserve` and passes components through `ObserveRoot.wrap`. Mock `@/lib/auth` so the first render has `{ session: null, profileState: { status: 'idle' }, loading: false }`, render the default export from `@/app/_layout`, and assert the spy was called once. This represents the sign-in screen becoming usable.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --runInBand __tests__/observe.test.tsx`

Expected: FAIL because the root layout neither uses `useObserve` nor calls `markInteractive`.

- [ ] **Step 3: Add the minimal instrumentation**

In `app/_layout.tsx`, import `ObserveRoot` and `useObserve` from `expo-observe`. Add an `InteractiveMarker` component that receives the existing `loading` state, calls `markInteractive()` from a `useEffect` whenever `loading` becomes false, and renders `null`. Render it inside `AuthProvider`, before `Routes`, so it is available for sign-in, onboarding, and authenticated starts. Export the root layout as `ObserveRoot.wrap(RootLayout)`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- --runInBand __tests__/observe.test.tsx`

Expected: PASS; the mock marker is called once after the usable sign-in route renders.

- [ ] **Step 5: Run type validation**

Run: `npm run lint`

Expected: exits with status 0 and reports no TypeScript errors.

- [ ] **Step 6: Commit the instrumentation**

    git add app/_layout.tsx __tests__/observe.test.tsx
    git commit -m "feat: observe app startup"

### Task 3: Verify Expo configuration and document the build requirement

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a verification note**

Add a short EAS Observe note under the deployment/build instructions stating that metrics require a new EAS development or production build and are not dispatched by Expo Go. Include the commands `eas build --profile preview` and `eas build --profile production`.

- [ ] **Step 2: Run Expo diagnostics**

Run: `npx expo-doctor`

Expected: exits with status 0, or any pre-existing diagnostic is recorded separately and does not concern `expo-observe`.

- [ ] **Step 3: Run the complete test suite**

Run: `npm test -- --runInBand`

Expected: PASS with the new Observe test and existing test suites green.

- [ ] **Step 4: Commit the verification note**

    git add README.md
    git commit -m "docs: note observe build requirement"
