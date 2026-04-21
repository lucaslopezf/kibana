/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React from 'react';
import { EuiToolTip, useEuiTheme } from '@elastic/eui';
import { css } from '@emotion/react';
import { MaxDimensionsWarning } from './max_dimensions_warning';

export const MaxDimensionsTooltipOverlay = () => {
  const { euiTheme } = useEuiTheme();

  return (
    <EuiToolTip
      content={<MaxDimensionsWarning />}
      position="top"
      anchorProps={{
        css: css`
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: auto;
          z-index: ${euiTheme.levels.menu};
        `,
      }}
    >
      <div />
    </EuiToolTip>
  );
};
