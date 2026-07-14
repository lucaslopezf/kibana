#!/usr/bin/env bash
#
# P1 performance runner for the FDS + Discover broad test plan.
#
# Runs the matrix  format x size x operation  over the Phase 0 reference datasets, in both
# cold and warm cache states, and writes a CSV of metrics (plus a printed summary).
#
#   operation in { fetch | stats | keep }
#     fetch : FROM <ds> | LIMIT 500                                  (raw rows, all columns)
#     stats : FROM <ds> | STATS COUNT(*), AVG(duration_ms) BY level (full-scan aggregation)
#     keep  : FROM <ds> | KEEP @timestamp, level, bytes | LIMIT 500 (projection)
#
#   cold : re-PUT the data_source (fresh STS) right before the query -> busts the FDS read cache
#   warm : immediately re-run the same query                          -> cache hit
#
# Metrics captured per run: wall-clock (curl time_total), took, documents_found, values_loaded,
# rows_emitted, is_partial.
#
#   PREFIX=lucaslopezf REGION=eu-north-1 ./run_perf_matrix.sh
#
# Requirements: valid aws login, ES up at localhost:9200, python3, curl.
#
set -euo pipefail

PREFIX="${PREFIX:-lucaslopezf}"
REGION="${REGION:-eu-north-1}"
ES="${ES:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-changeme}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

OUT_CSV="${OUT_CSV:-./ref-data/perf-results.csv}"
mkdir -p "$(dirname "$OUT_CSV")"
echo "dataset,format,size,op,phase,wall_s,took_ms,documents_found,values_loaded,rows_emitted,is_partial" > "$OUT_CSV"

# Re-PUT data_source my_s3 with fresh STS -> invalidates the FDS read cache (cold state).
put_data_source() {
  local creds
  creds="$(aws configure export-credentials --format process)"
  CREDS_JSON="$creds" REGION="$REGION" python3 -c '
import json, os
c = json.loads(os.environ["CREDS_JSON"])
print(json.dumps({"type":"s3","settings":{
  "region": os.environ["REGION"],
  "access_key": c["AccessKeyId"],
  "secret_key": c["SecretAccessKey"],
  "session_token": c["SessionToken"],
}}))' | curl -s -u "$ES_USER:$ES_PASS" -X PUT "$ES/_query/data_source/my_s3" \
    -H 'content-type: application/json' --data @- >/dev/null
}

# run_query <dataset> <format> <size> <op> <phase> <esql>
run_query() {
  local ds="$1" fmt="$2" size="$3" op="$4" phase="$5" esql="$6"
  local body
  body="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$esql")"
  local resp wall json
  resp="$(curl -s -u "$ES_USER:$ES_PASS" -X POST "$ES/_query" \
    -H 'content-type: application/json' -d "$body" -w $'\n%{time_total}')"
  wall="$(printf '%s' "$resp" | tail -1)"
  json="$(printf '%s' "$resp" | sed '$d')"
  local metrics
  metrics="$(printf '%s' "$json" | python3 -c '
import json,sys
b=json.load(sys.stdin)
print("{}|{}|{}|{}|{}".format(
  b.get("took"), b.get("documents_found"), b.get("values_loaded"),
  b.get("rows_emitted"), b.get("is_partial")))')"
  IFS='|' read -r took df vl re ip <<EOF
$metrics
EOF
  echo "${ds},${fmt},${size},${op},${phase},${wall},${took},${df},${vl},${re},${ip}" >> "$OUT_CSV"
  printf '  %-38s %-6s %-5s took=%-7s docs=%-8s wall=%ss\n' "$ds" "$op" "$phase" "$took" "$df" "$wall"
}

esql_for() {
  local ds="$1" op="$2"
  case "$op" in
    fetch) echo "FROM \"$ds\" | LIMIT 500" ;;
    stats) echo "FROM \"$ds\" | STATS c = COUNT(*), avgdur = AVG(duration_ms) BY level" ;;
    keep)  echo "FROM \"$ds\" | KEEP @timestamp, level, bytes | LIMIT 500" ;;
  esac
}

DATASETS="
ndjson 1x
csv 1x
parquet 1x
ndjson 10x
csv 10x
parquet 10x
ndjson 100x
csv 100x
parquet 100x
parquet 10x-manyfiles
"

echo "== Perf matrix -> $OUT_CSV =="
printf '%s\n' "$DATASETS" | while read -r fmt size; do
  [ -z "$fmt" ] && continue
  ds="${PREFIX}-ref-${fmt}-${size}"
  for op in fetch stats keep; do
    esql="$(esql_for "$ds" "$op")"
    put_data_source                       # cold: bust cache
    run_query "$ds" "$fmt" "$size" "$op" "cold" "$esql"
    run_query "$ds" "$fmt" "$size" "$op" "warm" "$esql"   # warm: cache hit
  done
done

echo
echo "== Results ($OUT_CSV) =="
column -s, -t "$OUT_CSV"
