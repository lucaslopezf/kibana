/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { useCallback, useMemo } from 'react';
import { STREAMS_APP_LOCATOR_ID } from '@kbn/deeplinks-observability';
import { isNonLocalIndexName } from '@kbn/es-query';
import type { ExternalServices } from '../types';

interface UseStreamsNavigationResult {
  getStreamUrl: (name: string) => string | undefined;
  /**
   * Per-name navigability predicate combining permission, locator
   * availability, and name validity (empty / wildcard / CCS rejection). True
   * when `getStreamUrl(name)` would return a URL. Useful for callers that
   * need to gate work (e.g. a `_resolve/index` request) on whether a Streams
   * link could render for *this specific* name, without building the URL.
   */
  isNavigable: (name: string | undefined) => boolean;
}

/**
 * Encapsulates Streams app navigation logic: permission gating, CCS filtering,
 * wildcard rejection, and URL generation via the Streams locator.
 *
 * The hook is intentionally agnostic of how `externalServices` are obtained;
 * callers are expected to pass them in (typically read from
 * `useExternalServices()` at the call site). When `externalServices` is
 * `undefined`, every call to `getStreamUrl` returns `undefined` and the UI is
 * expected to degrade gracefully (e.g. render plain text instead of a link).
 *
 * `getStreamUrl(name)` returns a URL when the given name is navigable in the
 * Streams app, or `undefined` when the name is invalid (empty, wildcard, CCS)
 * or the user lacks permissions / the locator is unavailable.
 */
export const useStreamsNavigation = (
  externalServices?: ExternalServices
): UseStreamsNavigationResult => {
  const canNavigate = useMemo(
    () => Boolean(externalServices?.discoverShared?.features.registry.getById('streams')),
    [externalServices?.discoverShared]
  );

  const locator = useMemo(
    () => externalServices?.share?.url.locators.get(STREAMS_APP_LOCATOR_ID),
    [externalServices?.share]
  );

  const isNavigable = useCallback(
    (name: string | undefined): boolean =>
      // Streams feature must be registered for the user.
      canNavigate &&
      // Locator must be available in the host app.
      !!locator &&
      // Defensive: empty / falsy names cannot produce a valid Streams URL.
      !!name &&
      // Streams locator routes to a single concrete stream (`/{name}`),
      // so index-pattern wildcards like `metrics-*` are not navigable.
      !name.includes('*') &&
      // Product decision (see https://github.com/elastic/kibana/issues/239387):
      // suppress the link when the data stream is non-local (remote cluster
      // via CCS, or linked project via CPS) because the URL would target the
      // local cluster/project and not the remote one.
      !isNonLocalIndexName(name),
    [canNavigate, locator]
  );

  const getStreamUrl = useCallback(
    (name: string): string | undefined =>
      isNavigable(name) ? locator?.getRedirectUrl({ name }) : undefined,
    [isNavigable, locator]
  );

  return { getStreamUrl, isNavigable };
};
