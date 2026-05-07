/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { setStateToKbnUrl } from '@kbn/kibana-utils-plugin/common';
import { appLocatorGetLocationCommon } from '../../../common/app_locator_get_location';
import { parseDiscoverUrl } from './parse_discover_url';

describe('parseDiscoverUrl', () => {
  it('rejects URLs that are not Discover URLs', () => {
    const result = parseDiscoverUrl('http://localhost:5601/app/dashboards#/list');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Discover/i);
    }
  });

  it('returns empty state with a warning when the hash is missing', () => {
    const result = parseDiscoverUrl('http://localhost:5601/app/discover');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appState).toBeNull();
      expect(result.value.globalState).toBeNull();
      expect(result.value.tabState).toBeNull();
      expect(result.value.savedSearchId).toBeNull();
      expect(result.value.decodeWarnings).toEqual([
        'URL contains no Discover state — defaults will apply.',
      ]);
    }
  });

  it('decodes a canonical metrics ES|QL URL', () => {
    const url =
      "http://localhost:5601/app/discover#/?_g=(time:(from:'now-1h',to:now))&_a=(query:(esql:'TS%20metrics-*'),dataSource:(type:esql))";
    const result = parseDiscoverUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appState).toEqual({
        query: { esql: 'TS metrics-*' },
        dataSource: { type: 'esql' },
      });
      expect(result.value.globalState).toEqual({ time: { from: 'now-1h', to: 'now' } });
      expect(result.value.decodeWarnings).toEqual([]);
    }
  });

  it('decodes a DataView URL with KQL query and time range', () => {
    const url =
      "http://localhost:5601/app/discover#/?_g=(time:(from:'now-15m',to:now))&_a=(query:(language:kuery,query:'host.name:%22h-01%22'),dataSource:(dataViewId:'logs-*',type:dataView),columns:!(host.name,message))";
    const result = parseDiscoverUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const app = result.value.appState!;
      expect(app.query).toEqual({ language: 'kuery', query: 'host.name:"h-01"' });
      expect(app.dataSource).toEqual({ dataViewId: 'logs-*', type: 'dataView' });
      expect(app.columns).toEqual(['host.name', 'message']);
    }
  });

  it('returns null + warning when a state key is hashed in session storage', () => {
    const url = 'http://localhost:5601/app/discover#/?_a=h@5dba75&_g=(time:(from:now-15m,to:now))';
    const result = parseDiscoverUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appState).toBeNull();
      expect(result.value.globalState).toEqual({ time: { from: 'now-15m', to: 'now' } });
      expect(result.value.decodeWarnings).toHaveLength(1);
      expect(result.value.decodeWarnings[0]).toMatch(/_a/);
      expect(result.value.decodeWarnings[0]).toMatch(/session storage/i);
    }
  });

  it('returns null + warning when a state key has malformed rison, but still decodes other keys', () => {
    const url =
      "http://localhost:5601/app/discover#/?_a=NOT-VALID-RISON&_g=(time:(from:'now-15m',to:now))";
    const result = parseDiscoverUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appState).toBeNull();
      expect(result.value.globalState).toEqual({ time: { from: 'now-15m', to: 'now' } });
      expect(result.value.decodeWarnings).toHaveLength(1);
      expect(result.value.decodeWarnings[0]).toMatch(/_a/);
    }
  });

  it('extracts savedSearchId from a "#/view/<id>" URL', () => {
    const url =
      'http://localhost:5601/app/discover#/view/my-saved-search-id?_g=(time:(from:now-1h,to:now))';
    const result = parseDiscoverUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.savedSearchId).toBe('my-saved-search-id');
      expect(result.value.globalState).toEqual({ time: { from: 'now-1h', to: 'now' } });
    }
  });

  it('tolerates a Kibana space prefix', () => {
    const url =
      "http://localhost:5601/s/marketing/app/discover#/?_a=(query:(esql:'TS%20metrics-*'),dataSource:(type:esql))";
    const result = parseDiscoverUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appState).toEqual({
        query: { esql: 'TS metrics-*' },
        dataSource: { type: 'esql' },
      });
    }
  });

  it('tolerates a serverBasePath prefix', () => {
    const url =
      "http://localhost:5601/abc/app/discover#/?_a=(query:(esql:'TS%20metrics-*'),dataSource:(type:esql))";
    const result = parseDiscoverUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appState).not.toBeNull();
    }
  });

  it('decodes _tab when present', () => {
    const url =
      "http://localhost:5601/app/discover#/?_a=(query:(esql:'TS%20metrics-*'))&_tab=(tabId:my-tab,tabLabel:'My%20Tab')";
    const result = parseDiscoverUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tabState).toEqual({ tabId: 'my-tab', tabLabel: 'My Tab' });
    }
  });

  it('round-trips through appLocatorGetLocationCommon (catches silent _a/_g key drift)', async () => {
    const params = {
      query: { esql: 'TS metrics-* | LIMIT 10' },
      timeRange: { from: 'now-30m', to: 'now' },
      breakdownField: 'host.name',
      columns: ['@timestamp', 'host.name'],
    };
    const { path } = await appLocatorGetLocationCommon(
      { useHash: false, setStateToKbnUrl },
      params
    );
    const url = `http://localhost:5601/app/discover${path}`;

    const result = parseDiscoverUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const app = result.value.appState!;
      expect(app.query).toEqual({ esql: 'TS metrics-* | LIMIT 10' });
      expect(app.breakdownField).toBe('host.name');
      expect(app.columns).toEqual(['@timestamp', 'host.name']);
      expect(app.dataSource).toEqual({ type: 'esql' });
      expect(result.value.globalState).toEqual({ time: { from: 'now-30m', to: 'now' } });
      expect(result.value.decodeWarnings).toEqual([]);
    }
  });
});
