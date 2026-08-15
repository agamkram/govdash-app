#!/usr/bin/env node
/**
 * Cache multi-year USAspending series for the FY scrub.
 *
 * - Toptier: /agency/{code}/budgetary_resources/ (all years in one call)
 * - Subtier: /agency/{code}/sub_agency/?fiscal_year=Y for years that need it
 *
 * Years: FY2018–FY2026 (DATA Act quality is thin before FY2018).
 *
 * Usage:
 *   npm run fetch:spend-history
 *   npm run fetch:spend-history -- --force
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw", "heat");
const TOPTIER = join(OUT, "usaspending-toptier.json");
const PRODUCT = join(ROOT, "data", "nested", "gov-tree-product.json");
const BEYOND = join(ROOT, "data", "nested", "gov-tree-beyond.json");
const DEST = join(OUT, "usaspending-history.json");

const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const CONCURRENCY = 5;

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

function walk(node, out = []) {
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

async function codesFromTreeAsync(path) {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    const root = raw.tree || raw;
    const top = new Set();
    const sub = new Set();
    for (const n of walk(root)) {
      if (!n.spending || n.spending.rolledUp) continue;
      const code = String(n.spending.toptierCode || "").trim();
      if (!code) continue;
      if (n.spending.grain === "toptier") top.add(code);
      if (n.spending.grain === "subtier") sub.add(code);
    }
    return { top, sub };
  } catch (err) {
    if (err.code === "ENOENT") return { top: new Set(), sub: new Set() };
    throw err;
  }
}

async function fetchSubAgencyYear(code, fy) {
  const results = [];
  let page = 1;
  let fiscalYear = fy;
  for (;;) {
    const url =
      `https://api.usaspending.gov/api/v2/agency/${encodeURIComponent(code)}/sub_agency/` +
      `?fiscal_year=${fy}&limit=100&page=${page}`;
    const json = await fetchJson(url);
    fiscalYear = json.fiscal_year || fiscalYear;
    results.push(...(json.results || []));
    const meta = json.page_metadata || {};
    if (!meta.hasNext) break;
    page = meta.next || page + 1;
    if (page > 20) break;
  }
  return {
    fiscalYear,
    results: results.map((r) => ({
      name: r.name || null,
      abbreviation: r.abbreviation || null,
      total_obligations: r.total_obligations ?? null,
    })),
  };
}

async function mapPool(items, limit, fn) {
  let i = 0;
  const out = new Array(items.length);
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });

  if (!opts.force && (await exists(DEST))) {
    console.log("Cache hit:", DEST, "(use --force to refresh)");
    return;
  }

  const topPayload = JSON.parse(await readFile(TOPTIER, "utf8"));
  const listCodes = [
    ...new Set(
      (topPayload.results || [])
        .map((a) => String(a.toptier_code || "").trim())
        .filter(Boolean)
    ),
  ];

  const product = await codesFromTreeAsync(PRODUCT);
  const beyond = await codesFromTreeAsync(BEYOND);
  const subtierCodes = new Set([...product.sub, ...beyond.sub]);

  // Prefer tree-matched toptiers when present; fall back to full list.
  const codesForBudget =
    product.top.size || beyond.top.size
      ? [...new Set([...product.top, ...beyond.top])]
      : listCodes;

  console.log(
    `Budgetary resources for ${codesForBudget.length} toptier codes; sub-agency history for ${subtierCodes.size} codes × ${YEARS.length} years…`
  );

  const toptierByCode = {};
  let topOk = 0;
  let topFail = 0;
  await mapPool(codesForBudget, CONCURRENCY, async (code) => {
    try {
      const json = await fetchJson(
        `https://api.usaspending.gov/api/v2/agency/${encodeURIComponent(code)}/budgetary_resources/`
      );
      const byYear = {};
      for (const row of json.agency_data_by_year || []) {
        const fy = Number(row.fiscal_year);
        if (!YEARS.includes(fy)) continue;
        byYear[fy] = {
          obligated: row.agency_total_obligated ?? null,
          outlay: row.agency_total_outlayed ?? null,
          budgetaryResources: row.agency_budgetary_resources ?? null,
        };
      }
      toptierByCode[code] = { byYear };
      topOk++;
      process.stdout.write(".");
    } catch (err) {
      topFail++;
      toptierByCode[code] = {
        byYear: {},
        error: String(err.message || err),
      };
      process.stdout.write("x");
    }
  });
  process.stdout.write("\n");

  const subtierByCode = {};
  let subOk = 0;
  let subFail = 0;
  const subJobs = [];
  for (const code of subtierCodes) {
    for (const fy of YEARS) subJobs.push({ code, fy });
  }

  await mapPool(subJobs, CONCURRENCY, async ({ code, fy }) => {
    if (!subtierByCode[code]) subtierByCode[code] = { byYear: {} };
    try {
      subtierByCode[code].byYear[fy] = await fetchSubAgencyYear(code, fy);
      subOk++;
      process.stdout.write(".");
    } catch (err) {
      subFail++;
      subtierByCode[code].byYear[fy] = {
        fiscalYear: fy,
        results: [],
        error: String(err.message || err),
      };
      process.stdout.write("x");
    }
  });
  process.stdout.write("\n");

  // Active FY/Q labels from the current toptier list (for partial current year).
  const active = {};
  for (const a of topPayload.results || []) {
    const code = String(a.toptier_code || "").trim();
    if (!code) continue;
    active[code] = {
      activeFy: a.active_fy != null ? Number(a.active_fy) : null,
      activeFq: a.active_fq != null ? Number(a.active_fq) : null,
      agencySlug: a.agency_slug || null,
      agencyName: a.agency_name || null,
      abbreviation: a.abbreviation || null,
    };
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    source: {
      toptier:
        "https://api.usaspending.gov/api/v2/agency/{code}/budgetary_resources/",
      subtier:
        "https://api.usaspending.gov/api/v2/agency/{code}/sub_agency/?fiscal_year=",
    },
    years: YEARS,
    note: "Yearly overlays for the map scrub. Structure stays the shipped Crosswalk tree; dollars only change. FY2018+ (DATA Act).",
    active,
    toptierByCode,
    subtierByCode,
    stats: {
      toptierOk: topOk,
      toptierFail: topFail,
      subtierCallsOk: subOk,
      subtierCallsFail: subFail,
      subtierCodes: subtierCodes.size,
    },
  };

  await writeFile(DEST, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${DEST} · toptier ${topOk} ok / ${topFail} fail · subtier calls ${subOk} ok / ${subFail} fail`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
