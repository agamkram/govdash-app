#!/usr/bin/env node
/**
 * Fetch U.S. resident population from Census Bureau PEP (NST table).
 * American source only — no World Bank.
 *
 * Usage: npm run fetch:population
 *        npm run fetch:population -- --force
 */
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data", "raw", "census");
const OUT_JSON = join(OUT_DIR, "us-population.json");
const XLSX_URL =
  "https://www2.census.gov/programs-surveys/popest/tables/2020-2024/state/totals/NST-EST2024-POP.xlsx";

const force = process.argv.includes("--force");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function runPython(xlsxPath) {
  const code = `
import json, sys, zipfile, xml.etree.ElementTree as ET
from pathlib import Path
p = Path(sys.argv[1])
with zipfile.ZipFile(p) as z:
    shared = []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    for si in root.findall("m:si", ns):
        texts = [t.text or "" for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")]
        shared.append("".join(texts))
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in sheet.findall(".//m:sheetData/m:row", ns):
        vals = []
        for c in row.findall("m:c", ns):
            t = c.get("t")
            v = c.find("m:v", ns)
            if v is None:
                vals.append("")
                continue
            vals.append(shared[int(v.text)] if t == "s" else v.text)
        rows.append(vals)
# Find United States row and year headers
years = None
us = None
for r in rows:
    if len(r) >= 3 and r[0] == "" and r[2] and r[2].isdigit() and len(r[2]) == 4:
        years = [c for c in r[2:] if c and c.isdigit()]
    if r and r[0] == "United States":
        us = r
        break
if not us or not years:
    raise SystemExit("Could not find United States row / year headers in Census NST table")
# cols: Area, 2020 base, then July 1 estimates matching years
vals = us[2 : 2 + len(years)]
pairs = list(zip(years, vals))
year, pop_s = pairs[-1]
pop = int(float(pop_s))
print(json.dumps({"year": year, "pop": pop, "asOf": f"{year}-07-01"}))
`;
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", code, xlsxPath], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`python exited ${code}`));
      else {
        try {
          resolve(JSON.parse(out.trim()));
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  if ((await exists(OUT_JSON)) && !force) {
    console.log("us-population.json exists (pass --force to refresh)");
    return;
  }
  const xlsxPath = join(OUT_DIR, "NST-EST2024-POP.xlsx");
  console.log("Fetching Census NST population table…");
  const res = await fetch(XLSX_URL, {
    headers: { "User-Agent": "GovDash/1 (U.S. Census population)" },
  });
  if (!res.ok) throw new Error(`Census download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(xlsxPath, buf);
  const parsed = await runPython(xlsxPath);
  const payload = {
    pop: parsed.pop,
    asOf: parsed.asOf,
    year: parsed.year,
    source: "U.S. Census Bureau, Population Estimates Program (NST-EST2024)",
    fetchedAt: new Date().toISOString(),
    file: XLSX_URL,
  };
  await writeFile(OUT_JSON, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Wrote ${OUT_JSON} · ${payload.pop.toLocaleString("en-US")} (${payload.asOf})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
