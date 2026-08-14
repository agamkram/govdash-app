#!/usr/bin/env node
/**
 * Attach USAspending dollars onto tree nodes as node.spending
 * (first-class field — not heat).
 *
 * 1. Toptier (~Cabinet / independent) via honest name match.
 * 2. Sub-agency rows under a matched toptier, onto descendant boxes
 *    (CBP, FEMA, IRS, Army, …). Parent keeps its own toptier total.
 *
 * Usage: npm run enrich:spending
 * Run after `npm run curate`. Fetch subtier cache first when possible.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bestMatch } from "./lib/spend-match.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEND = join(ROOT, "data", "raw", "heat", "usaspending-toptier.json");
const SUBTIER = join(ROOT, "data", "raw", "heat", "usaspending-subtier.json");
const FULL = join(ROOT, "data", "nested", "gov-tree.json");
const FULL_COPY = join(ROOT, "data", "nested", "gov-tree-full.json");
const PRODUCT = join(ROOT, "data", "nested", "gov-tree-product.json");
const BEYOND = join(ROOT, "data", "nested", "gov-tree-beyond.json");

function walk(node, out = []) {
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

function spendingRecord(agency, matchedHow, { rolledUp = false, grain = "toptier" } = {}) {
  const fy = agency.active_fy ?? agency.fiscalYear ?? null;
  const fq = agency.active_fq ?? agency.fiscalQuarter ?? null;
  const obligated =
    agency.obligated_amount ?? agency.total_obligations ?? agency.obligatedAmount ?? null;
  const outlay = agency.outlay_amount ?? agency.outlayAmount ?? null;
  const authority = agency.budget_authority_amount ?? agency.budgetAuthorityAmount ?? null;
  return {
    obligatedAmount: obligated,
    outlayAmount: outlay,
    budgetAuthorityAmount: authority,
    fiscalYear: fy,
    fiscalQuarter: fq,
    asOf: fy && fq ? `FY${fy} Q${fq}` : fy ? `FY${fy}` : null,
    source:
      grain === "subtier"
        ? "USAspending.gov (sub-agency)"
        : "USAspending.gov (toptier agencies)",
    grain,
    agencyName: agency.agency_name || agency.name || null,
    agencySlug: agency.agency_slug || agency.agencySlug || null,
    toptierCode: agency.toptier_code || agency.toptierCode || null,
    abbreviation: agency.abbreviation || null,
    matchedHow,
    rolledUp,
  };
}

function clearSpending(node) {
  delete node.spending;
  for (const c of node.children || []) clearSpending(c);
}

function rollUp(node) {
  for (const c of node.children || []) rollUp(c);
  if (node.spending && !node.spending.rolledUp) {
    return {
      obligated: node.spending.obligatedAmount || 0,
      outlay: node.spending.outlayAmount || 0,
      authority: node.spending.budgetAuthorityAmount || 0,
      asOf: node.spending.asOf,
    };
  }

  let obligated = 0;
  let outlay = 0;
  let authority = 0;
  let any = false;
  let asOf = null;
  for (const c of node.children || []) {
    if (c.spending?.obligatedAmount == null && c.spending?.outlayAmount == null) {
      continue;
    }
    any = true;
    obligated += c.spending.obligatedAmount || 0;
    outlay += c.spending.outlayAmount || 0;
    authority += c.spending.budgetAuthorityAmount || 0;
    asOf = asOf || c.spending.asOf;
  }
  if (!any) return null;

  node.spending = {
    obligatedAmount: obligated,
    outlayAmount: outlay,
    budgetAuthorityAmount: authority,
    fiscalYear: null,
    fiscalQuarter: null,
    asOf,
    source: "USAspending.gov (toptier agencies)",
    grain: "rollup",
    agencyName: null,
    agencySlug: null,
    toptierCode: null,
    abbreviation: null,
    matchedHow: "sum-children",
    rolledUp: true,
  };
  return { obligated, outlay, authority, asOf };
}

function applyToptier(root, agencies, usedSlugs) {
  const nodes = walk(root);
  const usedNodeIds = new Set();
  let matched = 0;

  const sorted = [...agencies].sort(
    (a, b) => (b.obligated_amount || 0) - (a.obligated_amount || 0)
  );

  for (const agency of sorted) {
    if (!agency?.agency_name) continue;
    const hit = bestMatch(agency, nodes, { usedNodeIds, usedSlugs });
    if (!hit) continue;
    hit.node.spending = spendingRecord(agency, hit.how, { grain: "toptier" });
    usedNodeIds.add(hit.node.id);
    if (agency.agency_slug) usedSlugs.add(String(agency.agency_slug).toLowerCase());
    matched++;
  }
  return matched;
}

function applySubtier(root, subtierByCode) {
  if (!subtierByCode) return { matched: 0, tried: 0 };
  let matched = 0;
  let tried = 0;
  const parents = walk(root).filter(
    (n) => n.spending && !n.spending.rolledUp && n.spending.grain === "toptier"
  );

  for (const parent of parents) {
    const code = String(parent.spending.toptierCode || "").trim();
    if (!code) continue;
    const pack = subtierByCode[code];
    const rows = pack?.results || [];
    if (!rows.length) continue;

    const descendants = walk(parent).filter((n) => n !== parent);
    const usedNodeIds = new Set(
      descendants.filter((n) => n.spending && !n.spending.rolledUp).map((n) => n.id)
    );

    const fy = pack.fiscalYear || parent.spending.fiscalYear;
    const sorted = [...rows].sort(
      (a, b) => (b.total_obligations || 0) - (a.total_obligations || 0)
    );

    for (const row of sorted) {
      if (!row?.name) continue;
      tried++;
      const agency = {
        name: row.name,
        agency_name: row.name,
        abbreviation: row.abbreviation || "",
        agency_slug: parent.spending.agencySlug,
        toptier_code: code,
        fiscalYear: fy,
        total_obligations: row.total_obligations,
      };
      const hit = bestMatch(agency, descendants, { usedNodeIds, minJ: 0.78 });
      if (!hit) continue;
      if (hit.node.spending && !hit.node.spending.rolledUp) continue;
      hit.node.spending = spendingRecord(agency, hit.how, { grain: "subtier" });
      usedNodeIds.add(hit.node.id);
      matched++;
    }
  }
  return { matched, tried };
}

async function loadSubtier() {
  try {
    const raw = JSON.parse(await readFile(SUBTIER, "utf8"));
    return raw.agencies || {};
  } catch (err) {
    if (err.code === "ENOENT") {
      console.warn("No subtier cache — run npm run fetch:subtier for bureau boxes");
      return null;
    }
    throw err;
  }
}

async function enrichTree(path, agencies, fetchedAt, subtierByCode, usedSlugs) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const root = raw.tree || raw;
  clearSpending(root);
  const matchedDirect = applyToptier(root, agencies, usedSlugs);
  const sub = applySubtier(root, subtierByCode);
  rollUp(root);

  let withSpend = 0;
  let toptier = 0;
  let subtier = 0;
  let rollup = 0;
  for (const n of walk(root)) {
    if (n.spending?.obligatedAmount == null && n.spending?.outlayAmount == null) continue;
    withSpend++;
    if (n.spending.rolledUp) rollup++;
    else if (n.spending.grain === "subtier") subtier++;
    else toptier++;
  }

  if (raw.meta) {
    raw.meta.spending = {
      source: "USAspending.gov toptier + sub-agency",
      fetchedAt: fetchedAt || null,
      matchedDirect,
      matchedSubtier: sub.matched,
      nodesWithSpending: withSpend,
      toptier,
      subtier,
      rollup,
      enrichedAt: new Date().toISOString(),
      note: "Toptier on Cabinet / independent. Subtier on descendants when the name matches. Honest blanks otherwise. Parents keep their own toptier total.",
    };
  }

  await writeFile(path, JSON.stringify(raw, null, 2) + "\n");
  console.log(
    `${path.split("/").slice(-1)[0]} · toptier ${matchedDirect} · subtier ${sub.matched} · ${withSpend} nodes with spending`
  );
}

async function main() {
  const payload = JSON.parse(await readFile(SPEND, "utf8"));
  const agencies = payload.results || [];
  if (!agencies.length) {
    throw new Error(`No agencies in ${SPEND} — run npm run fetch:heat`);
  }
  const subtierByCode = await loadSubtier();

  // Archive trees get their own slug set. Map trees share one so a Cabinet
  // cannot sit on product and again on Beyond.
  for (const path of [FULL, FULL_COPY]) {
    try {
      await enrichTree(path, agencies, payload.fetchedAt, subtierByCode, new Set());
    } catch (err) {
      if (err.code === "ENOENT") console.warn(`skip missing ${path}`);
      else throw err;
    }
  }

  const mapSlugs = new Set();
  for (const path of [PRODUCT, BEYOND]) {
    try {
      await enrichTree(path, agencies, payload.fetchedAt, subtierByCode, mapSlugs);
    } catch (err) {
      if (err.code === "ENOENT") console.warn(`skip missing ${path}`);
      else throw err;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
