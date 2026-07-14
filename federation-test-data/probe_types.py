#!/usr/bin/env python3
"""Probe FDS type inference across formats: print the ES|QL column types for each dataset."""
import json
import subprocess
import sys

ES = "http://localhost:9200"
AUTH = "elastic:changeme"
PREFIX = sys.argv[1] if len(sys.argv) > 1 else "lucaslopezf"
DATASETS = [f"{PREFIX}-types-ndjson", f"{PREFIX}-types-parquet", f"{PREFIX}-types-csv"]


def run_query(q):
    body = json.dumps({"query": q})
    out = subprocess.run(
        ["curl", "-s", "-u", AUTH, "-X", "POST", f"{ES}/_query",
         "-H", "content-type: application/json", "-d", body],
        capture_output=True, text=True,
    ).stdout
    return json.loads(out)


cols_by_ds = {}
for ds in DATASETS:
    print(f"\n============ {ds} ============")
    b = run_query(f'FROM "{ds}" | LIMIT 1')
    if "error" in b:
        print("ERROR:", b["error"].get("reason") or b["error"].get("type"))
        cols_by_ds[ds] = {}
        continue
    cols = {c["name"]: c["type"] for c in b.get("columns", [])}
    cols_by_ds[ds] = cols
    for name, typ in cols.items():
        print(f"  {name:30s} {typ}")

# side-by-side matrix
all_names = []
for ds in DATASETS:
    for n in cols_by_ds[ds]:
        if n not in all_names:
            all_names.append(n)

print("\n\n================ TYPE MATRIX (field | ndjson | parquet | csv) ================")
short = [ds.split("-types-")[-1] for ds in DATASETS]
print(f"{'field':30s} {short[0]:12s} {short[1]:12s} {short[2]:12s}")
for n in sorted(all_names):
    row = [cols_by_ds[ds].get(n, "-") for ds in DATASETS]
    print(f"{n:30s} {row[0]:12s} {row[1]:12s} {row[2]:12s}")
