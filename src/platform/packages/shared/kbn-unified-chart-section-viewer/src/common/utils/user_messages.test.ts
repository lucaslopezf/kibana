/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Datatable } from '@kbn/expressions-plugin/common';
import type { TableInspectorAdapter } from '@kbn/lens-common';
import { COUNTER_SHORT_RANGE_USER_MESSAGES, getNoDataUserMessages } from './user_messages';

const makeDatatable = (rows: Datatable['rows']): Datatable => ({
  type: 'datatable',
  columns: [],
  rows,
});

const makeMetricDatatable = (rows: Datatable['rows']): Datatable => ({
  type: 'datatable',
  columns: [
    {
      id: 'ts',
      name: '@timestamp',
      meta: { type: 'date', dimensionType: 'x' },
    },
    {
      id: 'metric',
      name: 'SUM(RATE(...))',
      meta: { type: 'number', dimensionType: 'y' },
    },
  ],
  rows,
});

describe('getNoDataUserMessages', () => {
  it('returns empty list when activeData is missing', () => {
    expect(getNoDataUserMessages({})).toEqual([]);
  });

  it('returns a warning when all tables are empty', () => {
    const activeData: TableInspectorAdapter = {
      layer1: makeDatatable([]),
      layer2: makeDatatable([]),
    };

    expect(getNoDataUserMessages({ activeData })).toEqual(COUNTER_SHORT_RANGE_USER_MESSAGES);
  });

  it('returns empty list when any table has rows', () => {
    const activeData: TableInspectorAdapter = {
      layer1: makeDatatable([]),
      layer2: makeDatatable([{ a: 1 }]),
    };

    expect(getNoDataUserMessages({ activeData })).toEqual([]);
  });

  it('returns a warning when rows exist but all metric values are null', () => {
    const activeData: TableInspectorAdapter = {
      layer1: makeMetricDatatable([
        { ts: '2026-04-07T09:31:10.000', metric: null },
        { ts: '2026-04-07T09:30:40.000', metric: null },
      ]),
    };

    expect(getNoDataUserMessages({ activeData })).toEqual(COUNTER_SHORT_RANGE_USER_MESSAGES);
  });

  it('returns empty list when at least one metric value is non-null', () => {
    const activeData: TableInspectorAdapter = {
      layer1: makeMetricDatatable([
        { ts: '2026-04-07T09:31:10.000', metric: null },
        { ts: '2026-04-07T09:30:40.000', metric: 42 },
      ]),
    };

    expect(getNoDataUserMessages({ activeData })).toEqual([]);
  });
});

