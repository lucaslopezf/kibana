#!/usr/bin/env bash
#
# Build the SCHEMA/TYPES probe datasets for the FDS + Discover broad test plan (P3).
#
# Same logical data (rich types: date, ip, int, long, double, boolean, multivalue arrays,
# geo_point as string + object, nested objects, AWS-native dotted names) emitted once as NDJSON
# and converted to CSV and Parquet with DuckDB. Registered as three FDS datasets so we can compare
# how each format exposes types through `_query` / Discover.
#
#   PREFIX=lucaslopezf REGION=eu-north-1 ./upload_and_register_types.sh
#
# Requirements: valid aws login, local ES up (elastic:changeme), node + duckdb.
#
set -euo pipefail

PREFIX="${PREFIX:-lucaslopezf}"
BUCKET="${BUCKET:-${PREFIX}-fds-refdata}"
REGION="${REGION:-eu-north-1}"
ES="${ES:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-changeme}"
ROWS="${ROWS:-2000}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"
ROOT=./types-data

echo "== identity =="
aws sts get-caller-identity

echo "== 0. Ensure bucket s3://$BUCKET =="
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION"
fi

rm -rf "$ROOT"; mkdir -p "$ROOT"

echo "== 1. Generate NDJSON ($ROWS rows) =="
OUT="$ROOT/ndjson/types.ndjson" ROWS="$ROWS" node gen_types_dataset.js

echo "== 2. Convert to Parquet (nested types preserved) and CSV (flattened/serialized) =="
mkdir -p "$ROOT/parquet" "$ROOT/csv"
# Parquet: read_json_auto keeps timestamp/date/bigint/double/boolean/list/struct logical types.
duckdb <<SQL
COPY (SELECT * FROM read_json_auto('$ROOT/ndjson/types.ndjson', format='newline_delimited'))
  TO '$ROOT/parquet/types.parquet' (FORMAT PARQUET);
COPY (SELECT * FROM read_json_auto('$ROOT/ndjson/types.ndjson', format='newline_delimited'))
  TO '$ROOT/csv/types.csv' (FORMAT CSV, HEADER);
SQL

echo "== 3. Upload to S3 =="
aws s3 cp "$ROOT/ndjson"  "s3://${BUCKET}/types/ndjson/"  --recursive
aws s3 cp "$ROOT/parquet" "s3://${BUCKET}/types/parquet/" --recursive
aws s3 cp "$ROOT/csv"     "s3://${BUCKET}/types/csv/"     --recursive

echo "== 4. Refresh data_source my_s3 (fresh STS) =="
CREDS_JSON="$(aws configure export-credentials --format process)"
CREDS_JSON="$CREDS_JSON" REGION="$REGION" python3 -c '
import json, os
c = json.loads(os.environ["CREDS_JSON"])
print(json.dumps({"type":"s3","settings":{
  "region": os.environ["REGION"],
  "access_key": c["AccessKeyId"],
  "secret_key": c["SecretAccessKey"],
  "session_token": c["SessionToken"],
}}))' | curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/data_source/my_s3" \
  -H 'content-type: application/json' --data @- -w '\n-> data_source: HTTP %{http_code}\n'

echo "== 5. Register datasets =="
register() {
  local name="$1" resource="$2" settings="$3"
  curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/dataset/${name}" \
    -H 'content-type: application/json' \
    -d "{\"data_source\":\"my_s3\",\"resource\":\"${resource}\",\"settings\":${settings}}" \
    -w "\n-> ${name}: HTTP %{http_code}\n"
}
register "${PREFIX}-types-ndjson"  "s3://${BUCKET}/types/ndjson/**/*.ndjson" '{"format":"ndjson"}'
register "${PREFIX}-types-csv"      "s3://${BUCKET}/types/csv/**/*.csv"       '{"format":"csv","delimiter":",","header_row":true}'
register "${PREFIX}-types-parquet"  "s3://${BUCKET}/types/parquet/**/*.parquet" '{"format":"parquet"}'

echo "== Done =="
echo "Datasets: ${PREFIX}-types-{ndjson,csv,parquet}"
