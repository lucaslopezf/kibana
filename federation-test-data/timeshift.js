#!/usr/bin/env node
/*
 * Decompresses the Kibana sample data (.json.gz) and applies the same time-shift
 * that Kibana does when installing them via the UI, producing NDJSON ready for S3.
 *
 * Reimplements the logic of:
 *   src/platform/plugins/shared/home/server/services/sample_data/lib/translate_timestamp.ts
 * (translateTimeRelativeToWeek / translateTimeRelativeToDifference)
 *
 * Only the DATE part is shifted; the time of day is preserved, just like Kibana.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MILLISECONDS_IN_DAY = 1000 * 60 * 60 * 24;

function iso8601ToDateIgnoringTime(iso8601) {
  const split = iso8601.split('-');
  if (split.length < 3) {
    throw new Error('Unexpected timestamp format, expecting YYYY-MM-DDTHH:mm:ss');
  }
  const year = parseInt(split[0], 10);
  const month = parseInt(split[1], 10) - 1; // zero-based months
  const date = parseInt(split[2], 10);
  return new Date(year, month, date);
}

function dateToIso8601IgnoringTime(date) {
  const dateItem = new Date(date);
  const year = dateItem.getFullYear();
  const month = dateItem.getMonth() + 1;
  const monthString = String(month).padStart(2, '0');
  const dateString = String(dateItem.getDate()).padStart(2, '0');
  return `${year}-${monthString}-${dateString}`;
}

function translateTimeRelativeToDifference(source, sourceReference, targetReference) {
  const sourceDate = iso8601ToDateIgnoringTime(source);
  const sourceReferenceDate = iso8601ToDateIgnoringTime(sourceReference);
  const targetReferenceDate = iso8601ToDateIgnoringTime(targetReference);

  const timeDelta = sourceDate.getTime() - sourceReferenceDate.getTime();
  const translatedDate = new Date(targetReferenceDate.getTime() + timeDelta);

  return `${dateToIso8601IgnoringTime(translatedDate)}T${source.substring(11)}`;
}

function translateTimeRelativeToWeek(source, sourceReference, targetReference) {
  const sourceReferenceDate = iso8601ToDateIgnoringTime(sourceReference);
  const targetReferenceDate = iso8601ToDateIgnoringTime(targetReference);

  const dayOfWeekDelta = sourceReferenceDate.getDay() - targetReferenceDate.getDay();
  const normalizationDelta = dayOfWeekDelta * MILLISECONDS_IN_DAY;
  const normalizedTargetReference = dateToIso8601IgnoringTime(
    new Date(targetReferenceDate.getTime() + normalizationDelta)
  );

  return translateTimeRelativeToDifference(source, sourceReference, normalizedTargetReference);
}

// Per-dataset config (copied from data_sets/<id>/index.ts)
const SAMPLE_DATA_ROOT = path.resolve(
  __dirname,
  '../src/platform/plugins/shared/home/server/services/sample_data/data_sets'
);

const DATASETS = {
  weblogs: {
    gz: path.join(SAMPLE_DATA_ROOT, 'logs/logs.json.gz'),
    timeFields: ['@timestamp', 'utc_time'],
    currentTimeMarker: '2018-08-01T00:00:00',
    preserveDayOfWeekTimeOfDay: true,
  },
  flights: {
    gz: path.join(SAMPLE_DATA_ROOT, 'flights/flights.json.gz'),
    timeFields: ['timestamp'],
    currentTimeMarker: '2018-01-09T00:00:00',
    preserveDayOfWeekTimeOfDay: true,
  },
  ecommerce: {
    gz: path.join(SAMPLE_DATA_ROOT, 'ecommerce/ecommerce.json.gz'),
    timeFields: ['order_date'],
    currentTimeMarker: '2016-12-11T00:00:00',
    preserveDayOfWeekTimeOfDay: true,
  },
};

const OUT_DIR = path.join(__dirname, 'ndjson');

function shiftDoc(doc, cfg, nowReference) {
  cfg.timeFields
    .filter((f) => doc[f])
    .forEach((f) => {
      doc[f] = cfg.preserveDayOfWeekTimeOfDay
        ? translateTimeRelativeToWeek(doc[f], cfg.currentTimeMarker, nowReference)
        : translateTimeRelativeToDifference(doc[f], cfg.currentTimeMarker, nowReference);
    });
  return doc;
}

function processDataset(name, cfg, nowReference) {
  const raw = zlib.gunzipSync(fs.readFileSync(cfg.gz)).toString('utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const out = [];
  let min = null;
  let max = null;
  const primary = cfg.timeFields[0];
  for (const line of lines) {
    const doc = JSON.parse(line);
    const shifted = shiftDoc(doc, cfg, nowReference);
    const t = shifted[primary];
    if (t) {
      if (min === null || t < min) min = t;
      if (max === null || t > max) max = t;
    }
    out.push(JSON.stringify(shifted));
  }
  const outPath = path.join(OUT_DIR, `${name}.ndjson`);
  fs.writeFileSync(outPath, out.join('\n') + '\n');
  return { name, count: out.length, min, max, outPath };
}

function main() {
  const requested = process.argv.slice(2);
  const names = requested.length ? requested : Object.keys(DATASETS);
  const nowReference = new Date().toISOString();
  console.log(`nowReference = ${nowReference}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const name of names) {
    const cfg = DATASETS[name];
    if (!cfg) {
      console.error(`unknown dataset: ${name} (valid: ${Object.keys(DATASETS).join(', ')})`);
      process.exitCode = 1;
      continue;
    }
    const res = processDataset(name, cfg, nowReference);
    console.log(
      `${res.name.padEnd(10)} ${String(res.count).padStart(6)} docs  [${res.min} .. ${res.max}]  -> ${path.relative(process.cwd(), res.outPath)}`
    );
  }
}

main();
