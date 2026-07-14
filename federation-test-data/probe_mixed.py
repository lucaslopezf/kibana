#!/usr/bin/env python3
"""Probe how FDS resolves mixed types across files in one dataset."""
import json
import subprocess
import sys

ES = "http://localhost:9200"
AUTH = "elastic:changeme"
PREFIX = sys.argv[1] if len(sys.argv) > 1 else "lucaslopezf"


def q(query):
    body = json.dumps({"query": query})
    out = subprocess.run(
        ["curl", "-s", "-u", AUTH, "-X", "POST", f"{ES}/_query",
         "-H", "content-type: application/json", "-d", body],
        capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def report(ds):
    print(f"\n================ {ds} ================")
    # 1) column types + error/partial signal
    b = q(f'FROM "{ds}" | LIMIT 1')
    if "error" in b:
        print("LIMIT 1 -> ERROR:", b["error"].get("reason") or b["error"].get("type"))
    else:
        print("columns:", {c["name"]: c["type"] for c in b["columns"]})
        print("is_partial:", b.get("is_partial"))
    # 2) count
    b = q(f'FROM "{ds}" | STATS c = COUNT(*)')
    if "error" in b:
        print("COUNT -> ERROR:", b["error"].get("reason") or b["error"].get("type"))
    else:
        print("COUNT(*):", b["values"], "is_partial:", b.get("is_partial"))
    # 3) sample from file_a side (low ids) and file_b side (high ids)
    for label, tail in (("file_a rows (id<3)", "| SORT id ASC | LIMIT 3"),
                        ("file_b rows (id>=200)", "| SORT id DESC | LIMIT 3")):
        b = q(f'FROM "{ds}" | KEEP id, status, amount, only_a, only_b {tail}')
        print(f"\n  -- {label} --")
        if "error" in b:
            print("   ERROR:", b["error"].get("reason") or b["error"].get("type"))
            continue
        names = [c["name"] for c in b["columns"]]
        print("   cols:", {c["name"]: c["type"] for c in b["columns"]}, "is_partial:", b.get("is_partial"))
        for row in b["values"]:
            print("   ", dict(zip(names, row)))


for fmt in ("ndjson", "parquet"):
    report(f"{PREFIX}-mixed-{fmt}")
