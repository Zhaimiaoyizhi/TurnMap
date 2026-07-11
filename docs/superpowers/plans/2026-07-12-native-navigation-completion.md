# TurnMap Native Navigation Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. The user explicitly prohibited subagents for this work.

**Goal:** Finish the evidence-backed native navigation migration, retire pre-0.8.0 routes, add safe custom sites, and produce a verified 0.8.4 local release candidate.

**Architecture:** A single evidence registry drives adapter capability declarations and docs. Site-native providers plug into a strict index/resolve/revive contract, while unverified sites remain mounted-DOM only. Custom sites use validated declarative profiles, exact-origin optional permissions, fixed preview messaging, and separate local backup files.

**Tech Stack:** TypeScript, React, Chrome MV3, Node test runner, Vite, agent-browser.

---

### Task 1: Evidence registry and QA harness

**Files:**
- Create: `src/content/native-capability-registry.ts`
- Create: `tests/native-capability-registry.test.mjs`
- Create: `docs/qa/native-navigation/README.md`
- Create: `docs/qa/native-navigation/site-evidence.json`

- [ ] Write failing tests that require exactly thirteen unique built-in records and prohibit verified tiers without evidence references.
- [ ] Run the tests and confirm the registry is missing.
- [ ] Implement the registry and JSON evidence schema.
- [ ] Run focused tests to green.
- [ ] Inventory real browser authentication and create one redacted report per site.

### Task 2: Native provider contract

**Files:**
- Create: `src/content/native-provider.ts`
- Modify: `src/content/native-web-navigation.ts`
- Modify: `src/content/conversation-adapters.ts`
- Test: `tests/native-web-navigation.test.mjs`

- [ ] Write failing tests for exact-identity provider resolution, explicit unmounted failures, and capability/evidence consistency.
- [ ] Implement the provider contract and migrate ChatGPT plus the mounted-DOM provider without behavioral regression.
- [ ] Add verified site-native providers only where browser evidence proves their selectors/identities.
- [ ] Run focused and full adapter tests.

### Task 3: Retire legacy scrolling/search

**Files:**
- Modify: `src/content/web-adapter-core.ts`
- Delete: `src/content/smart-scroll-harvest.ts`
- Delete: `src/content/scroll-container.ts`
- Modify: `src/side-panel/App.tsx`
- Modify: `src/settings-page/main.tsx`
- Modify: `src/side-panel/i18n/i18n-storage.ts`
- Modify: `tests/conversation-adapters.test.mjs`
- Modify: `tests/reading-settings.test.mjs`

- [ ] Write failing source-boundary tests that prohibit smart harvest, directional search, and retired UI copy.
- [ ] Delete inactive scrolling and SourceAnchor-search functions and imports.
- [ ] Replace Deep Scan with capability-aware Refresh Index behavior and copy.
- [ ] Remove obsolete settings UI while preserving safe reads of historical stored settings.
- [ ] Run unit and type checks.

### Task 4: Custom profile model and backup

**Files:**
- Create: `src/shared/custom-site-profiles.ts`
- Create: `tests/custom-site-profiles.test.mjs`

- [ ] Write failing tests for exact-origin validation, selector safety, built-in-origin protection, normalization, enabled/disabled state, and separate import/export.
- [ ] Implement schema version 1, validation, storage, and deterministic merge/replace import.
- [ ] Run focused tests to green.

### Task 5: Custom adapter and preview bridge

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/messaging.ts`
- Modify: `src/content/index.ts`
- Modify: `src/content/conversation-adapters.ts`
- Create: `src/content/custom-site-adapter.ts`
- Test: `tests/custom-site-adapter.test.mjs`

- [ ] Write failing tests for asynchronous custom adapter selection and fixed preview messages.
- [ ] Implement custom profile loading, exact-origin matching, non-scrolling extraction, identity-first mounted jump, and actionable preview results.
- [ ] Ensure built-in adapters always win and disabled profiles never activate.
- [ ] Run focused and full messaging/adapter tests.

### Task 6: Settings UI and permissions

**Files:**
- Create: `src/settings-page/CustomSitesSettingsPanel.tsx`
- Modify: `src/settings-page/main.tsx`
- Modify: `src/settings-page/settings-page.css`
- Modify: `src/side-panel/i18n/i18n-storage.ts`
- Test: `tests/custom-site-settings.test.mjs`

- [ ] Write failing UI/source tests for add, edit, permission request, preview, disabled reason, delete, import, and export controls.
- [ ] Implement the panel with fixed validation flow and exact-origin permission requests.
- [ ] Add bilingual copy and theme-safe styles.
- [ ] Run focused tests and build.

### Task 7: Documentation and release

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/permissions-review.md`
- Modify: `docs/privacy-statement.md`
- Modify: `docs/user-guide.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `public/manifest.json`
- Modify: `src/manifest.ts`

- [ ] Generate the capability tables from the evidence registry and document blocked/unverified sites honestly.
- [ ] Document custom-site setup, optional permissions, local storage, backup, and limitations.
- [ ] Update changelog continuously and bump all metadata to 0.8.4 after implementation is stable.
- [ ] Run full tests, typecheck, build, and package.
- [ ] Inspect the ZIP manifest and contents, create local commits, and preserve the release artifact.

