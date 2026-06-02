/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { isExemplarEligible } from './metric_eligibility';

describe('isExemplarEligible', () => {
  it('returns true for duration units', () => {
    expect(isExemplarEligible({ metricName: 'any.metric', units: ['ms'] })).toBe(true);
    expect(isExemplarEligible({ metricName: 'any.metric', units: ['us'] })).toBe(true);
    expect(isExemplarEligible({ metricName: 'any.metric', units: ['ns'] })).toBe(true);
    expect(isExemplarEligible({ metricName: 'any.metric', units: ['s'] })).toBe(true);
  });

  it('returns true when at least one unit is duration among mixed units', () => {
    expect(isExemplarEligible({ metricName: 'any.metric', units: [null, 'ms'] })).toBe(true);
  });

  it('returns true for OTel standard duration metric names', () => {
    expect(
      isExemplarEligible({ metricName: 'http.server.request.duration', units: [] })
    ).toBe(true);
    expect(isExemplarEligible({ metricName: 'db.client.operation.duration', units: [] })).toBe(
      true
    );
    expect(isExemplarEligible({ metricName: 'rpc.server.duration', units: [] })).toBe(true);
  });

  it('returns true for latency metric names', () => {
    expect(isExemplarEligible({ metricName: 'service.latency.p99', units: [] })).toBe(true);
  });

  it('returns false for non-duration metrics', () => {
    expect(
      isExemplarEligible({ metricName: 'system.memory.usage', units: ['bytes'] })
    ).toBe(false);
    expect(
      isExemplarEligible({ metricName: 'process.cpu.utilization', units: ['percent'] })
    ).toBe(false);
    expect(
      isExemplarEligible({ metricName: 'db.client.connections.count', units: ['count'] })
    ).toBe(false);
  });

  it('returns false for empty units and non-matching name', () => {
    expect(isExemplarEligible({ metricName: 'some.counter', units: [] })).toBe(false);
    expect(isExemplarEligible({ metricName: 'some.counter', units: [null] })).toBe(false);
  });
});
