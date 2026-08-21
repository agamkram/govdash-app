#!/usr/bin/env python3
"""
Fetch latest State Department monthly IV + NIV issuance PDFs and bake a snapshot.

  python3 scripts/fetch-visas.py
  python3 scripts/fetch-visas.py --force

Needs: pip install cloudscraper pypdf

Writes:
  data/raw/visas/{niv,iv}-latest.pdf
  data/raw/visas/manifest.json
  data/nested/visas.json

Metric: consular visa *issuances* for one calendar month — NOT arrivals,
NOT entries, NOT an official FYTD (State says do not sum monthly tables).
"""
from __future__ import annotations

import argparse
import calendar
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "visas"
NESTED = ROOT / "data" / "nested" / "visas.json"

NIV_INDEX = (
    "https://travel.state.gov/content/travel/en/legal/visa-law0/"
    "visa-statistics/nonimmigrant-visa-statistics/monthly-nonimmigrant-visa-issuances.html"
)
IV_INDEX = (
    "https://travel.state.gov/content/travel/en/legal/visa-law0/"
    "visa-statistics/immigrant-visa-statistics/monthly-immigrant-visa-issuances.html"
)

MONTH_RE = re.compile(
    r"(January|February|March|April|May|June|July|August|September|"
    r"October|November|December)\s+(20\d{2})",
    re.I,
)
FY_RE = re.compile(r"FY\s*(20\d{2})", re.I)
GRAND_RE = re.compile(r"GRAND\s+TOTAL\s+([\d,]+)", re.I)
# "Afghanistan B1/B2 1,525" or spaced IV rows
ROW_RE = re.compile(
    r"^(.+?)\s+([A-Z][A-Z0-9/]{0,10})\s+([\d,]+)\s*$"
)


def scraper():
    try:
        import cloudscraper
    except ImportError:
        print("Need cloudscraper: pip install cloudscraper", file=sys.stderr)
        sys.exit(1)
    return cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "darwin", "mobile": False}
    )


def month_urls(kind: str, year: int, month: int) -> list[str]:
    name = calendar.month_name[month].upper()
    ys = str(year)
    if kind == "niv":
        base = (
            "https://travel.state.gov/content/dam/visas/Statistics/"
            "Non-Immigrant-Statistics/MonthlyNIVIssuances/"
        )
        titles = [
            f"{name} {ys} - NIV Issuances by Nationality and Visa Class.pdf",
            f"{name} {ys}  - NIV Issuances by Nationality and Visa Class.pdf",
        ]
    else:
        base = (
            "https://travel.state.gov/content/dam/visas/Statistics/"
            "Immigrant-Statistics/MonthlyIVIssuances/"
        )
        titles = [
            f"{name} {ys} - IV Issuances by FSC or Place of Birth and Visa Class.pdf",
            f"{name} {ys}  - IV Issuances by FSC or Place of Birth and Visa Class.pdf",
            f"{name} {ys} - IV Issuances by Post and Visa Class.pdf",
            f"{name} {ys}  - IV Issuances by Post and Visa Class.pdf",
        ]
    return [base + quote(t, safe="") for t in titles]


def find_latest(s, kind: str, max_months: int = 24):
    y, m = date.today().year, date.today().month
    for _ in range(max_months):
        for url in month_urls(kind, y, m):
            r = s.get(url, timeout=60)
            ct = (r.headers.get("content-type") or "").lower()
            if (
                r.status_code == 200
                and "pdf" in ct
                and len(r.content) > 10_000
            ):
                return {
                    "year": y,
                    "month": m,
                    "url": url,
                    "bytes": r.content,
                }
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return None


