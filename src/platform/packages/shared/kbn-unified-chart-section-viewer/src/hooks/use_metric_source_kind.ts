/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { useEffect } from 'react';
import useAsyncFn from 'react-use/lib/useAsyncFn';
import type { DataViewsPublicPluginStart, MatchedItem } from '@kbn/data-views-plugin/public';
import type { MetricSourceKind } from '../types';
import { useExternalServices } from '../context/external_services';
import { useStreamsNavigation } from './use_streams_navigation';

interface UseMetricSourceKindResult {
  sourceKind: MetricSourceKind;
  isLoading: boolean;
}

interface ClassifiedSource {
  name: string;
  kind: MetricSourceKind;
}

const FALLBACK_KIND: MetricSourceKind = 'data_stream';

// Tag key produced by the data_views plugin when transforming `_resolve/index`
// responses into `MatchedItem[]`. See https://github.com/elastic/kibana/issues/265126.
const DATA_STREAM_TAG_KEY = 'data_stream';

/**
 * Classifies a metric source only when a Streams link could be rendered.
 *
 * Successful `_resolve/index` results are cached per `dataViews` instance and
 * source name. Failures fall back for the current render but are not cached.
 */
export const useMetricSourceKind = (name: string | undefined): UseMetricSourceKindResult => {
  const externalServices = useExternalServices();
  const { isNavigable } = useStreamsNavigation(externalServices);
  const dataViews = externalServices?.dataViews;
  const isSourceNavigable = isNavigable(name);
  const enabled = !!dataViews && isSourceNavigable;

  const [{ value, loading }, loadSourceKind] = useAsyncFn(resolveSourceKindForRender, []);

  useEffect(() => {
    if (!dataViews || !name || !isSourceNavigable) {
      return;
    }
    loadSourceKind(dataViews, name);
  }, [dataViews, name, isSourceNavigable, loadSourceKind]);

  return {
    sourceKind: enabled ? getCurrentSourceKind(value, name) : FALLBACK_KIND,
    isLoading: enabled ? loading : false,
  };
};

const resolveSourceKindForRender = async (
  dataViews: DataViewsPublicPluginStart,
  name: string
): Promise<ClassifiedSource> => {
  try {
    return { name, kind: await getCachedOrFetchSourceKind(dataViews, name) };
  } catch {
    return { name, kind: FALLBACK_KIND };
  }
};

const getCurrentSourceKind = (
  value: ClassifiedSource | undefined,
  name: string | undefined
): MetricSourceKind => (value && value.name === name ? value.kind : FALLBACK_KIND);

const getCachedOrFetchSourceKind = (
  dataViews: DataViewsPublicPluginStart,
  name: string
): Promise<MetricSourceKind> => {
  const cache = getSourceKindCache(dataViews);
  const cached = cache.get(name);
  if (cached) return cached;

  const pending = fetchCacheableSourceKind(dataViews, name);
  cache.set(name, pending);
  pending.catch(() => {
    if (cache.get(name) === pending) cache.delete(name);
  });
  return pending;
};

// Scope the session cache by dataViews instance to avoid cross-context reuse.
const sourceKindCacheByDataViews = new WeakMap<
  DataViewsPublicPluginStart,
  Map<string, Promise<MetricSourceKind>>
>();

const getSourceKindCache = (
  dataViews: DataViewsPublicPluginStart
): Map<string, Promise<MetricSourceKind>> => {
  let cache = sourceKindCacheByDataViews.get(dataViews);
  if (!cache) {
    cache = new Map();
    sourceKindCacheByDataViews.set(dataViews, cache);
  }
  return cache;
};

const fetchCacheableSourceKind = async (
  dataViews: DataViewsPublicPluginStart,
  name: string
): Promise<MetricSourceKind> => {
  const resolved = await dataViews.getIndices({
    pattern: name,
    showAllIndices: true,
    isRollupIndex: () => false,
  });
  if (resolved.length === 0) {
    throw new Error(`Empty _resolve/index response for "${name}"`);
  }
  const kind = getSourceKindFromMatchedItems(resolved, name);
  if (kind === null) {
    throw new Error(`"${name}" not present in _resolve/index response`);
  }
  return kind;
};

const getSourceKindFromMatchedItems = (
  matched: MatchedItem[],
  name: string
): MetricSourceKind | null => {
  const item = matched.find((m) => m.name === name);
  if (!item) return null;
  return item.tags.some((tag) => tag.key === DATA_STREAM_TAG_KEY) ? 'data_stream' : 'index';
};
