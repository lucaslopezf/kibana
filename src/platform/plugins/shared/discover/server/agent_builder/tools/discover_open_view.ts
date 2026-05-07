/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod/v4';
import { Parser } from '@elastic/esql';
import { zipObject } from 'lodash';
import type {
  CoreSetup,
  HttpServiceStart,
  IScopedClusterClient,
  KibanaRequest,
  Logger,
} from '@kbn/core/server';
import { ToolType } from '@kbn/agent-builder-common';
import type { BuiltinToolDefinition } from '@kbn/agent-builder-server';
import { createErrorResult, createOtherResult } from '@kbn/agent-builder-server';
import { ALLOWED_METRIC_TYPES_SET, isInternalDimension } from '@kbn/discover-utils';
import { buildMetricsInfoQuery } from '@kbn/esql-utils';
import { setStateToKbnUrl } from '@kbn/kibana-utils-plugin/common';
import { appLocatorGetLocationCommon } from '../../../common/app_locator_get_location';
import { METRICS_EXPERIENCE_PRODUCT_FEATURE_ID } from '../../../common/constants';
import { isMetricsEsqlSupported } from '../../../common/context_awareness/metrics_esql';
import { getKibanaAppUrl } from './kibana_app_url';

const DEFAULT_TIME_RANGE = { from: 'now-15m', to: 'now' } as const;

const discoverOpenViewSchema = z.object({
  intent: z.literal('metrics').describe('Discover profile to activate. v1 supports metrics only.'),
  pattern: z
    .string()
    .trim()
    .min(1, 'Pattern must not be empty or whitespace.')
    .default('metrics-*')
    .describe(
      `Index pattern for the data to view. Defaults to "metrics-*" — that's the right value for any generic "show me [...] metrics" request. The user does not need to name an index; only override this when the user explicitly typed a pattern (e.g. "metrics-apm.*", "my-service-metrics-*", "cluster:metrics-*"). Wildcards, datastream dots, and remote-cluster syntax are all supported.`
    ),
  timeRange: z
    .object({
      from: z.string().describe('Start time using Elasticsearch date math (e.g. "now-1h").'),
      to: z.string().describe('End time (e.g. "now").'),
    })
    .optional()
    .describe('Defaults to the last 15 minutes when omitted.'),
  where: z
    .string()
    .optional()
    .describe(
      `Optional WHERE clause body without the leading WHERE keyword. Example: 'host.name == "web-01"'. The clause is parsed; if it contains anything other than WHERE, the call is rejected.`
    )
    .superRefine((value, ctx) => {
      if (value === undefined || value.trim() === '') return;
      const result = validateWhereFragment(value);
      if (!result.ok) {
        ctx.addIssue({ code: 'custom', message: result.reason });
      }
    }),
  limit: z.number().int().positive().optional().describe('Optional row limit.'),
  breakdownField: z
    .string()
    .optional()
    .describe(
      `Optional dimension to break the metric chart down by — selects the breakdown control in Discover's metrics view. Use whenever the user phrases their request with "by", "grouped by", "broken down by", "per", "split by", or "for each" some dimension. The metric and the dimension can be anything the indices expose, e.g. "CPU by host.name", "memory grouped by container.id", "request rate per service.name", "error rate by region", "queue depth split by tenant.id", "throughput for each k8s pod". For OTel datastreams (patterns matching "*.otel-default" or "*.otel-*"), dimensions are usually nested under "resource.attributes.*" (e.g. resource.attributes.host.name, resource.attributes.service.name, resource.attributes.k8s.pod.name). For ECS-style indices, dimensions are flat (e.g. host.name, service.name, kubernetes.pod.name). When unsure which shape the index uses, call platform_core_get_index_mapping first and pick the field that matches the dimension the user asked for.`
    ),
});

type DiscoverOpenViewSchema = typeof discoverOpenViewSchema;
type DiscoverOpenViewInput = z.infer<DiscoverOpenViewSchema>;

