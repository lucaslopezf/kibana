/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { z } from '@kbn/zod/v4';
import { i18n } from '@kbn/i18n';
import { isOfAggregateQueryType, type AggregateQuery, type Query } from '@kbn/es-query';
import type { BrowserApiToolDefinition } from '@kbn/agent-builder-browser/tools/browser_api_tool';
import { AttachmentType, type AttachmentInput } from '@kbn/agent-builder-common/attachments';
import { useDiscoverServices } from '../../../../hooks/use_discover_services';
import {
  internalStateActions,
  useAppStateSelector,
  useCurrentDataView,
  useCurrentTabAction,
  useCurrentTabDataStateContainer,
  useCurrentTabSelector,
  useInternalStateDispatch,
} from '../../state_management/redux';
import { useDataState } from '../../hooks/use_data_state';
import { FetchStatus } from '../../../types';
import { useFetchMoreRecords } from '../layout/use_fetch_more_records';
import { ESQL_QUERY_RESULTS_ATTACHMENT_TYPE } from '../../../../../common/agent_builder';
import {
  useProfileAccessor,
  type DeepAnalysisPlaybookExtension,
} from '../../../../context_awareness';

const SESSION_TAG = 'discover';
const MAX_SAMPLE_ROWS = 10;
const MAX_COLUMNS = 100;
const MAX_VALUE_LENGTH = 100;

const updateQuerySchema = z.object({
  query: z.string().min(1).describe('The query string to apply to the current Discover tab.'),
  language: z
    .enum(['kuery', 'lucene'])
    .optional()
    .describe('For non-ES|QL tabs, the query language to use if it should change.'),
});

export const toDiscoverQuery = (
  currentQuery: AggregateQuery | Query | undefined,
  nextQuery: string,
  nextLanguage?: 'kuery' | 'lucene'
): AggregateQuery | Query => {
  if (isOfAggregateQueryType(currentQuery)) {
    return { esql: nextQuery };
  }
  return {
    language: nextLanguage ?? currentQuery?.language ?? 'kuery',
    query: nextQuery,
  };
};

const getQueryLanguage = (query: AggregateQuery | Query | undefined): string => {
  if (!query) return 'kuery';
  if (isOfAggregateQueryType(query)) return 'esql';
  return query.language;
};

const getQueryText = (query: AggregateQuery | Query | undefined): string => {
  if (!query) return '';
  if (isOfAggregateQueryType(query)) return query.esql;
  return String(query.query);
};

export const buildScreenContext = (
  dataViewTitle: string,
  query: AggregateQuery | Query | undefined,
  columns: string[] | undefined,
  dataSourceType: string | undefined,
  timeRange: { from: string; to: string } | undefined
): AttachmentInput => ({
  hidden: true,
  type: AttachmentType.screenContext,
  data: {
    app: SESSION_TAG,
    url: window.location.href,
    description: i18n.translate('discover.agentBuilder.screenContextDescription', {
      defaultMessage:
        'The user is viewing a Discover tab for data view {dataViewTitle} in {queryLanguage} mode.',
      values: { dataViewTitle, queryLanguage: getQueryLanguage(query) },
    }),
    time_range: timeRange,
    additional_data: {
      columns: JSON.stringify(columns ?? []),
      data_source_type: dataSourceType ?? 'unknown',
      data_view: dataViewTitle,
      query: getQueryText(query),
      query_language: getQueryLanguage(query),
    },
  },
});

