#!/usr/bin/env bash
#
# Build + push the pino service image to ECR and run it on ECS Fargate.
# This is the "ship the service" step only (ECR + ECS); the rest of the pipeline
# (CloudWatch subscription -> Firehose -> Glue/Parquet -> S3) is created by setup.sh.
# Use this to (re)deploy the container after changing app.js without touching the pipeline.
#
#   PREFIX=myuser REGION=eu-north-1 ./deploy_service.sh
#
# Requires: awscli, docker, AWS credentials, and that setup.sh already created the
# ECS execution role, log group and cluster (or run setup.sh first).
#
set -euo pipefail

PREFIX="${PREFIX:-myuser}"
REGION="${REGION:-eu-north-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"

echo "PREFIX=$PREFIX REGION=$REGION ACCOUNT=$ACCOUNT"

render() {
  sed -e "s|__ACCOUNT__|${ACCOUNT}|g" \
      -e "s|__REGION__|${REGION}|g" \
      -e "s|__PREFIX__|${PREFIX}|g" "$1"
}

echo "== 1. Build + push image to ECR =="
aws ecr create-repository --repository-name "${PREFIX}-pino-logger" --region "$REGION" >/dev/null 2>&1 || true
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker build --platform linux/amd64 -t "${PREFIX}-pino-logger:latest" "$HERE/.."
docker tag "${PREFIX}-pino-logger:latest" "${REGISTRY}/${PREFIX}-pino-logger:latest"
docker push "${REGISTRY}/${PREFIX}-pino-logger:latest"

echo "== 2. Register task definition =="
render "$HERE/taskdef.json" > "$TMP/taskdef.json"
aws ecs register-task-definition --cli-input-json "file://$TMP/taskdef.json" --region "$REGION" >/dev/null

echo "== 3. Run task on Fargate =="
VPC="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --region "$REGION" --query 'Vpcs[0].VpcId' --output text)"
SUBNETS="$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC --region "$REGION" --query 'Subnets[].SubnetId' --output text | tr '\t' ',')"
SG="$(aws ec2 describe-security-groups --filters Name=vpc-id,Values=$VPC Name=group-name,Values=default --region "$REGION" --query 'SecurityGroups[0].GroupId' --output text)"
aws ecs run-task --cluster "${PREFIX}-federation-cluster" --task-definition "${PREFIX}-pino-logger" \
  --launch-type FARGATE --count 1 \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --region "$REGION" --query 'tasks[0].taskArn' --output text

rm -rf "$TMP"
echo "== Done. Logs flowing to /${PREFIX}/federation-test-pino =="
echo "Stop the task when you have enough data:"
echo "  aws ecs list-tasks --cluster ${PREFIX}-federation-cluster --region $REGION"
echo "  aws ecs stop-task --cluster ${PREFIX}-federation-cluster --task <arn> --region $REGION"
