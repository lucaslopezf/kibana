#!/usr/bin/env node
/*
 * Generate VPC-flow-logs-style data laid out in the same partitioned S3 folder
 * structure AWS uses, so we can exercise partition detection + time filtering over
 * a federation dataset (the date-picker gap PoC).
 *
 * Real AWS delivery path (non-hive, "native"):
 *   AWSLogs/<account>/vpcflowlogs/<region>/<YYYY>/<MM>/<DD>/<file>.csv[.gz]
 * Hive-compatible option AWS also offers:
 *   AWSLogs/<account>/vpcflowlogs/<region>/year=<YYYY>/month=<MM>/day=<DD>/<file>.csv[.gz]
 *
 * Records use the default v2 VPC flow log fields (space-delimited, header on line 1):
 *   version account-id interface-id srcaddr dstaddr srcport dstport protocol
 *   packets bytes start end action log-status
 *
 * The partition columns (year/month/day) come from the FOLDER path, not the file
 * content, so the file format is orthogonal to what the PoC tests.
 *
 * Config via env vars (all optional):
 *   OUT_DIR          output root dir          (default ./vpc-flow-logs)
 *   ACCOUNT          12-digit account id      (default 123456789012)
 *   REGION           aws region               (default eu-north-1)
 *   START            first month  YYYY-MM-DD  (default 2024-01-01)
 *   END              last month   YYYY-MM-DD  (default 2026-07-01)
 *   DAYS             days per month to emit   (default "1,15")
 *   RECORDS_PER_DAY  flow records per file    (default 500)
 *   LAYOUT           native | hive            (default native)
 *   GZIP             true | false             (default false -> plain .csv)
 *
 * Example:
 *   START=2024-01-01 END=2026-07-01 LAYOUT=native node gen_vpc_flow_logs.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const OUT_DIR = env('OUT_DIR', path.join(process.cwd(), 'vpc-flow-logs'));
const ACCOUNT = env('ACCOUNT', '123456789012');
const REGION = env('REGION', 'eu-north-1');
const START = env('START', '2024-01-01');
const END = env('END', '2026-07-01');
const DAYS = env('DAYS', '1,15')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isInteger(n) && n >= 1 && n <= 28);
const RECORDS_PER_DAY = parseInt(env('RECORDS_PER_DAY', '500'), 10);
const LAYOUT = env('LAYOUT', 'native');
const GZIP = env('GZIP', 'false') === 'true';

const HEADER =
  'version account-id interface-id srcaddr dstaddr srcport dstport protocol ' +
  'packets bytes start end action log-status';

const pad2 = (n) => String(n).padStart(2, '0');
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const PRIVATE_HOSTS = ['172.31.16.', '172.31.32.', '10.0.1.', '10.0.2.', '192.168.1.'];
const PUBLIC_HOSTS = ['52.94.', '54.239.', '18.202.', '3.120.', '35.156.'];
const PORTS = [22, 80, 443, 3306, 5432, 8080, 9200, 53, 25, 20641];
const PROTOCOLS = [6, 6, 6, 17, 1]; // weighted toward tcp
const ACTIONS = ['ACCEPT', 'ACCEPT', 'ACCEPT', 'REJECT']; // mostly accept
const ENIS = Array.from({ length: 8 }, () => `eni-${crypto.randomBytes(8).toString('hex')}`);

const ip = (prefixes) => {
  const prefix = pick(prefixes); // ends with '.'
  const need = 4 - prefix.split('.').filter(Boolean).length;
  return prefix + Array.from({ length: need }, () => randInt(1, 254)).join('.');
};

const flowLine = (startSec) => {
  const endSec = startSec + randInt(1, 60);
  const proto = pick(PROTOCOLS);
  const packets = randInt(1, 5000);
  const bytes = packets * randInt(40, 1500);
  return [
    2,
    ACCOUNT,
    pick(ENIS),
    ip(PRIVATE_HOSTS),
    Math.random() < 0.5 ? ip(PUBLIC_HOSTS) : ip(PRIVATE_HOSTS),
    randInt(1024, 65535),
    pick(PORTS),
    proto,
    packets,
    bytes,
    startSec,
    endSec,
    pick(ACTIONS),
    'OK',
  ].join(' ');
};

const partitionDir = (y, m, d) =>
  LAYOUT === 'hive'
    ? path.join(`year=${y}`, `month=${pad2(m)}`, `day=${pad2(d)}`)
    : path.join(String(y), pad2(m), pad2(d));

const monthsBetween = (startStr, endStr) => {
  const [sy, sm] = startStr.split('-').map(Number);
  const [ey, em] = endStr.split('-').map(Number);
  const out = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push([y, m]);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
};

let files = 0;
let rows = 0;

for (const [year, month] of monthsBetween(START, END)) {
  for (const day of DAYS) {
    const dir = path.join(
      OUT_DIR,
      'AWSLogs',
      ACCOUNT,
      'vpcflowlogs',
      REGION,
      partitionDir(year, month, day)
    );
    fs.mkdirSync(dir, { recursive: true });

    // Base epoch (UTC) for midnight of this day; spread records across 24h.
    const base = Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0) / 1000);
    const lines = [HEADER];
    for (let i = 0; i < RECORDS_PER_DAY; i++) {
      lines.push(flowLine(base + randInt(0, 86399)));
    }
    const body = lines.join('\n') + '\n';

    const stamp = `${year}${pad2(month)}${pad2(day)}T0000Z`;
    const hash = crypto.randomBytes(4).toString('hex');
    const baseName = `${ACCOUNT}_vpcflowlogs_${REGION}_fl-${hash}_${stamp}_${hash}.csv`;
    const fileName = GZIP ? `${baseName}.gz` : baseName;
    const outPath = path.join(dir, fileName);

    fs.writeFileSync(outPath, GZIP ? zlib.gzipSync(Buffer.from(body)) : body);
    files += 1;
    rows += RECORDS_PER_DAY;
  }
}

// eslint-disable-next-line no-console
console.log(
  `Wrote ${files} files (${rows} flow records) to ${OUT_DIR}\n` +
    `  layout=${LAYOUT} gzip=${GZIP} account=${ACCOUNT} region=${REGION}\n` +
    `  range=${START}..${END} days=[${DAYS.join(',')}] records/day=${RECORDS_PER_DAY}`
);
