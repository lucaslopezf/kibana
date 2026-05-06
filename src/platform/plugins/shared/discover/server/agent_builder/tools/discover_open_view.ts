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
- \`breakdownField\` is optional. When set it must be a \`time_series_dimension\` field on the matching indices; the call is rejected with the list of available dimensions otherwise.

**Response shape:** \`url\` (fully-qualified Discover link), \`esql_query\` (what the URL runs), \`resolved_pattern\`, \`breakdown_field\`, \`available_breakdown_fields\` (every \`time_series_dimension: true\` field discovered in the matching indices — use it to pick a valid \`breakdownField\`), \`summary\` (a \`METRICS_INFO\` snapshot — metric name, dimensions, unit, … — of the metrics that match the URL's pipeline, scoped to \`breakdownField\` when one is set), and \`will_activate\` plus optional \`activation_blockers\`.

**How to render the response to the user:** include the inline \`summary\` AND the URL as a markdown link \`[Open in Discover](url)\`. The summary describes what metrics are in the matching indices; the URL drills in with the user's chosen time range and breakdown applied. Don't drop either piece.

**Activation rule:** the metrics profile activates only when the URL's ES|QL pipeline uses commands strictly from {TS, WHERE, SORT, LIMIT}. The tool rejects inputs that would produce a non-activating query. The \`summary\` is the same pipeline with \`| METRICS_INFO\` appended (built via the shared \`buildMetricsInfoQuery\` helper) — it returns metric metadata, not a time-range aggregation, so it is independent of activation. If activation cannot be guaranteed at runtime (e.g. publicBaseUrl is not configured) the URL is still returned and \`activation_blockers\` carries human-readable reasons.`;

export const discoverOpenViewTool = (
  coreSetup: CoreSetup
): BuiltinToolDefinition<DiscoverOpenViewSchema> => {
  // Cache the start-services promise so it resolves at most once across
  // invocations, mirroring the pattern used by other Agent Builder tools
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

      // 3. Introspect the index mapping to discover available breakdown
      // fields (time-series dimensions) and validate user-supplied breakdownField.
      // An invalid breakdown is a hard error: returning a Discover URL with a
      // dead breakdown produces a broken view, so we reject before composing
      // the URL or the metrics-info summary.
      const availableBreakdownFields = await getAvailableBreakdownFields(
        esClient,
        input.pattern,
        logger
      );
      if (
        input.breakdownField !== undefined &&
        !availableBreakdownFields.includes(input.breakdownField)
      ) {
        const suggestions =
          availableBreakdownFields.length > 0
            ? ` Available time-series dimensions in this pattern: ${availableBreakdownFields.join(
                ', '
              )}.`
            : ' No time-series dimensions were found in this pattern (it may not be a metrics index, or you lack read access).';
        return metricsErrorResult({
          message: `breakdownField "${input.breakdownField}" is not a time-series dimension on any matching index of "${input.pattern}".${suggestions}`,
          esql,
          pattern: input.pattern,
          extra: { available_breakdown_fields: availableBreakdownFields },
        });
      }

      // 4. Construct the fully-qualified URL. (Pricing-tier gating is handled
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

      // 5. Surface localhost fallback as a non-fatal blocker.
      // TODO: also fall back to cloud.kibanaUrl when publicBaseUrl is unset
      // (requires `cloud` as an optional Discover dep — deferred).
      const blockers: string[] = [];
      if (coreStart.http.basePath.publicBaseUrl === undefined) {
        blockers.push(
          'Kibana publicBaseUrl is not configured; the URL falls back to localhost and will only work in a local-dev environment.'
        );
      }

      // 6. Fetch a small inline metrics-info summary so the agent can render
      // data alongside the URL in a single response.
      // Best-effort — failures don't block the URL from being returned.
      const summary = await getMetricsSummary(esClient, esql, input.breakdownField, logger);

      return {
        results: [
          createOtherResult({
            url,
            esql_query: esql,
            resolved_pattern: input.pattern,
            breakdown_field: input.breakdownField,
            available_breakdown_fields: availableBreakdownFields,
            summary,
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

/**
 * Fetches field caps for the pattern and returns the list of fields tagged
 * `time_series_dimension: true`. Empty list on any error (missing index,
 * no permissions, non-time-series indices) — never fails the tool call.
 *
 * The agent uses this list to pick a valid `breakdownField` instead of
 * guessing OTel-vs-ECS field names.
 */
const getAvailableBreakdownFields = async (
  esClient: IScopedClusterClient,
  pattern: string,
  logger: Logger
): Promise<string[]> => {
  try {
    const fieldCaps = await esClient.asCurrentUser.fieldCaps({
      index: pattern,
      fields: '*',
      // Ask ES to surface only fields it considers candidates for time-series
      // dimensions. Falls back gracefully on indices without dimension metadata.
      include_unmapped: false,
    });
    const dimensions = new Set<string>();
    for (const [fieldName, byType] of Object.entries(fieldCaps.fields)) {
      for (const typeInfo of Object.values(byType)) {
        if (typeInfo.time_series_dimension === true) {
          dimensions.add(fieldName);
          break;
        }
      }
    }
    return [...dimensions].sort();
  } catch (error) {
    logger.warn(
      `discover.open_view: field_caps lookup for pattern "${pattern}" failed: ${
        (error as Error).message
      }`
    );
    return [];
  }
};

/**
 * Fetches a small inline summary of the metrics that match the URL's ES|QL
 * pipeline so the agent can render data alongside the link in a single
 * response. Returns `null` on any error — the URL is the primary deliverable;
 * the summary is best-effort.
 *
 * Implementation: appends `| METRICS_INFO` to the same `TS …` pipeline used
 * by the URL via `buildMetricsInfoQuery` from `@kbn/esql-utils`. That helper
 * already parses the source query, drops transformational commands (`STATS`,
 * `KEEP`, `DROP`, `RENAME`, `ENRICH`, `JOIN`, …), preserves an explicit
 * `LIMIT`, and sanitises the breakdown dimension via `sanitazeESQLInput`.
 *
 * The result is a snapshot of metric metadata (name, dimensions, unit, …),
 * not a time-range-scoped aggregation, so it doesn't need to agree with the
 * URL's chosen time range.
 */
const getMetricsSummary = async (
  esClient: IScopedClusterClient,
  esql: string,
  breakdownField: string | undefined,
  logger: Logger
): Promise<{ columns: string[]; rows: Array<Record<string, unknown>> } | null> => {
  const summaryQuery = buildMetricsInfoQuery(esql, breakdownField ? [breakdownField] : undefined);
  if (summaryQuery === '') {
    logger.warn(
      `discover.open_view: skipping summary — buildMetricsInfoQuery rejected the pipeline "${esql}".`
    );
    return null;
  }

  try {
    const response = await esClient.asCurrentUser.esql.query({ query: summaryQuery });
    const columns = response.columns.map((c) => c.name);
    const rows = response.values.map((row) => zipObject(columns, row));
    return { columns, rows };
  } catch (error) {
    logger.warn(
      `discover.open_view: summary query for pipeline "${esql}" failed: ${(error as Error).message}`
    );
    return null;
  }
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
