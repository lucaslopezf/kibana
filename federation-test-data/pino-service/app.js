/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

// Minimal service that emits realistic application logs using pino's native
// Runs on ECS Fargate; stdout is captured by the awslogs driver -> CloudWatch Logs.
const pino = require('pino');

// Default pino: level is a NUMBER (10..60), timestamp key is `time` (epoch ms),
// and the log message goes to `msg`.
// Default base adds pino's native `pid` and `hostname` fields (kept for realism);
// the per-log `svc` is set on each record below.
const log = pino();

const services = [
  'checkout-service',
  'cart-service',
  'payment-service',
  'auth-service',
  'catalog-service',
];
const messages = [
  'payment declined',
  'cache hit',
  'order placed',
  'upstream timeout',
  'user logged in',
  'slow query detected',
  'inventory reserved',
  'rate limit exceeded',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rid = () => Math.random().toString(36).slice(2, 12);

const emit = () => {
  const svc = pick(services);
  const status = pick([200, 201, 200, 200, 404, 500, 502]);
  const durationMs = Math.floor(Math.random() * 2500);
  const fields = {
    svc,
    reqId: rid(),
    status,
    durationMs,
  };
  const roll = Math.random();
  if (roll < 0.55) log.info(fields, pick(messages));
  else if (roll < 0.8) log.warn(fields, pick(messages));
  else if (roll < 0.95) log.error(fields, pick(messages));
  else log.debug(fields, pick(messages));
};

const intervalMs = Number(process.env.INTERVAL_MS || 200);
setInterval(emit, intervalMs);
log.info({ svc: 'bootstrap' }, `pino logger started (interval=${intervalMs}ms)`);
