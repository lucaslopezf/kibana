#!/usr/bin/env bash
#
# P1 concurrency runner for the FDS + Discover broad test plan.
#
# Simulates a dashboard fan-out: a dashboard issues ~1 request per panel, so this fires N `_query`
# requests in parallel against the same federated dataset and measures how latency/errors degrade vs
# the sequential baseline (N=1). This is the "concurrency" angle raised for dashboards.
#
#   concurrency N in { 1, 6, 12, 20 }   (typical panel counts)
#   op          in { fetch | stats }
#   phase       cold : re-PUT the data_source (fresh STS) right before the batch -> busts FDS cache
#               warm : immediately re-run the same batch                          -> cache hit
#
# Size is held constant (1x) so the only variable is concurrency, isolating thread-pool / S3 GET
# contention rather than raw volume.
#
# Metrics per batch: batch wall-clock (launch -> all done), per-request p50/p95/max latency,
# error count, is_partial count, and HTTP 429 (S3 SlowDown surfaced as request failures).
#
#   PREFIX=lucaslopezf REGION=eu-north-1 ./run_concurrency_matrix.sh
#
# Requirements: valid aws login, ES up at localhost:9200, python3, curl.
#
set -uo pipefail

PREFIX="${PREFIX:-lucaslopezf}"
REGION="${REGION:-eu-north-1}"
ES="${ES:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-changeme}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

OUT_CSV="${OUT_CSV:-./ref-data/concurrency-results.csv}"
mkdir -p "$(dirname "$OUT_CSV")"
echo "dataset,format,op,concurrency,phase,batch_wall_s,p50_ms,p95_ms,max_ms,errors,partials,http429" > "$OUT_CSV"

CONCURRENCIES="${CONCURRENCIES:-1 6 12 20}"
OPS="${OPS:-fetch stats}"

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

esql_for() {
  local ds="$1" op="$2"
  case "$op" in
    fetch) echo "FROM \"$ds\" | LIMIT 500" ;;
    stats) echo "FROM \"$ds\" | STATS c = COUNT(*), avgdur = AVG(duration_ms) BY level" ;;
  esac
}

# one request -> writes "<http_code> <time_total_s> <took> <is_partial>" to $1
one_req() {
  local outfile="$1" esql="$2" body resp time code json
  body="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$esql")"
  resp="$(curl -s -u "$ES_USER:$ES_PASS" -X POST "$ES/_query" \
    -H 'content-type: application/json' -d "$body" -w $'\n%{http_code}\n%{time_total}')"
  time="$(printf '%s' "$resp" | tail -1)"
  code="$(printf '%s' "$resp" | tail -2 | head -1)"
  json="$(printf '%s' "$resp" | sed '$d' | sed '$d')"
  local took ip
  took="$(printf '%s' "$json" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("took"))
except Exception: print("NA")')"
  ip="$(printf '%s' "$json" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("is_partial"))
except Exception: print("err")')"
  echo "$code $time $took $ip" > "$outfile"
}

run_batch() {
  local ds="$1" fmt="$2" op="$3" n="$4" phase="$5" esql="$6"
  local tmp start end i
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/conc.XXXXXX")"
  start="$(python3 -c 'import time; print(time.time())')"
  for i in $(seq 1 "$n"); do
    one_req "$tmp/req_$i" "$esql" &
  done
  wait
  end="$(python3 -c 'import time; print(time.time())')"
  python3 - "$tmp" "$ds" "$fmt" "$op" "$n" "$phase" "$start" "$end" "$OUT_CSV" <<'PY'
import sys, glob, os
tmp, ds, fmt, op, n, phase, start, end, out = sys.argv[1:10]
times = []; partials = 0; errors = 0; h429 = 0
for f in glob.glob(os.path.join(tmp, "req_*")):
    parts = open(f).read().split()
    if len(parts) >= 4:
        code, t, took, ip = parts[0], parts[1], parts[2], parts[3]
        try: times.append(float(t) * 1000)
        except Exception: pass
        if code != "200": errors += 1
        if code == "429": h429 += 1
        if ip == "true": partials += 1
    else:
        errors += 1
def pct(v, p):
    if not v: return ""
    v = sorted(v); k = (len(v) - 1) * p; f = int(k); c = min(f + 1, len(v) - 1)
    return round(v[f] + (v[c] - v[f]) * (k - f), 1)
batch = round(float(end) - float(start), 3)
p50 = pct(times, 0.5); p95 = pct(times, 0.95)
mx = round(max(times), 1) if times else ""
open(out, "a").write(f"{ds},{fmt},{op},{n},{phase},{batch},{p50},{p95},{mx},{errors},{partials},{h429}\n")
print(f"  {ds:34s} {op:5s} N={str(n):<3s} {phase:4s} batch={batch}s p50={p50}ms p95={p95}ms max={mx}ms err={errors} 429={h429} partial={partials}")
PY
  rm -rf "$tmp"
}

# Same logical data, size held at 1x; only concurrency varies.
DATASETS="
parquet 1x
ndjson 1x
"

echo "== Concurrency matrix -> $OUT_CSV =="
printf '%s\n' "$DATASETS" | while read -r fmt size; do
  [ -z "$fmt" ] && continue
  ds="${PREFIX}-ref-${fmt}-${size}"
  for op in $OPS; do
    esql="$(esql_for "$ds" "$op")"
    for n in $CONCURRENCIES; do
      put_data_source                                      # cold: bust cache
      run_batch "$ds" "$fmt" "$op" "$n" "cold" "$esql"
      run_batch "$ds" "$fmt" "$op" "$n" "warm" "$esql"     # warm: cache hit
    done
  done
done

echo
echo "== Results ($OUT_CSV) =="
column -s, -t "$OUT_CSV"
