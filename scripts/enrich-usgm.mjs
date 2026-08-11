#!/usr/bin/env node
/**
 * Attach U.S. Government Manual fields onto gov-tree nodes (sources.usgm).
 *
 * Requires: data/raw/usgm/entities.json (npm run parse:usgm)
 * Mutates:  data/nested/gov-tree.json (preserves sources.sam)
 *
 * Usage: npm run enrich:usgm
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TREE_PATH = join(ROOT, "data", "nested", "gov-tree.json");
const ENTITIES = join(ROOT, "data", "raw", "usgm", "entities.json");
const SAMPLES = join(ROOT, "data", "nested", "samples");

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
    .replace(/\bDEPARTMENT OF\b/g, " DEPT ")
    .replace(/\bDEPT(?:ARTMENT)? OF\b/g, " DEPT ")
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

function scoreNode(n) {
  const t = n.sources?.crosswalk?.gsaSfpEntityType;
  let s = 0;
  if (n.kind === "department") s += 50;
  if (n.kind === "branch") s += 40;
  if (t === "Agency" || t === "Ind Agency") s += 30;
  if (n.kind === "independent") s += 25;
  return s;
}

/** Manual aliases where names diverge from Crosswalk (keys = norm()). */
const ALIASES = {
  CONGRESS: ["US CONGRESS", "FEDERAL LEGISLATIVE BRANCH"],
  "LEGISLATIVE BRANCH": ["FEDERAL LEGISLATIVE BRANCH"],
  "EXECUTIVE BRANCH": ["FEDERAL EXECUTIVE BRANCH"],
  "JUDICIAL BRANCH": ["FEDERAL JUDICIAL BRANCH"],
  SENATE: ["US SENATE"],
  "HOUSE OF REPRESENTATIVES": ["US HOUSE OF REPRESENTATIVES"],
  "SUPREME COURT OF": ["SUPREME COURT OF THE UNITED STATES", "US SUPREME COURT"],
  "GOVERNMENT PUBLISHING OFFICE": [
    "US GOVERNMENT PRINTING OFFICE",
    "GOVERNMENT PRINTING OFFICE",
    "US GOVERNMENT PUBLISHING OFFICE",
  ],
  "DEPT DEFENSE": ["US DEPARTMENT OF DEFENSE", "DEPARTMENT OF DEFENSE"],
  "DEPT STATE": ["US DEPARTMENT OF STATE", "DEPARTMENT OF STATE"],
  "DEPT AGRICULTURE": ["US DEPARTMENT OF AGRICULTURE"],
  "DEPT JUSTICE": ["US DEPARTMENT OF JUSTICE"],
  "DEPT TREASURY": ["US DEPARTMENT OF THE TREASURY"],
  "DEPT COMMERCE": ["US DEPARTMENT OF COMMERCE"],
  "DEPT LABOR": ["US DEPARTMENT OF LABOR"],
  "DEPT ENERGY": ["US DEPARTMENT OF ENERGY"],
  "DEPT EDUCATION": ["US DEPARTMENT OF EDUCATION"],
  "DEPT TRANSPORTATION": ["US DEPARTMENT OF TRANSPORTATION"],
  "DEPT INTERIOR": ["US DEPARTMENT OF THE INTERIOR"],
  "DEPT HOMELAND SECURITY": ["US DEPARTMENT OF HOMELAND SECURITY"],
  "DEPT HEALTH AND HUMAN SERVICES": ["US DEPARTMENT OF HEALTH AND HUMAN SERVICES"],
  "DEPT HOUSING AND URBAN DEVELOPMENT": [
    "US DEPARTMENT OF HOUSING AND URBAN DEVELOPMENT",
  ],
  "DEPT VETERANS AFFAIRS": ["US DEPARTMENT OF VETERANS AFFAIRS"],
};

function usgmPayload(e, how, edition) {
  const mission = e.mission || [];
  return {
    matchedHow: how,
    edition,
    entityId: e.entityId ?? null,
    name: e.name,
    category: e.category ?? null,
    missionSummary: mission[0] || null,
    mission: mission.slice(0, 8),
    organization: (e.organization || []).slice(0, 4),
    legalAuthority: (e.legalAuthority || []).slice(0, 4),
    leadership: (e.leadership || []).slice(0, 20),
    web: e.web ?? null,
    phone: e.phone ?? null,
    govinfoUrl: edition
      ? `https://www.govinfo.gov/app/collection/govman`
      : null,
  };
}

