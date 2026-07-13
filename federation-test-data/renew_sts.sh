#!/usr/bin/env bash
#
# Renew the STS credentials stored in the FDS data_source.
#
# FDS keeps the S3 credentials in cluster state and never refreshes them, so when the
# temporary STS session expires (~1h) queries start failing with
# "The provided token has expired". This re-pushes the current session's credentials
# to the data_source (no data is re-generated or re-uploaded).
#
# It also invalidates the FDS cache, which is handy for cold pruning measurements.
#
#   ./renew_sts.sh                 # refresh data_source "my_s3"
#   DATA_SOURCE=other ./renew_sts.sh
#
# Env vars (all optional):
#   DATA_SOURCE   data_source name          (default my_s3)
#   REGION        aws region                (default eu-north-1)
#   ES            elasticsearch url         (default http://localhost:9200)
#   ES_USER       es user                   (default elastic)
#   ES_PASS       es password               (default changeme)
#
set -euo pipefail

DATA_SOURCE="${DATA_SOURCE:-my_s3}"
REGION="${REGION:-eu-north-1}"
ES="${ES:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-changeme}"

# 1. Ensure we have a live AWS session; log in if the current one is missing/expired.
if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "== no valid AWS session, running 'aws login' =="
  aws login
fi
echo "== AWS identity =="
aws sts get-caller-identity

# 2. Pull the current session's temporary credentials.
CREDS_JSON="$(aws configure export-credentials --format process)"

# 3. Re-PUT the data_source with the fresh credentials.
echo "== refreshing data_source '${DATA_SOURCE}' =="
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
' | curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/data_source/${DATA_SOURCE}" \
  -H 'content-type: application/json' --data @- -w '\n-> HTTP %{http_code}\n'

echo "== done. STS session is valid for ~1h; re-run when it expires. =="
