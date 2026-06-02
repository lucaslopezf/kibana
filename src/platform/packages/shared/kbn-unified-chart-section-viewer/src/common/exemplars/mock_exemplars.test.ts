/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { mockExemplarsQuery } from './mock_exemplars';

const start = new Date('2024-01-01T00:00:00Z').getTime();
const end = new Date('2024-01-01T01:00:00Z').getTime();

describe('mockExemplarsQuery', () => {
  it('includes time range bounds', () => {
    const query = mockExemplarsQuery({ start, end, metricName: 'http.server.duration' });
    expect(query).toContain('"2024-01-01T00:00:00.000Z"');
    expect(query).toContain('"2024-01-01T01:00:00.000Z"');
  });

  it('targets the fixture index', () => {
    const query = mockExemplarsQuery({ start, end, metricName: 'http.server.duration' });
    expect(query).toContain('exemplars-fixture-*');
  });

  it('appends LIMIT 200', () => {
    const query = mockExemplarsQuery({ start, end, metricName: 'http.server.duration' });
    expect(query).toContain('LIMIT 200');
  });

  it('adds WHERE clause for dimensions', () => {
    const query = mockExemplarsQuery({
      start,
      end,
      metricName: 'http.server.duration',
      dimensions: { 'service.name': 'checkout', 'attributes.env': 'prod' },
    });
    expect(query).toContain('`service.name` == "checkout"');
    expect(query).toContain('`attributes.env` == "prod"');
  });

  it('omits dimension WHERE when dimensions is empty', () => {
    const query = mockExemplarsQuery({
      start,
      end,
      metricName: 'http.server.duration',
      dimensions: {},
    });
    // Should not have a second WHERE clause beyond the time range one
    const whereCount = (query.match(/\| WHERE/g) ?? []).length;
    expect(whereCount).toBe(1);
  });

  it('omits dimension WHERE when dimensions is undefined', () => {
    const query = mockExemplarsQuery({ start, end, metricName: 'http.server.duration' });
    const whereCount = (query.match(/\| WHERE/g) ?? []).length;
    expect(whereCount).toBe(1);
  });
});
