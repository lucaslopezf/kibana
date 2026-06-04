/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { AttachChartToAgentParams } from '../../../../context_awareness/toolkit';

/**
 * Build a stable, deterministic id for a chart attachment in the Agent Builder
 * chat panel.
 *
 * The id is derived solely from the chart title (typically the metric name) so
 * we render one chip per metric. Re-clicking the action on the same chart —
 * even after the user changed the split-by dimensions — upserts the existing
 * attachment instead of creating a new chip. The latest query, dimensions and
 * column metadata still propagate via the reducer's upsert into `data`.
 */
export const buildAgentBuilderChartAttachmentId = (params: {
  title: AttachChartToAgentParams['title'];
}): string => {
  return `esql-chart-${params.title}`;
};
