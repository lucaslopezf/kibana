#!/usr/bin/env node
/*
 * Generate a SCHEMA/TYPES probe dataset as NDJSON for the FDS + Discover broad test plan (P3).
 *
 * Unlike gen_ref_dataset.js (flat + well-typed, for the performance matrix), this fixture is
 * intentionally RICH: it packs date, ip, integer, long, double, boolean, multivalue arrays,
 * geo_point (as both a "lat,lon" string and a {lat,lon} object), nested objects, and AWS-native
 * dotted field names. The point is to see how each format (NDJSON / CSV / Parquet) exposes these
 * types through FDS, and where CSV/row formats simply cannot represent them.
 *
 * Config via env vars (all optional):
 *   OUT     output NDJSON file path   (default ./types.ndjson)
 *   ROWS    number of records         (default 2000)
 *   START   first timestamp  ISO date (default 2026-06-14)
 *   END     last timestamp   ISO date (default 2026-07-14)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const OUT = env('OUT', path.join(process.cwd(), 'types.ndjson'));
const ROWS = parseInt(env('ROWS', '2000'), 10);
const START = new Date(env('START', '2026-06-14') + 'T00:00:00Z').getTime();
const END = new Date(env('END', '2026-07-14') + 'T00:00:00Z').getTime();

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max, dp) => Number((Math.random() * (max - min) + min).toFixed(dp));

const LEVELS = ['info', 'info', 'info', 'warn', 'error', 'debug'];
const METHODS = ['GET', 'GET', 'POST', 'PUT', 'DELETE'];
const REGIONS = ['us-east-1', 'us-west-2', 'eu-north-1', 'eu-west-1', 'ap-southeast-1'];
const ROLES = ['admin', 'editor', 'viewer', 'billing', 'ops'];
const TAGSET = ['prod', 'staging', 'canary', 'pci', 'gdpr', 'internal', 'external'];
const MESSAGES = [
  'request completed',
  'request failed',
  'cache miss',
  'user authenticated',
  'payment authorized',
  'downstream timeout',
];

const ipv4 = () => `${randInt(10, 192)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;
const ipv6 = () =>
  Array.from({ length: 8 }, () => randInt(0, 65535).toString(16)).join(':');

const sample = (arr, n) => {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
};

const span = END - START;

const record = () => {
  const ts = new Date(START + Math.floor(Math.random() * span));
  const lat = randFloat(-89, 89, 4);
  const lon = randFloat(-179, 179, 4);
  const status = pick([200, 200, 201, 301, 400, 404, 500, 503]);
  return {
    '@timestamp': ts.toISOString(),
    event_date: ts.toISOString().slice(0, 10), // date-only "YYYY-MM-DD"
    level: pick(LEVELS),
    client_ip: ipv4(),
    client_ipv6: ipv6(),
    port: randInt(1024, 65535),
    status,
    latency_ms: randFloat(0.5, 3200, 3), // double
    ratio: randFloat(0, 1, 6), // small double
    bytes: randInt(80, 2000000000), // long-ish
    is_error: status >= 500,
    tags: sample(TAGSET, randInt(1, 3)), // multivalue keyword
    scores: Array.from({ length: randInt(1, 4) }, () => randInt(0, 100)), // multivalue numeric
    geo_str: `${lat},${lon}`, // geo_point as "lat,lon" string
    location: { lat, lon }, // geo_point as object
    user: {
      id: randInt(1, 99999),
      name: `user_${crypto.randomBytes(2).toString('hex')}`,
      roles: sample(ROLES, randInt(1, 3)),
    },
    http: {
      request: { method: pick(METHODS), bytes: randInt(0, 8000) },
      response: { status_code: status },
    },
    'aws.region': pick(REGIONS), // AWS-native dotted name (top-level)
    'aws.account_id': String(randInt(100000000000, 999999999999)),
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
  console.log(`Wrote ${ROWS} type-probe records to ${OUT}`);
});
