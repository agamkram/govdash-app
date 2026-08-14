#!/usr/bin/env node
/**
 * Cache USAspending sub-agency (subtier) rows for each toptier code.
 *
 * Usage: npm run fetch:subtier
 *        npm run fetch:subtier -- --force
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw", "heat");
const TOPTIER = join(OUT, "usaspending-toptier.json");
const DEST = join(OUT, "usaspending-subtier.json");

function parseArgs(argv) {
  return { force: argv.includes("--force") };
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "GovDash/1" },
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function fetchAllPages(code, fy) {
  const results = [];
  let page = 1;
  let fiscalYear = fy;
  let toptierCode = code;
  for (;;) {
    const url =
      `https://api.usaspending.gov/api/v2/agency/${encodeURIComponent(code)}/sub_agency/` +
      `?fiscal_year=${fy}&limit=100&page=${page}`;
    const json = await fetchJson(url);
    fiscalYear = json.fiscal_year || fiscalYear;
    toptierCode = json.toptier_code || toptierCode;
    results.push(...(json.results || []));
    const meta = json.page_metadata || {};
    if (!meta.hasNext) break;
    page = meta.next || page + 1;
    if (page > 20) break;
  }
  return { toptierCode, fiscalYear, results };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });
  if (!opts.force && (await exists(DEST))) {
    console.log("Cache hit:", DEST);
    return;
  }

  const top = JSON.parse(await readFile(TOPTIER, "utf8"));
  const agencies = top.results || [];
  const codes = [
    ...new Set(
      agencies
        .map((a) => String(a.toptier_code || "").trim())
        .filter(Boolean)
    ),
  ];

  const fyByCode = new Map();
  for (const a of agencies) {
    if (a.toptier_code && a.active_fy) fyByCode.set(String(a.toptier_code), a.active_fy);
  }

  console.log(`Fetching sub-agency rows for ${codes.length} toptier codes…`);
  const byCode = {};
  let ok = 0;
  let fail = 0;
  const concurrency = 4;
  let i = 0;

  async function worker() {
    while (i < codes.length) {
      const idx = i++;
      const code = codes[idx];
      const fy = fyByCode.get(code) || "2026";
      try {
        byCode[code] = await fetchAllPages(code, fy);
        ok++;
        process.stdout.write(".");
      } catch (err) {
        fail++;
        byCode[code] = { toptierCode: code, fiscalYear: fy, results: [], error: String(err.message || err) };
        process.stdout.write("x");
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  process.stdout.write("\n");

  const payload = {
    fetchedAt: new Date().toISOString(),
    source: "https://api.usaspending.gov/api/v2/agency/{toptier_code}/sub_agency/",
    toptierSource: TOPTIER,
    count: codes.length,
    ok,
    fail,
    agencies: byCode,
  };
  await writeFile(DEST, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Wrote ${DEST} · ok ${ok} · fail ${fail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