export const buildEsqlResultsAttachment = (
  esqlQuery: string,
  esqlQueryColumns: Array<{ name: string; meta?: { type?: string } }>,
  result: Array<{ flattened: Record<string, unknown> }>,
  totalHits: number,
  timeRange: { from: string; to: string } | undefined,
  playbookContribution?: DeepAnalysisPlaybookExtension,
  /**
   * Stable id for the attachment. Defaults to the tab-level results id so the
   * passive Discover context replaces itself on each update; pass a chart-
   * specific id (see `buildAgentBuilderChartAttachmentId`) when emitting one
   * attachment per chart so they coexist instead of overwriting one another.
   */
  id: string = 'esql-query-results',
  /**
   * Optional human-readable title for the attachment. When set, the
   * agent-builder pill (`register_esql_results_ui.ts`) uses it verbatim
   * instead of the truncated query, so per-chart attachments are
   * identifiable at a glance.
   */
  title?: string
): AttachmentInput => {
  // Build a set of base field names to detect .keyword duplicates
  const columnNames = new Set(esqlQueryColumns.map((col) => col.name));

  // Filter out .keyword columns when the base field also exists (e.g. skip "host.keyword" if "host" exists)
  // no need to send columns with the same content twice
  const filteredColumns = esqlQueryColumns.filter((col) => {
    if (col.name.endsWith('.keyword')) {
      const baseName = col.name.slice(0, -'.keyword'.length);
      return !columnNames.has(baseName);
    }
    return true;
  });

  const columns = filteredColumns.slice(0, MAX_COLUMNS).map((col) => ({
    name: col.name,
    type: col.meta?.type ?? 'unknown',
  }));

  const sampleRows = result.slice(0, MAX_SAMPLE_ROWS).map((row) => {
    const rowData: Record<string, unknown> = {};
    for (const col of columns) {
      const value = row.flattened[col.name];
      if (value !== undefined) {
        rowData[col.name] =
          typeof value === 'string' && value.length > MAX_VALUE_LENGTH
            ? value.substring(0, MAX_VALUE_LENGTH) + '...'
            : value;
      }
    }
    return rowData;
  });

  return {
    id,
    type: ESQL_QUERY_RESULTS_ATTACHMENT_TYPE,
    data: {
      query: esqlQuery,
      columns,
      sampleRows,
      totalHits,
      timeRange,
      ...(title ? { title } : {}),
      ...(playbookContribution ? { playbookContribution } : {}),
    },
  };
};

