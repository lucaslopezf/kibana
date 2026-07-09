#!/usr/bin/env bash
#
# Stand up the "native (non-ECS) logs over federation" pipeline end-to-end:
#
#   ECS Fargate (pino) -> CloudWatch Logs -> subscription filter
#     -> Firehose (native decompression + CloudWatch Logs message extraction
#        + Data Format Conversion -> Parquet via Glue) -> S3
#
# All resource names are derived from $PREFIX. Requires: awscli, docker, and AWS
# credentials for the target account. Run from this directory.
#
#   PREFIX=myuser REGION=eu-north-1 ./setup.sh
#
# Tear everything down with ../../cloudwatch_firehose_teardown.sh (same PREFIX/REGION).
#
set -euo pipefail

PREFIX="${PREFIX:-myuser}"
PREFIX_US="${PREFIX//-/_}"                 # Glue db names can't contain hyphens
REGION="${REGION:-eu-north-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${BUCKET:-${PREFIX}-federation-test}"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"

echo "PREFIX=$PREFIX REGION=$REGION ACCOUNT=$ACCOUNT BUCKET=$BUCKET"

# Render a JSON template (placeholders -> values). PREFIX_US before PREFIX.
render() {
  sed -e "s|__ACCOUNT__|${ACCOUNT}|g" \
      -e "s|__REGION__|${REGION}|g" \
      -e "s|__PREFIX_US__|${PREFIX_US}|g" \
      -e "s|__PREFIX__|${PREFIX}|g" \
      -e "s|__BUCKET__|${BUCKET}|g" "$1"
}

echo "== 1. S3 bucket =="
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
fi

