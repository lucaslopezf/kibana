/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { useCallback, useMemo, useState } from 'react';
import { get } from 'lodash';
import type { ChartSectionProps } from '@kbn/unified-histogram/types';
import type { DataView } from '@kbn/data-views-plugin/public';
import { UnifiedMetricsExperienceGrid } from '@kbn/unified-chart-section-viewer';
import {
  UnifiedDocViewerObservabilityFullTraceFlyout,
  type UnifiedDocViewerObservabilityTracesDocumentType,
} from '@kbn/unified-doc-viewer-plugin/public';
import { lastValueFrom } from 'rxjs';
import {
  internalStateActions,
  useAppStateSelector,
  useCurrentTabAction,
  useInternalStateDispatch,
} from '../../../../../application/main/state_management/redux';
import { useDiscoverServices } from '../../../../../hooks/use_discover_services';
import type { ChartSectionConfigurationExtensionParams } from '../../../../types';
import type { DiscoverAppState } from '../../../../../application/main/state_management/redux';
import type { DataSourceProfileProvider } from '../../../../profiles';
import { METRICS_DATA_SOURCE_PROFILE_ID } from '../profile';

// PoC: hardcoded traces index pattern used for the ad-hoc DataView. The full-trace
// flyout itself pulls the real APM index pattern internally via the registered
// observability-full-trace-waterfall renderer, so this only seeds the dataView we
// pass for the nested span-detail flyout.
const TRACES_INDEX_PATTERN = 'traces-*';

// Pad the time range ±5 minutes around the fetched span so APM's trace API window
// reliably includes all related spans, regardless of Discover's current time picker.
const TRACE_RANGE_PAD_MS = 5 * 60 * 1000;

interface TraceFlyoutState {
  traceId: string;
  dataView: DataView;
  rangeFrom: string;
  rangeTo: string;
  docId: string | null;
  activeFlyoutType: UnifiedDocViewerObservabilityTracesDocumentType | null;
}

/**
 * Wrapper component that reads breakdownField from Discover's app state
 * and passes it to UnifiedMetricsExperienceGrid for syncing with dimensions selector.
 */
