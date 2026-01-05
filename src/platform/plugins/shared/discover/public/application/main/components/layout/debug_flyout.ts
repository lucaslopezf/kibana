/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

// Global render counter for tracking
let renderCounter = 0;
let lastExpandedDocChange = Date.now();

export const DEBUG_FLYOUT = {
  enabled: true, // Set to false to disable debug logs

  // Color-coded console output for easy identification
  colors: {
    redux: 'color: #764ABC; font-weight: bold', // Purple (Redux actions)
    render: 'color: #61DAFB; font-weight: bold', // Cyan (React renders)
    mount: 'color: #00FF00; font-weight: bold', // Green (Component mount)
    unmount: 'color: #FF0000; font-weight: bold', // Red (Component unmount)
    warning: 'color: #FFA500; font-weight: bold', // Orange (Warnings)
    portal: 'color: #FF69B4; font-weight: bold', // Pink (Portal operations)
    button: 'color: #FFD700; font-weight: bold', // Gold (Button clicks)
  },

  log(category: keyof typeof DEBUG_FLYOUT.colors, message: string, data?: unknown) {
    if (!this.enabled) return;
    const color = this.colors[category];
    const timestamp = Date.now();
    const renderId = ++renderCounter;

    // eslint-disable-next-line no-console
    console.log(
      `%c[FLYOUT_DEBUG #${renderId}] [${category.toUpperCase()}] ${message}`,
      color,
      data ?? ''
    );

    // Additional timing log for mount/unmount
    if (category === 'mount' || category === 'unmount') {
      // eslint-disable-next-line no-console
      console.log(
        `  └─ Time since last expandedDoc change: ${timestamp - lastExpandedDocChange}ms`
      );
    }
  },

  trackExpandedDocChange(newValue: unknown) {
    lastExpandedDocChange = Date.now();
    this.log('redux', 'expandedDoc CHANGED', {
      newValue: newValue ? 'DOCUMENT' : 'undefined',
      timestamp: new Date().toISOString(),
    });
  },

  trackRender(component: string, props: Record<string, unknown>) {
    this.log('render', `${component} RENDER`, {
      hasExpandedDoc: !!props.expandedDoc,
      hasRenderDocumentView: !!props.renderDocumentView,
      hasSetExpandedDoc: !!props.setExpandedDoc,
    });
  },

  trackMount(component: string, data?: unknown) {
    this.log('mount', `${component} MOUNTED ✅`, data);
  },

  trackUnmount(component: string, data?: unknown) {
    this.log('unmount', `${component} UNMOUNTED ❌`, data);
  },

  trackPortal(action: 'enter' | 'exit', portalType: string) {
    this.log('portal', `${portalType} ${action.toUpperCase()}`);
  },

  trackReduxAction(actionName: string, data?: unknown) {
    this.log('redux', `[REDUX ACTION] ${actionName}`, data);
  },

  trackReduxReset(actionName: string, data?: unknown) {
    // eslint-disable-next-line no-console
    console.log(
      `%c[FLYOUT_DEBUG] [REDUX ACTION] ${actionName} - ⚠️ RESET DETECTED!`,
      'color: #FF0000; font-weight: bold; font-size: 14px',
      data
    );
    // eslint-disable-next-line no-console
    console.trace('[FLYOUT_DEBUG] Stack trace for RESET:');
  },

  trackButtonClick(data: unknown) {
    this.log('button', 'ExpandButton CLICK', data);
  },
};
