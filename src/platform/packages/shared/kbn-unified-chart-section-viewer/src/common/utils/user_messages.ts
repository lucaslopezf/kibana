/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { i18n } from '@kbn/i18n';
import type { LensUserMessagesContext, UserMessage } from '@kbn/lens-common';

export const LEGACY_HISTOGRAM_USER_MESSAGES: UserMessage[] = [
  {
    uniqueId: 'metrics-experience-histogram-warning',
    severity: 'warning',
    shortMessage: i18n.translate('metricsExperience.userMessage.histogram.short', {
      defaultMessage: 'Histogram warning',
    }),
    longMessage: i18n.translate('metricsExperience.userMessage.histogram.long', {
      defaultMessage:
        'Calculated assuming T-Digest encoding. If the histogram was encoded differently, the data is approximate',
    }),
    fixableInEditor: false,
    displayLocations: [{ id: 'embeddableBadge' }],
  },
];

export const COUNTER_SHORT_RANGE_USER_MESSAGES: UserMessage[] = [
  {
    uniqueId: 'metrics-experience-counter-short-range-warning',
    severity: 'warning',
    shortMessage: i18n.translate('metricsExperience.userMessage.counterShortRange.short', {
      defaultMessage: 'Possible incomplete data',
    }),
    longMessage: i18n.translate('metricsExperience.userMessage.counterShortRange.long', {
      defaultMessage:
        'Counter metrics use RATE(), which needs at least 2 data points per time bucket. Short time ranges may produce empty results. Try widening the time range.',
    }),
    fixableInEditor: false,
    displayLocations: [{ id: 'embeddableBadge' }],
  },
];

export const getNoDataUserMessages = ({ activeData }: LensUserMessagesContext): UserMessage[] => {
  if (!activeData) {
    return [];
  }

  const hasAnyData = Object.values(activeData).some((table) => {
    if (table.rows.length === 0) {
      return false;
    }

    const metricColumns = table.columns.filter((column) => column.meta.dimensionType === 'y');

    if (metricColumns.length === 0) {
      return true;
    }

    return table.rows.some((row) => metricColumns.some((column) => row[column.id] != null));
  });

  return hasAnyData ? [] : COUNTER_SHORT_RANGE_USER_MESSAGES;
};
