#!/usr/bin/env python3
"""
Parse RPC SIV Arrivals by Nationality and State PDF → data/nested/siv.json

Needs: pypdf
Input: data/raw/wraps/siv-arrivals.pdf
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "wraps" / "siv-arrivals.pdf"
OUT = ROOT / "data" / "nested" / "siv.json"

STATES = {
    "Alabama",
    "Alaska",
    "Arizona",
    "Arkansas",
    "California",
    "Colorado",
    "Connecticut",
    "Delaware",
    "District of Columbia",
    "Florida",
    "Georgia",
    "Hawaii",
    "Idaho",
    "Illinois",
    "Indiana",
    "Iowa",
    "Kansas",
    "Kentucky",
    "Louisiana",
    "Maine",
    "Maryland",
    "Massachusetts",
    "Michigan",
    "Minnesota",
    "Mississippi",
    "Missouri",
    "Montana",
    "Nebraska",
    "Nevada",
    "New Hampshire",
    "New Jersey",
    "New Mexico",
    "New York",
    "North Carolina",
    "North Dakota",
    "Ohio",
    "Oklahoma",
    "Oregon",
    "Pennsylvania",
    "Rhode Island",
    "South Carolina",
    "South Dakota",
    "Tennessee",
    "Texas",
    "Utah",
    "Vermont",
    "Virginia",
    "Washington",
    "West Virginia",
    "Wisconsin",
    "Wyoming",
    "Not Available",
}

# Nationalities that appear as section markers in the SIV PDF.
NAT_NAMES = {
    "Afghanistan",
    "Belgium",
    "Canada",
    "France",
    "Germany",
    "Iraq",
    "Italy",
    "Spain",
}


def parse_siv(path: Path) -> dict:
    from pypdf import PdfReader

    words: list[tuple[float, float, str]] = []

    def visitor(text, cm, tm, fontDict, fontSize):
        t = (text or "").strip()
        if t:
            words.append((float(tm[5]), float(tm[4]), t))

    reader = PdfReader(str(path))
    for page in reader.pages:
        page.extract_text(visitor_text=visitor)

    buckets: dict[int, list] = defaultdict(list)
    for y, x, t in words:
        buckets[round(y)].append((x, t))

    def parse_line(y: int):
        parts = sorted(buckets.get(y, []), key=lambda p: p[0])
        texts = [t for _, t in parts]
        nums = [int(t.replace(",", "")) for t in texts if re.fullmatch(r"[\d,]+", t)]
        labels = [t for t in texts if not re.fullmatch(r"[\d,]+", t)]
        return texts, labels, nums

    blob = " ".join(t for _, _, t in words)
    period = None
    m = re.search(
        r"October 1,\s*(\d{4})\s*through\s*([A-Za-z]+ \d{1,2},\s*\d{4})", blob
    )
    if m:
        period = f"October 1, {m.group(1)} through {m.group(2)}"

    as_of = None
    as_of_label = None
    m2 = re.search(r"as of ([A-Za-z]+ \d{1,2}, \d{4})", path.name, re.I)
    if m2:
        try:
            dt = datetime.strptime(m2.group(1), "%B %d, %Y")
            as_of = dt.date().isoformat()
            as_of_label = dt.strftime("%b %Y")
        except ValueError:
            pass
    if not as_of:
        m3 = re.search(r"Data as of (\d{1,2})/(\d{1,2})/(\d{4})", blob)
        if m3:
            mo, d, y = int(m3.group(1)), int(m3.group(2)), int(m3.group(3))
            dt = datetime(y, mo, d)
            as_of = dt.date().isoformat()
            as_of_label = dt.strftime("%b %Y")

    fiscal_year = None
    m4 = re.search(r"Fiscal Year (\d{4})", blob)
    if m4:
        fiscal_year = int(m4.group(1))

    countries = sorted(
        {(y, l) for y in buckets for l in parse_line(y)[1] if l in NAT_NAMES}
    )

    rows: list[tuple[int, str, int]] = []
    grand = None
    ys = sorted(buckets, reverse=True)
    i = 0
    while i < len(ys):
        y = ys[i]
        texts, labels, nums = parse_line(y)
        if "Grand Total" in labels and nums and nums[0] > 100:
            grand = nums[0]
            i += 1
            continue

        nats = [l for l in labels if l in NAT_NAMES]
        states = [l for l in labels if l in STATES]

        if nats and states:
            total = nums[-1] if nums else None
            if total is None and i + 1 < len(ys):
                _, l2, n2 = parse_line(ys[i + 1])
                if n2 and not l2:
                    total = n2[-1]
                    i += 1
            if total is not None:
                rows.append((y, states[0], total))
            i += 1
            continue

        # "Actual Destination State" + Colorado junk label
        if states and ("Actual Destination State" in labels or "Actual" in labels):
            total = nums[-1] if nums else None
            if total is None and i + 1 < len(ys):
                _, l2, n2 = parse_line(ys[i + 1])
                if n2 and not any(l in STATES for l in l2):
                    total = n2[-1]
                    i += 1
            if total is not None:
                rows.append((y, states[0], total))
            i += 1
            continue

        if len(labels) == 1 and labels[0] in STATES and not nums:
            st = labels[0]
            if i + 1 < len(ys):
                _, l2, n2 = parse_line(ys[i + 1])
                if n2 and not l2:
                    rows.append((y, st, n2[-1]))
                    i += 2
                    continue
                if (
                    n2
                    and any(l in NAT_NAMES for l in l2)
                    and not any(l in STATES for l in l2)
                ):
                    rows.append((y, st, n2[-1]))
                    i += 2
                    continue
            i += 1
            continue
        i += 1

    if grand is None:
        raise SystemExit("SIV PDF: could not find Grand Total")

    by_nat: dict[str, int] = defaultdict(int)
    by_state_nat: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for y_s, st, total in rows:
        cand = [(yc, n) for yc, n in countries if yc <= y_s + 5]
        nat = cand[-1][1] if cand else "Unknown"
        by_state_nat[st][nat] += total
        by_nat[nat] += total

    row_sum = sum(by_nat.values())
    if row_sum != grand:
        # Prefer PDF grand total; keep rows if close, else fail loud.
        if abs(row_sum - grand) > max(50, grand * 0.05):
            raise SystemExit(
                f"SIV parse mismatch: rows sum {row_sum} vs grand {grand}"
            )

    by_state = {}
    for st, nats in by_state_nat.items():
        by_nationality = [
            {"name": n, "total": t}
            for n, t in sorted(nats.items(), key=lambda x: (-x[1], x[0]))
        ]
        by_state[st] = {
            "total": sum(nats.values()),
            "byNationality": by_nationality,
        }

    by_country = [
        {"name": n, "total": t}
        for n, t in sorted(by_nat.items(), key=lambda x: (-x[1], x[0]))
        if n != "Unknown"
    ]

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "asOf": as_of,
        "asOfLabel": as_of_label,
        "fiscalYear": fiscal_year,
        "period": period,
        "sourceName": "State Department Refugee Processing Center (SIV arrivals)",
        "sourceUrl": "https://www.rpc.state.gov/admissions-and-arrivals/",
        "total": grand,
        "rowSum": row_sum,
        "byCountry": by_country,
        "byState": by_state,
        "note": (
            "Iraqi and Afghan SIV holders + derived family who received DoS "
            "resettlement benefits. Monthly RPC snapshot. "
            "Historical months can move after reconciliation."
        ),
    }


def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"Missing {RAW} — run npm run fetch:wraps -- --force")
    payload = parse_siv(RAW)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(
        f"Wrote {OUT} — FY{payload['fiscalYear']} total={payload['total']} "
        f"states={len(payload['byState'])} rowSum={payload['rowSum']} "
        f"asOf={payload['asOf']}"
    )


if __name__ == "__main__":
    main()
