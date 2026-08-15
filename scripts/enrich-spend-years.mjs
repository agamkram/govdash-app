#!/usr/bin/env node
/**
 * Build data/nested/spend-by-year.json — compact yearly $ overlay keyed by
 * the same node ids already matched on the product/beyond trees.
 *
 * Structure (boxes) stay put. Only obligated/outlay amounts change by FY.
 *
 * Usage: npm run enrich:spend-years
 * Requires: npm run enrich:spending (matched trees) + fetch:spend-history
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HISTORY = join(ROOT, "data", "raw", "heat", "usaspending-history.json");
const PRODUCT = join(ROOT, "data", "nested", "gov-tree-product.json");
const BEYOND = join(ROOT, "data", "nested", "gov-tree-beyond.json");
const DEST = join(ROOT, "data", "nested", "spend-by-year.json");

const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

function walk(node, out = []) {
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

function norm(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bU\.?S\.?\b/g, " ")
    .replace(/\bUNITED STATES\b/g, " ")
    .replace(/\bTHE\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return new Set(norm(s).split(" ").filter((t) => t.length > 1));
}

function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function findSubRow(rows, name, abbreviation) {
  if (!rows?.length) return null;
  const want = norm(name);
  const wantAbbr = norm(abbreviation);
  let best = null;
  for (const row of rows) {
    if (!row?.name) continue;
    const rn = norm(row.name);
    if (want && rn === want) return row;
    if (wantAbbr && norm(row.abbreviation) === wantAbbr && wantAbbr.length >= 2) {
      if (jaccard(row.name, name) >= 0.4 || rn.includes(want) || want.includes(rn)) {
        return row;
      }
    }
    const j = Math.max(
      jaccard(row.name, name),
      abbreviation && row.abbreviation
        ? jaccard(row.abbreviation, abbreviation)
        : 0
    );
    if (!best || j > best.j) best = { row, j };
  }
  if (best && best.j >= 0.78) return best.row;
  return null;
}

function asOfLabel(fy, activeMeta) {
  const y = Number(fy);
  const short = String(y).slice(-2); // FY26 not FY2026
  if (
    activeMeta?.activeFy === y &&
    activeMeta?.activeFq != null &&
    Number(activeMeta.activeFq) < 4
  ) {
    return `FY${short} Q${activeMeta.activeFq}`;
  }
  return `FY${short}`;
}

async function loadTreeNodes(path) {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return walk(raw.tree || raw);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function main() {
  const history = JSON.parse(await readFile(HISTORY, "utf8"));
  const years = history.years || YEARS;
  const toptierByCode = history.toptierByCode || {};
  const subtierByCode = history.subtierByCode || {};
  const active = history.active || {};

  const nodes = [
    ...(await loadTreeNodes(PRODUCT)),
    ...(await loadTreeNodes(BEYOND)),
  ];

  const outNodes = {};
  let toptierN = 0;
  let subtierN = 0;
  let yearHits = 0;

  for (const n of nodes) {
    if (!n?.id || !n.spending || n.spending.rolledUp) continue;
    const grain = n.spending.grain;
    if (grain !== "toptier" && grain !== "subtier") continue;

    const code = String(n.spending.toptierCode || "").trim();
    if (!code) continue;

    const entry = {
      grain,
      toptierCode: code,
      agencySlug: n.spending.agencySlug || null,
      agencyName: n.spending.agencyName || null,
      abbreviation: n.spending.abbreviation || null,
      matchedHow: n.spending.matchedHow || null,
      y: {},
    };

    if (grain === "toptier") {
      const series = toptierByCode[code]?.byYear || {};
      for (const fy of years) {
        const row = series[fy] || series[String(fy)];
        if (!row) continue;
        if (row.obligated == null && row.outlay == null) continue;
        entry.y[fy] = {
          o: row.obligated ?? null,
          u: row.outlay ?? null,
        };
        yearHits++;
      }
      if (Object.keys(entry.y).length) {
        outNodes[n.id] = entry;
        toptierN++;
      }
      continue;
    }

    // subtier — match by name within parent code for each year
    const name = n.spending.agencyName || n.name;
    const abbr = n.spending.abbreviation || n.short;
    const pack = subtierByCode[code]?.byYear || {};
    for (const fy of years) {
      const yearPack = pack[fy] || pack[String(fy)];
      const rows = yearPack?.results || [];
      const hit = findSubRow(rows, name, abbr);
      if (!hit || hit.total_obligations == null) continue;
      entry.y[fy] = { o: hit.total_obligations, u: null };
      yearHits++;
    }
    if (Object.keys(entry.y).length) {
      outNodes[n.id] = entry;
      subtierN++;
    }
  }

  // Default year = max year present, prefer active FY from any agency.
  let defaultYear = years[years.length - 1];
  for (const meta of Object.values(active)) {
    if (meta?.activeFy && years.includes(Number(meta.activeFy))) {
      defaultYear = Number(meta.activeFy);
      break;
    }
  }

  // One asOf string per year (use first active_fq if current incomplete year).
  let sampleActive = null;
  for (const meta of Object.values(active)) {
    if (meta?.activeFy === defaultYear && meta.activeFq != null) {
      sampleActive = meta;
      break;
    }
  }
  const asOf = {};
  for (const fy of years) {
    asOf[fy] = asOfLabel(fy, sampleActive);
  }

  const payload = {
    meta: {
      years,
      defaultYear,
      asOf,
      source: "USAspending.gov (budgetary_resources + sub_agency)",
      historyFetchedAt: history.fetchedAt || null,
      builtAt: new Date().toISOString(),
      toptierNodes: toptierN,
      subtierNodes: subtierN,
      yearHits,
      note: "Same 2026 Crosswalk boxes. Dollars only — mission, OPM, and edges do not move. Blank year = no honest match for that FY.",
    },
    nodes: outNodes,
  };

  await writeFile(DEST, JSON.stringify(payload) + "\n");
  console.log(
    `spend-by-year.json · ${toptierN} toptier · ${subtierN} subtier · ${yearHits} year-cells · default FY${defaultYear}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
