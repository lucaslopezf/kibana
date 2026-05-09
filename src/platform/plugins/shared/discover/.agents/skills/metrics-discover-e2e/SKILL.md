---
name: metrics-discover-e2e
description: >
  Scout E2E tests for the Metrics Experience in Discover. Use when: (1) writing or editing
  specs under src/platform/plugins/shared/discover/test/scout/ui/parallel_tests/metrics_experience/,
  (2) editing fixtures, page objects, generators, or kbn_archives under
  src/platform/plugins/shared/discover/test/scout/ui/fixtures/metrics_experience/,
  (3) debugging a flaky or failing metrics Scout spec, (4) adding a new spec for the metrics
  grid, flyout, breakdown selector, sharing, or saving sessions, (5) deciding which existing
  spec to model a new test on. Do NOT use for: metrics activation profile code, viewer
  package code, or any non-test work — for those, use the metrics-discover skill.
---

# Metrics in Discover — Scout E2E (specialist)

Scout UI tests for the Metrics Experience in Discover. App-behavior questions (activation profile, viewer-package code) → sibling **`metrics-discover`** skill. Generic Scout fundamentals (fixtures, POs, parallel mode, tags, flake control) → `scout-ui-testing` skill. CI failure logs → `buildkite-logs` skill.

## Where things live

| What | Path |
|------|------|
| Specs | `src/platform/plugins/shared/discover/test/scout/ui/parallel_tests/metrics_experience/*.spec.ts` |
| Local readme (authoritative on data + run commands) | `parallel_tests/metrics_experience/readme.md` |
| Fixtures + page objects + generators | `src/platform/plugins/shared/discover/test/scout/ui/fixtures/metrics_experience/` |
| Playwright config | `src/platform/plugins/shared/discover/test/scout/ui/parallel.playwright.config.ts` |
| Global setup (creates the two TSDB indices) | `src/platform/plugins/shared/discover/test/scout/ui/parallel_tests/global.setup.ts` |

Two TSDB indices created in `global.setup.ts`; suite is self-contained (no external ES archives).

## Spec map

| Scenario | Spec |
|----------|------|
| Grid rendering / basic interactions | `grid.spec.ts` |
| Keyboard navigation across the grid | `grid.navigation.spec.ts` |
| Insights flyout open / tabs / content | `insights_flyout.spec.ts` |
| Brushing a chart to zoom | `brush_to_zoom.spec.ts` |
| Fullscreen mode (button + Esc) | `fullscreen.spec.ts` |
| Inspector / view-details navigation | `inspect.spec.ts` |
| Breakdown-by-dimension selection | `breakdown_by_dimension.spec.ts` |
| Stream switch with heterogeneous dimensions | `dimensions_wipe.spec.ts` |
| ES\|QL query kickstart | `query_kickstart.spec.ts` |
| Add-to-case action (privileged user) | `add_to_case_privileged.spec.ts` |
| Save session | `save_session.spec.ts` |
| Share session | `share_session.spec.ts` |

## Page object hierarchy

Reuse `pageObjects.discover` first, then `pageObjects.metricsExperience` for grid / flyout / toolbar / pagination / share-save concerns. See `references/page_object_ownership.md`.

## Answer style

Tight, direct, no padding. Name the spec file, the page objects, and the test structure — then stop. Skip:
- rationale / "why this pattern" sections
- "what I did not do" / caveat blocks
- local repro / stress-run / `--repeat-each` / `/flaky` commands
- detailed flakiness pedagogy (polling tradeoffs, baseline-fallback)
- validation commands (`jest`, `type_check`, `eslint`, `check_changes`)
- optional spec variants beyond what was asked

## Triage workflow

For a flaky / failing metrics spec: pull Buildkite logs first (use the `buildkite-logs` skill) and read the Playwright trace before guessing. Common metrics-suite causes: **time-range drift** in the TSDB indices (fixed window from `global.setup.ts` — specs with hard-coded timestamps drift outside it), **cross-package selector breakage** from `data-test-subj` changes in `kbn-unified-chart-section-viewer`, or a recent change to the spec / its page object. Do **not** quick-skip the spec — fix the underlying code.

## Deeper references

- [`references/page_object_ownership.md`](references/page_object_ownership.md) — Discover→metrics ownership hierarchy, decision rule for new methods, worked spec example. **Read when** writing a new spec or asked "which page object should I use for X."
