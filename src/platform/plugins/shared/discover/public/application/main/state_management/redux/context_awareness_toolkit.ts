/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type {
  AttachChartToAgentParams,
  ContextAwarenessToolkit,
  ContextAwarenessToolkitActions,
} from '../../../../context_awareness/toolkit';
import { buildAgentBuilderChartAttachmentId } from './agent_builder_chart_attachments';
import type { InternalStateStore } from './internal_state';
import { internalStateActions } from '.';

export const createContextAwarenessToolkit = ({
  internalState,
  tabId,
  isAgentBuilderAvailable,
}: {
  internalState: InternalStateStore;
  tabId: string;
  isAgentBuilderAvailable?: boolean;
}): ContextAwarenessToolkit => {
  const actions: ContextAwarenessToolkitActions = {
    openInNewTab: async (params) => {
      await internalState.dispatch(internalStateActions.openInNewTabExtPointAction(params));
    },
    updateESQLQuery: (queryOrUpdater) => {
      internalState.dispatch(internalStateActions.updateESQLQuery({ tabId, queryOrUpdater }));
    },
    refreshData: () => {
      internalState.dispatch(internalStateActions.fetchData({ tabId }));
    },
    addFilter: (field, value, mode) => {
      internalState.dispatch(internalStateActions.addFilter({ tabId, field, value, mode }));
    },
    updateAdHocDataViews: async (adHocDataViews) => {
      await internalState.dispatch(internalStateActions.updateAdHocDataViews(adHocDataViews));
    },
    setExpandedDoc: (record, options) => {
      internalState.dispatch(
        internalStateActions.setExpandedDoc({
          tabId,
          expandedDoc: record,
          initialDocViewerTabId: options?.initialTabId,
        })
      );
    },
  };

  if (isAgentBuilderAvailable) {
    actions.attachChartToAgent = (params: AttachChartToAgentParams) => {
      internalState.dispatch(
        internalStateActions.upsertAgentBuilderChartAttachment({
          tabId,
          attachment: {
            id: buildAgentBuilderChartAttachmentId(params),
            title: params.title,
            esqlQuery: params.esqlQuery,
            dimensions: params.dimensions,
            timeRange: params.timeRange,
            columns: params.columns,
          },
        })
      );
    };
  }

  return { actions };
};
