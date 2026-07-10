#!/usr/bin/env bash
#
# Generate partitioned VPC-flow-logs-style data, upload it to S3 in the real AWS
# folder layout, and register it as federation datasets. This is the data side of
# the date-picker / partition-pruning PoC.
#
# Creates two datasets so we can compare partitioning styles:
#   - <prefix>-vpc-native : AWS default layout .../<region>/<YYYY>/<MM>/<DD>/  (partition_path template)
#   - <prefix>-vpc-hive   : hive-compatible   .../<region>/year=.../month=.../day=.../ (partition_detection=hive)
#
#   PREFIX=lucaslopezf REGION=eu-north-1 ./upload_and_register_vpc_flow_logs.sh
#
# Requirements:
#   - valid aws login (STS credentials in the default profile) for the target account
#   - local ES up at http://localhost:9200 (elastic:changeme)
#   - node available (to run gen_vpc_flow_logs.js)
#
# NOTE on data span: defaults cover 2024-01 .. 2026-07 (2 days/month) so the dataset
# intentionally spans multiple years -- that's what exercises "accidentally query
# years of data" and folder pruning by year/month/day.
#
set -euo pipefail

PREFIX="${PREFIX:-lucaslopezf}"
BUCKET="${BUCKET:-${PREFIX}-fds-vpcflowlogs}"
REGION="${REGION:-eu-north-1}"
ACCOUNT="${ACCOUNT:-123456789012}"   # folder-name only; keep a placeholder, not the real id
ES="${ES:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-changeme}"

START="${START:-2024-01-01}"
END="${END:-2026-07-01}"
DAYS="${DAYS:-1,15}"
RECORDS_PER_DAY="${RECORDS_PER_DAY:-500}"
GZIP="${GZIP:-false}"

DS_NATIVE="${PREFIX}-vpc-native"
DS_HIVE="${PREFIX}-vpc-hive"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

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

echo "== 1. Generate data (native + hive layouts) =="
rm -rf ./vpc-flow-logs-native ./vpc-flow-logs-hive
OUT_DIR=./vpc-flow-logs-native LAYOUT=native ACCOUNT="$ACCOUNT" REGION="$REGION" \
  START="$START" END="$END" DAYS="$DAYS" RECORDS_PER_DAY="$RECORDS_PER_DAY" GZIP="$GZIP" \
  node gen_vpc_flow_logs.js
OUT_DIR=./vpc-flow-logs-hive LAYOUT=hive ACCOUNT="$ACCOUNT" REGION="$REGION" \
  START="$START" END="$END" DAYS="$DAYS" RECORDS_PER_DAY="$RECORDS_PER_DAY" GZIP="$GZIP" \
  node gen_vpc_flow_logs.js

echo "== 2. Upload to S3 =="
aws s3 cp ./vpc-flow-logs-native "s3://${BUCKET}/vpc-native/" --recursive
aws s3 cp ./vpc-flow-logs-hive "s3://${BUCKET}/vpc-hive/" --recursive

echo "== 3. Create/update data_source (STS credentials from the current profile) =="
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
    "settings": {"region": region, "access_key": ak, "secret_key": sk, "session_token": st},
}))
PY
)" -w '\n-> HTTP %{http_code}\n'

echo "== 4. Create datasets =="
# Native AWS layout: bare year/month/day folders -> partition_path template.
# VPC flow logs (plain) are space-delimited with a header row -> format=csv, delimiter=" ".
curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/dataset/${DS_NATIVE}" \
  -H 'content-type: application/json' \
  -d "{\"data_source\":\"my_s3\",\"resource\":\"s3://${BUCKET}/vpc-native/AWSLogs/${ACCOUNT}/vpcflowlogs/${REGION}/**\",\"settings\":{\"format\":\"csv\",\"delimiter\":\" \",\"header_row\":true,\"partition_path\":\"/{year}/{month}/{day}/\"}}" \
  -w "\n-> ${DS_NATIVE}: HTTP %{http_code}\n"

# Hive-compatible layout: year=/month=/day= -> partition_detection=hive.
curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/dataset/${DS_HIVE}" \
  -H 'content-type: application/json' \
  -d "{\"data_source\":\"my_s3\",\"resource\":\"s3://${BUCKET}/vpc-hive/AWSLogs/${ACCOUNT}/vpcflowlogs/${REGION}/**\",\"settings\":{\"format\":\"csv\",\"delimiter\":\" \",\"header_row\":true,\"partition_detection\":\"hive\"}}" \
  -w "\n-> ${DS_HIVE}: HTTP %{http_code}\n"

echo "== 5. Validate =="
for name in "$DS_NATIVE" "$DS_HIVE"; do
  echo "--- FROM \"${name}\" | LIMIT 2 ---"
  curl -s -u "$ES_USER:$ES_PASS" -X POST "$ES/_query" \
    -H 'content-type: application/json' \
    -d "{\"query\":\"FROM \\\"${name}\\\" | KEEP year, month, day | LIMIT 2\"}" | head -c 900
  echo
done

cat <<EOF

== Done ==
Datasets:  ${DS_NATIVE}  (partition_path)   |   ${DS_HIVE}  (hive)

Try in Discover (note: date picker is disabled over federation -> filter by partitions):

  -- WRONG (independent >= is not a date range): don't do this
  FROM "${DS_HIVE}" | WHERE year >= 2026 AND month >= 6 AND day >= 10

  -- CORRECT "from a date onwards" over partition columns:
  FROM "${DS_HIVE}"
  | WHERE year > ?year
       OR (year == ?year AND month > ?month)
       OR (year == ?year AND month == ?month AND day >= ?day)
  | LIMIT 100

Reminder: STS credentials expire in ~1h; re-run step 3 (or this whole script) when they do.
EOF
