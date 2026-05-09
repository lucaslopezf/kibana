---
name: metrics-discover
description: >
  Specialist for the Metrics Experience in Kibana Discover — the activation profile and viewer-package
  code. Use when: (1) editing the metrics data source profile under
  src/platform/plugins/shared/discover/public/context_awareness/profile_providers/common/metrics_data_source_profile/,
  (2) editing the kbn-unified-chart-section-viewer package (grid, flyout, toolbar, hooks),
  (3) debugging why a metric is or isn't appearing in the Discover grid/flyout (app behavior,
  not test failures), (4) wiring metrics views into Agent Builder, (5) writing or reviewing
  ES|QL queries that target the metrics profile (TS / LIMIT / SORT / WHERE).
  Do NOT use for: Scout E2E test work (use the metrics-discover-e2e skill instead),
  Lens metric visualizations, the Observability infrastructure metrics UI, the kbn-metrics
  OpenTelemetry packages, or non-metrics Discover work.
---

# Metrics in Discover (specialist)

The Metrics Experience renders a grid of charts (and a per-metric flyout) inside Discover whenever an ES|QL query resolves to the **metrics data source profile**. Profile lives in the Discover plugin; grid/flyout/chart machinery in the `@kbn/unified-chart-section-viewer` package. Owned by `@elastic/obs-exploration-team`. Sibling skills: `metrics-discover-e2e` (Scout tests), `kibana-i18n` (user-facing strings), `elasticsearch-esql` (ES|QL syntax).

## Glossary

- **Metric** — numeric value with a *metric type* (`gauge | counter | histogram`) and *unit* (`ns | us | ms | s | m | h | d | percent | bytes | count`). Set by index mapping (`time_series_metric: ...`).
- **Dimension** — categorical label (e.g. `service.name`); splits a metric into per-series on breakdown. Internal dimensions (`labels._*`, `_metric_names_hash`) filtered by parser.
- **Stream** — source data stream. Grid renders **one card per `(metric, stream)` pair**.

## Key files & responsibilities

| What | Path |
|------|------|
| Profile activation + `METRICS_DATA_SOURCE_PROFILE_ID` | `src/platform/plugins/shared/discover/public/context_awareness/profile_providers/common/metrics_data_source_profile/profile.ts` |
| Accessor (binds profile to viewer) | `.../metrics_data_source_profile/accessor/{chart_section.tsx, get_default_app_state.ts}` |
| Product-feature gate | `METRICS_EXPERIENCE_PRODUCT_FEATURE_ID` in `discover/common/constants` |
| Viewer package | `src/platform/packages/shared/kbn-unified-chart-section-viewer/` |
| Viewer state + UI interactions (breakdown, search, page, fullscreen, flyout) | `kbn-unified-chart-section-viewer/src/components/observability/metrics/context/metrics_experience_state_provider/metrics_experience_state_context.tsx` |
| Charts grid | `kbn-unified-chart-section-viewer/src/components/charts_grid.tsx` |
| Flyout | `kbn-unified-chart-section-viewer/src/components/flyout/` |

## Profile activation rules

The profile in `profile.ts` matches when **all** of these hold:

1. The query is an `AggregateQuery` (ES|QL).
2. `Parser.parse(query.esql)` returns no errors and at least one command.
3. Every command is in the supported set: `ts`, `limit`, `sort`, `where`. Anything else (`stats`, `eval`, `keep`, `drop`, `rename`) → no match. The profile rejects transformational commands because the grid builds its own per-card aggregation.
4. Solution is one of `Observability`, `Security`, `Search`, `Default`.
5. Product feature `METRICS_EXPERIENCE_PRODUCT_FEATURE_ID` is enabled for the deployment.

`TS` is the expected source command; `FROM` does not activate. `WHERE` flows through as a filter; `LIMIT`/`SORT` are accepted but the grid overrides them with its own ordering and pagination.

## METRICS_INFO

Viewer appends `| METRICS_INFO` via `buildMetricsInfoQuery` (`kbn-esql-utils/.../append_metrics_info.ts`) and parses with `parseMetricsWithTelemetry` (`kbn-unified-chart-section-viewer/.../parse_metrics_response_with_telemetry.ts`) — that parser filters by `ALLOWED_METRIC_TYPES` and hides internal dimensions. **Full data flow + parsed shape: `references/metrics_info.md`.**

## Answer style

Tight, direct, no padding. Name the files and patterns, then stop. Skip:
- rationale / "why this design" sections
- "what I did not do" / caveat blocks
- validation commands (`jest`, `type_check`, `eslint`, `check_changes`)
- optional extensions, payload alternatives, "if you also want X"
- local repro / stress-run commands
- pedagogy beyond what the question asks

## Workflows

### Add support for a new ES|QL command in the profile

1. Update `SUPPORTED_ESQL_COMMANDS` in `profile.ts`.
2. Add a unit-test case to `profile.test.ts`.
3. Walk callers of `use_esql_query_info` in the viewer package — confirm the new command doesn't break query inspection / breakdown.
4. The Scout test for the new command goes in `metrics-discover-e2e`.

### Wire metrics into Agent Builder

The tool's ES|QL must satisfy the activation rules above — `TS` source, only `WHERE`/`SORT`/`LIMIT`. A query with `STATS` (or any transformational command) falls through to the default Discover chart instead of the metrics grid. `LIMIT`/`SORT` are accepted but overridden by the grid.

## Deeper references

Read on demand — only when the task fits.

- [`references/metrics_info.md`](references/metrics_info.md) — full `METRICS_INFO` data flow: command, query construction, fetch hook, response type, parser, parsed shape, grid + flyout consumption, fields-metadata integration. **Read when** debugging "empty grid", changing what each metric reports, or tracing how a card's value gets there.
- [`references/telemetry.md`](references/telemetry.md) — EBT registration + `discover_metrics_info` event schema, APM signals (execution-context labelling, Lens per-card error capture), `@kbn/ebt-tools` performance instrumentation, Inspector request tracking. **Read when** the task mentions EBT / telemetry / APM, or investigating per-card chart errors.
