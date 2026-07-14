#!/usr/bin/env python3
"""Show sample VALUES for rich fields per format (multivalue arrays, nested, geo, ids)."""
import json
import subprocess
import sys

ES = "http://localhost:9200"
AUTH = "elastic:changeme"
PREFIX = sys.argv[1] if len(sys.argv) > 1 else "lucaslopezf"


def run_query(q):
    body = json.dumps({"query": q})
    out = subprocess.run(
        ["curl", "-s", "-u", AUTH, "-X", "POST", f"{ES}/_query",
         "-H", "content-type: application/json", "-d", body],
        capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def show(ds, q):
    print(f"\n--- {ds} :: {q}")
    b = run_query(q)
    if "error" in b:
        print("  ERROR:", b["error"].get("reason") or b["error"].get("type"))
        return
    names = [c["name"] for c in b["columns"]]
    for row in b["values"][:3]:
        for n, v in zip(names, row):
            print(f"    {n:24s} = {json.dumps(v)}")
        print("    " + "-" * 20)


nd = f"{PREFIX}-types-ndjson"
pq = f"{PREFIX}-types-parquet"
cv = f"{PREFIX}-types-csv"

for ds in (nd, pq):
    show(ds, f'FROM "{ds}" | KEEP tags, scores, geo_str, location.lat, location.lon, user.roles, client_ip, aws.account_id | LIMIT 3')

show(cv, f'FROM "{cv}" | KEEP tags, scores, geo_str, location, user, http, client_ip, aws.account_id | LIMIT 3')
