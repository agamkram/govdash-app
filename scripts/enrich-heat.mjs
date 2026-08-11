#!/usr/bin/env node
/**
 * Attach heat scores onto gov-tree nodes from cached signals.
 * Preserves sources.sam / sources.usgm.
 *
 * Usage: npm run enrich:heat
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TREE_PATH = join(ROOT, "data", "nested", "gov-tree.json");
const HEAT = join(ROOT, "data", "raw", "heat");
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
    .replace(/\bNATIONAL AERONAUTICS AND SPACE ADMINISTRATION\b/g, " NASA ")
    .replace(/\bSOCIAL SECURITY ADMINISTRATION\b/g, " SSA ")
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

function countDescendants(node) {
  let n = 0;
  for (const c of node.children || []) n += 1 + countDescendants(c);
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
  if (t === "Agency" || t === "Ind Agency") s += 30;
  if (n.kind === "independent") s += 25;
  return s;
}

function logNorm(values) {
  const logs = values.map((v) => Math.log1p(Math.max(0, v || 0)));
  const max = Math.max(...logs, 1e-9);
  return (v) => Math.log1p(Math.max(0, v || 0)) / max;
}

function bestSpendMatch(agency, nodes, used) {
  const name = agency.agency_name;
  const abbr = agency.abbreviation;
  let cands = nodes.filter((n) => !used.has(n.id) && norm(n.name) === norm(name));
  if (abbr) {
    cands = cands.concat(
      nodes.filter(
        (n) =>
          !used.has(n.id) &&
          (norm(n.short || "") === norm(abbr) || norm(n.name).includes(norm(abbr)))
      )
    );
  }
  if (cands.length) {
    cands.sort((a, b) => scoreNode(b) - scoreNode(a));
    return { node: cands[0], how: "name" };
  }
  cands = nodes
    .filter((n) => !used.has(n.id))
    .map((n) => ({
      n,
      j: Math.max(
        jaccard(name, n.name),
        abbr ? jaccard(abbr, n.short || n.name) : 0
      ),
    }))
    .filter((x) => x.j >= 0.72)
    .sort((a, b) => b.j - a.j || scoreNode(b.n) - scoreNode(a.n));
  if (cands.length) return { node: cands[0].n, how: `jaccard-${cands[0].j.toFixed(2)}` };
  return null;
}

function combineScore({ spendingN, frN, sizeN }) {
  // weights among available signals
  const parts = [];
  if (spendingN != null) parts.push([0.55, spendingN]);
  if (frN != null) parts.push([0.3, frN]);
  if (sizeN != null) parts.push([0.15, sizeN]);
  if (!parts.length) return 0;
  const wsum = parts.reduce((s, [w]) => s + w, 0);
  return parts.reduce((s, [w, v]) => s + (w / wsum) * v, 0);
}

async function main() {
  const data = JSON.parse(await readFile(TREE_PATH, "utf8"));
  const spend = JSON.parse(
    await readFile(join(HEAT, "usaspending-toptier.json"), "utf8")
  );
  let frCounts = { results: [] };
  try {
    frCounts = JSON.parse(
      await readFile(join(HEAT, "federal-register-counts.json"), "utf8")
    );
  } catch {
    /* optional until fetch:heat completes FR */
  }

  const nodes = walk(data.tree);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // clear heat
  for (const n of nodes) n.heat = null;

  // size for all
  for (const n of nodes) {
    n._desc = countDescendants(n);
  }
  const sizeNorm = logNorm(nodes.map((n) => n._desc));

  // spending matches
  const used = new Set();
  const spendMatches = [];
  const obligated = (spend.results || []).map((a) => a.obligated_amount || 0);
  const spendNorm = logNorm(obligated);

  for (const agency of spend.results || []) {
    const m = bestSpendMatch(agency, nodes, used);
    if (!m) continue;
    used.add(m.node.id);
    spendMatches.push({
      node: m.node,
      agency,
      how: m.how,
      spendingN: spendNorm(agency.obligated_amount || 0),
    });
  }

  // FR counts (already node-linked in cache)
  const frByNode = new Map();
  const frNorm = logNorm((frCounts.results || []).map((r) => r.documentCount || 0));
  for (const r of frCounts.results || []) {
    if (r.documentCount == null) continue;
    frByNode.set(r.nodeId, {
      ...r,
      frN: frNorm(r.documentCount),
    });
  }

  // assign direct heat
  const direct = new Map();
  for (const n of nodes) {
    const sm = spendMatches.find((s) => s.node.id === n.id);
    const fr = frByNode.get(n.id);
    const spendingN = sm ? sm.spendingN : null;
    const frN = fr ? fr.frN : null;
    const sizeN = sizeNorm(n._desc);
    const hasActivity = spendingN != null || frN != null;
    if (!hasActivity && n._desc === 0) {
      n.heat = null;
      continue;
    }
    const score = combineScore({ spendingN, frN, sizeN: hasActivity ? sizeN : sizeN * 0.5 });
    const heat = {
      score: Number(score.toFixed(4)),
      period: {
        spending: spend.fetchedAt || null,
        federalRegister: frCounts.since || null,
      },
      signals: {
        obligatedAmount: sm ? sm.agency.obligated_amount : null,
        outlayAmount: sm ? sm.agency.outlay_amount : null,
        spendingAgency: sm ? sm.agency.agency_name : null,
        federalRegisterDocs: fr ? fr.documentCount : null,
        federalRegisterAgency: fr ? fr.frName : null,
        descendantCount: n._desc,
      },
      rolledUp: false,
    };
    n.heat = heat;
    if (hasActivity) direct.set(n.id, heat.score);
  }

  // roll up max heat to ancestors (so branches show activity)
  function roll(node) {
    let childMax = 0;
    for (const c of node.children || []) {
      childMax = Math.max(childMax, roll(c));
    }
    const own = node.heat?.score || 0;
    const rolled = Math.max(own, childMax * 0.92);
    if (rolled > 0) {
      if (!node.heat) {
        node.heat = {
          score: Number(rolled.toFixed(4)),
          period: { spending: spend.fetchedAt || null, federalRegister: frCounts.since || null },
          signals: {
            obligatedAmount: null,
            outlayAmount: null,
            spendingAgency: null,
            federalRegisterDocs: null,
            federalRegisterAgency: null,
            descendantCount: node._desc,
          },
          rolledUp: true,
        };
      } else if (rolled > own + 1e-6) {
        node.heat.score = Number(rolled.toFixed(4));
        node.heat.rolledUp = own < rolled;
      }
    }
    return node.heat?.score || 0;
  }
  roll(data.tree);

  // cleanup temp
  for (const n of nodes) delete n._desc;

  const withHeat = nodes.filter((n) => n.heat && n.heat.score > 0).length;
  data.meta.heat = {
    enrichedAt: new Date().toISOString(),
    spendingMatched: spendMatches.length,
    federalRegisterMatched: frByNode.size,
    nodesWithHeat: withHeat,
    formula:
      "0.55·logNorm(USAspending obligated) + 0.30·logNorm(FR docs since period) + 0.15·logNorm(descendants); parent roll-up = max(own, 0.92·max child)",
    sources: {
      usaspending: "data/raw/heat/usaspending-toptier.json",
      federalRegister: "data/raw/heat/federal-register-counts.json",
    },
  };

  await writeFile(TREE_PATH, JSON.stringify(data, null, 2));
  await mkdir(SAMPLES, { recursive: true });
  for (const [sample, name] of [
    ["legislative", "Federal Legislative Branch"],
    ["defense", "US Department of Defense (DOD)"],
  ]) {
    const node = findByName(data.tree, name);
    if (!node) continue;
    await writeFile(
      join(SAMPLES, `${sample}.json`),
      JSON.stringify({ meta: { ...data.meta, sample: name }, tree: clone(node) }, null, 2)
    );
  }

  const top = nodes
    .filter((n) => n.heat && !n.heat.rolledUp)
    .sort((a, b) => b.heat.score - a.heat.score)
    .slice(0, 8);
  console.log(`Spending matched: ${spendMatches.length}`);
  console.log(`FR matched:       ${frByNode.size}`);
  console.log(`Nodes with heat:  ${withHeat}`);
  console.log("Top direct heat:");
  for (const n of top) {
    console.log(
      `  ${n.heat.score.toFixed(3)}  ${n.name.slice(0, 50)}  $=${n.heat.signals.obligatedAmount ?? "—"}  FR=${n.heat.signals.federalRegisterDocs ?? "—"}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
