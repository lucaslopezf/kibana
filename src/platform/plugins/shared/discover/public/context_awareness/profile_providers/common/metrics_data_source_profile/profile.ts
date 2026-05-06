/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { AggregateQuery, Query } from '@kbn/es-query';
import { isOfAggregateQueryType } from '@kbn/es-query';
import { METRICS_EXPERIENCE_PRODUCT_FEATURE_ID } from '../../../../../common/constants';
import { isMetricsEsqlSupported } from '../../../../../common/context_awareness/metrics_esql';
import type { DataSourceProfileProvider } from '../../../profiles';
import { DataSourceCategory, SolutionType } from '../../../profiles';
import { createChartSection } from './accessor/chart_section';
import { getDefaultAppState } from './accessor/get_default_app_state';

export type MetricsExperienceDataSourceProfileProvider = DataSourceProfileProvider<{}>;

export const METRICS_DATA_SOURCE_PROFILE_ID = 'metrics-data-source-profile';
export const createMetricsDataSourceProfileProvider =
  (): MetricsExperienceDataSourceProfileProvider => ({
    profileId: METRICS_DATA_SOURCE_PROFILE_ID,
    restrictedToProductFeature: METRICS_EXPERIENCE_PRODUCT_FEATURE_ID,
    profile: {
      getChartSectionConfiguration: createChartSection(),
      getDefaultAppState,
    },
    resolve: async ({ query, rootContext }) => {
      if (!isQuerySupported(query) || !isSolutionValid(rootContext.solutionType)) {
        return { isMatch: false };
      }

      return {
        isMatch: true,
        context: {
          category: DataSourceCategory.Metrics,
        },
      };
    },
  });

function isSolutionValid(solutionType: SolutionType) {
  return [
    SolutionType.Observability,
    SolutionType.Security,
    SolutionType.Search,
    SolutionType.Default,
  ].includes(solutionType);
}

function isQuerySupported(query: AggregateQuery | Query | undefined): query is AggregateQuery {
  if (!isOfAggregateQueryType(query)) {
    return false;
  }
  return isMetricsEsqlSupported(query.esql).ok;
}