const MetricsExperienceGridWrapper = (
  props: ChartSectionProps & { actions: ChartSectionConfigurationExtensionParams['actions'] }
) => {
  const breakdownField = useAppStateSelector((state: DiscoverAppState) => state.breakdownField);
  const dispatch = useInternalStateDispatch();
  const updateAppState = useCurrentTabAction(internalStateActions.updateAppState);
  const { discoverShared, dataViews, notifications, docLinks, logger, data } =
    useDiscoverServices();

  const [traceFlyoutState, setTraceFlyoutState] = useState<TraceFlyoutState | null>(null);

  const onBreakdownFieldChange = useCallback(
    (nextBreakdownField?: string) => {
      dispatch(updateAppState({ appState: { breakdownField: nextBreakdownField } }));
    },
    [dispatch, updateAppState]
  );

  // PoC: ignores the clicked traceId and fetches whatever is currently in traces-*.
  // Opens the full trace-with-waterfall flyout — same UX as opening a trace doc in Discover.
  const openTraceById = useCallback(
    async (_traceId: string) => {
      try {
        const response = await lastValueFrom(
          data.search.search({
            params: {
              index: TRACES_INDEX_PATTERN,
              body: {
                size: 1,
                sort: [{ '@timestamp': 'desc' }],
                query: {
                  bool: {
                    filter: [
                      { exists: { field: 'trace.id' } },
                      // PoC: traces-apm-* mixes spans and transactions; constrain to
                      // spans for a stable hit shape with a valid trace.id.
                      { term: { 'processor.event': 'span' } },
                    ],
                  },
                },
              },
            },
          })
        );

        const hit = response.rawResponse?.hits?.hits?.[0];
        if (!hit) {
          notifications.toasts.addWarning({
            title: 'No spans found',
            text: `No documents in ${TRACES_INDEX_PATTERN} match processor.event: span with trace.id.`,
          });
          return;
        }

        const source = hit._source as Record<string, unknown> | undefined;
        // ECS docs store `trace.id` nested as `trace: { id: '…' }`; lodash get
        // interprets the dotted path correctly. Fall back to the literally-flat key.
        const traceIdValue: unknown = (source && get(source, 'trace.id')) ?? source?.['trace.id'];
        if (typeof traceIdValue !== 'string') {
          notifications.toasts.addWarning({
            title: 'Trace flyout',
            text: 'Fetched document has no trace.id; cannot open flyout.',
          });
          return;
        }

        // Pad ±5 minutes around the fetched span timestamp so APM's API window
        // covers the rest of the trace. Falls back to relative range.
        const timestampValue: unknown =
          (source && get(source, '@timestamp')) ?? source?.['@timestamp'];
        const tsMs =
          typeof timestampValue === 'string'
            ? Date.parse(timestampValue)
            : typeof timestampValue === 'number'
            ? timestampValue
            : NaN;
        const rangeFrom = Number.isFinite(tsMs)
          ? new Date(tsMs - TRACE_RANGE_PAD_MS).toISOString()
          : 'now-15m';
        const rangeTo = Number.isFinite(tsMs)
          ? new Date(tsMs + TRACE_RANGE_PAD_MS).toISOString()
          : 'now';

        const adHocDataView = await dataViews.create(
          { title: TRACES_INDEX_PATTERN, timeFieldName: '@timestamp' },
          undefined,
          false
        );

        // PoC: remove with the other debug logs once the flow stabilises.
        // eslint-disable-next-line no-console
        console.debug('[exemplars] resolved trace hit', {
          _id: hit._id,
          _index: hit._index,
          traceId: traceIdValue,
          rangeFrom,
          rangeTo,
          processorEvent: source && get(source, 'processor.event'),
        });

        setTraceFlyoutState({
          traceId: traceIdValue,
          dataView: adHocDataView,
          rangeFrom,
          rangeTo,
          docId: null,
          activeFlyoutType: null,
        });
      } catch (err) {
        logger.get(METRICS_DATA_SOURCE_PROFILE_ID).error(err);
        notifications.toasts.addError(err instanceof Error ? err : new Error(String(err)), {
          title: 'Failed to open trace flyout',
        });
      }
    },
    [data.search, dataViews, notifications.toasts, logger]
  );

  const closeTraceFlyout = useCallback(() => setTraceFlyoutState(null), []);

  const onWaterfallNodeClick = useCallback(
    (spanId: string) =>
      setTraceFlyoutState((prev) =>
        prev ? { ...prev, docId: spanId, activeFlyoutType: 'span' } : prev
      ),
    []
  );

  const onWaterfallErrorClick = useCallback(
    (params: { id: string }) =>
      setTraceFlyoutState((prev) =>
        prev ? { ...prev, docId: params.id, activeFlyoutType: 'log' } : prev
      ),
    []
  );

  const externalServices = useMemo(
    () => ({
      discoverShared,
      dataViews,
      notifications,
      docLinks,
      logger: logger.get(METRICS_DATA_SOURCE_PROFILE_ID),
    }),
    [discoverShared, dataViews, notifications, docLinks, logger]
  );

  return (
    <>
      <UnifiedMetricsExperienceGrid
        {...props}
        actions={props.actions}
        profileId={METRICS_DATA_SOURCE_PROFILE_ID}
        breakdownField={breakdownField}
        onBreakdownFieldChange={onBreakdownFieldChange}
        externalServices={externalServices}
        openTraceById={openTraceById}
      />
      {traceFlyoutState && (
        <UnifiedDocViewerObservabilityFullTraceFlyout
          traceId={traceFlyoutState.traceId}
          rangeFrom={traceFlyoutState.rangeFrom}
          rangeTo={traceFlyoutState.rangeTo}
          dataView={traceFlyoutState.dataView}
          docId={traceFlyoutState.docId}
          activeFlyoutType={traceFlyoutState.activeFlyoutType}
          onNodeClick={onWaterfallNodeClick}
          onErrorClick={onWaterfallErrorClick}
          onCloseFlyout={closeTraceFlyout}
          onExitFullScreen={closeTraceFlyout}
        />
      )}
    </>
  );
};

export const createChartSection =
  (): DataSourceProfileProvider['profile']['getChartSectionConfiguration'] =>
  (prev) =>
  (params) => {
    return {
      ...prev(params),
      renderChartSection: (props) => {
        return <MetricsExperienceGridWrapper {...props} actions={params.actions} />;
      },
      replaceDefaultChart: true,
      localStorageKeyPrefix: 'discover:metricsExperience',
      defaultTopPanelHeight: 'max-content',
    };
  };