function bestMatch(entity, nodes) {
  const nName = norm(entity.name);
  const aliasTargets = ALIASES[nName] || [];

  for (const alias of aliasTargets) {
    const hits = nodes.filter((n) => norm(n.name) === norm(alias));
    if (hits.length) {
      hits.sort((a, b) => scoreNode(b) - scoreNode(a));
      return { node: hits[0], how: "alias" };
    }
  }

  let cands = nodes.filter((n) => norm(n.name) === nName);
  if (cands.length === 1) return { node: cands[0], how: "name" };
  if (cands.length > 1) {
    cands.sort((a, b) => scoreNode(b) - scoreNode(a));
    return { node: cands[0], how: "name-best" };
  }

  cands = nodes
    .map((n) => ({ n, j: jaccard(entity.name, n.name) }))
    .filter((x) => x.j >= 0.75)
    .sort((a, b) => b.j - a.j || scoreNode(b.n) - scoreNode(a.n));
  if (cands.length) return { node: cands[0].n, how: `jaccard-${cands[0].j.toFixed(2)}` };

  return null;
}

async function main() {
  // Ensure entities.json exists
  const parsed = spawnSync("python3", [join(ROOT, "scripts", "parse-usgm.py")], {
    stdio: "inherit",
  });
  if (parsed.status !== 0) process.exit(parsed.status ?? 1);

  const data = JSON.parse(await readFile(TREE_PATH, "utf8"));
  const usgm = JSON.parse(await readFile(ENTITIES, "utf8"));
  const nodes = walk(data.tree);
  const edition = usgm.edition || null;

  for (const n of nodes) {
    if (n.sources) n.sources.usgm = null;
  }

  const used = new Set();
  const matches = [];
  const missed = [];

  // Prefer parents / richer entries first
  const entities = [...(usgm.entities || [])].sort((a, b) => {
    const rank = (e) =>
      (e.mission?.length ? 10 : 0) +
      (e.leadership?.length ? 5 : 0) +
      (e.level === "entity" ? 3 : 0);
    return rank(b) - rank(a);
  });

  for (const e of entities) {
    const available = nodes.filter((n) => !used.has(n.id));
    const m = bestMatch(e, available);
    if (!m) {
      missed.push(e.name);
      continue;
    }
    used.add(m.node.id);
    if (!m.node.sources) m.node.sources = { crosswalk: null, sam: null, usgm: null };
    m.node.sources.usgm = usgmPayload(e, m.how, edition);
    matches.push({ crosswalk: m.node.name, usgm: e.name, how: m.how });
  }

  data.meta.usgm = {
    enrichedAt: new Date().toISOString(),
    edition,
    sourceFile: usgm.sourceFile,
    entityCount: usgm.count,
    matched: matches.length,
    missed: missed.length,
    missedNames: missed.slice(0, 80),
  };

  await writeFile(TREE_PATH, JSON.stringify(data, null, 2));
  await mkdir(SAMPLES, { recursive: true });

  const legislative = findByName(data.tree, "Federal Legislative Branch");
  const defense = findByName(data.tree, "US Department of Defense (DOD)");
  for (const [sample, node] of [
    ["legislative", legislative],
    ["defense", defense],
  ]) {
    if (!node) continue;
    await writeFile(
      join(SAMPLES, `${sample}.json`),
      JSON.stringify(
        {
          meta: {
            ...data.meta,
            sample: node.name,
            nodeCount: countNodes(node),
          },
          tree: clone(node),
        },
        null,
        2
      )
    );
  }

  const dod = defense?.sources?.usgm;
  console.log(`USGM entities: ${usgm.count}`);
  console.log(`Matched:       ${matches.length}`);
  console.log(`Missed:        ${missed.length}`);
  console.log(
    `Defense text:  ${dod?.missionSummary ? dod.missionSummary.slice(0, 80) + "…" : "none"}`
  );
  console.log(`Updated:       ${TREE_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
