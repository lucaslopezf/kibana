#!/usr/bin/env bash
#
# Build MIXED-SCHEMA probe datasets for the FDS + Discover broad test plan (P3, mixed types).
#
# Two files in the SAME dataset disagree on types:
#   file_a: status = integer, amount = integer, has field only_a; missing only_b
#   file_b: status = string,  amount = double,  has field only_b; missing only_a
#
# We register the folder (both files) as one dataset per format (ndjson + parquet) and see how FDS
# resolves the conflict: coercion / null / error / is_partial.
#
#   PREFIX=lucaslopezf REGION=eu-north-1 ./upload_and_register_mixed.sh
#
set -euo pipefail

PREFIX="${PREFIX:-lucaslopezf}"
BUCKET="${BUCKET:-${PREFIX}-fds-refdata}"
REGION="${REGION:-eu-north-1}"
ES="${ES:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-changeme}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"
ROOT=./mixed-data
rm -rf "$ROOT"; mkdir -p "$ROOT/ndjson" "$ROOT/parquet"

echo "== 1. Generate two NDJSON files with conflicting types =="
python3 - "$ROOT" <<'PY'
import json, sys, random
root = sys.argv[1]
random.seed(7)
# file_a: status int, amount int, only_a present
with open(f"{root}/ndjson/file_a.ndjson", "w") as f:
    for i in range(200):
        f.write(json.dumps({
            "id": i,
            "status": random.choice([200, 201, 404, 500]),   # integer
            "amount": random.randint(1, 1000),               # integer
            "only_a": f"a_{i}",                               # present only in A
        }) + "\n")
# file_b: status string, amount double, only_b present
with open(f"{root}/ndjson/file_b.ndjson", "w") as f:
    for i in range(200, 400):
        f.write(json.dumps({
            "id": i,
            "status": random.choice(["ok", "error", "not_found"]),  # string
            "amount": round(random.uniform(1, 1000), 2),            # double
            "only_b": bool(random.getrandbits(1)),                  # present only in B
        }) + "\n")
print("wrote file_a.ndjson (status int) and file_b.ndjson (status string)")
PY

echo "== 2. Convert each NDJSON to its OWN parquet (so parquet schemas differ across files) =="
duckdb <<SQL
COPY (SELECT * FROM read_json_auto('$ROOT/ndjson/file_a.ndjson', format='newline_delimited'))
  TO '$ROOT/parquet/file_a.parquet' (FORMAT PARQUET);
COPY (SELECT * FROM read_json_auto('$ROOT/ndjson/file_b.ndjson', format='newline_delimited'))
  TO '$ROOT/parquet/file_b.parquet' (FORMAT PARQUET);
SQL
echo "-- parquet schemas --"
duckdb -c "DESCRIBE SELECT * FROM read_parquet('$ROOT/parquet/file_a.parquet');"
duckdb -c "DESCRIBE SELECT * FROM read_parquet('$ROOT/parquet/file_b.parquet');"

echo "== 3. Upload =="
aws s3 cp "$ROOT/ndjson"  "s3://${BUCKET}/mixed/ndjson/"  --recursive
aws s3 cp "$ROOT/parquet" "s3://${BUCKET}/mixed/parquet/" --recursive

echo "== 4. Refresh data_source my_s3 =="
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

echo "== 5. Register datasets (folder = both files) =="
register() {
  local name="$1" resource="$2" settings="$3"
  curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/dataset/${name}" \
    -H 'content-type: application/json' \
    -d "{\"data_source\":\"my_s3\",\"resource\":\"${resource}\",\"settings\":${settings}}" \
    -w "\n-> ${name}: HTTP %{http_code}\n"
}
register "${PREFIX}-mixed-ndjson"  "s3://${BUCKET}/mixed/ndjson/**/*.ndjson"   '{"format":"ndjson"}'
register "${PREFIX}-mixed-parquet" "s3://${BUCKET}/mixed/parquet/**/*.parquet" '{"format":"parquet"}'

echo "== Done =="
echo "Datasets: ${PREFIX}-mixed-{ndjson,parquet}"
