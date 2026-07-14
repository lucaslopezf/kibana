#!/usr/bin/env python3
import json, subprocess, sys
ES = "http://localhost:9200"; AUTH = "elastic:changeme"
PREFIX = sys.argv[1] if len(sys.argv) > 1 else "lucaslopezf"

def q(query):
    body = json.dumps({"query": query})
    out = subprocess.run(["curl","-s","-u",AUTH,"-X","POST",f"{ES}/_query",
        "-H","content-type: application/json","-d",body], capture_output=True, text=True).stdout
    return json.loads(out)

def show(query):
    print(f"\n>>> {query}")
    b = q(query)
    if "error" in b:
        print("   ERROR:", b["error"].get("reason") or b["error"].get("type")); return
    names = [c["name"] for c in b["columns"]]
    print("   cols:", {c["name"]: c["type"] for c in b["columns"]}, "is_partial:", b.get("is_partial"))
    for row in b.get("values", [])[:4]:
        print("   ", dict(zip(names, row)))

pq = f"{PREFIX}-mixed-parquet"
nd = f"{PREFIX}-mixed-ndjson"
print("############ PARQUET ############")
show(f'FROM "{pq}" | LIMIT 3')
show(f'FROM "{pq}" | KEEP id, status | LIMIT 3')
show(f'FROM "{pq}" | KEEP id, status, amount, only_a, only_b | LIMIT 3')
show(f'FROM "{pq}" | SORT id | LIMIT 3')
show(f'FROM "{pq}" | STATS c = COUNT(*) BY status')
print("\n############ NDJSON ############")
show(f'FROM "{nd}" | KEEP id | LIMIT 3')
show(f'FROM "{nd}" | STATS c = COUNT(*) BY status')
show(f'FROM "{nd}" | KEEP id, amount | LIMIT 3')
