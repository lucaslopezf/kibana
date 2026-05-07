/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

const INTERNAL_DIMENSION_EXACT_NAMES: ReadonlySet<string> = new Set(['_metric_names_hash', 'unit']);

const INTERNAL_DIMENSION_PREFIXES: readonly string[] = ['labels._'];

export const isInternalDimension = (name: string): boolean => {
  if (INTERNAL_DIMENSION_EXACT_NAMES.has(name)) {
    return true;
  }
  return INTERNAL_DIMENSION_PREFIXES.some((prefix) => name.startsWith(prefix));
};

export const ALLOWED_METRIC_TYPES: readonly string[] = ['gauge', 'counter', 'histogram'];

export const ALLOWED_METRIC_TYPES_SET: ReadonlySet<string> = new Set(ALLOWED_METRIC_TYPES);
