# Telemetry & observability

Observability surfaces wired into the metrics grid and per-card Lens chart.

## EBT (event-based telemetry)

- **Registration**: `kbn-unified-chart-section-viewer/src/components/observability/metrics/telemetry/metrics_ebt_events.ts` (`registerMetricsEbtEvents`). Wired into Discover via `registerUnifiedChartSectionViewerEbtEvents()` in plugin setup.
- **Event**: `discover_metrics_info`, fired once per successful `METRICS_INFO` load from `use_fetch_metrics_data.ts:115` (`trackMetricsInfo(parsed.telemetry)`). 5-field schema: `total_number_of_metrics`, `total_number_of_dimensions`, `metrics_by_type`, `units`, `multi_value_counts`.
- **Hook pattern**: `useTelemetry()` from `ebt_telemetry_context.tsx` returns `trackMetricsInfo(payload)`. Must be called inside `EventBasedTelemetryProvider`; the provider receives `analytics?: AnalyticsServiceStart`.

## APM

The viewer package does no direct APM instrumentation of its own code. Two APM signals show up in traces:

**Execution-context labelling.** `getMetricsExecutionContext(action, name)` (`utils/execution_context.ts`) labels each ES search call with `executionContext.page = 'metrics_${action}_${name}'`; used at `execute_esql_query.ts:87–90`. The enums in `utils/execution_context_enums.ts` have one value each today: `MetricsExecutionContextAction.FETCH = 'fetch'` and `MetricsExecutionContextName.METRICS_INFO = 'metrics_info'`. Resulting tag: `page=metrics_fetch_metrics_info`.

*Search in APM:* on the Kibana frontend RUM service, filter by `labels.page : "metrics_fetch_metrics_info"`. The label rides on transactions for the `METRICS_INFO` ES search call.

**Per-card Lens errors.** Each card hosts a Lens embeddable. Lens's `data_loader.ts` (`x-pack/platform/plugins/shared/lens/public/react_embeddable/data_loader.ts:331–353`) subscribes to a `blockingError$` observable; on every emission it opens a `lens-chart-error` span on `lens-embeddable`, attaches `kibana_meta_*` labels (metric type, profile id, metric id), and calls `apm.captureError(error)`. Both runtime expression failures and validation blocking errors flow through this path. The metrics grid inherits the capture "for free" — `LensWrapper` (`lens_wrapper.tsx:116–128`) passes props straight through to `EmbeddableComponent`.

*Search in APM:* on the Kibana frontend RUM service, open the **Errors** view and filter by `span.name : "lens-chart-error"` (or `span.subtype : "lens-embeddable"`). Narrow to a specific metric / profile with `labels.kibana_meta_metric_type`, `labels.kibana_meta_profile_id`, or `labels.kibana_meta_metric_id`.

## Performance instrumentation (`@kbn/ebt-tools`)

`<PerformanceContextProvider>` wraps the grid (`metrics/index.tsx:22`). Inside, `usePerformanceContext().onPageReady()` fires when `!isDiscoverLoading && metricItems.length > 0` (`metrics_experience_grid.tsx:92–105`), reporting custom metric `metric_experience_fields_count` plus the active `rangeFrom` / `rangeTo`. This is the only Web-Vitals-style instrumentation; no `performance.mark` or React Profiler.

## Inspector request tracking

`ChartSectionInspectorProvider` + `trackRequest(name, description, fn)` (`chart_section_inspector_context.tsx:74–84`) wraps each `executeEsqlQuery` call. Calls `requestAdapter.start(name)` then `.json(request)` + `.ok({json: response})` on success or `.error({json: e})` on failure. Used at `use_fetch_metrics_data.ts:73–98`. Surfaces request/response payloads + errors in Discover's Inspector panel — dev-visible observability.
