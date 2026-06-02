/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import { renderHook } from '@testing-library/react';
import { ExemplarsProvider, useExemplarsContext } from './exemplars_provider';
import { mockExemplarsQuery } from './mock_exemplars';
import type { GetExemplarsQuery } from './types';

const params = { start: 0, end: 1000, metricName: 'http.server.duration' };

describe('ExemplarsProvider', () => {
  it('provides the mock query builder by default', () => {
    const { result } = renderHook(() => useExemplarsContext(), {
      wrapper: ({ children }) => <ExemplarsProvider>{children}</ExemplarsProvider>,
    });
    expect(result.current.getExemplarsQuery(params)).toBe(mockExemplarsQuery(params));
  });

  it('uses an injected getExemplarsQuery when provided', () => {
    const customQuery: GetExemplarsQuery = () => 'FROM custom-index | LIMIT 1';
    const { result } = renderHook(() => useExemplarsContext(), {
      wrapper: ({ children }) => (
        <ExemplarsProvider getExemplarsQuery={customQuery}>{children}</ExemplarsProvider>
      ),
    });
    expect(result.current.getExemplarsQuery(params)).toBe('FROM custom-index | LIMIT 1');
  });
});

describe('useExemplars', () => {
  it('returns mock getExemplarsQuery outside a provider (context default)', () => {
    const { result } = renderHook(() => useExemplarsContext());
    expect(result.current.getExemplarsQuery(params)).toBe(mockExemplarsQuery(params));
  });
});
