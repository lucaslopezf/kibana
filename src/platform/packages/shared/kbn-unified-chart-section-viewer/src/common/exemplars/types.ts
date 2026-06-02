/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export interface Exemplar {
  timestamp: number;
  traceId: string;
  spanId?: string;
  /** Metric-axis value (e.g. duration in ms). Undefined for non-duration metrics. */
  value?: number;
  labels?: Record<string, string>;
}

export interface GetExemplarsQueryParams {
  start: number;
  end: number;
  metricName: string;
  dimensions?: Record<string, string>;
}

/**
 * Returns an ES|QL query string that yields exemplar rows.
 * Lens runs the query; we never fetch in JS.
 * The default implementation targets `exemplars-fixture-*` for development.
 * Discover (or any host) can inject a real implementation via ExemplarsProvider.
 */
export type GetExemplarsQuery = (params: GetExemplarsQueryParams) => string;

/** Data extracted from a Lens onFilter click on the exemplar scatter layer. */
export interface ExemplarClickData {
  traceId: string;
  spanId?: string;
  /** Epoch ms timestamp of the exemplar. */
  timestamp?: number;
  /** Duration in milliseconds. */
  durationMs?: number;
  /** Other labels from the exemplar row (service.name, transaction.name, etc.). */
  labels: Record<string, string>;
}