export const DiscoverAgentBuilderConfig = () => {
  const { agentBuilder } = useDiscoverServices();
  const dispatch = useInternalStateDispatch();
  const dataView = useCurrentDataView();
  const [columns, dataSource, query] = useAppStateSelector((state) => [
    state.columns,
    state.dataSource,
    state.query,
  ]);
  const timeRange = useCurrentTabSelector((tab) => tab.globalState.timeRange);
  const chartAttachments = useCurrentTabSelector((tab) => tab.agentBuilderChartAttachments);

  const dataStateContainer = useCurrentTabDataStateContainer();
  const documentState = useDataState(dataStateContainer.data$.documents$);
  const { totalHits } = useFetchMoreRecords();
  const getDeepAnalysisPlaybookAccessor = useProfileAccessor('getDeepAnalysisPlaybook');

  const isEsqlMode = isOfAggregateQueryType(query);
  const hasEsqlResults =
    isEsqlMode &&
    documentState.fetchStatus === FetchStatus.COMPLETE &&
    documentState.result &&
    documentState.result.length > 0 &&
    Boolean(documentState.esqlQueryColumns);

  // Use a ref for query so the tool handler always reads the latest value
  const queryRef = useRef(query);
  queryRef.current = query;

  const runQueryTool: BrowserApiToolDefinition<z.infer<typeof updateQuerySchema>> = useMemo(
    () => ({
      id: 'discover_run_query',
      description: i18n.translate('discover.agentBuilder.runQueryToolDescription', {
        defaultMessage: 'Run a query in a new Discover tab.',
      }),
      schema: updateQuerySchema,
      handler: async ({ language, query: nextQuery }: z.infer<typeof updateQuerySchema>) => {
        const newQuery = toDiscoverQuery(queryRef.current, nextQuery, language);
        dispatch(internalStateActions.openInNewTab({ appState: { query: newQuery } }));
      },
    }),
    [dispatch]
  );

  const browserApiTools = useMemo(
    () => (isEsqlMode ? [runQueryTool] : []),
    [isEsqlMode, runQueryTool]
  );

  // Track which chart-attachment ids we've already pushed to the sidebar so we
  // can open the panel the first time each one shows up without re-opening it
  // on every re-render.
  const seenChartAttachmentIdsRef = useRef<Set<string>>(new Set());

  const removeChartAttachment = useCurrentTabAction(
    internalStateActions.removeAgentBuilderChartAttachment
  );

  // When the user closes a chip in the agent builder, drop the chart from Redux
  // (our source of truth) so the next `setChatConfig` does not re-push it, and
  // forget its id so re-attaching the same chart is treated as new (re-opening
  // the panel).
  const handleAttachmentRemoved = useCallback(
    (attachmentId: string) => {
      seenChartAttachmentIdsRef.current.delete(attachmentId);
      dispatch(removeChartAttachment({ id: attachmentId }));
    },
    [dispatch, removeChartAttachment]
  );

  useEffect(() => {
    if (!agentBuilder) {
      return;
    }

    const normalizedTimeRange = timeRange ? { from: timeRange.from, to: timeRange.to } : undefined;

    const attachments: AttachmentInput[] = [
      buildScreenContext(
        dataView.getIndexPattern(),
        query,
        columns,
        dataSource?.type,
        normalizedTimeRange
      ),
    ];

    const hasChartAttachments = Boolean(chartAttachments && chartAttachments.length > 0);

    // The passive tab-level ES|QL results chip is only added when the user has
    // not explicitly attached any chart. With chart attachments present, the
    // user has signalled exactly what they want the agent to look at; adding
    // the tab-level query on top would duplicate context and clutter the
    // panel. Note: the hidden screen-context attachment above still carries
    // the tab's query for the agent.
    if (
      hasEsqlResults &&
      !hasChartAttachments &&
      documentState.esqlQueryColumns &&
      documentState.result
    ) {
      const esqlQuery = isOfAggregateQueryType(query) ? query.esql : '';
      const playbookContribution = getDeepAnalysisPlaybookAccessor(() => undefined)({
        dataView,
        query,
        columns: documentState.esqlQueryColumns.map((col) => ({
          name: col.name,
          type: col.meta?.type,
        })),
      });
      attachments.push(
        buildEsqlResultsAttachment(
          esqlQuery,
          documentState.esqlQueryColumns,
          documentState.result,
          totalHits ?? documentState.result.length,
          normalizedTimeRange,
          playbookContribution
        )
      );
    }

    // Append one `esql.query_results` attachment per chart the user has
    // explicitly attached. We carry over the tab-level Shape Profile so each
    // chart attachment also tells the agent how to drill into it.
    //
    // When the user closes a chip, the agent builder calls
    // `onAttachmentRemoved` (see `handleAttachmentRemoved`), which drops the
    // chart from Redux so this effect no longer re-pushes it on the next pass.
    if (chartAttachments && chartAttachments.length > 0) {
      const chartPlaybookContribution = getDeepAnalysisPlaybookAccessor(() => undefined)({
        dataView,
        query,
        columns: undefined,
      });
      for (const chart of chartAttachments) {
        const chartTimeRange = chart.timeRange
          ? { from: chart.timeRange.from, to: chart.timeRange.to }
          : normalizedTimeRange;
        // We do not have rows for individual charts at attach time; the agent
        // can call `executeEsql` to fetch them on demand using the query.
        const chartColumns = (chart.columns ?? []).map((col) => ({
          name: col.name,
          meta: { type: col.type },
        }));
        const chartTitle =
          chart.dimensions.length > 0
            ? i18n.translate('discover.agentBuilder.chartAttachmentTitleWithDimensions', {
                defaultMessage: '{title} by {dimensions}',
                values: { title: chart.title, dimensions: chart.dimensions.join(', ') },
              })
            : chart.title;
        attachments.push(
          buildEsqlResultsAttachment(
            chart.esqlQuery,
            chartColumns,
            [],
            0,
            chartTimeRange,
            chartPlaybookContribution,
            chart.id,
            chartTitle
          )
        );
      }
    }

    agentBuilder.setChatConfig({
      sessionTag: SESSION_TAG,
      attachments,
      browserApiTools,
      onAttachmentRemoved: handleAttachmentRemoved,
    });

    // Open the panel the first time a new chart attachment appears, so the
    // user immediately sees the chip after clicking the chart action. Existing
    // attachments do not re-trigger the open call across re-renders.
    if (chartAttachments && chartAttachments.length > 0) {
      const seen = seenChartAttachmentIdsRef.current;
      const newIds = chartAttachments.filter((chart) => !seen.has(chart.id));
      if (newIds.length > 0) {
        for (const chart of newIds) {
          seen.add(chart.id);
        }
        // Intentionally call without args: `openChat` with any options replaces
        // the active chat config with just those options, wiping the
        // attachments we just pushed via `setChatConfig`. With no args,
        // `openSidebarInternal` falls back to `conversationActiveConfig`
        // (the full config we just set) instead.
        agentBuilder.openChat();
      }
    }

    return () => {
      agentBuilder.clearChatConfig();
    };
  }, [
    agentBuilder,
    browserApiTools,
    chartAttachments,
    columns,
    dataSource?.type,
    dataView,
    documentState.esqlQueryColumns,
    documentState.result,
    getDeepAnalysisPlaybookAccessor,
    handleAttachmentRemoved,
    hasEsqlResults,
    isEsqlMode,
    query,
    timeRange,
    totalHits,
  ]);

  return null;
};
