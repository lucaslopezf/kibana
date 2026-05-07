/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import rison from '@kbn/rison';
import { isStateHash, parseUrlHash } from '@kbn/kibana-utils-plugin/common';
import {
  APP_STATE_URL_KEY,
  GLOBAL_STATE_URL_KEY,
  TAB_STATE_URL_KEY,
} from '../../../common/constants';

export interface ParsedDiscoverUrl {
  appState: Record<string, unknown> | null;
  globalState: Record<string, unknown> | null;
  tabState: Record<string, unknown> | null;
  savedSearchId: string | null;
  decodeWarnings: string[];
}

export type ParseDiscoverUrlResult =
  | { ok: true; value: ParsedDiscoverUrl }
  | { ok: false; reason: string };

/**
 * Decodes a Discover URL into its rison-encoded `_a` (app state), `_g` (global
 * state) and `_tab` (tab state) blobs, plus the optional saved-search id from
 * the hash path.
 *
 * Inverse of `appLocatorGetLocationCommon`. Pure: no Kibana runtime deps
 * beyond the URL/rison helpers in `@kbn/kibana-utils-plugin/common`.
 *
 * Failures of two flavors:
 * - **Hard error** (`ok: false`): URL is malformed or clearly not a Discover
 *   URL. The tool factory turns these into `createErrorResult`.
 * - **Soft warning** (`decodeWarnings`): one state key was unreadable
 *   (session-storage hash, rison parse error, …) but other keys parsed fine.
 *   The tool factory still returns the partial state alongside the warnings.
 */
export const parseDiscoverUrl = (url: string): ParseDiscoverUrlResult => {
  const pathPart = stripHash(url);
  if (pathPart !== null && !isDiscoverPath(pathPart)) {
    return {
      ok: false,
      reason: `URL does not look like a Discover URL: pathname does not contain "/app/discover".`,
    };
  }

  const decodeWarnings: string[] = [];

  let hashed: ReturnType<typeof parseUrlHash>;
  try {
    hashed = parseUrlHash(url);
  } catch (e) {
    return { ok: false, reason: `Could not parse URL: ${(e as Error).message}` };
  }

  if (!hashed || !hashed.query) {
    decodeWarnings.push('URL contains no Discover state — defaults will apply.');
    return {
      ok: true,
      value: {
        appState: null,
        globalState: null,
        tabState: null,
        savedSearchId: null,
        decodeWarnings,
      },
    };
  }

  const savedSearchId = extractSavedSearchId(hashed.pathname);

  const appState = decodeStateValue(
    APP_STATE_URL_KEY,
    pickFirst(hashed.query[APP_STATE_URL_KEY]),
    decodeWarnings
  );
  const globalState = decodeStateValue(
    GLOBAL_STATE_URL_KEY,
    pickFirst(hashed.query[GLOBAL_STATE_URL_KEY]),
    decodeWarnings
  );
  const tabState = decodeStateValue(
    TAB_STATE_URL_KEY,
    pickFirst(hashed.query[TAB_STATE_URL_KEY]),
    decodeWarnings
  );

  return {
    ok: true,
    value: { appState, globalState, tabState, savedSearchId, decodeWarnings },
  };
};

const stripHash = (url: string): string | null => {
  if (url.startsWith('#')) return null;
  const hashIdx = url.indexOf('#');
  return hashIdx === -1 ? url : url.slice(0, hashIdx);
};

const isDiscoverPath = (pathOrUrl: string): boolean => {
  let pathname: string;
  try {
    pathname = new URL(pathOrUrl, 'http://placeholder.invalid').pathname;
  } catch {
    pathname = pathOrUrl;
  }
  return /\/app\/discover(?:\/|\?|#|$)/.test(pathname);
};

const extractSavedSearchId = (hashPath?: string | null): string | null => {
  if (!hashPath) return null;
  const match = hashPath.match(/^\/?view\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

const pickFirst = (value: string | string[] | undefined | null): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
};

const decodeStateValue = (
  keyName: string,
  raw: string | undefined,
  warnings: string[]
): Record<string, unknown> | null => {
  if (raw === undefined) return null;
  if (isStateHash(raw)) {
    warnings.push(
      `"${keyName}" is stored in session storage (hashed value "${raw}") and cannot be decoded server-side. Disable advanced setting "state:storeInSessionStorage" or use Share → Short URL to produce a non-hashed link.`
    );
    return null;
  }
  try {
    const decoded = rison.decode(raw);
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
      warnings.push(`"${keyName}" rison-decoded to a non-object value; ignoring.`);
      return null;
    }
    return decoded as Record<string, unknown>;
  } catch (e) {
    warnings.push(`"${keyName}" rison-decode failed: ${(e as Error).message}`);
    return null;
  }
};
