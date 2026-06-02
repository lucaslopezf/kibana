/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { createContext, useContext, useMemo } from 'react';
import type { GetExemplarsQuery } from './types';
import { mockExemplarsQuery } from './mock_exemplars';

interface ExemplarsContextValue {
  getExemplarsQuery: GetExemplarsQuery;
}

const ExemplarsContext = createContext<ExemplarsContextValue>({
  getExemplarsQuery: mockExemplarsQuery,
});

export interface ExemplarsProviderProps {
  children: React.ReactNode;
  /** Override the query builder — inject a real implementation from the host (e.g. Discover). */
  getExemplarsQuery?: GetExemplarsQuery;
}

export const ExemplarsProvider = ({ children, getExemplarsQuery }: ExemplarsProviderProps) => {
  const value = useMemo(
    () => ({ getExemplarsQuery: getExemplarsQuery ?? mockExemplarsQuery }),
    [getExemplarsQuery]
  );
  return <ExemplarsContext.Provider value={value}>{children}</ExemplarsContext.Provider>;
};

export const useExemplarsContext = (): ExemplarsContextValue => {
  return useContext(ExemplarsContext);
};
