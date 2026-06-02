/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type {
  CommonXYLayerConfig,
  ReferenceLineDecorationConfig,
  DataDecorationConfig,
} from '../../common';
import { getDataLayers, isAnnotationsLayer, isDataLayer, isReferenceLine } from './visualization';

export function isHorizontalChart(layers: CommonXYLayerConfig[]) {
  return getDataLayers(layers).every((l) => l.isHorizontal);
}

export const getSeriesColor = (layer: CommonXYLayerConfig, accessor: string) => {
  if (
    (isDataLayer(layer) && layer.splitAccessors) ||
    isAnnotationsLayer(layer) ||
    isReferenceLine(layer)
  ) {
    return null;
  }
  const decorations: Array<DataDecorationConfig | ReferenceLineDecorationConfig> | undefined =
    layer?.decorations;
  return (
    decorations?.find((decorationConfig) => decorationConfig.forAccessor === accessor)?.color ||
    null
  );
};

/**
 * Returns the configured point marker shape for a given accessor, or undefined
 * when the decoration does not override it. Unlike color, point shape applies
 * even when a split accessor is present — a scatter overlay typically wants a
 * distinct shape regardless of breakdown.
 */
export const getPointShape = (
  layer: CommonXYLayerConfig,
  accessor: string
): DataDecorationConfig['pointShape'] => {
  if (!isDataLayer(layer)) {
    return undefined;
  }
  const decorations: DataDecorationConfig[] | undefined = layer.decorations as
    | DataDecorationConfig[]
    | undefined;
  return decorations?.find((decorationConfig) => decorationConfig.forAccessor === accessor)
    ?.pointShape;
};

/**
 * Returns the configured point marker radius for a given accessor, or undefined
 * when the decoration does not override it. Per-accessor radius takes precedence
 * over the layer-level `pointsRadius` arg, allowing overlay layers to use a
 * distinct dot size from the primary series.
 */
export const getPointRadius = (
  layer: CommonXYLayerConfig,
  accessor: string
): DataDecorationConfig['pointsRadius'] => {
  if (!isDataLayer(layer)) {
    return undefined;
  }
  const decorations: DataDecorationConfig[] | undefined = layer.decorations as
    | DataDecorationConfig[]
    | undefined;
  return decorations?.find((decorationConfig) => decorationConfig.forAccessor === accessor)
    ?.pointsRadius;
};
