/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { NullableMetricUnit } from '../../types';

const DURATION_UNITS: Set<NullableMetricUnit> = new Set(['ns', 'us', 'ms', 's']);

const DURATION_NAME_PATTERNS = [/duration/i, /latency/i];

/**
 * Returns true when the metric's Y-axis maps to a duration-like quantity
 * (i.e. a value that a trace also has). Only these metrics show the exemplar
 * scatter layer — for others the toggle is present but silently a no-op until
 * we have a better representation.
 */
export const isExemplarEligible = ({
  metricName,
  units,
}: {
  metricName: string;
  units: NullableMetricUnit[];
}): boolean => {
  if (units.some((u) => u !== null && DURATION_UNITS.has(u))) {
    return true;
  }
  return DURATION_NAME_PATTERNS.some((pattern) => pattern.test(metricName));
};
