#!/usr/bin/env bash
#
# Upload logs NDJSON to S3 and register the S3 datasets via the `_query` API.
#
#   ./upload_and_register_logs.sh
#
# Requirements:
#   - valid aws login (STS credentials in the default profile)
#   - local ES up at http://localhost:9200 (elastic:changeme)
#   - NDJSON already generated in ./ndjson (node gen_logs.js)
#
set -euo pipefail

BUCKET="${BUCKET:-my-esql-federation}"
ES="${ES:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-changeme}"
REGION="${REGION:-eu-north-1}"
DATASETS=("logs-synth" "logs-nginx.access" "logs-kubernetes.container_logs" "logs-aws.s3access")

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

echo "== 1. Upload NDJSON to s3://$BUCKET/ =="
for name in "${DATASETS[@]}"; do
  aws s3 cp "ndjson/${name}.ndjson" "s3://${BUCKET}/${name}/${name}.ndjson"
done

echo "== 2. Create/update data_source (STS credentials from the current profile) =="
CREDS_JSON="$(aws configure export-credentials --format process)"
ACCESS_KEY="$(echo "$CREDS_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["AccessKeyId"])')"
SECRET_KEY="$(echo "$CREDS_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["SecretAccessKey"])')"
SESSION_TOKEN="$(echo "$CREDS_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["SessionToken"])')"

curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/data_source/my_s3" \
  -H 'content-type: application/json' \
  -d "$(python3 - "$REGION" "$ACCESS_KEY" "$SECRET_KEY" "$SESSION_TOKEN" <<'PY'
import json, sys
region, ak, sk, st = sys.argv[1:5]
print(json.dumps({
    "type": "s3",
    "settings": {
        "region": region,
        "access_key": ak,
        "secret_key": sk,
        "session_token": st,
    },
}))
PY
)" -w '\n-> HTTP %{http_code}\n'

echo "== 3. Create datasets (one per signal, ndjson format) =="
for name in "${DATASETS[@]}"; do
  curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/dataset/${name}" \
    -H 'content-type: application/json' \
    -d "{\"data_source\":\"my_s3\",\"resource\":\"s3://${BUCKET}/${name}/*\",\"settings\":{\"format\":\"ndjson\"}}" \
    -w "\n-> ${name}: HTTP %{http_code}\n"
done

echo "== 4. Validate with POST _query =="
for name in "${DATASETS[@]}"; do
  echo "--- FROM \"${name}\" | LIMIT 2 ---"
  curl -s -u "$ES_USER:$ES_PASS" -X POST "$ES/_query" \
    -H 'content-type: application/json' \
    -d "{\"query\":\"FROM \\\"${name}\\\" | LIMIT 2\"}" | head -c 900
  echo
done

echo "== Done. Remember: STS credentials expire in ~1h; re-run step 2 (or this script) when they expire. =="