const TOOL_DESCRIPTION = `Builds a Kibana Discover URL that opens with the metrics-data-source-profile activated, plus an inline metrics-info snapshot, in a single tool call. v1 supports metrics intent only — not logs, not traces.

**When to use:**
- The user wants to see, open, or share **any** metric or set of metrics for an index pattern. The metric can be anything: CPU, memory, disk, network, latency, throughput, error rate, queue length, request count, GPU/temperature readings, business or custom counters, etc.
- The user phrases the request as "show me X metrics", "open metrics for X in Discover", "metrics for my Y", "give me a Kibana URL for Z metrics", "X by Y", "X per Y", "X grouped by Y", or similar — where Y is any dimension exposed by the indices (host, pod, container, service, namespace, region, tenant, customer id, application label, OTel \`resource.attributes.*\`, …).
- The user wants the URL itself: "give me a link", "open in Discover", "share this view".
- The user wants both: a quick metric-metadata snapshot (returned as \`summary\`) and a clickable URL to drill in.

**Do NOT use for:**
- Log queries or log analysis — use \`observability.run_log_rate_analysis\` or \`observability.get_logs\` if the user is in the observability solution.
- Trace queries — use \`observability.get_traces\` or \`observability.get_trace_metrics\`.
- Embedding aggregations (STATS, EVAL on metric values, KEEP/DROP, …) inside the URL — those commands deactivate the metrics profile, so the tool rejects them. This is a viewer, not a transformation.

**Inputs to flag:**
- \`pattern\` defaults to \`metrics-*\`, which is correct for any generic "show me [...] metrics" request. Override only when the user explicitly typed a specific pattern.
- \`breakdownField\` is optional. When set it must appear in the indices' \`METRICS_INFO.dimension_fields\` (the same source the Discover metrics grid uses to populate its dimension picker); the call is rejected with the list of valid dimensions otherwise.

**Response shape:** \`url\` (fully-qualified Discover link), \`esql_query\` (what the URL runs), \`resolved_pattern\`, \`breakdown_field\`, \`available_breakdown_fields\` (every dimension surfaced by \`METRICS_INFO\` for the matching indices — pick a valid \`breakdownField\` from this list), \`summary\` (the full \`METRICS_INFO\` snapshot — metric name, dimensions, unit, … — for the pattern, independent of \`breakdownField\`), and \`will_activate\` plus optional \`activation_blockers\`.

**How to render the response to the user:** include the inline \`summary\` AND the URL as a markdown link \`[Open in Discover](url)\`. The summary describes what metrics are in the matching indices; the URL drills in with the user's chosen time range and breakdown applied. Don't drop either piece.

**Activation rule:** the metrics profile activates only when the URL's ES|QL pipeline uses commands strictly from {TS, WHERE, SORT, LIMIT}. The tool rejects inputs that would produce a non-activating query. The \`summary\` is the same pipeline with \`| METRICS_INFO\` appended (built via the shared \`buildMetricsInfoQuery\` helper) — it returns metric metadata, not a time-range aggregation, so it is independent of activation. If activation cannot be guaranteed at runtime (e.g. publicBaseUrl is not configured) the URL is still returned and \`activation_blockers\` carries human-readable reasons.`;

