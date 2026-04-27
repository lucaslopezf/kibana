/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { DataViewsPublicPluginStart, MatchedItem } from '@kbn/data-views-plugin/public';
import type { ExternalServices } from '../types';
import { ExternalServicesProvider } from '../context/external_services';
import { useMetricSourceKind } from './use_metric_source_kind';

const createMatchedItem = (name: string, isDataStream: boolean): MatchedItem =>
  ({
    name,
    tags: isDataStream ? [{ key: 'data_stream', name: 'Data stream', color: '' }] : [],
    item: { name },
  } as MatchedItem);

const createMockDataViews = (
  impl: (params: { pattern: string }) => Promise<MatchedItem[]>
): DataViewsPublicPluginStart =>
  ({
    getIndices: jest.fn(impl),
  } as unknown as DataViewsPublicPluginStart);

const createMockExternalServices = ({
  dataViews,
  hasStreamsFeature = true,
  hasLocator = true,
}: {
  dataViews?: DataViewsPublicPluginStart;
  hasStreamsFeature?: boolean;
  hasLocator?: boolean;
} = {}): ExternalServices =>
  ({
    dataViews,
    share: hasLocator
      ? {
          url: {
            locators: {
              get: jest.fn(() => ({
                getRedirectUrl: jest.fn(({ name }: { name: string }) => `/app/streams/${name}`),
              })),
            },
          },
        }
      : undefined,
    discoverShared: {
      features: {
        registry: {
          getById: jest.fn((id: string) =>
            hasStreamsFeature && id === 'streams' ? {} : undefined
          ),
        },
      },
    },
  } as unknown as ExternalServices);

const wrapper =
  (externalServices: ExternalServices | undefined): React.FC<{ children: React.ReactNode }> =>
  ({ children }) =>
    (
      <ExternalServicesProvider externalServices={externalServices}>
        {children}
      </ExternalServicesProvider>
    );

