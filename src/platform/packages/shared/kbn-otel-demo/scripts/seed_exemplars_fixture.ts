/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/**
 * Seeds `exemplars-fixture-default` with ~500 exemplar docs spread across the
 * last 24 hours, including two synthetic spike windows so charts show something
 * interesting to click.
 *
 * Usage:
 *   node scripts/run src/platform/packages/shared/kbn-otel-demo/scripts/seed_exemplars_fixture.ts
 *
 * Overrides via env vars: ELASTICSEARCH_HOST, ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD
 */

import { run } from '@kbn/dev-cli-runner';
import { Client } from '@elastic/elasticsearch';
import { readKibanaConfig } from '../src/read_kibana_config';

const INDEX = 'exemplars-fixture-default';
const DATA_STREAM = 'exemplars-fixture-*';

const SERVICES = [
  { name: 'checkout-service', transactions: ['POST /checkout', 'GET /cart'] },
  { name: 'payment-service', transactions: ['POST /pay', 'POST /refund'] },
  { name: 'inventory-service', transactions: ['GET /stock', 'PUT /reserve'] },
];

const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;

const randomHex = (length: number) =>
  Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');

const buildDoc = (timestamp: number, durationUs: number) => {
  const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
  const transaction = service.transactions[Math.floor(Math.random() * service.transactions.length)];
  return {
    '@timestamp': new Date(timestamp).toISOString(),
    'trace.id': randomHex(32),
    'span.id': randomHex(16),
    'service.name': service.name,
    'transaction.name': transaction,
    'transaction.duration.us': Math.round(durationUs),
  };
};

run(async ({ log, flags }) => {
  const config = readKibanaConfig(log, flags['config'] as string | undefined);
  const { hosts, username, password } = config.elasticsearch;

  const client = new Client({ node: hosts, auth: { username, password } });

  // Delete existing fixture data so re-runs are idempotent
  try {
    await client.indices.delete({ index: INDEX, ignore_unavailable: true });
    log.info(`Deleted existing index ${INDEX}`);
  } catch {
    // ok if it didn't exist
  }

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const start = now - oneDayMs;

  // Two spike windows: ~4h ago and ~8h ago
  const spike1Center = now - 4 * 60 * 60 * 1000;
  const spike2Center = now - 8 * 60 * 60 * 1000;
  const spikeWindowMs = 10 * 60 * 1000; // 10 minutes around each spike

  const docs: ReturnType<typeof buildDoc>[] = [];

  // ~400 baseline docs spread across 24h
  for (let i = 0; i < 400; i++) {
    const ts = start + Math.random() * oneDayMs;
    const durationUs = randomBetween(5_000, 150_000); // 5ms–150ms
    docs.push(buildDoc(ts, durationUs));
  }

  // ~50 spike docs around spike1 (high duration)
  for (let i = 0; i < 50; i++) {
    const ts = spike1Center + randomBetween(-spikeWindowMs / 2, spikeWindowMs / 2);
    const durationUs = randomBetween(800_000, 2_000_000); // 800ms–2s
    docs.push(buildDoc(ts, durationUs));
  }

  // ~50 spike docs around spike2
  for (let i = 0; i < 50; i++) {
    const ts = spike2Center + randomBetween(-spikeWindowMs / 2, spikeWindowMs / 2);
    const durationUs = randomBetween(600_000, 1_500_000); // 600ms–1.5s
    docs.push(buildDoc(ts, durationUs));
  }

  // Bulk index
  const operations = docs.flatMap((doc) => [{ index: { _index: INDEX } }, doc]);
  const { errors, items } = await client.bulk({ operations, refresh: true });

  if (errors) {
    const failed = items.filter((item) => item.index?.error);
    log.error(`${failed.length} docs failed to index`);
    failed.slice(0, 3).forEach((item) => log.error(JSON.stringify(item.index?.error)));
    process.exit(1);
  }

  log.success(
    `Indexed ${docs.length} exemplar docs into ${INDEX}. ` +
      `Two spike windows: ~4h ago and ~8h ago. ` +
      `Query with: FROM ${DATA_STREAM}`
  );
});