echo "== 2. IAM roles =="
cat > "$TMP/trust-firehose.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"firehose.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
cat > "$TMP/trust-cwl.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"logs.${REGION}.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
cat > "$TMP/trust-ecs.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
cat > "$TMP/s3-write.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:AbortMultipartUpload","s3:GetBucketLocation","s3:GetObject","s3:ListBucket","s3:ListBucketMultipartUploads","s3:PutObject"],"Resource":["arn:aws:s3:::${BUCKET}","arn:aws:s3:::${BUCKET}/*"]}]}
JSON
cat > "$TMP/firehose-glue.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["glue:GetTable","glue:GetTableVersion","glue:GetTableVersions","glue:GetDatabase","glue:GetDatabases"],"Resource":["arn:aws:glue:${REGION}:${ACCOUNT}:catalog","arn:aws:glue:${REGION}:${ACCOUNT}:database/${PREFIX_US}_federation","arn:aws:glue:${REGION}:${ACCOUNT}:table/${PREFIX_US}_federation/*"]}]}
JSON
cat > "$TMP/firehose-put.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["firehose:PutRecord","firehose:PutRecordBatch"],"Resource":"arn:aws:firehose:${REGION}:${ACCOUNT}:deliverystream/${PREFIX}-cw-pino-parquet"}]}
JSON

aws iam create-role --role-name "${PREFIX}-firehose-to-s3-role" \
  --assume-role-policy-document "file://$TMP/trust-firehose.json" >/dev/null 2>&1 || true
aws iam put-role-policy --role-name "${PREFIX}-firehose-to-s3-role" --policy-name s3-write \
  --policy-document "file://$TMP/s3-write.json"
aws iam put-role-policy --role-name "${PREFIX}-firehose-to-s3-role" --policy-name "${PREFIX}-firehose-glue" \
  --policy-document "file://$TMP/firehose-glue.json"

aws iam create-role --role-name "${PREFIX}-cwl-to-firehose-role" \
  --assume-role-policy-document "file://$TMP/trust-cwl.json" >/dev/null 2>&1 || true
aws iam put-role-policy --role-name "${PREFIX}-cwl-to-firehose-role" --policy-name firehose-put \
  --policy-document "file://$TMP/firehose-put.json"

aws iam create-role --role-name "${PREFIX}-ecsTaskExecutionRole" \
  --assume-role-policy-document "file://$TMP/trust-ecs.json" >/dev/null 2>&1 || true
aws iam attach-role-policy --role-name "${PREFIX}-ecsTaskExecutionRole" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
echo "   (waiting for IAM propagation)"; sleep 10

echo "== 3. CloudWatch log group =="
aws logs create-log-group --log-group-name "/${PREFIX}/federation-test-pino" --region "$REGION" 2>/dev/null || true

echo "== 4. Glue database + table =="
aws glue create-database --database-input "{\"Name\":\"${PREFIX_US}_federation\"}" --region "$REGION" 2>/dev/null || true
render "$HERE/glue-table.json" > "$TMP/glue-table.json"
aws glue create-table --database-name "${PREFIX_US}_federation" \
  --table-input "file://$TMP/glue-table.json" --region "$REGION" 2>/dev/null || \
aws glue update-table --database-name "${PREFIX_US}_federation" \
  --table-input "file://$TMP/glue-table.json" --region "$REGION"

echo "== 5. Build + push image to ECR =="
aws ecr create-repository --repository-name "${PREFIX}-pino-logger" --region "$REGION" >/dev/null 2>&1 || true
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker build --platform linux/amd64 -t "${PREFIX}-pino-logger:latest" "$HERE/.."
docker tag "${PREFIX}-pino-logger:latest" "${REGISTRY}/${PREFIX}-pino-logger:latest"
docker push "${REGISTRY}/${PREFIX}-pino-logger:latest"

echo "== 6. ECS cluster + task definition + run =="
aws ecs create-cluster --cluster-name "${PREFIX}-federation-cluster" --region "$REGION" >/dev/null
render "$HERE/taskdef.json" > "$TMP/taskdef.json"
aws ecs register-task-definition --cli-input-json "file://$TMP/taskdef.json" --region "$REGION" >/dev/null
VPC="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --region "$REGION" --query 'Vpcs[0].VpcId' --output text)"
SUBNETS="$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC --region "$REGION" --query 'Subnets[].SubnetId' --output text | tr '\t' ',')"
SG="$(aws ec2 describe-security-groups --filters Name=vpc-id,Values=$VPC Name=group-name,Values=default --region "$REGION" --query 'SecurityGroups[0].GroupId' --output text)"
aws ecs run-task --cluster "${PREFIX}-federation-cluster" --task-definition "${PREFIX}-pino-logger" \
  --launch-type FARGATE --count 1 \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --region "$REGION" --query 'tasks[0].taskArn' --output text

echo "== 7. Firehose (decompression + message extraction + Parquet) =="
render "$HERE/firehose.json" > "$TMP/firehose.json"
aws firehose create-delivery-stream --delivery-stream-name "${PREFIX}-cw-pino-parquet" \
  --delivery-stream-type DirectPut \
  --extended-s3-destination-configuration "file://$TMP/firehose.json" --region "$REGION" >/dev/null
echo -n "   waiting for ACTIVE"
for _ in $(seq 1 30); do
  ST="$(aws firehose describe-delivery-stream --delivery-stream-name "${PREFIX}-cw-pino-parquet" --region "$REGION" --query 'DeliveryStreamDescription.DeliveryStreamStatus' --output text 2>/dev/null || true)"
  [ "$ST" = "ACTIVE" ] && { echo " ok"; break; }; echo -n "."; sleep 5
done

echo "== 8. Subscription filter (log group -> Firehose) =="
aws logs put-subscription-filter \
  --log-group-name "/${PREFIX}/federation-test-pino" \
  --filter-name "${PREFIX}-pino-to-firehose" --filter-pattern "" \
  --destination-arn "arn:aws:firehose:${REGION}:${ACCOUNT}:deliverystream/${PREFIX}-cw-pino-parquet" \
  --role-arn "arn:aws:iam::${ACCOUNT}:role/${PREFIX}-cwl-to-firehose-role" --region "$REGION"

rm -rf "$TMP"
cat <<EOF

== Done ==
Data lands (after ~60s buffering) at: s3://${BUCKET}/pino-parquet/**

Register it in Elasticsearch (needs an S3-readable data_source; use a read-only IAM key):

  PUT _query/dataset/logs-cloudwatch-pino-parquet
  { "data_source": "<your_s3_data_source>",
    "resource": "s3://${BUCKET}/pino-parquet/**",
    "settings": { "format": "parquet" } }

Then in Discover:  FROM logs-cloudwatch-pino-parquet
EOF
