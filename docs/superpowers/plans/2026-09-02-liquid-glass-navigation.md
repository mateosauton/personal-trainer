# Liquid Glass Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized bottom tab bar with a compact, raised liquid-glass navigation dock.

**Architecture:** Keep Expo Router's two-screen `Tabs` navigator unchanged. Adjust the bar's layout styles and capture its design contract through a focused renderer test.

**Tech Stack:** Expo Router, React Native, TypeScript, Jest, React Native Testing Library.

---

### Task 1: Lock in compact floating navigation

**Files:**
- Create: `__tests__/tabs-layout.test.tsx`
- Modify: `app/(tabs)/_layout.tsx`

- [ ] **Step 1: Write a failing test**

Create a mocked `expo-router` `Tabs` component that captures `screenOptions`. Render `TabsLayout` and assert that `tabBarStyle` has `height: 64`, `position: 'absolute'`, and `bottom`, `left`, and `right` equal to `16`.

- [ ] **Step 2: Verify red**

Run `npm test -- --runInBand __tests__/tabs-layout.test.tsx`. Expect failure because the existing bar has `height: 88` and no floating offsets.

- [ ] **Step 3: Implement minimal styling**

In `styles.bar`, set `position: 'absolute'`, `left/right/bottom: space.lg`, `height: 64`, `paddingTop: space.xs`, `backgroundColor: colors.overlay`, `borderWidth: 1`, `borderColor: colors.borderStrong`, `borderRadius: radius.lg`, and a restrained native shadow plus `elevation: 12`. Import `radius`; reduce tab item gap to `3`.

- [ ] **Step 4: Verify green**

Run `npm test -- --runInBand __tests__/tabs-layout.test.tsx`. Expect pass.

- [ ] **Step 5: Verify all checks**

Run `npm run lint && npm test -- --runInBand`. Expect both commands to exit successfully.

- [ ] **Step 6: Commit and publish**

Stage only the navigation layout, its test, and these two documents. Commit with `refine floating tab bar`, rebase onto `origin/master` if needed, and push `master` to `origin`.