export const discoverOpenViewTool = (
  coreSetup: CoreSetup
): BuiltinToolDefinition<DiscoverOpenViewSchema> => {
  // Cache the start-services promise so it resolves at most once across invocations.
  let startServicesPromise: ReturnType<CoreSetup['getStartServices']> | undefined;
  const getStartServices = () => {
    if (!startServicesPromise) {
      startServicesPromise = coreSetup.getStartServices();
    }
    return startServicesPromise;
  };

  return {
    id: 'platform.discover.open_view',
    type: ToolType.builtin,
    description: TOOL_DESCRIPTION,
    schema: discoverOpenViewSchema,
    availability: {
      handler: async () => {
        const isAvailable = await coreSetup.pricing.isFeatureAvailable(
          METRICS_EXPERIENCE_PRODUCT_FEATURE_ID
        );
        return isAvailable
          ? { status: 'available' }
          : {
              status: 'unavailable',
              reason:
                'metrics-experience product feature is not enabled in this pricing tier (observability/complete or security/complete required).',
            };
      },
      cacheMode: 'global',
    },
    handler: async (input, { request, logger, esClient }) => {
      const [coreStart] = await getStartServices();

      // 1. Build the ES|QL pipeline. Input was already validated by Zod.
      const esql = buildMetricsEsql(input);

      // 2. Sanity-check the pipeline activates the metrics profile.
      const support = isMetricsEsqlSupported(esql);
      if (!support.ok) {
        return metricsErrorResult({
          message: support.reason,
          esql,
          pattern: input.pattern,
        });
      }

      // 3. Run METRICS_INFO once to derive both the canonical dimension list
      // (same source the metrics-experience grid uses to populate its picker)
      // and the inline summary the agent renders alongside the URL. Sharing a
      // single round-trip keeps validation and rendering in lockstep with the UI.
      const snapshot = await getMetricsSnapshot(esClient, esql, logger);

      // 4. Validate user-supplied breakdownField against the canonical list.
      // An invalid breakdown is a hard error: returning a Discover URL whose
      // breakdownField the metrics grid cannot match leaves the dimension
      // picker silently empty, so we reject before composing the URL.
      if (
        input.breakdownField !== undefined &&
        !snapshot.availableBreakdownFields.includes(input.breakdownField)
      ) {
        const suggestions =
          snapshot.availableBreakdownFields.length > 0
            ? ` Available dimensions in this pattern: ${snapshot.availableBreakdownFields.join(
                ', '
              )}.`
            : snapshot.snapshotError
            ? ` METRICS_INFO introspection failed: ${snapshot.snapshotError}.`
            : ' No dimensions were surfaced by METRICS_INFO for this pattern (it may not be a metrics index, or you lack read access).';
        return metricsErrorResult({
          message: `breakdownField "${input.breakdownField}" is not a metrics dimension surfaced by METRICS_INFO for "${input.pattern}".${suggestions}`,
          esql,
          pattern: input.pattern,
          extra: { available_breakdown_fields: snapshot.availableBreakdownFields },
        });
      }

      // 5. Construct the fully-qualified URL. (Pricing-tier gating is handled
      // by `availability` above — the agent never sees this tool on tiers
      // without the metrics-experience product feature.)
      const urlResult = await constructDiscoverUrl({
        esql,
        timeRange: input.timeRange ?? DEFAULT_TIME_RANGE,
        breakdownField: input.breakdownField,
        request,
        http: coreStart.http,
      });
      if (!urlResult.ok) {
        logger.error(`discover.open_view: URL construction failed: ${urlResult.reason}`);
        return metricsErrorResult({
          message: `Failed to construct Discover URL: ${urlResult.reason}`,
          esql,
          pattern: input.pattern,
        });
      }
      const url = urlResult.url;

      // 6. Surface localhost fallback as a non-fatal blocker.
      // TODO: also fall back to cloud.kibanaUrl when publicBaseUrl is unset
      // (requires `cloud` as an optional Discover dep — deferred).
      const blockers: string[] = [];
      if (coreStart.http.basePath.publicBaseUrl === undefined) {
        blockers.push(
          'Kibana publicBaseUrl is not configured; the URL falls back to localhost and will only work in a local-dev environment.'
        );
      }

      return {
        results: [
          createOtherResult({
            url,
            esql_query: esql,
            resolved_pattern: input.pattern,
            breakdown_field: input.breakdownField,
            available_breakdown_fields: snapshot.availableBreakdownFields,
            summary: snapshot.summary,
            will_activate: blockers.length === 0,
            activation_blockers: blockers.length > 0 ? blockers : undefined,
          }),
        ],
      };
    },
    tags: ['discover', 'urls', 'metrics'],
  };
};

/**
 * Pure string assembly of the metrics pipeline. Pattern trimming and
 * `WHERE` fragment validation are enforced by the Zod schema, so this
 * function cannot fail and never needs a result envelope.
 */
const buildMetricsEsql = (input: DiscoverOpenViewInput): string => {
  const parts: string[] = [`TS ${input.pattern}`];
  if (input.where !== undefined && input.where.trim() !== '') {
    parts.push(`WHERE ${input.where.trim()}`);
  }
  if (input.limit !== undefined) {
    parts.push(`LIMIT ${input.limit}`);
  }
  return parts.join(' | ');
};

const validateWhereFragment = (fragment: string): { ok: true } | { ok: false; reason: string } => {
  const probe = `FROM dummy | WHERE ${fragment}`;
  const parsed = Parser.parse(probe);
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      reason: `WHERE clause has parse errors: ${parsed.errors.map((e) => e.message).join('; ')}`,
    };
  }
  const extras = parsed.root.commands.filter((c) => c.name !== 'from' && c.name !== 'where');
  if (extras.length > 0) {
    return {
      ok: false,
      reason: `WHERE clause must not introduce additional commands. Found: ${extras
        .map((c) => c.name)
        .join(', ')}`,
    };
  }
  return { ok: true };
};

