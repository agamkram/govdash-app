#!/usr/bin/env python3
"""
Parse RPC / WRAPS public reports → data/nested/wraps.json

Needs: pypdf (pip install pypdf)
Inputs in data/raw/wraps/:
  admissions.xlsx  — Refugee Admissions Report
  arrivals.pdf     — Refugee Arrivals by State and Nationality

Usage: python3 scripts/parse-wraps.py
"""
from __future__ import annotations

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "wraps"
OUT = ROOT / "data" / "nested" / "wraps.json"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

STATES = sorted(
    {
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
    },
    key=len,
    reverse=True,
)
STATE_SET = set(STATES)

# Common postal aliases for the R lookup box
STATE_ALIASES = {
    "AL": "Alabama",
    "AK": "Alaska",
    "AZ": "Arizona",
    "AR": "Arkansas",
    "CA": "California",
    "CO": "Colorado",
    "CT": "Connecticut",
    "DE": "Delaware",
    "DC": "District of Columbia",
    "FL": "Florida",
    "GA": "Georgia",
    "HI": "Hawaii",
    "ID": "Idaho",
    "IL": "Illinois",
    "IN": "Indiana",
    "IA": "Iowa",
    "KS": "Kansas",
    "KY": "Kentucky",
    "LA": "Louisiana",
    "ME": "Maine",
    "MD": "Maryland",
    "MA": "Massachusetts",
    "MI": "Michigan",
    "MN": "Minnesota",
    "MS": "Mississippi",
    "MO": "Missouri",
    "MT": "Montana",
    "NE": "Nebraska",
    "NV": "Nevada",
    "NH": "New Hampshire",
    "NJ": "New Jersey",
    "NM": "New Mexico",
    "NY": "New York",
    "NC": "North Carolina",
    "ND": "North Dakota",
    "OH": "Ohio",
    "OK": "Oklahoma",
    "OR": "Oregon",
    "PA": "Pennsylvania",
    "RI": "Rhode Island",
    "SC": "South Carolina",
    "SD": "South Dakota",
    "TN": "Tennessee",
    "TX": "Texas",
    "UT": "Utah",
    "VT": "Vermont",
    "VA": "Virginia",
    "WA": "Washington",
    "WV": "West Virginia",
    "WI": "Wisconsin",
    "WY": "Wyoming",
}


def load_shared_strings(z: zipfile.ZipFile) -> list[str]:
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    out = []
    for si in root.findall("m:si", NS):
        texts = [t.text or "" for t in si.findall(".//m:t", NS)]
        out.append("".join(texts))
    return out


def sheet_rows(z: zipfile.ZipFile, sheet_path: str, ss: list[str]) -> list[dict[str, str]]:
    sheet = ET.fromstring(z.read(sheet_path))
    rows = []
    for row in sheet.findall("m:sheetData/m:row", NS):
        cells: dict[str, str] = {}
        for c in row.findall("m:c", NS):
            ref = c.attrib["r"]
            col = re.match(r"[A-Z]+", ref).group(0)
            v = c.find("m:v", NS)
            if v is None or v.text is None:
                continue
            val = v.text
            if c.attrib.get("t") == "s":
                val = ss[int(val)]
            cells[col] = val
        rows.append(cells)
    return rows


