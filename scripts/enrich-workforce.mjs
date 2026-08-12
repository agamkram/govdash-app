#!/usr/bin/env node
/**
 * Attach OPM civilian employee counts onto tree nodes.
 *
 * Usage: npm run enrich:workforce
 *
 * Writes workforce onto gov-tree.json, then product + beyond (and full copy).
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COUNTS = join(ROOT, "data", "raw", "workforce", "opm-employment-counts.json");
const MANIFEST = join(ROOT, "data", "raw", "workforce", "manifest.json");
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
    .replace(/\bNAT\b/g, " NATIONAL ")
    .replace(/\bNATIONAL AERONAUTICS AND SPACE ADMINISTRATION\b/g, " NASA ")
    .replace(/\bNAT AERONAUTICS AND SPACE ADMINISTRATION\b/g, " NASA ")
    .replace(/\bENVIRONMENTAL PROTECTION AGENCY\b/g, " EPA ")
    .replace(/\bSOCIAL SECURITY ADMINISTRATION\b/g, " SSA ")
    .replace(/\bNEIL A\.?\b/g, " ")
    .replace(/\bJOHN F\.?\b/g, " ")
    .replace(/\bJOHN H\.?\b/g, " ")
    .replace(/\bJOHN C\.?\b/g, " ")
    .replace(/\bJOHN GLENN\b/g, " GLENN ")
    .replace(/\bLYNDON B\.?\b/g, " ")
    .replace(/\bGEORGE C\.?\b/g, " ")
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
  if (n.kind === "bureau") s += 20;
  if (n.kind === "military") s += 25;
  return s;
}

function bestMatch(opmName, nodes, used, minJ = 0.72, { allowShort = true } = {}) {
  const exact = nodes.filter(
    (n) => !used.has(n.id) && norm(n.name) === norm(opmName)
  );
  if (exact.length) {
    exact.sort((a, b) => scoreNode(b) - scoreNode(a));
    return { node: exact[0], how: "name", j: 1 };
  }

  // Containment: "AMES RESEARCH CENTER" ↔ "NASA Ames Research Center"
  const contained = nodes
    .filter((n) => !used.has(n.id))
    .map((n) => {
      const o = norm(opmName);
      const nm = norm(n.name);
      let j = 0;
      if (o === nm) j = 1;
      else if (nm.includes(o) || o.includes(nm)) {
        const shorter = Math.min(o.length, nm.length);
        const longer = Math.max(o.length, nm.length);
        j = 0.82 + 0.1 * (shorter / longer);
      } else j = Math.max(jaccard(opmName, n.name), n.short ? jaccard(opmName, n.short) : 0);
      return { n, j };
    })
    .filter((x) => x.j >= minJ)
    .sort((a, b) => b.j - a.j || scoreNode(b.n) - scoreNode(a.n));
  if (contained.length) {
    return {
      node: contained[0].n,
      how: contained[0].j >= 0.99 ? "name" : `jaccard-${contained[0].j.toFixed(2)}`,
      j: contained[0].j,
    };
  }

  if (allowShort) {
    const on = norm(opmName);
    const shortOk = nodes.filter((n) => {
      if (used.has(n.id) || !n.short) return false;
      const sn = norm(n.short);
      if (sn.length < 2) return false;
      // Only when OPM label is basically the short (not "HEADQUARTERS NASA")
      return on === sn || on.split(" ").length <= 2;
    });
    if (shortOk.length === 1) {
      return { node: shortOk[0], how: "short", j: 0.9 };
    }
  }

  return null;
}

function attachDirect(nodes, rows, level, asOf, source, used) {
  let matched = 0;
  for (const row of rows) {
    if (!row?.name || !(row.count > 0)) continue;
    const minJ = level === "subelement" ? 0.8 : 0.72;
    const hit = bestMatch(row.name, nodes, used, minJ, {
      allowShort: level !== "subelement",
    });
    if (!hit) continue;
    // Prefer more specific: don't overwrite subelement with department
    const prev = hit.node.workforce;
    const rank = { subelement: 3, agency: 2, department: 1 };
    if (prev && (rank[prev.level] || 0) > (rank[level] || 0)) continue;
    hit.node.workforce = {
      count: row.count,
      asOf,
      source,
      level,
      opmCode: row.code || null,
      opmName: row.name,
      matchedHow: hit.how,
      rolledUp: false,
    };
    used.add(hit.node.id);
    matched++;
  }
  return matched;
}

function rollUp(node) {
  for (const c of node.children || []) rollUp(c);
  if (node.workforce && !node.workforce.rolledUp) return node.workforce.count;

  let sum = 0;
  let any = false;
  let asOf = null;
  let source = null;
  for (const c of node.children || []) {
    if (c.workforce?.count != null) {
      sum += c.workforce.count;
      any = true;
      asOf = asOf || c.workforce.asOf;
      source = source || c.workforce.source;
    }
  }
  if (any) {
    node.workforce = {
      count: sum,
      asOf,
      source,
      level: "rollup",
      opmCode: null,
      opmName: null,
      matchedHow: "sum-children",
      rolledUp: true,
    };
    return sum;
  }
  return 0;
}

function clearWorkforce(node) {
  delete node.workforce;
  for (const c of node.children || []) clearWorkforce(c);
}

async function enrichTree(path, counts, asOf, source) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const root = raw.tree || raw;
  clearWorkforce(root);
  const nodes = walk(root);
  const used = new Set();

  // Most specific first
  const mSub = attachDirect(nodes, counts.subelements || [], "subelement", asOf, source, used);
  const mAg = attachDirect(nodes, counts.agencies || [], "agency", asOf, source, used);
  const mDept = attachDirect(nodes, counts.departments || [], "department", asOf, source, used);
  rollUp(root);

  let withCount = 0;
  for (const n of walk(root)) if (n.workforce?.count != null) withCount++;

  if (raw.meta) {
    raw.meta.workforce = {
      asOf,
      source,
      matched: { subelement: mSub, agency: mAg, department: mDept },
      nodesWithCount: withCount,
      enrichedAt: new Date().toISOString(),
    };
  }

  await writeFile(path, JSON.stringify(raw, null, 2) + "\n");
  console.log(
    `${path.split("/").slice(-1)[0]} · direct sub ${mSub} / agency ${mAg} / dept ${mDept} · ${withCount} nodes with counts`
  );
}

async function main() {
  const counts = JSON.parse(await readFile(COUNTS, "utf8"));
  let asOf = counts.asOf;
  try {
    const man = JSON.parse(await readFile(MANIFEST, "utf8"));
    if (man.year && man.month) asOf = `${man.year}${man.month}`;
  } catch {
    /* optional */
  }
  const source = counts.source || "OPM Federal Workforce Data";

  for (const path of [FULL, FULL_COPY, PRODUCT, BEYOND]) {
    try {
      await enrichTree(path, counts, asOf, source);
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
