#!/usr/bin/env python3
"""Aggregate OPM FWD employment parquet → small JSON by dept / agency / subelement."""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

try:
    import pyarrow.parquet as pq
except ImportError:
    sys.stderr.write("pyarrow required: pip3 install pyarrow\n")
    sys.exit(1)


def main() -> None:
    if len(sys.argv) < 3:
        sys.stderr.write("Usage: aggregate-opm-workforce.py <in.parquet> <out.json>\n")
        sys.exit(1)
    src = Path(sys.argv[1])
    dest = Path(sys.argv[2])

    t = pq.read_table(
        src,
        columns=[
            "department",
            "department_code",
            "agency",
            "agency_code",
            "agency_subelement",
            "agency_subelement_code",
            "count",
            "snapshot_yyyymm",
        ],
    )
    d_names = t.column("department").to_pylist()
    d_codes = t.column("department_code").to_pylist()
    a_names = t.column("agency").to_pylist()
    a_codes = t.column("agency_code").to_pylist()
    s_names = t.column("agency_subelement").to_pylist()
    s_codes = t.column("agency_subelement_code").to_pylist()
    counts = t.column("count").to_pylist()
    snaps = t.column("snapshot_yyyymm").to_pylist()
    as_of = str(snaps[0]) if snaps else None

    dept: dict[str, dict] = defaultdict(lambda: {"name": None, "count": 0})
    agency: dict[str, dict] = defaultdict(
        lambda: {"name": None, "departmentCode": None, "department": None, "count": 0}
    )
    sub: dict[str, dict] = defaultdict(
        lambda: {
            "name": None,
            "agencyCode": None,
            "agency": None,
            "count": 0,
        }
    )

    for i, raw in enumerate(counts):
        c = int(raw or 1)
        dc = d_codes[i]
        if dc is not None:
            key = str(dc).strip()
            dept[key]["name"] = d_names[i]
            dept[key]["count"] += c
        ac = a_codes[i]
        if ac is not None:
            key = str(ac).strip()
            agency[key]["name"] = a_names[i]
            agency[key]["departmentCode"] = str(dc).strip() if dc is not None else None
            agency[key]["department"] = d_names[i]
            agency[key]["count"] += c
        sc = s_codes[i]
        if sc is not None:
            key = str(sc).strip()
            sub[key]["name"] = s_names[i]
            sub[key]["agencyCode"] = str(ac).strip() if ac is not None else None
            sub[key]["agency"] = a_names[i]
            sub[key]["count"] += c

    out = {
        "source": "OPM Federal Workforce Data (EHRI Status)",
        "asOf": as_of,
        "rowCount": t.num_rows,
        "departments": [
            {"code": k, "name": v["name"], "count": v["count"]}
            for k, v in sorted(dept.items(), key=lambda x: -x[1]["count"])
        ],
        "agencies": [
            {
                "code": k,
                "name": v["name"],
                "departmentCode": v["departmentCode"],
                "department": v["department"],
                "count": v["count"],
            }
            for k, v in sorted(agency.items(), key=lambda x: -x[1]["count"])
        ],
        "subelements": [
            {
                "code": k,
                "name": v["name"],
                "agencyCode": v["agencyCode"],
                "agency": v["agency"],
                "count": v["count"],
            }
            for k, v in sorted(sub.items(), key=lambda x: -x[1]["count"])
        ],
    }
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {dest} · asOf={as_of} · "
        f"{len(out['departments'])} depts · {len(out['agencies'])} agencies · "
        f"{len(out['subelements'])} subelements"
    )


if __name__ == "__main__":
    main()
