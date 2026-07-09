#!/usr/bin/env node
/*
 * Generate TRACES NDJSON for querying files stored in S3 as datasets, replicating the ECS/APM
 * span & transaction shape Discover's traces experience expects.
 *
 * Written as plain node (like gen_logs.js / timeshift.js). Output is NESTED JSON
 * (trace:{id}, span:{name,duration:{us}}, transaction:{...}, data_stream:{type}, ...) so that
 * dotted columns (trace.id, span.duration.us, transaction.name, event.outcome, ...) are inferred.
 *
 * Each trace = 1 root transaction + a few child spans sharing the same trace.id, so the flyout
 * waterfall has real structure. Documents carry data_stream.type: "traces" + trace.id so the
 * traces document profile activates over federation (where _index does not match a traces pattern).
 *
 * Generated datasets (one per file, ready to register as an ndjson dataset):
 *   - traces-apm.ndjson    (primary)
 *   - traces-otel.ndjson   (naming variant, same shape)
 *
 * Timestamps spread across the last 24h (up to "now"), so they fall within Discover's default range.
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'ndjson');
const NOW = Date.now();
const WINDOW_MS = 24 * 60 * 60 * 1000; // last 24h

// ---------- helpers ----------
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function hex(len) {
  let s = '';
  while (s.length < len) s += Math.random().toString(16).slice(2);
  return s.slice(0, len);
}

// Spread n increasing timestamps within [NOW-WINDOW, NOW]
function traceStartAt(i, n) {
  const frac = n <= 1 ? 1 : i / (n - 1);
  const jitter = randomInt(-30000, 30000);
  const t = NOW - WINDOW_MS + Math.floor(frac * WINDOW_MS) + jitter;
  return Math.min(t, NOW);
}

// Convert a doc with dotted keys into nested JSON. Keys starting with '@' or without a dot stay as-is.
function nest(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    if (value === undefined) continue;
    if (!key.includes('.') || key.startsWith('@')) {
      out[key] = value;
      continue;
    }
    const parts = key.split('.');
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (typeof cursor[p] !== 'object' || cursor[p] === null) cursor[p] = {};
      cursor = cursor[p];
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return out;
}

const SERVICES = [
  'checkout-service',
  'payment-service',
  'auth-service',
  'cart-service',
  'catalog-service',
  'notification-service',
];
const ENVS = ['production', 'staging', 'development'];
const AGENTS = ['java', 'nodejs', 'go', 'python'];

const TRANSACTIONS = [
  'GET /api/cart',
  'POST /api/checkout',
  'GET /api/products',
  'POST /api/login',
  'GET /api/orders',
  'PUT /api/cart/items',
];

// span name -> [type, subtype]
const SPAN_KINDS = [
  ['SELECT FROM orders', 'db', 'postgresql'],
  ['SELECT FROM products', 'db', 'postgresql'],
  ['redis GET session', 'db', 'redis'],
  ['GET catalog-service', 'external', 'http'],
  ['POST payment-service', 'external', 'http'],
  ['render template', 'app', 'internal'],
  ['publish notification', 'messaging', 'kafka'],
];

function makeSpan(base, { traceId, transactionId, service, env, agent, tStartMs }) {
  const [spanName, spanType, spanSubtype] = pick(SPAN_KINDS);
  const durationUs = randomInt(500, 400000);
  const offsetMs = randomInt(1, 300);
  const outcome = Math.random() < 0.12 ? 'failure' : 'success';
  return {
    '@timestamp': new Date(Math.min(tStartMs + offsetMs, NOW)).toISOString(),
    'data_stream.type': 'traces',
    'data_stream.dataset': base.dataset,
    'data_stream.namespace': 'default',
    'processor.event': 'span',
    'trace.id': traceId,
    'transaction.id': transactionId,
    'parent.id': transactionId,
    'span.id': hex(16),
    'span.name': spanName,
    'span.type': spanType,
    'span.subtype': spanSubtype,
    'span.duration.us': durationUs,
    'service.name': service,
    'service.environment': env,
    'agent.name': agent,
    'event.outcome': outcome,
  };
}

function makeTransaction(base, { traceId, transactionId, service, env, agent, tStartMs }) {
  const durationUs = randomInt(2000, 1500000);
  const outcome = Math.random() < 0.1 ? 'failure' : 'success';
  return {
    '@timestamp': new Date(tStartMs).toISOString(),
    'data_stream.type': 'traces',
    'data_stream.dataset': base.dataset,
    'data_stream.namespace': 'default',
    'processor.event': 'transaction',
    'trace.id': traceId,
    'transaction.id': transactionId,
    'transaction.name': pick(TRANSACTIONS),
    'transaction.type': 'request',
    'transaction.duration.us': durationUs,
    'service.name': service,
    'service.environment': env,
    'agent.name': agent,
    'event.outcome': outcome,
  };
}

function genTraces(nTraces, base) {
  const docs = [];
  for (let i = 0; i < nTraces; i++) {
    const traceId = hex(32);
    const transactionId = hex(16);
    const service = pick(SERVICES);
    const env = pick(ENVS);
    const agent = pick(AGENTS);
    const tStartMs = traceStartAt(i, nTraces);
    const ctx = { traceId, transactionId, service, env, agent, tStartMs };

    docs.push(makeTransaction(base, ctx));
    const nSpans = randomInt(2, 5);
    for (let s = 0; s < nSpans; s++) {
      docs.push(makeSpan(base, ctx));
    }
  }
  return docs;
}

// ---------- output ----------
function writeDataset(name, docs) {
  let min = null;
  let max = null;
  const lines = docs.map((flat) => {
    const t = flat['@timestamp'];
    if (t) {
      if (min === null || t < min) min = t;
      if (max === null || t > max) max = t;
    }
    return JSON.stringify(nest(flat));
  });
  const outPath = path.join(OUT_DIR, `${name}.ndjson`);
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  return { name, count: docs.length, min, max, outPath };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`now = ${new Date(NOW).toISOString()} (window: last 24h)`);

  const datasets = {
    'traces-apm': genTraces(400, { dataset: 'apm' }),
    'traces-otel': genTraces(150, { dataset: 'otel' }),
  };

  for (const [name, docs] of Object.entries(datasets)) {
    const res = writeDataset(name, docs);
    console.log(
      `${res.name.padEnd(14)} ${String(res.count).padStart(5)} docs  [${res.min} .. ${res.max}]  -> ${path.relative(process.cwd(), res.outPath)}`
    );
  }
}

main();
