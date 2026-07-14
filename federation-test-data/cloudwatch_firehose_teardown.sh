#!/usr/bin/env bash
#
# Tear down the CloudWatch Logs -> Firehose -> S3 federation test resources
# (both the NDJSON and the Parquet branches). Safe to re-run: every step ignores
# "not found" errors.
#
#   PREFIX=myuser REGION=eu-north-1 ./cloudwatch_firehose_teardown.sh
#
# Requires AWS credentials for the account that owns the resources.
# All resource names are derived from $PREFIX (default "myuser").
#
set -uo pipefail

PREFIX="${PREFIX:-myuser}"
# Glue database names can't contain hyphens; derive an underscore-safe variant.
PREFIX_US="${PREFIX//-/_}"
REGION="${REGION:-eu-north-1}"

BUCKET="${BUCKET:-${PREFIX}-federation-test}"
LOG_GROUP="/${PREFIX}/federation-test"
LOG_GROUP_PINO="/${PREFIX}/federation-test-pino"
GLUE_DB="${PREFIX_US}_federation"
GLUE_TABLE="logs_cloudwatch_parquet"
GLUE_TABLE_PINO="logs_cloudwatch_pino_parquet"
ECS_CLUSTER="${PREFIX}-federation-cluster"
ECR_REPO="${PREFIX}-pino-logger"

run() { echo "+ $*"; "$@" 2>&1 | sed 's/^/    /' || true; }

echo "== identity (confirm you are in the RIGHT account) =="
aws sts get-caller-identity 2>&1 | sed 's/^/    /'
echo

echo "== 0. Native pino test: ECS Fargate + ECR =="
# Stop any running tasks, then deregister task defs and delete the cluster.
for t in $(aws ecs list-tasks --cluster "$ECS_CLUSTER" --region "$REGION" --query 'taskArns[]' --output text 2>/dev/null); do
  run aws ecs stop-task --cluster "$ECS_CLUSTER" --task "$t" --region "$REGION"
done
for td in $(aws ecs list-task-definitions --family-prefix "${PREFIX}-pino-logger" --region "$REGION" --query 'taskDefinitionArns[]' --output text 2>/dev/null); do
  run aws ecs deregister-task-definition --task-definition "$td" --region "$REGION"
done
run aws ecs delete-cluster --cluster "$ECS_CLUSTER" --region "$REGION"
run aws ecr delete-repository --repository-name "$ECR_REPO" --force --region "$REGION"

echo "== 1. Delete CloudWatch subscription filters =="
run aws logs delete-subscription-filter --log-group-name "$LOG_GROUP" --filter-name "${PREFIX}-cw-to-firehose" --region "$REGION"
run aws logs delete-subscription-filter --log-group-name "$LOG_GROUP" --filter-name "${PREFIX}-cw-to-firehose-parquet" --region "$REGION"
run aws logs delete-subscription-filter --log-group-name "$LOG_GROUP_PINO" --filter-name "${PREFIX}-pino-to-firehose" --region "$REGION"
run aws logs delete-subscription-filter --log-group-name "$LOG_GROUP_PINO" --filter-name "${PREFIX}-pino-to-firehose-json" --region "$REGION"

echo "== 2. Delete Firehose delivery streams =="
run aws firehose delete-delivery-stream --delivery-stream-name "${PREFIX}-cw-logs-to-s3" --region "$REGION"
run aws firehose delete-delivery-stream --delivery-stream-name "${PREFIX}-cw-logs-to-s3-parquet" --region "$REGION"
run aws firehose delete-delivery-stream --delivery-stream-name "${PREFIX}-cw-pino-parquet" --region "$REGION"
run aws firehose delete-delivery-stream --delivery-stream-name "${PREFIX}-cw-pino-json" --region "$REGION"

echo "== 3. Delete Lambda =="
run aws lambda delete-function --function-name "${PREFIX}-cw-transform" --region "$REGION"

echo "== 4. Delete Glue tables + database =="
run aws glue delete-table --database-name "$GLUE_DB" --name "$GLUE_TABLE" --region "$REGION"
run aws glue delete-table --database-name "$GLUE_DB" --name "$GLUE_TABLE_PINO" --region "$REGION"
run aws glue delete-database --name "$GLUE_DB" --region "$REGION"

echo "== 5. Delete CloudWatch log groups =="
run aws logs delete-log-group --log-group-name "$LOG_GROUP" --region "$REGION"
run aws logs delete-log-group --log-group-name "$LOG_GROUP_PINO" --region "$REGION"

echo "== 6. Delete IAM roles (detach/delete policies first) =="
# firehose-to-s3-role: inline s3-write, parquet-extras, firehose-glue
run aws iam delete-role-policy --role-name "${PREFIX}-firehose-to-s3-role" --policy-name s3-write
run aws iam delete-role-policy --role-name "${PREFIX}-firehose-to-s3-role" --policy-name parquet-extras
run aws iam delete-role-policy --role-name "${PREFIX}-firehose-to-s3-role" --policy-name "${PREFIX}-firehose-glue"
run aws iam delete-role --role-name "${PREFIX}-firehose-to-s3-role"
# cwl-to-firehose-role: inline firehose-put (+ firehose-put-json from add_json_variant.sh)
run aws iam delete-role-policy --role-name "${PREFIX}-cwl-to-firehose-role" --policy-name firehose-put
run aws iam delete-role-policy --role-name "${PREFIX}-cwl-to-firehose-role" --policy-name firehose-put-json
run aws iam delete-role --role-name "${PREFIX}-cwl-to-firehose-role"
# lambda-transform-role: managed AWSLambdaBasicExecutionRole
run aws iam detach-role-policy --role-name "${PREFIX}-lambda-transform-role" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
run aws iam delete-role --role-name "${PREFIX}-lambda-transform-role"
# ecsTaskExecutionRole: managed AmazonECSTaskExecutionRolePolicy
run aws iam detach-role-policy --role-name "${PREFIX}-ecsTaskExecutionRole" --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
run aws iam delete-role --role-name "${PREFIX}-ecsTaskExecutionRole"

echo "== 7. Delete IAM reader user (access keys + inline policy first) =="
for ak in $(aws iam list-access-keys --user-name "${PREFIX}-federation-reader" --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null); do
  run aws iam delete-access-key --user-name "${PREFIX}-federation-reader" --access-key-id "$ak"
done
run aws iam delete-user-policy --user-name "${PREFIX}-federation-reader" --policy-name s3-read
run aws iam delete-user --user-name "${PREFIX}-federation-reader"

echo "== 8. Empty + delete the S3 bucket =="
run aws s3 rm "s3://$BUCKET" --recursive
run aws s3api delete-bucket --bucket "$BUCKET" --region "$REGION"

echo
echo "== Done. Verify nothing is left: =="
echo "   aws firehose list-delivery-streams --region $REGION"
echo "   aws s3 ls | grep $PREFIX"
