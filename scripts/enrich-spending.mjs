#!/usr/bin/env node
/**
 * Attach USASpending toptier dollars onto tree nodes as node.spending
 * (first-class field — not heat).
 *
 * Usage: npm run enrich:spending
 *
 * Prefers departments / independents / agencies. Parents without a direct
 * match get a sum roll-up of matched children (same honesty pattern as OPM).
 * Run after `npm run curate` so product doors get roll-ups too.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEND = join(ROOT, "data", "raw", "heat", "usaspending-toptier.json");
const FULL = join(ROOT, "data", "nested", "gov-tree.json");
const FULL_COPY = join(ROOT, "data", "nested", "gov-tree-full.json");
const PRODUCT = join(ROOT, "data", "nested", "gov-tree-product.json");
const BEYOND = join(ROOT, "data", "nested", "gov-tree-beyond.json");

function norm(s) {
  let t = String(s || "").toUpperCase();
  t = t.replace(
    /^(.+?),\s*(DEPARTMENT|DEPT|AGENCY)\s+OF\s*$/i,
    (_, name, kind) => `${kind} OF ${name}`
  );
  return t
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bU\.?S\.?\b/g, " ")
    .replace(/\bUNITED STATES\b/g, " ")
    .replace(/\bDEPARTMENT OF THE\b/g, " DEPT ")
    .replace(/\bDEPARTMENT OF\b/g, " DEPT ")
    .replace(/\bDEPT(?:ARTMENT)? OF THE\b/g, " DEPT ")
    .replace(/\bDEPT(?:ARTMENT)? OF\b/g, " DEPT ")
    .replace(/\bNATIONAL AERONAUTICS AND SPACE ADMINISTRATION\b/g, " NASA ")
    .replace(/\bENVIRONMENTAL PROTECTION AGENCY\b/g, " EPA ")
    .replace(/\bSOCIAL SECURITY ADMINISTRATION\b/g, " SSA ")
    .replace(/\bGENERAL SERVICES ADMINISTRATION\b/g, " GSA ")
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

function walk(node, out = []) {
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

function scoreNode(n) {
  let s = 0;
  if (n.kind === "department") s += 50;
  if (n.kind === "independent") s += 40;
  if (n.kind === "agency") s += 30;
  if (n.kind === "branch") s += 10;
  if (n.kind === "bureau") s += 15;
  if (n.short) s += 5;
  return s;
}

function bestMatch(agency, nodes, used, minJ = 0.72) {
  const names = [agency.agency_name, agency.abbreviation].filter(Boolean);

  for (const label of names) {
    const exact = nodes.filter(
      (n) =>
        !used.has(n.id) &&
        (norm(n.name) === norm(label) ||
          (n.short && norm(n.short) === norm(label)))
    );
    if (exact.length) {
      exact.sort((a, b) => scoreNode(b) - scoreNode(a));
      return { node: exact[0], how: "name", j: 1 };
    }
  }

  const scored = nodes
    .filter((n) => !used.has(n.id))
    .map((n) => {
      let j = 0;
      for (const label of names) {
        j = Math.max(
          j,
          jaccard(label, n.name),
          n.short ? jaccard(label, n.short) : 0
        );
        const o = norm(label);
        const nm = norm(n.name);
        if (o && nm && (nm.includes(o) || o.includes(nm))) {
          const shorter = Math.min(o.length, nm.length);
          const longer = Math.max(o.length, nm.length);
          j = Math.max(j, 0.82 + 0.1 * (shorter / longer));
        }
      }
      return { n, j };
    })
    .filter((x) => x.j >= minJ)
    .sort((a, b) => b.j - a.j || scoreNode(b.n) - scoreNode(a.n));

  if (!scored.length) return null;
  return {
    node: scored[0].n,
    how: scored[0].j >= 0.99 ? "name" : `jaccard-${scored[0].j.toFixed(2)}`,
    j: scored[0].j,
  };
}

function spendingRecord(agency, matchedHow, rolledUp = false) {
  const fy = agency.active_fy || null;
  const fq = agency.active_fq || null;
  return {
    obligatedAmount: agency.obligated_amount ?? null,
    outlayAmount: agency.outlay_amount ?? null,
    budgetAuthorityAmount: agency.budget_authority_amount ?? null,
    fiscalYear: fy,
    fiscalQuarter: fq,
    asOf: fy && fq ? `FY${fy} Q${fq}` : fy ? `FY${fy}` : null,
    source: "USAspending.gov (toptier agencies)",
    agencyName: agency.agency_name || null,
    agencySlug: agency.agency_slug || null,
    toptierCode: agency.toptier_code || null,
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
    agencyName: null,
    agencySlug: null,
    toptierCode: null,
    abbreviation: null,
    matchedHow: "sum-children",
    rolledUp: true,
  };
  return { obligated, outlay, authority, asOf };
}

async function enrichTree(path, agencies, fetchedAt) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const root = raw.tree || raw;
  clearSpending(root);
  const nodes = walk(root);
  const used = new Set();
  let matched = 0;

  const sorted = [...agencies].sort(
    (a, b) => (b.obligated_amount || 0) - (a.obligated_amount || 0)
  );

  for (const agency of sorted) {
    if (!agency?.agency_name) continue;
    const hit = bestMatch(agency, nodes, used);
    if (!hit) continue;
    hit.node.spending = spendingRecord(agency, hit.how, false);
    used.add(hit.node.id);
    matched++;
  }

  rollUp(root);

  let withSpend = 0;
  for (const n of walk(root)) {
    if (n.spending?.obligatedAmount != null || n.spending?.outlayAmount != null) {
      withSpend++;
    }
  }

  if (raw.meta) {
    raw.meta.spending = {
      source: "USAspending.gov toptier agencies",
      fetchedAt: fetchedAt || null,
      matchedDirect: matched,
      nodesWithSpending: withSpend,
      enrichedAt: new Date().toISOString(),
      note: "Toptier grain (~Cabinet / independent). Children often blank; parents may roll up sums.",
    };
  }

  await writeFile(path, JSON.stringify(raw, null, 2) + "\n");
  console.log(
    `${path.split("/").slice(-1)[0]} · direct ${matched} · ${withSpend} nodes with spending`
  );
}

async function main() {
  const payload = JSON.parse(await readFile(SPEND, "utf8"));
  const agencies = payload.results || [];
  if (!agencies.length) {
    throw new Error(`No agencies in ${SPEND} — run npm run fetch:heat`);
  }

  for (const path of [FULL, FULL_COPY, PRODUCT, BEYOND]) {
    try {
      await enrichTree(path, agencies, payload.fetchedAt);
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
