#!/usr/bin/env bash
#
# Add a JSON-landing branch to the existing native-logs pipeline (created by setup.sh), so the
# SAME service logs land both as Parquet (setup.sh) and as JSON/NDJSON, for a 1:1 comparison of
# federation over Parquet vs JSON on identical real data.
#
#   ECS Fargate (pino) -> CloudWatch Logs group
#      |-- subscription filter 1 -> Firehose (Parquet)  [setup.sh]
#      `-- subscription filter 2 -> Firehose (JSON)      [this script]
#
# The JSON Firehose keeps native decompression + CloudWatch Logs message extraction but drops the
# Data Format Conversion; an AppendDelimiterToRecord processor adds a newline between extracted
# messages so the result is valid NDJSON (message extraction alone concatenates JSON with no
# separator).
#
#   PREFIX=myuser REGION=eu-north-1 ./add_json_variant.sh
#
# Prerequisites: setup.sh already ran (roles, bucket, log group, Firehose Parquet, service).
# Tear down with ../../cloudwatch_firehose_teardown.sh (same PREFIX/REGION).
#
set -euo pipefail

PREFIX="${PREFIX:-myuser}"
REGION="${REGION:-eu-north-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${BUCKET:-${PREFIX}-federation-test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"

STREAM_JSON="${PREFIX}-cw-pino-json"
LOG_GROUP_PINO="/${PREFIX}/federation-test-pino"

echo "PREFIX=$PREFIX REGION=$REGION ACCOUNT=$ACCOUNT BUCKET=$BUCKET"

render() {
  sed -e "s|__ACCOUNT__|${ACCOUNT}|g" \
      -e "s|__REGION__|${REGION}|g" \
      -e "s|__PREFIX__|${PREFIX}|g" \
      -e "s|__BUCKET__|${BUCKET}|g" "$1"
}

echo "== 1. Allow the CWL->Firehose role to PutRecord on the JSON stream =="
cat > "$TMP/firehose-put-json.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["firehose:PutRecord","firehose:PutRecordBatch"],"Resource":"arn:aws:firehose:${REGION}:${ACCOUNT}:deliverystream/${STREAM_JSON}"}]}
JSON
aws iam put-role-policy --role-name "${PREFIX}-cwl-to-firehose-role" --policy-name firehose-put-json \
  --policy-document "file://$TMP/firehose-put-json.json"
echo "   (waiting for IAM propagation)"; sleep 8

echo "== 2. Firehose (decompression + message extraction + newline delimiter -> JSON) =="
render "$HERE/firehose-json.json" > "$TMP/firehose-json.json"
aws firehose create-delivery-stream --delivery-stream-name "$STREAM_JSON" \
  --delivery-stream-type DirectPut \
  --extended-s3-destination-configuration "file://$TMP/firehose-json.json" --region "$REGION" >/dev/null
echo -n "   waiting for ACTIVE"
for _ in $(seq 1 30); do
  ST="$(aws firehose describe-delivery-stream --delivery-stream-name "$STREAM_JSON" --region "$REGION" --query 'DeliveryStreamDescription.DeliveryStreamStatus' --output text 2>/dev/null || true)"
  [ "$ST" = "ACTIVE" ] && { echo " ok"; break; }; echo -n "."; sleep 5
done

echo "== 3. Second subscription filter (same log group -> JSON Firehose) =="
aws logs put-subscription-filter \
  --log-group-name "$LOG_GROUP_PINO" \
  --filter-name "${PREFIX}-pino-to-firehose-json" --filter-pattern "" \
  --destination-arn "arn:aws:firehose:${REGION}:${ACCOUNT}:deliverystream/${STREAM_JSON}" \
  --role-arn "arn:aws:iam::${ACCOUNT}:role/${PREFIX}-cwl-to-firehose-role" --region "$REGION"

rm -rf "$TMP"

cat <<EOF

== Done ==
JSON data lands (after ~60s buffering) at: s3://${BUCKET}/pino-json/**

Register the JSON dataset in Elasticsearch (reuse the same read-only data_source as the Parquet one):

  PUT _query/dataset/logs-cloudwatch-pino-json
  { "data_source": "${PREFIX}_s3",
    "resource": "s3://${BUCKET}/pino-json/**",
    "settings": { "format": "ndjson" } }

Then compare in Discover / _query:
  FROM logs-cloudwatch-pino-json     (JSON)
  FROM logs-cloudwatch-pino-parquet  (Parquet)  -- same underlying events
EOF