describe('useMetricSourceKind', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Disabled cases short-circuit before any effect is scheduled. The mock
  // throws if called, so an erroneous fetch attempt would surface as a
  // synchronous test failure rather than a missed negative assertion.
  const failIfCalled = (): Promise<MatchedItem[]> => {
    throw new Error('getIndices should not be called');
  };

  it('returns the data_stream fallback without calling the API when name is undefined', () => {
    const dataViews = createMockDataViews(failIfCalled);
    const services = createMockExternalServices({ dataViews });

    const { result } = renderHook(() => useMetricSourceKind(undefined), {
      wrapper: wrapper(services),
    });

    expect(result.current).toEqual({ sourceKind: 'data_stream', isLoading: false });
    expect(dataViews.getIndices).not.toHaveBeenCalled();
  });

  it('returns the data_stream fallback without calling the API when dataViews is missing', () => {
    const services = createMockExternalServices();

    const { result } = renderHook(() => useMetricSourceKind('metrics-system-default'), {
      wrapper: wrapper(services),
    });

    expect(result.current).toEqual({ sourceKind: 'data_stream', isLoading: false });
  });

  it('returns the data_stream fallback without calling the API when the user has no Streams permission', () => {
    const dataViews = createMockDataViews(failIfCalled);
    const services = createMockExternalServices({ dataViews, hasStreamsFeature: false });

    const { result } = renderHook(() => useMetricSourceKind('metrics-no-permission-default'), {
      wrapper: wrapper(services),
    });

    expect(result.current).toEqual({ sourceKind: 'data_stream', isLoading: false });
    expect(dataViews.getIndices).not.toHaveBeenCalled();
  });

  it('returns the data_stream fallback without calling the API when the locator is unavailable', () => {
    const dataViews = createMockDataViews(failIfCalled);
    const services = createMockExternalServices({ dataViews, hasLocator: false });

    const { result } = renderHook(() => useMetricSourceKind('metrics-no-locator-default'), {
      wrapper: wrapper(services),
    });

    expect(result.current).toEqual({ sourceKind: 'data_stream', isLoading: false });
    expect(dataViews.getIndices).not.toHaveBeenCalled();
  });

  it('returns the data_stream fallback without calling the API for wildcard names', () => {
    const dataViews = createMockDataViews(failIfCalled);
    const services = createMockExternalServices({ dataViews });

    const { result } = renderHook(() => useMetricSourceKind('metrics-*'), {
      wrapper: wrapper(services),
    });

    expect(result.current).toEqual({ sourceKind: 'data_stream', isLoading: false });
    expect(dataViews.getIndices).not.toHaveBeenCalled();
  });

  it('returns the data_stream fallback without calling the API for CCS / non-local names', () => {
    const dataViews = createMockDataViews(failIfCalled);
    const services = createMockExternalServices({ dataViews });

    const { result } = renderHook(
      () => useMetricSourceKind('remote_cluster:metrics-system-default'),
      { wrapper: wrapper(services) }
    );

    expect(result.current).toEqual({ sourceKind: 'data_stream', isLoading: false });
    expect(dataViews.getIndices).not.toHaveBeenCalled();
  });

  it('classifies a resolved data stream', async () => {
    // Use a unique name to avoid the module-level cache poisoning other tests.
    const name = 'metrics-cache-miss-ds-default';
    const dataViews = createMockDataViews(() => Promise.resolve([createMatchedItem(name, true)]));
    const services = createMockExternalServices({ dataViews });

    const { result } = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.sourceKind).toBe('data_stream');
    expect(dataViews.getIndices).toHaveBeenCalledWith({
      pattern: name,
      showAllIndices: true,
      isRollupIndex: expect.any(Function),
    });
  });

  it('classifies a resolved plain index', async () => {
    const name = 'plain-index-cache-miss';
    const dataViews = createMockDataViews(() => Promise.resolve([createMatchedItem(name, false)]));
    const services = createMockExternalServices({ dataViews });

    const { result } = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.sourceKind).toBe('index');
  });

  it('falls back to data_stream when getIndices throws', async () => {
    const name = 'metrics-throwing-default';
    const dataViews = createMockDataViews(() => Promise.reject(new Error('boom')));
    const services = createMockExternalServices({ dataViews });

    const { result } = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.sourceKind).toBe('data_stream');
  });

  it('falls back to data_stream when getIndices returns an empty array', async () => {
    const name = 'metrics-empty-default';
    const dataViews = createMockDataViews(() => Promise.resolve([]));
    const services = createMockExternalServices({ dataViews });

    const { result } = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.sourceKind).toBe('data_stream');
  });

  it('serves repeated calls for the same name from the module cache', async () => {
    // Resolve as `index` so a passing assertion proves we returned the
    // cached classification, not the fallback default.
    const name = 'metrics-cache-hit-default';
    const dataViews = createMockDataViews(() => Promise.resolve([createMatchedItem(name, false)]));
    const services = createMockExternalServices({ dataViews });

    const first = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });
    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
    });
    expect(first.result.current.sourceKind).toBe('index');
    expect(dataViews.getIndices).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });
    await waitFor(() => {
      expect(second.result.current.isLoading).toBe(false);
    });
    expect(second.result.current.sourceKind).toBe('index');
    expect(dataViews.getIndices).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures: a subsequent call retries with a fresh result', async () => {
    const name = 'metrics-retry-after-failure';
    let callCount = 0;
    const dataViews = createMockDataViews(() => {
      callCount += 1;
      if (callCount === 1) return Promise.reject(new Error('boom'));
      // Resolve as `index` on retry. If the failure had been cached, the
      // second call would still return the fallback (`data_stream`).
      return Promise.resolve([createMatchedItem(name, false)]);
    });
    const services = createMockExternalServices({ dataViews });

    const first = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });
    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
    });
    expect(first.result.current.sourceKind).toBe('data_stream');
    expect(dataViews.getIndices).toHaveBeenCalledTimes(1);

    first.unmount();

    const second = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });
    await waitFor(() => {
      expect(second.result.current.isLoading).toBe(false);
    });
    expect(dataViews.getIndices).toHaveBeenCalledTimes(2);
    expect(second.result.current.sourceKind).toBe('index');
  });

  it('does not cache "no match" responses: a subsequent call retries', async () => {
    const name = 'metrics-no-match-default';
    let callCount = 0;
    const dataViews = createMockDataViews(() => {
      callCount += 1;
      if (callCount === 1) {
        // Non-empty response without the requested name — treated as transient.
        return Promise.resolve([createMatchedItem('something-else', true)]);
      }
      return Promise.resolve([createMatchedItem(name, false)]);
    });
    const services = createMockExternalServices({ dataViews });

    const first = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });
    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
    });
    expect(first.result.current.sourceKind).toBe('data_stream');
    expect(dataViews.getIndices).toHaveBeenCalledTimes(1);

    first.unmount();

    const second = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });
    await waitFor(() => {
      expect(second.result.current.isLoading).toBe(false);
    });
    expect(dataViews.getIndices).toHaveBeenCalledTimes(2);
    expect(second.result.current.sourceKind).toBe('index');
  });

  it('dedupes concurrent in-flight callers for the same name', async () => {
    const name = 'metrics-inflight-dedupe-default';
    let resolveResult: (matched: MatchedItem[]) => void = () => {};
    const dataViews = createMockDataViews(
      () =>
        new Promise<MatchedItem[]>((resolve) => {
          resolveResult = resolve;
        })
    );
    const services = createMockExternalServices({ dataViews });

    // Mount two parallel consumers before the underlying promise resolves.
    const first = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });
    const second = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });

    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(true);
      expect(second.result.current.isLoading).toBe(true);
    });
    expect(dataViews.getIndices).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveResult([createMatchedItem(name, true)]);
    });

    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
      expect(second.result.current.isLoading).toBe(false);
    });
    expect(first.result.current.sourceKind).toBe('data_stream');
    expect(second.result.current.sourceKind).toBe('data_stream');
    expect(dataViews.getIndices).toHaveBeenCalledTimes(1);
  });

  it('does not cache empty resolutions: a subsequent call retries', async () => {
    const name = 'metrics-retry-after-empty';
    let callCount = 0;
    const dataViews = createMockDataViews(() => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve([]);
      return Promise.resolve([createMatchedItem(name, false)]);
    });
    const services = createMockExternalServices({ dataViews });

    const first = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });
    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
    });
    expect(first.result.current.sourceKind).toBe('data_stream');
    expect(dataViews.getIndices).toHaveBeenCalledTimes(1);

    first.unmount();

    const second = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(services),
    });
    await waitFor(() => {
      expect(second.result.current.isLoading).toBe(false);
    });
    expect(dataViews.getIndices).toHaveBeenCalledTimes(2);
    expect(second.result.current.sourceKind).toBe('index');
  });

  it('does not show stale classification while a new name is loading', async () => {
    const nameA = 'metrics-stale-guard-a';
    const nameB = 'metrics-stale-guard-b';
    let resolveB: (value: MatchedItem[]) => void = () => {};
    const dataViews = createMockDataViews(({ pattern }) => {
      if (pattern === nameA) return Promise.resolve([createMatchedItem(nameA, false)]); // index
      if (pattern === nameB) {
        return new Promise<MatchedItem[]>((resolve) => {
          resolveB = resolve;
        });
      }
      return Promise.resolve([]);
    });
    const services = createMockExternalServices({ dataViews });

    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => useMetricSourceKind(name),
      {
        wrapper: wrapper(services),
        initialProps: { name: nameA },
      }
    );

    await waitFor(() => {
      expect(result.current.sourceKind).toBe('index');
    });

    // Switch to B while its resolution is still pending.
    rerender({ name: nameB });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });
    expect(result.current.sourceKind).toBe('data_stream');

    resolveB([createMatchedItem(nameB, true)]);
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.sourceKind).toBe('data_stream');
  });

  it('partitions the cache by dataViews instance: different instances get different results for the same name', async () => {
    const name = 'metrics-partitioned-by-instance';
    // Instance A classifies the same source name as a data stream, instance
    // B classifies it as a plain index. If the cache leaked across instances,
    // the second hook would inherit A's answer and the assertions below
    // would fail.
    const dataViewsA = createMockDataViews(() => Promise.resolve([createMatchedItem(name, true)]));
    const dataViewsB = createMockDataViews(() => Promise.resolve([createMatchedItem(name, false)]));
    const servicesA = createMockExternalServices({ dataViews: dataViewsA });
    const servicesB = createMockExternalServices({ dataViews: dataViewsB });

    const underA = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(servicesA),
    });
    await waitFor(() => {
      expect(underA.result.current.isLoading).toBe(false);
    });
    expect(underA.result.current.sourceKind).toBe('data_stream');
    expect(dataViewsA.getIndices).toHaveBeenCalledTimes(1);

    const underB = renderHook(() => useMetricSourceKind(name), {
      wrapper: wrapper(servicesB),
    });
    await waitFor(() => {
      expect(underB.result.current.isLoading).toBe(false);
    });
    expect(underB.result.current.sourceKind).toBe('index');
    expect(dataViewsB.getIndices).toHaveBeenCalledTimes(1);
    expect(dataViewsA.getIndices).toHaveBeenCalledTimes(1);
  });
});
