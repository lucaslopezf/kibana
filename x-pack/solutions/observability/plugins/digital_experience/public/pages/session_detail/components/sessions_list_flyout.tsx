/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useState, type ReactNode } from 'react';
import { i18n } from '@kbn/i18n';
import useDebounce from 'react-use/lib/useDebounce';
import useLocalStorage from 'react-use/lib/useLocalStorage';
import { EuiFlyout } from '@elastic/eui';

/** The width of the sessions list, in pixels, kept across visits. */
const RAIL_WIDTH_STORAGE_KEY = 'digitalExperience.sessionDetail.railWidthPx';
const DEFAULT_RAIL_WIDTH = 360;
const MIN_RAIL_WIDTH = 240;
/** How long after the user stops dragging the width is stored. */
const WIDTH_SAVE_DEBOUNCE_MS = 300;

const clampWidth = (width: unknown): number =>
  typeof width === 'number' && Number.isFinite(width)
    ? Math.max(MIN_RAIL_WIDTH, width)
    : DEFAULT_RAIL_WIDTH;

/** Where the sessions list shows: on a side of the session, or not at all. */
export type RailPlacement = 'left' | 'right' | 'hidden';

const FLYOUT_LABEL = i18n.translate('xpack.digitalExperience.sessionDetail.rail.flyoutLabel', {
  defaultMessage: 'Sessions',
});

/** The session, with the sessions list in a resizable flyout that pushes it aside. */
export function SessionsListFlyout({
  placement,
  rail,
  onHideRail,
  children,
}: {
  placement: RailPlacement;
  rail: ReactNode;
  /** Called when the flyout is closed, e.g. with Escape. */
  onHideRail: () => void;
  children: ReactNode;
}) {
  const [savedWidth, setSavedWidth] = useLocalStorage<number>(
    RAIL_WIDTH_STORAGE_KEY,
    DEFAULT_RAIL_WIDTH
  );
  // Given to the flyout once: it keeps the width the user drags to on its own.
  const [initialWidth] = useState(() => clampWidth(savedWidth));
  const [railWidth, setRailWidth] = useState(initialWidth);
  // A drag reports a width on every mouse move; what the user settled on is stored once, after.
  useDebounce(
    () => {
      if (railWidth !== savedWidth) {
        setSavedWidth(railWidth);
      }
    },
    WIDTH_SAVE_DEBOUNCE_MS,
    [railWidth]
  );

  return (
    <>
      {children}
      {placement !== 'hidden' && (
        <EuiFlyout
          type="push"
          side={placement}
          // Always beside the session, never a modal over it, so both stay usable on any width.
          pushMinBreakpoint="xs"
          ownFocus={false}
          paddingSize="none"
          hideCloseButton
          resizable
          size={initialWidth}
          minWidth={MIN_RAIL_WIDTH}
          onResize={setRailWidth}
          onClose={onHideRail}
          aria-label={FLYOUT_LABEL}
          data-test-subj="digitalExperienceSessionsFlyout"
          data-rail-side={placement}
        >
          {rail}
        </EuiFlyout>
      )}
    </>
  );
}