def parse_admissions_xlsx(path: Path) -> dict:
    z = zipfile.ZipFile(path)
    ss = load_shared_strings(z)
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
    wb = ET.fromstring(z.read("xl/workbook.xml"))

    as_of = None
    as_of_label = None
    fiscal_year = None
    ceiling = None
    total = None
    by_country: list[dict] = []

    # Prefer the highest-numbered year sheet that looks like current FY.
    year_sheets = []
    for s in wb.findall("m:sheets/m:sheet", NS):
        name = s.attrib.get("name") or ""
        if re.fullmatch(r"20\d{2}", name):
            year_sheets.append((int(name), s))
    year_sheets.sort(reverse=True)

    for year, s in year_sheets:
        rid = s.attrib[f"{REL_NS}id"]
        target = rid_to_target[rid].lstrip("/")
        path_in = "xl/" + target if not target.startswith("xl/") else target
        rows = sheet_rows(z, path_in, ss)
        # Header as-of often on early rows of this sheet or sheet1; also check row text.
        countries = []
        fy_total = None
        fy_ceiling = None
        for row in rows:
            a = (row.get("A") or "").strip()
            b = (row.get("B") or "").strip()
            d = row.get("D")
            c = row.get("C")
            if a.lower().startswith("as of") or b.lower().startswith("as of"):
                as_of_raw = a or b
                m = re.search(
                    r"(\d{1,2})[- ]([A-Za-z]+)[- ](\d{4})", as_of_raw.replace(",", " ")
                )
                if m:
                    day, mon, y = m.group(1), m.group(2), m.group(3)
                    as_of_label = f"{mon[:3]} {y}"
                    try:
                        dt = datetime.strptime(f"{day} {mon} {y}", "%d %B %Y")
                    except ValueError:
                        try:
                            dt = datetime.strptime(f"{day} {mon} {y}", "%d %b %Y")
                        except ValueError:
                            dt = None
                    if dt:
                        as_of = dt.date().isoformat()
            if b == "Grand Totals" or a == "Grand Totals":
                if d is not None and str(d).strip() != "":
                    fy_total = int(float(str(d).replace(",", "")))
                if c is not None and str(c).strip() != "":
                    try:
                        fy_ceiling = int(float(str(c).replace(",", "")))
                    except ValueError:
                        pass
            # Country rows: blank A, country in B, total in D; skip region totals
            if b and not a and d is not None and str(d).strip() != "":
                if b.startswith("Total ") or b == "Grand Totals":
                    continue
                try:
                    n = int(float(str(d).replace(",", "")))
                except ValueError:
                    continue
                countries.append({"name": b, "total": n})
        if fy_total is not None:
            fiscal_year = year
            total = fy_total
            ceiling = fy_ceiling
            by_country = sorted(countries, key=lambda x: (-x["total"], x["name"]))
            break

    # Cumulative sheet often has the as-of stamp
    if as_of is None:
        for s in wb.findall("m:sheets/m:sheet", NS):
            if (s.attrib.get("name") or "") != "Cumulative Summary":
                continue
            rid = s.attrib[f"{REL_NS}id"]
            target = rid_to_target[rid].lstrip("/")
            path_in = "xl/" + target if not target.startswith("xl/") else target
            for row in sheet_rows(z, path_in, ss):
                a = (row.get("A") or "").strip()
                if a.lower().startswith("as of"):
                    m = re.search(
                        r"(\d{1,2})[- ]([A-Za-z]+)[- ](\d{4})", a.replace(",", " ")
                    )
                    if m:
                        day, mon, y = m.group(1), m.group(2), m.group(3)
                        as_of_label = f"{mon[:3]} {y}"
                        try:
                            dt = datetime.strptime(f"{day} {mon} {y}", "%d %B %Y")
                        except ValueError:
                            try:
                                dt = datetime.strptime(f"{day} {mon} {y}", "%d %b %Y")
                            except ValueError:
                                dt = None
                        if dt:
                            as_of = dt.date().isoformat()
                    break

    return {
        "fiscalYear": fiscal_year,
        "asOf": as_of,
        "asOfLabel": as_of_label,
        "ceiling": ceiling,
        "total": total,
        "byCountry": by_country,
    }


def page_lines(page):
    from pypdf import PdfReader  # noqa: F401 — imported by caller

    words = []

    def visitor(text, cm, tm, fontDict, fontSize):
        t = (text or "").strip()
        if t:
            words.append((float(tm[5]), float(tm[4]), t))

    page.extract_text(visitor_text=visitor)
    buckets: dict[int, list] = defaultdict(list)
    for y, x, t in words:
        buckets[round(y)].append((x, t))
    lines = []
    for y in sorted(buckets, reverse=True):
        parts = sorted(buckets[y], key=lambda p: p[0])
        texts = [t for x, t in parts]
        nums = [int(t.replace(",", "")) for t in texts if re.fullmatch(r"[\d,]+", t)]
        lines.append((y, texts, nums))
    return lines


def clean_nat(name: str) -> str | None:
    name = (name or "").strip()
    if not name or name in STATE_SET:
        return None
    if len(name) > 48:
        return None
    if any(
        x in name
        for x in (
            "Data as",
            "Refugee",
            "Fiscal",
            "Based",
            "Doe",
            "Historical",
            "October",
            "Department",
            "Placement",
            "Affiliate",
            "Virtual",
            "reconciliation",
            "State Name",
            "PA Nationality",
            "counted toward",
            "Actual Destination",
        )
    ):
        return None
    if name in (
        "Nov",
        "Dec",
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Grand",
        "Total",
    ):
        return None
    if not re.match(r"^[A-Za-z][A-Za-z .'\-]+$", name):
        return None
    return name


