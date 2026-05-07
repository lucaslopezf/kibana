/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod/v4';
import {
  isOfAggregateQueryType,
  isOfQueryType,
  pinFilter,
  unpinFilter,
  type AggregateQuery,
  type Filter,
  type Query,
  type TimeRange,
} from '@kbn/es-query';
import { isTimeRange } from '@kbn/data-plugin/common';
import { ToolType } from '@kbn/agent-builder-common';
import type { BuiltinToolDefinition } from '@kbn/agent-builder-server';
import { createErrorResult, createOtherResult } from '@kbn/agent-builder-server';
import {
  createDataViewDataSource,
  createEsqlDataSource,
  DataSourceType,
  type DiscoverDataSource,
} from '../../../common/data_sources';
import { isMetricsEsqlSupported } from '../../../common/context_awareness/metrics_esql';
import { parseDiscoverUrl, type ParsedDiscoverUrl } from './parse_discover_url';

// TODO: Important note! If we want to do this production ready, we should take care of the whole code. This was a quick PoC.
// So, most of the code it was vibecode + a little bit of manual refinement.

const discoverReadUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'URL must not be empty.')
    .describe(
      'A Discover URL — full origin URL, path, or just the `#/...` fragment — copied from the browser address bar or a Discover "Share" link. The tool decodes the rison-encoded `_g`, `_a`, and `_tab` state blobs and returns the data source, query, time range, filters, columns, sort, breakdown, and any saved-search reference encoded in the URL.'
    ),
});

type DiscoverReadUrlSchema = typeof discoverReadUrlSchema;

const TOOL_DESCRIPTION = `Decodes a shared Discover URL into the structured view state it represents (data source, query, time range, filters, columns, sort, breakdown, saved-search id, tab) plus a one-paragraph human-readable summary.

**When to use:**
- The user pastes a Discover URL or a Discover "Share" link and asks you to interpret, analyze, or act on what they were looking at.
- The user mentions "this view", "this dashboard link", "the URL I just shared", and you need the underlying query/time-range/filters to answer.
- You need to chain into another tool (e.g. \`platform_core_execute_esql\`, \`observability.get_metric_change_points\`) and the user gave you a Discover URL as the source of truth instead of typing the parameters out.

**Do NOT use for:**
- URLs from other Kibana apps (Dashboards, Lens, Alerting). Those will be rejected.
- Generating a Discover URL from parameters — use \`platform.discover.open_view\` (the inverse tool).
- Resolving the contents of a saved search referenced by id. v1 returns \`saved_search_id\` only; the saved-object payload is not fetched.

**Limitations:**
- URLs that store state in session-storage (the \`!h@<hex>\` sentinel — set when the advanced setting \`state:storeInSessionStorage\` is on) cannot be decoded server-side. The tool reports those keys as \`null\` with a warning in \`decode_warnings\`. Workaround: paste a non-hashed Share link, or turn the setting off.
- Discover URLs only. Cross-app deep-links (e.g. dashboards drilldowns) are out of scope.

**Response shape:** \`data_source\`, \`query\`, \`time_range\`, \`filters\` (canonical Kibana \`Filter[]\` merged from \`_a\` and \`_g\`; pinned filters from \`_g\` carry \`$state.store: 'globalState'\`, app-scope filters from \`_a\` carry \`$state.store: 'appState'\`), \`columns\`, \`sort\`, \`breakdown_field\`, \`view_mode\`, \`saved_search_id\`, \`tab\`, \`is_metrics_compatible\` (only meaningful for ES|QL pipelines — true when the pipeline activates the metrics-data-source-profile, null for KQL), \`summary\`, \`decode_warnings\`.

**How to render the response to the user:** quote the \`summary\` paragraph back so the user can confirm you read the link correctly, then act on the structured fields. If \`decode_warnings\` is non-empty, mention them — the structured state may be incomplete.`;

type DecodedQuery =
  | ({ type: 'esql' } & AggregateQuery)
  | { type: 'kql'; language: string; query: string };

interface DecodedTab {
  tabId: string;
  tabLabel?: string;
}

interface DecodedView {
  dataSource: DiscoverDataSource | null;
  query: DecodedQuery | null;
  timeRange: TimeRange | null;
  filters: Filter[];
  columns: string[] | null;
  sort: Array<[string, string]> | null;
  breakdownField: string | null;
  viewMode: string | null;
  savedSearchId: string | null;
  tab: DecodedTab | null;
  isMetricsCompatible: boolean | null;
}

export const discoverReadUrlTool = (): BuiltinToolDefinition<DiscoverReadUrlSchema> => ({
  id: 'platform.discover.read_url',
  type: ToolType.builtin,
  description: TOOL_DESCRIPTION,
  schema: discoverReadUrlSchema,
  handler: async (input) => {
    const parsed = parseDiscoverUrl(input.url);
    if (!parsed.ok) {
      return {
        results: [createErrorResult({ message: parsed.reason, metadata: { url: input.url } })],
      };
    }

    const view = buildView(parsed.value);
    const summary = buildSummary(view);

    return {
      results: [
        createOtherResult({
          data_source: view.dataSource,
          query: view.query,
          time_range: view.timeRange,
          filters: view.filters,
          columns: view.columns,
          sort: view.sort,
          breakdown_field: view.breakdownField,
          view_mode: view.viewMode,
          saved_search_id: view.savedSearchId,
          tab: view.tab,
          is_metrics_compatible: view.isMetricsCompatible,
          summary,
          decode_warnings: parsed.value.decodeWarnings,
        }),
      ],
    };
  },
  tags: ['discover', 'urls'],
});

