#!/usr/bin/env node
/**
 * Attach SAM.gov department fields onto gov-tree nodes (sources.sam).
 * One SAM org → one Crosswalk node (no painting every CGAC child).
 *
 * Input:  data/raw/sam/departments-active.json
 *         data/nested/gov-tree.json  (or rebuilds from Crosswalk first)
 * Output: data/nested/gov-tree.json (enriched)
 *         data/nested/samples/* refreshed
 *
 * Usage: npm run enrich:sam
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TREE_PATH = join(ROOT, "data", "nested", "gov-tree.json");
const SAM_PATH = join(ROOT, "data", "raw", "sam", "departments-active.json");
const SAMPLES = join(ROOT, "data", "nested", "samples");

function norm(s) {
  let t = String(s || "").toUpperCase();
  // "STATE, DEPARTMENT OF" → "DEPARTMENT OF STATE"
  t = t.replace(
    /^(.+?),\s*(DEPARTMENT|DEPT|AGENCY)\s+OF\s*$/i,
    (_, name, kind) => `${kind} OF ${name}`
  );
  return t
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bU\.?S\.?\b/g, " ")
    .replace(/\bUNITED STATES\b/g, " ")
    .replace(/\bDEPARTMENT OF\b/g, " DEPT ")
    .replace(/\bDEPT(?:ARTMENT)? OF\b/g, " DEPT ")
    .replace(/\bTHE\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreNode(n) {
  const t = n.sources?.crosswalk?.gsaSfpEntityType;
  let s = 0;
  if (n.kind === "department") s += 50;
  if (t === "Agency" || t === "Ind Agency") s += 30;
  if (n.kind === "independent") s += 25;
  return s;
}

function walk(node, out = []) {
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

function countNodes(node) {
  let n = 1;
  for (const c of node.children || []) n += countNodes(c);
  return n;
}

function findByName(node, name) {
  if (node.name === name) return node;
  for (const c of node.children || []) {
    const hit = findByName(c, name);
    if (hit) return hit;
  }
  return null;
}

function clone(node) {
  return JSON.parse(JSON.stringify(node));
}

function samPayload(o, how) {
  return {
    matchedHow: how,
    fhorgid: o.fhorgid ?? null,
    fhorgname: o.fhorgname ?? null,
    status: o.status ?? null,
    fhorgtype: o.fhorgtype ?? null,
    agencycode: o.agencycode ?? null,
    cgaclist: (o.cgaclist || []).map((c) => c.cgac),
    fhagencyorgname: o.fhagencyorgname ?? null,
    lastupdateddate: o.lastupdateddate ?? null,
    createddate: o.createddate ?? null,
    fhfullparentpathname:
      o.fhorgparenthistory?.[0]?.fhfullparentpathname ?? null,
  };
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

function bestNameMatch(o, nodes) {
  const nName = norm(o.fhorgname);
  let cands = nodes.filter((n) => norm(n.name) === nName);
  if (cands.length === 1) return { node: cands[0], how: "name" };
  if (cands.length > 1) {
    cands.sort((a, b) => scoreNode(b) - scoreNode(a));
    return { node: cands[0], how: "name-best" };
  }

  // Strong overlap only — avoids IBWC→State, Kennedy→Smithsonian false hits
  cands = nodes
    .map((n) => ({ n, j: jaccard(o.fhorgname, n.name) }))
    .filter((x) => x.j >= 0.72)
    .sort((a, b) => b.j - a.j || scoreNode(b.n) - scoreNode(a.n));
  if (cands.length) return { node: cands[0].n, how: `jaccard-${cands[0].j.toFixed(2)}` };
  return null;
}

function bestCgacMatch(o, nodes) {
  const cgacs = (o.cgaclist || []).map((c) => String(c.cgac).padStart(3, "0"));
  if (!cgacs.length) return null;

  let cands = nodes.filter((n) => {
    const cg = n.sources?.crosswalk?.cgacAgencyCode
      ? String(n.sources.crosswalk.cgacAgencyCode).padStart(3, "0")
      : "";
    if (!cgacs.includes(cg)) return false;
    const t = n.sources?.crosswalk?.gsaSfpEntityType;
    return (
      n.kind === "department" ||
      n.kind === "independent" ||
      t === "Agency" ||
      t === "Ind Agency"
    );
  });
  if (!cands.length) return null;

  // Prefer name similarity within same CGAC (IBWC vs State both 019)
  cands = cands
    .map((n) => ({ n, j: jaccard(o.fhorgname, n.name), score: scoreNode(n) }))
    .sort((a, b) => b.j - a.j || b.score - a.score);

  if (cands[0].j >= 0.35 || cands.length === 1) {
    return { node: cands[0].n, how: cands.length === 1 ? "cgac-agency" : "cgac-best" };
  }
  return null;
}

async function main() {
  // Ensure base tree exists / is fresh from Crosswalk
  const build = spawnSync(process.execPath, [join(ROOT, "scripts", "build-hierarchy.mjs")], {
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const data = JSON.parse(await readFile(TREE_PATH, "utf8"));
  const sam = JSON.parse(await readFile(SAM_PATH, "utf8"));
  const nodes = walk(data.tree).filter((n) => n.sources?.crosswalk);

  // clear prior sam
  for (const n of walk(data.tree)) {
    if (n.sources) n.sources.sam = null;
  }

  const used = new Set();
  const matches = [];
  const missed = [];
  const available = () => nodes.filter((n) => !used.has(n.id));

  // Pass 1: names (claim strongest links first)
  for (const o of sam.orglist || []) {
    const m = bestNameMatch(o, available());
    if (!m) continue;
    used.add(m.node.id);
    m.node.sources.sam = samPayload(o, m.how);
    matches.push({
      crosswalk: m.node.name,
      sam: o.fhorgname,
      how: m.how,
      status: o.status,
    });
  }

  // Pass 2: CGAC for leftovers
  for (const o of sam.orglist || []) {
    if (matches.some((m) => m.sam === o.fhorgname)) continue;
    const m = bestCgacMatch(o, available());
    if (!m) {
      missed.push(o.fhorgname);
      continue;
    }
    used.add(m.node.id);
    m.node.sources.sam = samPayload(o, m.how);
    matches.push({
      crosswalk: m.node.name,
      sam: o.fhorgname,
      how: m.how,
      status: o.status,
    });
  }

  data.meta.sam = {
    enrichedAt: new Date().toISOString(),
    sourceFile: "data/raw/sam/departments-active.json",
    samFetchedAt: sam.fetchedAt ?? null,
    samOrgCount: sam.count ?? (sam.orglist || []).length,
    matched: matches.length,
    missed: missed.length,
    missedNames: missed,
  };

  await writeFile(TREE_PATH, JSON.stringify(data, null, 2));

  await mkdir(SAMPLES, { recursive: true });
  const legislative = findByName(data.tree, "Federal Legislative Branch");
  const defense = findByName(data.tree, "US Department of Defense (DOD)");
  if (legislative) {
    await writeFile(
      join(SAMPLES, "legislative.json"),
      JSON.stringify(
        {
          meta: {
            ...data.meta,
            sample: "Federal Legislative Branch",
            nodeCount: countNodes(legislative),
          },
          tree: clone(legislative),
        },
        null,
        2
      )
    );
  }
  if (defense) {
    await writeFile(
      join(SAMPLES, "defense.json"),
      JSON.stringify(
        {
          meta: {
            ...data.meta,
            sample: "US Department of Defense (DOD)",
            nodeCount: countNodes(defense),
          },
          tree: clone(defense),
        },
        null,
        2
      )
    );
  }

  console.log(`SAM orgs:     ${sam.orglist?.length ?? 0}`);
  console.log(`Matched:      ${matches.length}`);
  console.log(`Missed:       ${missed.length}`);
  console.log(
    `Defense SAM:  ${defense?.sources?.sam?.status || "none"} (${defense?.sources?.sam?.fhorgname || "—"})`
  );
  console.log(`Updated:      ${TREE_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
