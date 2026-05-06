/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { HttpServiceStart, KibanaRequest } from '@kbn/core/server';

/**
 * Build a fully-qualified Kibana app URL for use in tool responses.
 *
 * `core.http.basePath.publicBaseUrl` already contains `serverBasePath`, while
 * `core.http.basePath.get(request)` returns `${serverBasePath}${requestScopePath}`.
 * Concatenating the two would double-count the server base path (e.g.
 * `https://host/kibana/kibana/s/myspace/...`). We strip `serverBasePath` off the
 * request-scoped value before joining so the result keeps a single base path
 * plus the space prefix when present.
 *
 * Falls back to a `protocol://hostname:port${serverBasePath}` URL only when
 * `publicBaseUrl` is unset — typically just `yarn start --no-base-path` local dev.
 *
 * Mirrors the pattern used by
 * `x-pack/platform/plugins/shared/agent_builder/server/utils/get_kibana_url.ts`.
 * If that helper is promoted to a shared package we should consume it directly
 * instead of duplicating logic.
 */
export const getKibanaAppUrl = (
  http: HttpServiceStart,
  request: KibanaRequest,
  appPath: string
): string => {
  const baseUrl = http.basePath.publicBaseUrl ?? getFallbackBaseUrl(http);
  // `basePath.remove(p)` returns `/` (not `''`) when `p === serverBasePath`.
  // Joining `/` with an appPath that starts with `/` would yield `//`, so
  // collapse the `'/'` sentinel to empty before concatenating.
  const requestScope = http.basePath.remove(http.basePath.get(request));
  const requestScopeForJoin = requestScope === '/' ? '' : requestScope;
  return `${baseUrl}${requestScopeForJoin}${appPath}`;
};

/**
 * Localhost fallback used only when `publicBaseUrl` is not configured.
 *
 * Uses the same `basePath.prepend('/').slice(0, -1)` idiom as
 * `agent_builder/server/utils/get_kibana_url.ts` and
 * `workflows_execution_engine/server/utils/get_kibana_url.ts`:
 * `prepend('/')` returns `${serverBasePath}/` (just `'/'` when no base path
 * is configured), and the trailing slash is trimmed off so the caller can
 * append a leading-slash path without producing `//`.
 */
export const getFallbackBaseUrl = (http: HttpServiceStart): string => {
  const { protocol, hostname, port } = http.getServerInfo();
  return `${protocol}://${hostname}:${port}${http.basePath.prepend('/').slice(0, -1)}`;
};
