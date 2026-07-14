#!/usr/bin/env bash
#
# Build the REFERENCE datasets for the FDS + Discover broad test plan (Phase 0).
#
# The same logical data (a flat, well-typed log record) is emitted once as NDJSON and then
# converted to CSV and Parquet with DuckDB, so any latency/scan difference across datasets is
# attributable to the FORMAT, not the data. Sizes scale 1x / 10x / 100x, plus a "many small
# files" Parquet variant to exercise S3 LIST+GET overhead.
#
#   PREFIX=lucaslopezf REGION=eu-north-1 ./upload_and_register_ref_data.sh
#
# Requirements:
#   - valid aws login (STS credentials in the default profile) for the target account
#   - local ES up at http://localhost:9200 (elastic:changeme)
#   - node (gen_ref_dataset.js) and duckdb CLI available
#
# Datasets created (<prefix>-ref-<format>-<size>):
#   ndjson/csv/parquet x 1x/10x/100x                -> format comparison at scale
#   parquet-10x-manyfiles                           -> many small files vs one big file
#
set -euo pipefail

PREFIX="${PREFIX:-lucaslopezf}"
BUCKET="${BUCKET:-${PREFIX}-fds-refdata}"
REGION="${REGION:-eu-north-1}"
ES="${ES:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-changeme}"

BASE_ROWS="${BASE_ROWS:-10000}"          # 1x
MANYFILES_N="${MANYFILES_N:-50}"         # #files for the parquet-manyfiles variant (applied to 10x)
START="${START:-2026-06-14}"
END="${END:-2026-07-14}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

ROOT=./ref-data

echo "== identity =="
aws sts get-caller-identity

echo "== 0. Ensure bucket s3://$BUCKET (region $REGION) =="
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
fi

rm -rf "$ROOT"
mkdir -p "$ROOT"

# Convert one NDJSON file into a single CSV and a single Parquet (types enforced so Parquet
# carries proper logical types; CSV is text and its typing is inferred on read by FDS).
convert_single() {
  local ndjson="$1" csv="$2" parquet="$3"
  duckdb <<SQL
COPY (
  SELECT CAST("@timestamp" AS TIMESTAMP) AS "@timestamp", level, service, host, ip,
         CAST(status AS INTEGER) AS status, CAST(duration_ms AS INTEGER) AS duration_ms,
         CAST(bytes AS BIGINT) AS bytes, message
  FROM read_json_auto('${ndjson}', format='newline_delimited')
) TO '${csv}' (FORMAT CSV, HEADER);
COPY (
  SELECT CAST("@timestamp" AS TIMESTAMP) AS "@timestamp", level, service, host, ip,
         CAST(status AS INTEGER) AS status, CAST(duration_ms AS INTEGER) AS duration_ms,
         CAST(bytes AS BIGINT) AS bytes, message
  FROM read_json_auto('${ndjson}', format='newline_delimited')
) TO '${parquet}' (FORMAT PARQUET);
SQL
}

echo "== 1. Generate + convert sizes (1x/10x/100x) =="
# (case instead of an associative array so this also runs on the macOS system bash 3.2)
rows_for() {
  case "$1" in
    1x) echo "$BASE_ROWS" ;;
    10x) echo "$((BASE_ROWS * 10))" ;;
    100x) echo "$((BASE_ROWS * 100))" ;;
  esac
}
for size in 1x 10x 100x; do
  rows="$(rows_for "$size")"
  echo "-- size=$size rows=$rows --"
  mkdir -p "$ROOT/ndjson/$size" "$ROOT/csv/$size" "$ROOT/parquet/$size"
  OUT="$ROOT/ndjson/$size/ref-$size.ndjson" ROWS="$rows" START="$START" END="$END" node gen_ref_dataset.js
  convert_single "$ROOT/ndjson/$size/ref-$size.ndjson" \
                 "$ROOT/csv/$size/ref-$size.csv" \
                 "$ROOT/parquet/$size/ref-$size.parquet"
done