const buildView = ({
  appState,
  globalState,
  tabState,
  savedSearchId,
}: ParsedDiscoverUrl): DecodedView => {
  const query = coerceQuery(appState?.query);
  const isMetricsCompatible = query?.type === 'esql' ? isMetricsEsqlSupported(query.esql).ok : null;

  return {
    dataSource: coerceDataSource(appState?.dataSource),
    query,
    timeRange: isTimeRange(globalState?.time) ? globalState.time : null,
    filters: collectFilters(appState?.filters, globalState?.filters),
    columns: coerceStringArray(appState?.columns),
    sort: coerceSort(appState?.sort),
    breakdownField: coerceNonEmptyString(appState?.breakdownField),
    viewMode: coerceNonEmptyString(appState?.viewMode),
    savedSearchId,
    tab: coerceTab(tabState),
    isMetricsCompatible,
  };
};

const coerceQuery = (raw: unknown): DecodedQuery | null => {
  if (!isRecord(raw)) return null;
  const query = raw as AggregateQuery | Query;
  if (isOfAggregateQueryType(query) && typeof query.esql === 'string') {
    return { type: 'esql', esql: query.esql };
  }
  if (isOfQueryType(query) && typeof query.query === 'string') {
    return {
      type: 'kql',
      language: typeof query.language === 'string' ? query.language : 'kuery',
      query: query.query,
    };
  }
  return null;
};

const coerceDataSource = (raw: unknown): DiscoverDataSource | null => {
  if (!isRecord(raw)) return null;
  if (raw.type === DataSourceType.Esql) return createEsqlDataSource();
  if (raw.type === DataSourceType.DataView && typeof raw.dataViewId === 'string') {
    return createDataViewDataSource({ dataViewId: raw.dataViewId });
  }
  return null;
};

const coerceStringArray = (raw: unknown): string[] | null => {
  if (!Array.isArray(raw)) return null;
  const filtered = raw.filter((v): v is string => typeof v === 'string');
  return filtered.length === raw.length ? filtered : null;
};

const coerceSort = (raw: unknown): Array<[string, string]> | null => {
  if (!Array.isArray(raw)) return null;
  const out: Array<[string, string]> = [];
  for (const entry of raw) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
      out.push([entry[0], entry[1]]);
    } else {
      return null;
    }
  }
  return out;
};

const coerceNonEmptyString = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return raw;
};

const coerceTab = (raw: Record<string, unknown> | null | undefined): DecodedTab | null => {
  if (!raw || typeof raw.tabId !== 'string') return null;
  return {
    tabId: raw.tabId,
    tabLabel: typeof raw.tabLabel === 'string' ? raw.tabLabel : undefined,
  };
};

const collectFilters = (appFilters: unknown, globalFilters: unknown): Filter[] => {
  const out: Filter[] = [];
  if (Array.isArray(appFilters)) {
    for (const f of appFilters) {
      if (isRecord(f)) out.push(unpinFilter(f as Filter));
    }
  }
  if (Array.isArray(globalFilters)) {
    for (const f of globalFilters) {
      if (isRecord(f)) out.push(pinFilter(f as Filter));
    }
  }
  return out;
};

const buildSummary = (view: DecodedView): string => {
  if (
    view.savedSearchId &&
    !view.dataSource &&
    !view.timeRange &&
    !view.query &&
    view.filters.length === 0
  ) {
    return `Saved search reference (id: ${view.savedSearchId}) — saved-search content is not embedded in the URL.`;
  }

  const parts: string[] = [];
  if (view.dataSource?.type === DataSourceType.Esql) parts.push('ES|QL data source');
  else if (view.dataSource?.type === DataSourceType.DataView)
    parts.push(`DataView \`${view.dataSource.dataViewId ?? 'unknown'}\``);

  if (view.timeRange) parts.push(`time \`${view.timeRange.from} → ${view.timeRange.to}\``);

  if (view.query?.type === 'esql') parts.push(`pipeline \`${view.query.esql}\``);
  else if (view.query?.type === 'kql')
    parts.push(`${view.query.language.toUpperCase()} \`${view.query.query}\``);

  if (view.breakdownField) parts.push(`breakdown by \`${view.breakdownField}\``);
  if (view.columns?.length) parts.push(`columns: ${view.columns.join(', ')}`);
  if (view.filters.length) parts.push(`${view.filters.length} filter(s) applied`);
  if (view.savedSearchId) parts.push(`saved-search id \`${view.savedSearchId}\``);
  if (view.viewMode) parts.push(`view mode \`${view.viewMode}\``);

  if (parts.length === 0) return 'No structured Discover state present in URL.';
  return `Discover view: ${parts.join('; ')}.`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
