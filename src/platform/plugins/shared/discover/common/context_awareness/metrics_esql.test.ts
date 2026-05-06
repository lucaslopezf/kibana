/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { METRICS_PROFILE_SUPPORTED_COMMANDS, isMetricsEsqlSupported } from './metrics_esql';

describe('isMetricsEsqlSupported', () => {
  describe('accepts pipelines that activate the metrics profile', () => {
    it.each([
      ['TS metrics-*'],
      ['TS metrics-* | LIMIT 10'],
      ['TS metrics-* | WHERE host.name == "web-01"'],
      ['TS metrics-* | SORT @timestamp DESC'],
      ['TS metrics-* | WHERE foo == 1 | SORT @timestamp DESC | LIMIT 5'],
      ['TS metrics-hostmetricsreceiver.otel-default'],
      ['TS cluster_a:metrics-*'],
    ])('accepts %p', (esql) => {
      expect(isMetricsEsqlSupported(esql)).toEqual({ ok: true });
    });
  });

  describe('rejects pipelines that would not activate the metrics profile', () => {
    it.each([
      ['FROM metrics-*', /from/i],
      ['TS metrics-* | STATS count()', /stats/i],
      ['TS metrics-* | EVAL value = gauge_0 * 2', /eval/i],
      ['TS metrics-* | KEEP @timestamp, host.name', /keep/i],
      ['TS metrics-* | RENAME host.name AS hostname', /rename/i],
      ['TS metrics-* | DROP @timestamp', /drop/i],
    ])('rejects %p mentioning %p in the reason', (esql, reasonRegex) => {
      const result = isMetricsEsqlSupported(esql);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(reasonRegex);
      }
    });
  });

  describe('rejects malformed input', () => {
    it('rejects empty pipelines', () => {
      const result = isMetricsEsqlSupported('');
      expect(result.ok).toBe(false);
    });

    it('rejects garbage strings with a parse-error reason', () => {
      const result = isMetricsEsqlSupported('this is not esql');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // The parser returns either a parse error or rejects on the disallowed
        // command name; either path satisfies the activation rule.
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });
  });

  it('keeps the canonical command set tight (drift guard)', () => {
    // If this assertion changes, the metrics-data-source-profile resolver
    // and the discover.open_view tool must both be reviewed — they share this
    // constant. The intent is to catch silent drift if a contributor adds a
    // command without considering Discover's profile activation behavior.
    expect([...METRICS_PROFILE_SUPPORTED_COMMANDS].sort()).toEqual([
      'limit',
      'sort',
      'ts',
      'where',
    ]);
  });
});