def parse_arrivals_pdf(path: Path) -> dict:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    by_state: dict[str, dict] = {}
    period = None

    for page in reader.pages:
        lines = page_lines(page)
        # Period note sometimes in footer text
        for _y, texts, _nums in lines:
            joined = " ".join(texts)
            m = re.search(
                r"October 1,\s*(\d{4})\s*through\s*([A-Za-z]+ \d{1,2},\s*\d{4})",
                joined,
            )
            if m:
                period = f"October 1, {m.group(1)} through {m.group(2)}"

        sequence = []
        pending: list[str] = []
        for _y, texts, _nums in lines:
            if len(texts) >= 2 and texts[0] in STATE_SET and texts[1] == "Total":
                sequence.append({"state": texts[0], "nats": list(pending)})
                pending = []
                continue
            parts = [t for t in texts if not re.fullmatch(r"[\d,]+", t) and t != "Total"]
            name = clean_nat(" ".join(parts))
            if name:
                pending.append(name)

        pure: list[list[int]] = []
        for _y, texts, nums in lines:
            if nums and texts and all(re.fullmatch(r"[\d,]+", t) for t in texts):
                if pure and pure[-1] == nums:
                    continue
                pure.append(nums)
        if pure and pure[-1] and pure[-1][-1] >= 5000:
            # national grand-total strip on page 0
            pure = pure[:-1]

        idx = 0
        for s in sequence:
            nats = s["nats"]
            if idx >= len(pure):
                break
            if len(nats) >= 2 and idx + len(nats) < len(pure):
                parts = pure[idx : idx + len(nats)]
                maybe_total = pure[idx + len(nats)]
                sm = sum(p[-1] for p in parts)
                if maybe_total[-1] == sm:
                    by_state[s["state"]] = {
                        "total": sm,
                        "byNationality": [
                            {"name": n, "total": p[-1]} for n, p in zip(nats, parts)
                        ],
                    }
                    idx += len(nats) + 1
                    continue
            # default: one number row = state total
            total = pure[idx][-1]
            idx += 1
            by_nat = (
                [{"name": n, "total": total} for n in nats]
                if nats
                else [{"name": "Total", "total": total}]
            )
            # If multiple nats listed but only one number, keep names only when single
            if len(nats) > 1:
                by_nat = [{"name": "Various", "total": total}]
            by_state[s["state"]] = {"total": total, "byNationality": by_nat}

    # Normalize nationality lists: drop placeholder
    for st, row in by_state.items():
        row["byNationality"] = [
            n for n in row["byNationality"] if n["name"] not in ("Total", "Various")
        ]
        row["byNationality"].sort(key=lambda x: (-x["total"], x["name"]))

    total = sum(v["total"] for v in by_state.values())
    return {"total": total, "period": period, "byState": by_state}


def main() -> None:
    admissions_path = RAW / "admissions.xlsx"
    arrivals_path = RAW / "arrivals.pdf"
    if not admissions_path.exists():
        raise SystemExit(f"Missing {admissions_path} — run npm run fetch:wraps first")
    if not arrivals_path.exists():
        raise SystemExit(f"Missing {arrivals_path} — run npm run fetch:wraps first")

    admissions = parse_admissions_xlsx(admissions_path)
    arrivals = parse_arrivals_pdf(arrivals_path)

    as_of = admissions.get("asOf")
    as_of_label = admissions.get("asOfLabel")
    # Prefer arrivals filename date if admissions stamp missing
    if not as_of:
        m = re.search(r"as of ([A-Za-z]+ \d{1,2}, \d{4})", arrivals_path.name)
        if m:
            try:
                dt = datetime.strptime(m.group(1), "%B %d, %Y")
                as_of = dt.date().isoformat()
                as_of_label = dt.strftime("%b %Y")
            except ValueError:
                pass

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "asOf": as_of,
        "asOfLabel": as_of_label,
        "fiscalYear": admissions.get("fiscalYear"),
        "period": arrivals.get("period"),
        "sourceName": "State Department Refugee Processing Center (WRAPS reports)",
        "sourceUrl": "https://www.rpc.state.gov/admissions-and-arrivals/",
        "stateAliases": STATE_ALIASES,
        "admissions": {
            "total": admissions.get("total"),
            "ceiling": admissions.get("ceiling"),
            "byCountry": admissions.get("byCountry") or [],
        },
        "arrivals": {
            "total": arrivals.get("total"),
            "byState": arrivals.get("byState") or {},
        },
        "note": "Monthly RPC snapshot. Historical months can move after reconciliation.",
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    n_states = len(payload["arrivals"]["byState"])
    print(
        f"Wrote {OUT} — FY{payload['fiscalYear']} admissions={payload['admissions']['total']} "
        f"arrivals states={n_states} sum={payload['arrivals']['total']} asOf={payload['asOf']}"
    )


if __name__ == "__main__":
    main()
