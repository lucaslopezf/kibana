# Page object ownership

There is a clear hierarchy. Reuse top-down — Discover-shared first, metrics-specific only when the action is genuinely metrics-grid / flyout / toolbar territory.

1. **`@kbn/scout` page objects** — `src/platform/packages/shared/kbn-scout/src/playwright/page_objects/`. **Always look here first** for anything not tied to the metrics grid/flyout/toolbar. List the directory and pick the best match. `brush_to_zoom.spec.ts` is the precedent for combining multiple `@kbn/scout` POs in one spec.
2. **`pageObjects.metricsExperience`** — `MetricsExperiencePage` and its sub-POs (`flyout.ts`, `breakdown_selector.ts`, `chart_actions.ts`, `chart_interactions.ts`, `pagination.ts`, `share_helper.ts`). Owns the metrics-grid card surface: grid layout, per-card chart and context menu, the toolbar breakdown selector (the metrics-specific control, distinct from the Discover sidebar field-list), pagination, share/save flows, fullscreen.
3. **Fixture-level override** in `fixtures/metrics_experience/index.ts` — for metrics-specific *tuning* of a Discover-shared method (e.g., the existing `extendPageObject(pageObjects.discover, { goto: async () => {…} })` that bumps the load timeout to 30 s). Don't fork the method into `MetricsExperiencePage` — extend the Discover PO at the fixture and let specs keep calling `discover.x()`.

## Worked example (from `breakdown_by_dimension.spec.ts:38–46`)

```ts
const { discover, metricsExperience } = pageObjects;
await discover.writeAndSubmitEsqlQuery(testData.ESQL_QUERIES.TS); // Discover-shared
await expect(metricsExperience.grid).toBeVisible();                // Metrics-specific
await discover.addBreakdownFieldFromSidebar(breakdownField);       // Discover-shared
await expect(
  metricsExperience.breakdownSelector.getToggleWithSelection(breakdownField),
).toBeVisible();                                                   // Metrics-specific
```

## Decision rule when adding a new method

1. **Already on `pageObjects.discover` (or another `@kbn/scout` PO)?** Reuse from the spec — don't wrap.
2. **Discover-shared concern (would belong in any Discover suite, not metrics-specific)?** Add to `DiscoverApp` in `@kbn/scout` (`src/platform/packages/shared/kbn-scout/src/playwright/page_objects/discover_app.ts`). Cross-package change; coordinate with Discover and Scout owners on the PR. Don't add it to a metrics PO and call it from the metrics suite — that hides reusable behavior in a leaf suite.
3. **Metrics-specific?** Pick the matching metrics PO: actions on a single chart card → `chart_actions.ts` / `chart_interactions.ts`. Flyout content → `flyout.ts`. Grid-level interactions → `metrics_experience.ts`. Breakdown toolbar → `breakdown_selector.ts`. Pagination → `pagination.ts`. Share/save flows → `share_helper.ts`. If none fit, add a new metrics PO file following the `scout-ui-testing` skill's PO conventions, and re-export the top-level class from `fixtures/metrics_experience/page_objects/index.ts`.
4. **Discover-shared method that needs metrics-specific tuning (timeout, extra wait, retry)?** Apply it as a fixture-level override using `extendPageObject(pageObjects.discover, { … })` in `fixtures/metrics_experience/index.ts`, mirroring the existing `goto` override (see the inline comment there for the pattern).
