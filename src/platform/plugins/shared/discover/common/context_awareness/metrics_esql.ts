/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { Parser } from '@elastic/esql';

/**
 * Set of ES|QL commands the metrics-data-source-profile resolver accepts.
 * The resolver activates the metrics profile only when every command in the
 * pipeline belongs to this set. Anything else (STATS, EVAL, KEEP, DROP,
 * RENAME, DISSECT, GROK, LOOKUP, JOIN, MV_EXPAND, …) deactivates the profile.
 *
 */
export const METRICS_PROFILE_SUPPORTED_COMMANDS: ReadonlySet<string> = new Set([
  'ts',
  'limit',
  'sort',
  'where',
]);

/**
 * Result of {@link isMetricsEsqlSupported}. Carries a human-readable reason
 * on failure so callers (e.g. the Agent Builder tool) can surface it to users.
 */
export type MetricsEsqlSupportResult = { ok: true } | { ok: false; reason: string };

/**
 * Returns whether the given ES|QL string would activate the
 * `metrics-data-source-profile` in Discover.
 *
 * The check has three components:
 * 1. The query must parse without errors.
 * 2. The pipeline must have at least one command.
 * 3. Every command must be in {@link METRICS_PROFILE_SUPPORTED_COMMANDS}.
 *
 */
export const isMetricsEsqlSupported = (esql: string): MetricsEsqlSupportResult => {
  const parsed = Parser.parse(esql);
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      reason: `ES|QL parse errors: ${parsed.errors.map((e) => e.message).join('; ')}`,
    };
  }
  if (parsed.root.commands.length === 0) {
    return { ok: false, reason: 'ES|QL pipeline must have at least one command.' };
  }
  const disallowed = parsed.root.commands.filter(
    (c) => !METRICS_PROFILE_SUPPORTED_COMMANDS.has(c.name)
  );
  if (disallowed.length > 0) {
    return {
      ok: false,
      reason: `Metrics profile rejects command(s): ${disallowed
        .map((c) => c.name.toUpperCase())
        .join(', ')}. Allowed: ${[...METRICS_PROFILE_SUPPORTED_COMMANDS]
        .map((c) => c.toUpperCase())
        .join(', ')}.`,
    };
  }
  return { ok: true };
};
