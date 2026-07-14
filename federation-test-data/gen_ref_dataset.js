#!/usr/bin/env node
/*
 * Generate a reference log dataset as NDJSON, used as the single source of truth for the
 * cross-format performance comparison (the same logical data is later converted to CSV and
 * Parquet with DuckDB, so latency/scan differences are attributable to the format, not the
 * data).
 *
 * The record is intentionally FLAT and well-typed so it maps cleanly to all three formats
 * (NDJSON / CSV / Parquet) with comparable payloads. Richer types (nested objects,
 * multivalue arrays, geo_point) are exercised separately in the schema/types fixtures, where
 * CSV's inability to represent them is itself part of the finding.
 *
 * Fields:
 *   @timestamp    ISO-8601 date
 *   level         keyword  (info|warn|error|debug)
 *   service       keyword
 *   host          keyword
 *   ip            IPv4 string
 *   status        integer  (HTTP status)
 *   duration_ms   integer
 *   bytes         integer
 *   message       text
 *
 * Config via env vars (all optional):
 *   OUT     output NDJSON file path   (default ./ref.ndjson)
 *   ROWS    number of records         (default 10000)
 *   START   first timestamp  ISO date (default 2026-06-14)
 *   END     last timestamp   ISO date (default 2026-07-14)
 *
 * Example:
 *   OUT=./ref-10x.ndjson ROWS=100000 node gen_ref_dataset.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const OUT = env('OUT', path.join(process.cwd(), 'ref.ndjson'));
const ROWS = parseInt(env('ROWS', '10000'), 10);
const START = new Date(env('START', '2026-06-14') + 'T00:00:00Z').getTime();
const END = new Date(env('END', '2026-07-14') + 'T00:00:00Z').getTime();

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const LEVELS = ['info', 'info', 'info', 'warn', 'error', 'debug'];
const SERVICES = ['checkout', 'payment', 'catalog', 'auth', 'shipping', 'search'];
const STATUSES = [200, 200, 200, 201, 301, 400, 404, 500, 503];
const MESSAGES = [
  'request completed',
  'request failed',
  'cache miss',
  'db query executed',
  'user authenticated',
  'payment authorized',
  'order created',
  'downstream timeout',
];

const HOSTS = Array.from({ length: 12 }, (_, i) => `ip-10-0-${randInt(0, 4)}-${10 + i}`);

const ip = () => `${randInt(10, 192)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;

const span = END - START;

const record = () => {
  const ts = new Date(START + Math.floor(Math.random() * span)).toISOString();
  const status = pick(STATUSES);
  return {
    '@timestamp': ts,
    level: pick(LEVELS),
    service: pick(SERVICES),
    host: pick(HOSTS),
    ip: ip(),
    status,
    duration_ms: randInt(1, 4000),
    bytes: randInt(80, 900000),
    message: `${pick(MESSAGES)} (${crypto.randomBytes(3).toString('hex')})`,
  };
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const stream = fs.createWriteStream(OUT);
for (let i = 0; i < ROWS; i++) {
  stream.write(JSON.stringify(record()) + '\n');
}
stream.end();

stream.on('finish', () => {
  // eslint-disable-next-line no-console
  console.log(`Wrote ${ROWS} records to ${OUT} (range ${env('START', '2026-06-14')}..${env('END', '2026-07-14')})`);
});
