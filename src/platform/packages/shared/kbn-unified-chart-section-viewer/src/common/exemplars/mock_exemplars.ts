/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { GetExemplarsQuery } from './types';

const EXEMPLAR_FIXTURE_INDEX = 'exemplars-fixture-*';

const dimensionsToWhere = (dimensions: Record<string, string> | undefined): string => {
  if (!dimensions || Object.keys(dimensions).length === 0) return '';
  const clauses = Object.entries(dimensions)
    .map(([key, value]) => `\`${key}\` == "${value}"`)
    .join(' AND ');
  return `| WHERE ${clauses}`;
};

/**
 * Default exemplar query targeting the local fixture data stream.
 * Seed with: node src/platform/packages/shared/kbn-otel-demo/scripts/seed_exemplars_fixture.js
 */
export const mockExemplarsQuery: GetExemplarsQuery = ({ start, end, dimensions }) => {
  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();
  const dimensionFilter = dimensionsToWhere(dimensions);

  return [
    `FROM ${EXEMPLAR_FIXTURE_INDEX}`,
    `| WHERE @timestamp >= "${startIso}" AND @timestamp <= "${endIso}"`,
    dimensionFilter,
    '| LIMIT 200',
  ]
    .filter(Boolean)
    .join('\n  ');
};
