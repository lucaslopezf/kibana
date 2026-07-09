#!/usr/bin/env node
/*
 * Generate LOGS NDJSON for querying files stored in S3 as datasets, replicating the ECS
 * shape produced by @kbn/synthtrace-client (log.create):
 *   src/platform/packages/shared/kbn-synthtrace-client/src/lib/logs/index.ts
 *
 * Written as plain node (without importing the TS package) so it can be run the same
 * way as timeshift.js. The output is NESTED JSON (log:{level}, data_stream:{type},
 * service:{name}, ...) so that dotted columns (log.level, data_stream.type, ...) are
 * inferred, just like the example weblogs.
 *
 * Generated datasets (one per file, ready to register as an ndjson dataset):
 *   - logs-synth.ndjson                    (primary, covers log profile corner cases)
 *   - logs-nginx.access.ndjson             (nginx integration)
 *   - logs-kubernetes.container_logs.ndjson(k8s integration)
 *   - logs-aws.s3access.ndjson             (aws integration)
 *
 * Timestamps spread across the last 24h (up to "now"), so they fall within
 * Discover's default range.
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

// Spread n increasing timestamps within [NOW-WINDOW, NOW]
function timestampAt(i, n) {
  const frac = n <= 1 ? 1 : i / (n - 1);
  const jitter = randomInt(-30000, 30000);
  const t = NOW - WINDOW_MS + Math.floor(frac * WINDOW_MS) + jitter;
  return new Date(Math.min(t, NOW)).toISOString();
}

// Convert a doc with dotted keys (log.level) into nested JSON (log:{level}).
// Keys starting with '@' or without a dot are kept as-is.
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
const HOSTS = ['host-01', 'host-02', 'host-03', 'edge-gateway', 'worker-a', 'worker-b'];
const ENVS = ['production', 'staging', 'development'];

// log.level: canonical + synonyms + case variants (to exercise the coalescing/badge)
const LEVELS = [
  'info',
  'info',
  'info',
  'warning',
  'warn', // synonym of warning
  'error',
  'error',
  'err', // synonym of error
  'ERROR', // uppercase
  'Info', // capitalized
  'debug',
  'trace',
  'notice',
  'critical',
  'alert',
  'emergency',
  'fatal',
];

const MESSAGES = {
  info: [
    'Request completed successfully',
    'User session started',
    'Cache warmed up',
    'Health check passed',
  ],
  warn: [
    'Elevated latency detected on downstream call',
    'Retrying request after transient failure',
    'Connection pool nearing capacity',
  ],
  error: [
    'Failed to process payment: gateway timeout',
    'Unhandled exception while serializing response',
    'Database connection refused',
    'Null pointer while reading order items',
  ],
  other: ['Background job executed', 'Configuration reloaded', 'Metrics flushed to collector'],
};

function messageFor(level) {
  const l = (level || '').toLowerCase();
  if (l.startsWith('info') || l === 'notice') return pick(MESSAGES.info);
  if (l.startsWith('warn')) return pick(MESSAGES.warn);
  if (l.startsWith('err') || ['critical', 'alert', 'emergency', 'fatal'].includes(l))
    return pick(MESSAGES.error);
  return pick(MESSAGES.other);
}

const STACK_TRACE = [
  'java.lang.NullPointerException: Cannot invoke "Order.getItems()" because "order" is null',
  '    at com.acme.checkout.OrderService.process(OrderService.java:142)',
  '    at com.acme.checkout.CheckoutController.submit(CheckoutController.java:57)',
  '    at java.base/java.lang.Thread.run(Thread.java:840)',
].join('\n');

// ---------- per-dataset generators ----------
function genSynth(n) {
  const docs = [];
  for (let i = 0; i < n; i++) {
    const level = pick(LEVELS);
    const service = pick(SERVICES);
    const isError = (level || '').toLowerCase().startsWith('err') || level === 'ERROR';

    const doc = {
      '@timestamp': timestampAt(i, n),
      'input.type': 'logs',
      'data_stream.type': 'logs',
      'data_stream.namespace': 'default',
      'data_stream.dataset': 'synth',
      'event.dataset': 'synth',
      'log.level': level,
      message: messageFor(level),
      'service.name': service,
      'service.environment': pick(ENVS),
      'host.name': pick(HOSTS),
      'agent.name': 'synthtrace',
      'network.bytes': randomInt(500, 10000),
    };

    // subset with stack trace + error fields
    if (isError && i % 5 === 0) {
      doc['error.message'] = 'Order processing failed';
      doc['error.stack_trace'] = STACK_TRACE;
      doc['error.exception.type'] = 'NullPointerException';
      doc['error.exception.message'] = 'order is null';
    }

    // subset with trace correlation
    if (i % 7 === 0) {
      doc['trace.id'] = `trace-${randomInt(100000, 999999)}`;
      doc['transaction.id'] = `txn-${randomInt(100000, 999999)}`;
      doc['span.id'] = `span-${randomInt(100000, 999999)}`;
    }

    // some docs with log.level missing
    if (i % 23 === 0) {
      delete doc['log.level'];
      doc.message = pick(MESSAGES.other);
    }
    // some docs with log.level explicitly null
    if (i % 31 === 0) {
      doc['log.level'] = null;
    }
    // some field missing (no service.name) to see empty cells
    if (i % 29 === 0) {
      delete doc['service.name'];
    }

    docs.push(doc);
  }
  return docs;
}

function genNginx(n) {
  const paths = ['/', '/login', '/api/cart', '/api/checkout', '/products/42', '/static/app.js'];
  const codes = [200, 200, 200, 301, 304, 400, 404, 500, 502];
  const methods = ['GET', 'GET', 'GET', 'POST', 'PUT', 'DELETE'];
  const docs = [];
  for (let i = 0; i < n; i++) {
    const code = pick(codes);
    const level = code >= 500 ? 'error' : code >= 400 ? 'warn' : 'info';
    docs.push({
      '@timestamp': timestampAt(i, n),
      'data_stream.type': 'logs',
      'data_stream.namespace': 'default',
      'data_stream.dataset': 'nginx.access',
      'event.dataset': 'nginx.access',
      'log.level': level,
      'url.path': pick(paths),
      'http.request.method': pick(methods),
      'http.response.status_code': code,
      'http.response.bytes': randomInt(120, 90000),
      'client.ip': `10.0.${randomInt(0, 255)}.${randomInt(1, 254)}`,
      'user_agent.name': pick(['Chrome', 'Firefox', 'Safari', 'curl', 'Googlebot']),
      'host.name': pick(HOSTS),
      message: `${pick(methods)} ${pick(paths)} ${code}`,
    });
  }
  return docs;
}

function genKubernetes(n) {
  const namespaces = ['default', 'kube-system', 'observability', 'payments'];
  const pods = ['checkout-7d9', 'payment-5f2', 'auth-9a1', 'cart-3b8', 'catalog-6c4'];
  const clusters = ['prod-us-east', 'prod-eu-west', 'staging-cluster'];
  const docs = [];
  for (let i = 0; i < n; i++) {
    const level = pick(LEVELS);
    const ns = pick(namespaces);
    docs.push({
      '@timestamp': timestampAt(i, n),
      'data_stream.type': 'logs',
      'data_stream.namespace': 'default',
      'data_stream.dataset': 'kubernetes.container_logs',
      'event.dataset': 'kubernetes.container_logs',
      'log.level': level,
      'kubernetes.namespace': ns,
      'kubernetes.pod.name': `${pick(pods)}-${randomInt(10000, 99999)}`,
      'kubernetes.container.name': pick(SERVICES),
      'orchestrator.cluster.name': pick(clusters),
      'host.name': pick(HOSTS),
      'service.name': pick(SERVICES),
      message: messageFor(level),
    });
  }
  return docs;
}

function genAwsS3access(n) {
  const buckets = ['acme-prod-assets', 'acme-backups', 'acme-logs-archive'];
  const ops = [
    'REST.GET.OBJECT',
    'REST.PUT.OBJECT',
    'REST.HEAD.OBJECT',
    'REST.DELETE.OBJECT',
    'REST.GET.BUCKET',
  ];
  const keys = ['images/logo.png', 'reports/2026/q3.csv', 'backups/db.sql.gz', 'static/app.js'];
  const docs = [];
  for (let i = 0; i < n; i++) {
    const op = pick(ops);
    const status = pick([200, 200, 206, 304, 403, 404, 500]);
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    docs.push({
      '@timestamp': timestampAt(i, n),
      'data_stream.type': 'logs',
      'data_stream.namespace': 'default',
      'data_stream.dataset': 'aws.s3access',
      'event.dataset': 'aws.s3access',
      'log.level': level,
      'aws.s3.bucket.name': pick(buckets),
      'aws.s3.object.key': pick(keys),
      'aws.s3access.operation': op,
      'aws.s3access.http_status': status,
      'client.ip': `54.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`,
      'host.name': 's3.amazonaws.com',
      message: `${op} ${pick(keys)} ${status}`,
    });
  }
  return docs;
}

// ---------- output ----------
function writeDataset(name, docs) {
  const primary = '@timestamp';
  let min = null;
  let max = null;
  const lines = docs.map((flat) => {
    const t = flat[primary];
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

function levelHistogram(docs) {
  const h = {};
  for (const d of docs) {
    const key =
      d['log.level'] === undefined
        ? '<missing>'
        : d['log.level'] === null
        ? '<null>'
        : d['log.level'];
    h[key] = (h[key] || 0) + 1;
  }
  return h;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`now = ${new Date(NOW).toISOString()} (window: last 24h)`);

  const datasets = {
    'logs-synth': genSynth(2000),
    'logs-nginx.access': genNginx(800),
    'logs-kubernetes.container_logs': genKubernetes(800),
    'logs-aws.s3access': genAwsS3access(800),
  };

  for (const [name, docs] of Object.entries(datasets)) {
    const res = writeDataset(name, docs);
    console.log(
      `${res.name.padEnd(32)} ${String(res.count).padStart(5)} docs  [${res.min} .. ${
        res.max
      }]  -> ${path.relative(process.cwd(), res.outPath)}`
    );
  }

  console.log('\nlog.level in logs-synth:');
  const hist = levelHistogram(datasets['logs-synth']);
  for (const [k, v] of Object.entries(hist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(k).padEnd(12)} ${v}`);
  }
}

main();
