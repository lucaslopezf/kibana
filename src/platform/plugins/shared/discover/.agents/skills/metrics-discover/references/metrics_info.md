# `METRICS_INFO` data flow

Viewer appends `| METRICS_INFO` to the user's query, parses metric metadata, renders one card per `(metric, stream)`.

| Stage | File / type |
|-------|-------------|
| Command definition | `kbn-esql-language/src/commands/registry/metrics_info/index.ts` |
| Query construction | `kbn-esql-utils/src/utils/append_to_query/append_metrics_info.ts` (`buildMetricsInfoQuery` — strips `SORT`, preserves `LIMIT`, optional `WHERE TO_STRING(dim) IS NOT NULL`) |
| Fetch hook | `kbn-unified-chart-section-viewer/.../hooks/use_fetch_metrics_data.ts` (`useFetchMetricsData`) |
| Response shape | `MetricsESQLResponse` in `kbn-unified-chart-section-viewer/src/types.ts` — columns: `metric_name`, `data_stream`, `unit`, `metric_type`, `field_type`, `dimension_fields` |
| Parser | `.../utils/parse_metrics_response_with_telemetry.ts` (`parseMetricsWithTelemetry`) — filters by `ALLOWED_METRIC_TYPES` (`gauge`/`counter`/`histogram`), hides internal dimensions (`_metric_names_hash`, `unit`, `labels._*`) |
| Parsed shape (one card) | `ParsedMetricItem` in `types.ts` — `metricName`, `dataStream`, `units[]`, `metricTypes[]`, `fieldTypes[]`, `dimensionFields[]` |
| Grid | `metrics_experience_grid.tsx` → `ChartsGrid` → per-card `ChartItem` |
| Flyout | `flyout/metrics_insights_flyout.tsx` → `flyout/tabs/overview_tab_metadata.tsx` (renders unit / metric type / field type as badge groups; Dimensions list renders from `dimensionFields[]`) |

## Description text (the one piece NOT from METRICS_INFO)

Flyout title descriptions come from `@kbn/fields-metadata-plugin` via `kbn-unified-chart-section-viewer/src/context/fields_metadata/fields_metadata_provider.tsx` (batched `useFieldsMetadata({ fieldNames, attributes: ['description'] })`). Only `description` — units, types, dimensions all come from `METRICS_INFO`.

## Empty grid debugging

Profile matched but grid empty? Inspect the network panel for `<userQuery> | METRICS_INFO` and check whether `parseMetricsWithTelemetry` filtered the rows. Most "empty grid" cases are "parser hid them" (unsupported `metric_type`, internal dimension prefix), not "no data".