interface MetricsSummary {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

interface MetricsSnapshot {
  summary: MetricsSummary | null;
  availableBreakdownFields: string[];
  snapshotError?: string;
}

/**
 * Runs `TS <pattern> | METRICS_INFO` once and returns both the inline
 * summary the agent renders alongside the URL and the canonical list of
 * dimensions to validate `breakdownField` against.
 *
 * The dimension list is derived from the `dimension_fields` column of the
 * METRICS_INFO response — the same source the metrics-experience grid uses
 * to populate its picker (see `parseMetricsWithTelemetry` in
 * `kbn-unified-chart-section-viewer`). Internal metadata names like
 * `_metric_names_hash`, `unit`, and `labels._*` are filtered out via
 * {@link isInternalDimension} so they never surface to the agent.
 *
 * The query is intentionally unfiltered (no breakdown WHERE clause). The
 * URL still carries the chosen breakdownField, so the user lands in
 * Discover with it applied; the snapshot is a global picture of what's in
 * the indices, not a per-breakdown subset.
 *
 * Failures are non-fatal: the URL is the primary deliverable. We log the
 * error, return an empty dimension list plus the human-readable reason in
 * `snapshotError`, and let the caller surface it in the validation message.
 */
const getMetricsSnapshot = async (
  esClient: IScopedClusterClient,
  esql: string,
  logger: Logger
): Promise<MetricsSnapshot> => {
  const snapshotQuery = buildMetricsInfoQuery(esql);
  if (snapshotQuery === '') {
    const reason = `buildMetricsInfoQuery rejected the pipeline "${esql}".`;
    logger.warn(`discover.open_view: skipping snapshot — ${reason}`);
    return { summary: null, availableBreakdownFields: [], snapshotError: reason };
  }

  try {
    const response = await esClient.asCurrentUser.esql.query({ query: snapshotQuery });
    const columns = response.columns.map((c) => c.name);
    const rows = response.values.map((row) => zipObject(columns, row));
    return {
      summary: { columns, rows },
      availableBreakdownFields: extractAvailableBreakdownFields(rows),
    };
  } catch (error) {
    const reason = (error as Error).message;
    logger.warn(
      `discover.open_view: METRICS_INFO snapshot for pipeline "${esql}" failed: ${reason}`
    );
    return { summary: null, availableBreakdownFields: [], snapshotError: reason };
  }
};

/**
 * Aggregates `dimension_fields` across all METRICS_INFO rows into a
 * deduped, sorted, internal-filtered list. Applies the same row-level
 * metric-type gate (`ALLOWED_METRIC_TYPES`) and dimension-name filter
 * (`isInternalDimension`) the metrics-experience grid uses, so the
 * validation list matches the dimensions the UI will actually render.
 */
const extractAvailableBreakdownFields = (rows: Array<Record<string, unknown>>): string[] => {
  const dimensions = new Set<string>();

  for (const row of rows) {
    const metricTypes = toArray(row.metric_type);
    if (!metricTypes.every((type) => ALLOWED_METRIC_TYPES_SET.has(type))) {
      continue;
    }
    for (const name of toArray(row.dimension_fields)) {
      if (!isInternalDimension(name)) {
        dimensions.add(name);
      }
    }
  }

  return [...dimensions].sort();
};

/**
 * Coerces a METRICS_INFO column value (which may be a single string or a
 * string array depending on cardinality) into a string array, dropping
 * anything that isn't a string. Mirrors the UI's `toArray` helper.
 */
const toArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return [value];
  return [];
};

const constructDiscoverUrl = async (params: {
  esql: string;
  timeRange: { from: string; to: string };
  breakdownField?: string;
  request: KibanaRequest;
  http: HttpServiceStart;
}): Promise<{ ok: true; url: string } | { ok: false; reason: string }> => {
  try {
    const { path: discoverPath } = await appLocatorGetLocationCommon(
      { useHash: false, setStateToKbnUrl },
      {
        query: { esql: params.esql },
        timeRange: params.timeRange,
        breakdownField: params.breakdownField,
      }
    );
    return {
      ok: true,
      url: getKibanaAppUrl(params.http, params.request, `/app/discover${discoverPath}`),
    };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
};

/**
 * Wraps `createErrorResult` for the open-view tool so every error carries the
 * same baseline metadata.
 */
const metricsErrorResult = (params: {
  message: string;
  esql: string;
  pattern: string;
  extra?: Record<string, unknown>;
}) => ({
  results: [
    createErrorResult({
      message: params.message,
      metadata: {
        esql_query: params.esql,
        resolved_pattern: params.pattern,
        ...params.extra,
      },
    }),
  ],
});
