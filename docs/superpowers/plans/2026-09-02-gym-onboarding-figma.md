# Gym Onboarding Figma Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an editable eight-screen mobile onboarding flow for Office Gym in a new Figma design file.

**Architecture:** The Figma file will use one page with a compact foundation area and eight connected mobile frames. Auto-layout will control all screen composition; local text styles, colors, and components will make buttons, option cards, chips, and progress states consistently reusable.

**Tech Stack:** Figma Design, Figma Plugin API, local auto-layout components.

---

### Task 1: Create the file and visual foundation

**Files:**
- Create: New Figma Design file, `Office Gym — Onboarding`

- [ ] **Step 1: Create a blank Figma design file**

Create the file in the user's selected Figma plan and retain the returned file key for all following calls.

- [ ] **Step 2: Add foundation samples**

Create an 8-point spacing reference, dark background and surface samples, white and muted text samples, and the electric-lime primary action color. Use Office Gym's values: `#0A0A0B`, `#141416`, `#1C1C1F`, `#FFFFFF`, `#8E8E93`, and `#D7FF3E`.

- [ ] **Step 3: Verify foundations**

Inspect the created page and confirm all samples use the intended names and colors.

### Task 2: Build reusable onboarding patterns

**Files:**
- Modify: New Figma Design file, `Office Gym — Onboarding`

- [ ] **Step 1: Create a primary button pattern**

Build a full-width, 56px-high pill button with lime fill, dark text, and the label `Continue`.

- [ ] **Step 2: Create selection patterns**

Build a selected and unselected option card with title, one-line helper text, surface fill, rounded corners, and a clear lime selected state. Build selected and unselected pill chips for numeric choices.

- [ ] **Step 3: Create progress pattern**

Build a thin muted rail with a lime progress segment and a compact `STEP N OF 7` label.

- [ ] **Step 4: Verify patterns**

Confirm the patterns have clear selected state contrast and fit a 390px screen width.

### Task 3: Compose the eight mobile screens

**Files:**
- Modify: New Figma Design file, `Office Gym — Onboarding`

- [ ] **Step 1: Create the welcome and decision screens**

Create 390 × 844 frames for Welcome, Goal, Experience, Weekly cadence, and Session length. Give every decision screen a progress pattern and a fixed Continue action.

- [ ] **Step 2: Create profile and considerations screens**

Create Profile with optional name/photo and Skip, then Considerations with multi-select limitation chips plus `None`.

- [ ] **Step 3: Create the confirmation screen**

Create Plan ready with the selected summary: `Build muscle`, `Comfortable`, `4 days / week`, and `45 min sessions`; finish with `View my plan`.

- [ ] **Step 4: Connect prototype actions**

Wire primary actions from Welcome through Plan ready in sequence. Add an optional Skip connection from Profile to Considerations.

### Task 4: Validate and hand off

**Files:**
- Modify: New Figma Design file, `Office Gym — Onboarding`

- [ ] **Step 1: Check layout and content**

Review every frame at mobile size for consistent 8-point spacing, readable text, and a primary action reachable without scrolling.

- [ ] **Step 2: Capture a final visual check**

Inspect a screenshot of the full flow and correct any overlap, clipping, or inconsistent selected state.

- [ ] **Step 3: Share the file URL**

Return the Figma URL and summarize the screens and prototype path.