def extract_text(pdf_path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    parts = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n".join(parts)


def parse_pdf(text: str, kind: str) -> dict:
    month_hit = MONTH_RE.search(text)
    fy_hit = FY_RE.search(text)
    grand_hit = GRAND_RE.search(text)
    if not grand_hit:
        raise ValueError(f"No GRAND TOTAL in {kind} PDF")

    total = int(grand_hit.group(1).replace(",", ""))
    by_nat: dict[str, int] = defaultdict(int)
    by_class: dict[str, int] = defaultdict(int)

    skip_prefixes = (
        "nationality",
        "foreign state",
        "or place of birth",
        "visa class",
        "issuances",
        "nonimmigrant",
        "immigrant",
        "page ",
        "grand total",
        "*\"non-nationality",
        "*non-nationality",
    )

    for raw in text.splitlines():
        line = " ".join(raw.split())
        if not line:
            continue
        low = line.lower()
        if any(low.startswith(p) for p in skip_prefixes):
            continue
        if "page " in low and " of " in low:
            continue
        m = ROW_RE.match(line)
        if not m:
            continue
        nat, klass, n = m.group(1).strip(), m.group(2).strip(), m.group(3)
        if nat.lower() in ("nationality", "post", "visa"):
            continue
        # Filter junk class tokens
        if not re.match(r"^[A-Z]", klass):
            continue
        count = int(n.replace(",", ""))
        if count <= 0:
            continue
        by_nat[nat] += count
        by_class[klass] += count

    def top(d: dict[str, int], n: int = 20):
        return [
            {"name": k, "total": v}
            for k, v in sorted(d.items(), key=lambda kv: (-kv[1], kv[0]))[:n]
        ]

    year = int(month_hit.group(2)) if month_hit else None
    month_name = month_hit.group(1).title() if month_hit else None
    month_num = None
    if month_name:
        month_num = list(calendar.month_name).index(month_name)

    fiscal_year = int(fy_hit.group(1)) if fy_hit else None
    if fiscal_year is None and year and month_num:
        # FY starts October
        fiscal_year = year + 1 if month_num >= 10 else year

    as_of_label = f"{month_name[:3]} {year}" if month_name and year else "—"

    return {
        "kind": kind,
        "asOfLabel": as_of_label,
        "year": year,
        "month": month_num,
        "monthName": month_name,
        "fiscalYear": fiscal_year,
        "total": total,
        "byClass": top(by_class, 25),
        "byNationality": top(by_nat, 25),
        "parsedNationalities": len(by_nat),
        "parsedClasses": len(by_class),
        "rowSum": sum(by_nat.values()),
    }


def build_series(kind: str, parsed: dict, pdf_url: str) -> dict:
    label = "Nonimmigrant" if kind == "niv" else "Immigrant"
    index = NIV_INDEX if kind == "niv" else IV_INDEX
    note = (
        f"{label} visa issuances for one calendar month (State Department Visa Office). "
        "Preliminary. Do not add months together for an FY total — State says monthly "
        "tables are not an official year-to-date. Annual totals are in the Report of the Visa Office."
    )
    out = {
        **parsed,
        "sourceName": f"State Department monthly {label} visa issuances",
        "sourceUrl": index,
        "pdfUrl": pdf_url,
        "note": note,
    }
    # Drop internal parse helpers from nested if desired — keep rowSum for honesty
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    manifest_path = RAW / "manifest.json"

    if not args.force and NESTED.exists() and manifest_path.exists():
        age = datetime.now(timezone.utc).timestamp() - NESTED.stat().st_mtime
        if age < 12 * 3600:
            print("visas.json is fresh (<12h). Use --force to refetch.")
            return

    print("Finding latest NIV + IV monthly PDFs (Cloudflare-aware)…")
    s = scraper()

    niv_hit = find_latest(s, "niv")
    iv_hit = find_latest(s, "iv")
    if not niv_hit or not iv_hit:
        missing = []
        if not niv_hit:
            missing.append("NIV")
        if not iv_hit:
            missing.append("IV")
        raise SystemExit(f"Could not find latest PDF for: {', '.join(missing)}")

    niv_pdf = RAW / "niv-latest.pdf"
    iv_pdf = RAW / "iv-latest.pdf"
    niv_pdf.write_bytes(niv_hit["bytes"])
    iv_pdf.write_bytes(iv_hit["bytes"])
    print(
        f"NIV {calendar.month_abbr[niv_hit['month']]} {niv_hit['year']} · "
        f"{len(niv_hit['bytes']):,} bytes"
    )
    print(
        f"IV  {calendar.month_abbr[iv_hit['month']]} {iv_hit['year']} · "
        f"{len(iv_hit['bytes']):,} bytes"
    )

    niv_parsed = parse_pdf(extract_text(niv_pdf), "niv")
    iv_parsed = parse_pdf(extract_text(iv_pdf), "iv")

    # Prefer calendar stamp from probe if PDF text is thin
    if not niv_parsed.get("year"):
        niv_parsed["year"] = niv_hit["year"]
        niv_parsed["month"] = niv_hit["month"]
        niv_parsed["monthName"] = calendar.month_name[niv_hit["month"]]
        niv_parsed["asOfLabel"] = (
            f"{calendar.month_abbr[niv_hit['month']]} {niv_hit['year']}"
        )
    if not iv_parsed.get("year"):
        iv_parsed["year"] = iv_hit["year"]
        iv_parsed["month"] = iv_hit["month"]
        iv_parsed["monthName"] = calendar.month_name[iv_hit["month"]]
        iv_parsed["asOfLabel"] = (
            f"{calendar.month_abbr[iv_hit['month']]} {iv_hit['year']}"
        )

    niv = build_series("niv", niv_parsed, niv_hit["url"])
    iv = build_series("iv", iv_parsed, iv_hit["url"])

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "niv": niv,
        "iv": iv,
        "note": (
            "Latest published month for each series. Issuances, not arrivals or "
            "encounters. Not an FYTD — State forbids summing monthly tables."
        ),
    }
    NESTED.parent.mkdir(parents=True, exist_ok=True)
    NESTED.write_text(json.dumps(payload, indent=2) + "\n")

    manifest = {
        "fetchedAt": payload["generatedAt"],
        "nivUrl": niv_hit["url"],
        "ivUrl": iv_hit["url"],
        "nivAsOf": niv["asOfLabel"],
        "ivAsOf": iv["asOfLabel"],
        "nivTotal": niv["total"],
        "ivTotal": iv["total"],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    print(
        f"Wrote {NESTED.relative_to(ROOT)} · NIV {niv['asOfLabel']}={niv['total']:,} · "
        f"IV {iv['asOfLabel']}={iv['total']:,}"
    )


if __name__ == "__main__":
    main()