echo "== 1b. Parquet many-files variant (10x split into $MANYFILES_N files) =="
MF_DIR="$ROOT/parquet-manyfiles/10x"
rm -rf "$MF_DIR"; mkdir -p "$MF_DIR"
duckdb <<SQL
COPY (
  SELECT CAST("@timestamp" AS TIMESTAMP) AS "@timestamp", level, service, host, ip,
         CAST(status AS INTEGER) AS status, CAST(duration_ms AS INTEGER) AS duration_ms,
         CAST(bytes AS BIGINT) AS bytes, message,
         (row_number() OVER () % ${MANYFILES_N}) AS fno
  FROM read_json_auto('$ROOT/ndjson/10x/ref-10x.ndjson', format='newline_delimited')
) TO '${MF_DIR}'
  (FORMAT PARQUET, PARTITION_BY (fno), WRITE_PARTITION_COLUMNS false, OVERWRITE_OR_IGNORE, FILENAME_PATTERN 'part_{uuid}');
SQL

echo "== 2. Upload to S3 =="
aws s3 cp "$ROOT/ndjson"            "s3://${BUCKET}/ref/ndjson/"            --recursive
aws s3 cp "$ROOT/csv"               "s3://${BUCKET}/ref/csv/"               --recursive
aws s3 cp "$ROOT/parquet"           "s3://${BUCKET}/ref/parquet/"           --recursive
aws s3 cp "$ROOT/parquet-manyfiles" "s3://${BUCKET}/ref/parquet-manyfiles/" --recursive

echo "== 3. Create/update data_source (STS credentials from the current profile) =="
# JSON body built by python from env (not argv) and streamed to curl over stdin, so the
# secret/session token never appear on any process's command line.
CREDS_JSON="$(aws configure export-credentials --format process)"
CREDS_JSON="$CREDS_JSON" REGION="$REGION" python3 -c '
import json, os
c = json.loads(os.environ["CREDS_JSON"])
print(json.dumps({
    "type": "s3",
    "settings": {
        "region": os.environ["REGION"],
        "access_key": c["AccessKeyId"],
        "secret_key": c["SecretAccessKey"],
        "session_token": c["SessionToken"],
    },
}))
' | curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/data_source/my_s3" \
  -H 'content-type: application/json' --data @- -w '\n-> HTTP %{http_code}\n'

echo "== 4. Register datasets =="
register() {
  local name="$1" resource="$2" settings="$3"
  curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/dataset/${name}" \
    -H 'content-type: application/json' \
    -d "{\"data_source\":\"my_s3\",\"resource\":\"${resource}\",\"settings\":${settings}}" \
    -w "\n-> ${name}: HTTP %{http_code}\n"
}

for size in 1x 10x 100x; do
  register "${PREFIX}-ref-ndjson-${size}" \
    "s3://${BUCKET}/ref/ndjson/${size}/**/*.ndjson" '{"format":"ndjson"}'
  register "${PREFIX}-ref-csv-${size}" \
    "s3://${BUCKET}/ref/csv/${size}/**/*.csv" '{"format":"csv","delimiter":",","header_row":true}'
  register "${PREFIX}-ref-parquet-${size}" \
    "s3://${BUCKET}/ref/parquet/${size}/**/*.parquet" '{"format":"parquet"}'
done
register "${PREFIX}-ref-parquet-10x-manyfiles" \
  "s3://${BUCKET}/ref/parquet-manyfiles/10x/**/*.parquet" '{"format":"parquet"}'

echo "== 5. Validate =="
for name in "${PREFIX}-ref-ndjson-1x" "${PREFIX}-ref-csv-1x" "${PREFIX}-ref-parquet-1x" "${PREFIX}-ref-parquet-10x-manyfiles"; do
  echo "--- FROM \"${name}\" | STATS c = COUNT(*) ---"
  curl -s -u "$ES_USER:$ES_PASS" -X POST "$ES/_query" \
    -H 'content-type: application/json' \
    -d "{\"query\":\"FROM \\\"${name}\\\" | STATS c = COUNT(*)\"}" | head -c 400
  echo
done

cat <<EOF

== Done ==
Bucket: s3://${BUCKET}/ref/
Datasets:
  ${PREFIX}-ref-{ndjson,csv,parquet}-{1x,10x,100x}     ($BASE_ROWS / $((BASE_ROWS*10)) / $((BASE_ROWS*100)) rows)
  ${PREFIX}-ref-parquet-10x-manyfiles                  (10x rows split into ~${MANYFILES_N} files)

STS credentials expire in ~1h; re-run ./renew_sts.sh (or this whole script) when they do.
EOF
