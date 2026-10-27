/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

// EDOT Browser fields and values that `@kbn/apm-types` has no constant for.

/** Local indices only: remote clusters are not searched. */
export const OTEL_LOGS_INDEX = 'logs-*.otel-*';
export const OTEL_TRACES_INDEX = 'traces-*.otel-*';

export const BROWSER_SDK_LANGUAGE = 'webjs';

export const WEB_VITAL_NAME = 'browser.web_vital.name';
export const WEB_VITAL_VALUE = 'browser.web_vital.value';

/** End of the load event, in milliseconds from the start of the navigation. */
export const NAVIGATION_TIMING_LOAD_EVENT_END = 'browser.navigation_timing.load_event_end';

export const EVENT_NAVIGATION_TIMING = 'browser.navigation_timing';
export const EVENT_WEB_VITAL = 'browser.web_vital';
export const EVENT_EXCEPTION = 'exception';

export const SPAN_KIND_CLIENT = 'Client';
export const SPAN_STATUS_ERROR = 'Error';
