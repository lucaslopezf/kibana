/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { HttpServiceStart, KibanaRequest } from '@kbn/core/server';
import { getFallbackBaseUrl, getKibanaAppUrl } from './kibana_app_url';

/**
 * Builds a minimal `HttpServiceStart` mock whose `basePath` mirrors the real
 * `BasePath` semantics for the operations the helpers use:
 *
 *   - `publicBaseUrl`        — optional override (already includes `serverBasePath`).
 *   - `serverBasePath`       — set via `serverBasePath` argument.
 *   - `requestScopePath`     — set via `requestScopePath` argument (e.g. `/s/myspace`).
 *   - `prepend(p)`           — prepends `serverBasePath` when `p` starts with `/`.
 *   - `get(request)`         — returns `${serverBasePath}${requestScopePath}`.
 *   - `remove(p)`            — strips `serverBasePath` if present.
 *   - `getServerInfo()`      — returns `{ protocol, hostname, port }`.
 */
const buildHttpMock = (overrides: {
  publicBaseUrl?: string;
  serverBasePath?: string;
  requestScopePath?: string;
  protocol?: 'http' | 'https';
  hostname?: string;
  port?: number;
}): HttpServiceStart => {
  const serverBasePath = overrides.serverBasePath ?? '';
  const requestScopePath = overrides.requestScopePath ?? '';

  return {
    basePath: {
      publicBaseUrl: overrides.publicBaseUrl,
      serverBasePath,
      get: (_: KibanaRequest) => `${serverBasePath}${requestScopePath}`,
      prepend: (p: string) => {
        if (serverBasePath === '' || !p.startsWith('/')) {
          return p;
        }
        return `${serverBasePath}${p}`;
      },
      remove: (p: string) => {
        if (serverBasePath === '') return p;
        if (p === serverBasePath) return '/';
        if (p.startsWith(`${serverBasePath}/`)) {
          return p.slice(serverBasePath.length);
        }
        return p;
      },
      set: jest.fn(),
    },
    getServerInfo: () => ({
      name: 'test',
      hostname: overrides.hostname ?? 'localhost',
      port: overrides.port ?? 5601,
      protocol: overrides.protocol ?? 'http',
    }),
  } as unknown as HttpServiceStart;
};

const fakeRequest = {} as KibanaRequest;

describe('getKibanaAppUrl', () => {
  it('uses publicBaseUrl alone when no server base path or space prefix', () => {
    const http = buildHttpMock({ publicBaseUrl: 'https://kb.example.com' });
    expect(getKibanaAppUrl(http, fakeRequest, '/app/discover#/?_g=()')).toBe(
      'https://kb.example.com/app/discover#/?_g=()'
    );
  });

  it('does NOT double-count serverBasePath when publicBaseUrl already includes it (regression: cloud bug)', () => {
    // Cloud Hosted with `server.basePath: '/kibana'` — publicBaseUrl carries
    // the base path, basePath.get(request) returns `/kibana` again. Without
    // the strip, the URL would render `https://kb/kibana/kibana/app/...`.
    const http = buildHttpMock({
      publicBaseUrl: 'https://kb.example.com/kibana',
      serverBasePath: '/kibana',
    });
    expect(getKibanaAppUrl(http, fakeRequest, '/app/discover')).toBe(
      'https://kb.example.com/kibana/app/discover'
    );
  });

  it('appends a non-default space prefix once when publicBaseUrl carries serverBasePath', () => {
    const http = buildHttpMock({
      publicBaseUrl: 'https://kb.example.com/kibana',
      serverBasePath: '/kibana',
      requestScopePath: '/s/myspace',
    });
    expect(getKibanaAppUrl(http, fakeRequest, '/app/discover')).toBe(
      'https://kb.example.com/kibana/s/myspace/app/discover'
    );
  });

  it('appends a non-default space prefix when serverBasePath is empty', () => {
    const http = buildHttpMock({
      publicBaseUrl: 'https://kb.example.com',
      requestScopePath: '/s/myspace',
    });
    expect(getKibanaAppUrl(http, fakeRequest, '/app/discover')).toBe(
      'https://kb.example.com/s/myspace/app/discover'
    );
  });

  it('falls back to localhost when publicBaseUrl is unset', () => {
    const http = buildHttpMock({ port: 5601 });
    expect(getKibanaAppUrl(http, fakeRequest, '/app/discover')).toBe(
      'http://localhost:5601/app/discover'
    );
  });

  it('preserves serverBasePath in the localhost fallback', () => {
    const http = buildHttpMock({ serverBasePath: '/kibana', port: 5601 });
    expect(getKibanaAppUrl(http, fakeRequest, '/app/discover')).toBe(
      'http://localhost:5601/kibana/app/discover'
    );
  });

  it('preserves both serverBasePath and space prefix in the localhost fallback', () => {
    const http = buildHttpMock({
      serverBasePath: '/kibana',
      requestScopePath: '/s/myspace',
      port: 5601,
    });
    expect(getKibanaAppUrl(http, fakeRequest, '/app/discover')).toBe(
      'http://localhost:5601/kibana/s/myspace/app/discover'
    );
  });

  it('respects https + non-default port + custom hostname in the fallback', () => {
    const http = buildHttpMock({
      protocol: 'https',
      hostname: 'kibana.internal',
      port: 5602,
    });
    expect(getKibanaAppUrl(http, fakeRequest, '/app/discover')).toBe(
      'https://kibana.internal:5602/app/discover'
    );
  });
});

describe('getFallbackBaseUrl', () => {
  it('omits server base path when none is configured', () => {
    const http = buildHttpMock({ port: 5601 });
    expect(getFallbackBaseUrl(http)).toBe('http://localhost:5601');
  });

  it('appends server base path when configured', () => {
    const http = buildHttpMock({ serverBasePath: '/kibana', port: 5601 });
    expect(getFallbackBaseUrl(http)).toBe('http://localhost:5601/kibana');
  });
});
