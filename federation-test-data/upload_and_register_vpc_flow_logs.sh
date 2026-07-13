#!/usr/bin/env bash
#
# Generate partitioned VPC-flow-logs-style data, upload it to S3 in the real AWS
# folder layout, and register it as federation datasets. This is the data side of
# the date-picker / partition-pruning PoC.
#
# Creates four datasets so we can compare partitioning styles + formats + the pruning gap:
#   - <prefix>-vpc-native        : AWS default layout .../<region>/<YYYY>/<MM>/<DD>/  (partition_path template, CSV)
#   - <prefix>-vpc-hive          : hive-compatible   .../<region>/year=.../month=.../day=.../ (partition_detection=hive, CSV)
#   - <prefix>-vpc-hive-parquet  : same hive layout but Parquet files (matches the documented FDS example)
#   - <prefix>-vpc-parquet-oneday: Parquet, resource scoped to a single day -> positive pruning control
#
#   PREFIX=lucaslopezf REGION=eu-north-1 ./upload_and_register_vpc_flow_logs.sh
#
# Requirements:
#   - valid aws login (STS credentials in the default profile) for the target account
#   - local ES up at http://localhost:9200 (elastic:changeme)
#   - node available (to run gen_vpc_flow_logs.js)
#   - duckdb CLI available (to convert the hive CSV into partitioned Parquet)
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
DS_HIVE_PARQUET="${PREFIX}-vpc-hive-parquet"
DS_ONEDAY="${PREFIX}-vpc-parquet-oneday"

# Control dataset scoped to a single partition folder (positive pruning control):
# reads only that one day's file, proving the storage layer CAN read a subset -- the
# WHERE-on-partition-columns path just doesn't. Defaults to the last day in the range.
ONEDAY_YEAR="${ONEDAY_YEAR:-2026}"
ONEDAY_MONTH="${ONEDAY_MONTH:-07}"
ONEDAY_DAY="${ONEDAY_DAY:-01}"

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

echo "== 1b. Convert the hive CSV into partitioned Parquet (DuckDB) =="
# Same hive layout, but Parquet files. Partition columns (year/month/day) come from the
# folder path only (WRITE_PARTITION_COLUMNS false), exactly like the CSV datasets.
PARQUET_BASE="./vpc-hive-parquet/AWSLogs/${ACCOUNT}/vpcflowlogs/${REGION}"
rm -rf ./vpc-hive-parquet
mkdir -p "$PARQUET_BASE"
duckdb -c "
COPY (
  SELECT * FROM read_csv('vpc-flow-logs-hive/**/*.csv', delim=' ', header=true, hive_partitioning=true)
) TO '${PARQUET_BASE}'
  (FORMAT PARQUET, PARTITION_BY (year, month, day), WRITE_PARTITION_COLUMNS false, OVERWRITE_OR_IGNORE, FILENAME_PATTERN 'part_{uuid}');
"

echo "== 2. Upload to S3 =="
aws s3 cp ./vpc-flow-logs-native "s3://${BUCKET}/vpc-native/" --recursive
aws s3 cp ./vpc-flow-logs-hive "s3://${BUCKET}/vpc-hive/" --recursive
aws s3 cp ./vpc-hive-parquet "s3://${BUCKET}/vpc-hive-parquet/" --recursive

echo "== 3. Create/update data_source (STS credentials from the current profile) =="
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

# Same hive layout, Parquet files -> format=parquet (no delimiter/header_row). Matches the docs example.
curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/dataset/${DS_HIVE_PARQUET}" \
  -H 'content-type: application/json' \
  -d "{\"data_source\":\"my_s3\",\"resource\":\"s3://${BUCKET}/vpc-hive-parquet/AWSLogs/${ACCOUNT}/vpcflowlogs/${REGION}/**/*.parquet\",\"settings\":{\"format\":\"parquet\",\"partition_detection\":\"hive\"}}" \
  -w "\n-> ${DS_HIVE_PARQUET}: HTTP %{http_code}\n"

# Positive pruning control: resource scoped to a single day's folder. A plain COUNT(*)
# here reads only that one file (~500 docs), vs the full dataset reading 31000 for the
# equivalent WHERE year/month/day filter -> shows a bounded read IS possible.
curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/dataset/${DS_ONEDAY}" \
  -H 'content-type: application/json' \
  -d "{\"data_source\":\"my_s3\",\"resource\":\"s3://${BUCKET}/vpc-hive-parquet/AWSLogs/${ACCOUNT}/vpcflowlogs/${REGION}/year=${ONEDAY_YEAR}/month=${ONEDAY_MONTH}/day=${ONEDAY_DAY}/**/*.parquet\",\"settings\":{\"format\":\"parquet\",\"partition_detection\":\"hive\"}}" \
  -w "\n-> ${DS_ONEDAY}: HTTP %{http_code}\n"

echo "== 5. Validate =="
for name in "$DS_NATIVE" "$DS_HIVE" "$DS_HIVE_PARQUET"; do
  echo "--- FROM \"${name}\" | LIMIT 2 ---"
  curl -s -u "$ES_USER:$ES_PASS" -X POST "$ES/_query" \
    -H 'content-type: application/json' \
    -d "{\"query\":\"FROM \\\"${name}\\\" | KEEP year, month, day | LIMIT 2\"}" | head -c 900
  echo
done

cat <<EOF

== Done ==
Datasets:
  ${DS_NATIVE}        (partition_path, csv)
  ${DS_HIVE}          (hive, csv)
  ${DS_HIVE_PARQUET}  (hive, parquet)
  ${DS_ONEDAY}        (hive, parquet, resource scoped to ${ONEDAY_YEAR}/${ONEDAY_MONTH}/${ONEDAY_DAY}) -- pruning control

Show the pruning gap (measure cold -> re-run ./renew_sts.sh before each; read documents_found):

  -- (A) filter one day over the FULL dataset -> COUNT=500 but documents_found=31000 (reads everything)
  FROM "${DS_HIVE_PARQUET}"
  | WHERE year == ${ONEDAY_YEAR} AND month == ${ONEDAY_MONTH} AND day == ${ONEDAY_DAY}
  | STATS c = COUNT(*)

  -- (B) same one day, but resource scoped -> COUNT=500 AND documents_found=500 (reads only that folder)
  FROM "${DS_ONEDAY}" | STATS c = COUNT(*)

A vs B return the same rows; A reads 62x more -> the WHERE on partition columns is not pruned.

Reminder: STS credentials expire in ~1h; re-run ./renew_sts.sh (or this whole script) when they do.
EOF
