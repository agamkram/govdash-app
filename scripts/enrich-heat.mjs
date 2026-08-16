#!/usr/bin/env node
/**
 * Attach live Heat events onto product (and full) tree nodes.
 * Kills the old score-based heat. New shape:
 *
 *   node.heat = {
 *     asOf, count, rolledUp,
 *     events: [{ id, kind, when, title, summary, url, source, urgency }]
 *   }
 *
 * Usage: npm run enrich:heat
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NESTED = join(ROOT, "data", "nested");
const RAW = join(ROOT, "data", "raw", "heat", "events-raw.json");
const FR_AGENCIES = join(
  ROOT,
  "data",
  "raw",
  "heat",
  "federal-register-agencies.json"
);

const PRODUCT = join(NESTED, "gov-tree-product.json");
const FULL = join(NESTED, "gov-tree.json");
const BEYOND = join(NESTED, "gov-tree-beyond.json");

/** Stable map homes for chamber / executive signals. */
const ANCHOR = {
  senate: "gsa-3",
  house: "gsa-4",
  congress: "gsa-2",
  legislative: "gsa-1",
  potus: "gsa-43",
  eop: "gsa-42",
  whiteHouse: "gsa-53",
  executive: "gsa-41",
  doj: "gsa-653",
  judicial: "gsa-23",
};

const MAX_EVENTS_PER_NODE = 12;

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
    .replace(/\bADMINISTRATION\b/g, " ADMIN ")
    .replace(/\bCOMMISSION\b/g, " COMM ")
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

function slimEvent(e) {
  return {
    id: e.id,
    kind: e.kind,
    when: e.when || null,
    until: e.until || null,
    filedAt: e.filedAt || null,
    signedAt: e.signedAt || null,
    title: e.title,
    summary: e.summary || "",
    url: e.url || e.pdfUrl || e.htmlUrl || null,
    source: e.source || "",
    sourceUrl: e.sourceUrl || null,
    urgency: e.urgency || "upcoming",
    bill: e.bill || null,
  };
}

function buildAgencyIndex(nodes) {
  /** @type {{ node:*, names:string[] }[]} */
  const rows = [];
  for (const n of nodes) {
    const names = [n.name, n.short].filter(Boolean);
    const cw = n.sources?.crosswalk;
    if (cw?.gsaSfpName) names.push(cw.gsaSfpName);
    const sam = n.sources?.sam;
    if (sam?.fhorgname) names.push(sam.fhorgname);
    if (sam?.fhagencyorgname) names.push(sam.fhagencyorgname);
    rows.push({ node: n, names });
  }
  return rows;
}

function bestAgencyMatch(agencyName, index, min = 0.55) {
  let best = null;
  let bestScore = min;
  const nA = norm(agencyName);
  for (const row of index) {
    for (const name of row.names) {
      if (!name) continue;
      if (norm(name) === nA) {
        return { node: row.node, score: 1, how: "exact" };
      }
      const j = jaccard(agencyName, name);
      if (j > bestScore) {
        bestScore = j;
        best = { node: row.node, score: j, how: `jaccard-${j.toFixed(2)}` };
      }
    }
  }
  return best;
}

function eventSortKey(e) {
  const u =
    e.urgency === "now" ? 0 : e.urgency === "upcoming" ? 1 : e.urgency === "soon" ? 2 : 3;
  const t = Date.parse(e.when || "") || 0;
  return u * 1e15 - t;
}

function attachDirect(byId, nodeId, event) {
  const n = byId.get(nodeId);
  if (!n) return false;
  if (!n._heatEvents) n._heatEvents = [];
  n._heatEvents.push(slimEvent(event));
  return true;
}

function finalizeHeat(nodes, asOf) {
  // clear all first
  for (const n of nodes) {
    n.heat = null;
  }

  // direct events
  for (const n of nodes) {
    const list = n._heatEvents || [];
    delete n._heatEvents;
    if (!list.length) continue;
    list.sort((a, b) => eventSortKey(a) - eventSortKey(b));
    const uniq = new Map();
    for (const e of list) uniq.set(e.id, e);
    const events = [...uniq.values()]
      .sort((a, b) => eventSortKey(a) - eventSortKey(b))
      .slice(0, MAX_EVENTS_PER_NODE);
    n.heat = {
      asOf,
      count: events.length,
      rolledUp: false,
      events,
    };
  }

  // roll up: parents light up when children have heat
  function roll(node) {
    let childEvents = [];
    let childCount = 0;
    for (const c of node.children || []) {
      const sub = roll(c);
      childCount += sub.count;
      childEvents = childEvents.concat(sub.sample);
    }
    const own = node.heat?.events || [];
    const ownCount = node.heat?.count || 0;
    if (ownCount === 0 && childCount === 0) return { count: 0, sample: [] };

    if (ownCount > 0) {
      // keep own events; still note child count in count field for badge
      node.heat.count = ownCount + childCount;
      if (childCount > 0) node.heat.hasChildHeat = true;
      return {
        count: node.heat.count,
        sample: own.slice(0, 4),
      };
    }

    // rolled-up only
    childEvents.sort((a, b) => eventSortKey(a) - eventSortKey(b));
    const sample = [];
    const seen = new Set();
    for (const e of childEvents) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      sample.push(e);
      if (sample.length >= 6) break;
    }
    node.heat = {
      asOf,
      count: childCount,
      rolledUp: true,
      events: sample.map((e) => ({
        ...e,
        summary: e.summary
          ? `${e.summary} (from lower in the map)`
          : "Activity lower in this branch",
      })),
    };
    return { count: childCount, sample };
  }

  // find root(s)
  const roots = nodes.filter((n) => !n.parentId || n.id === "usa" || n.kind === "sovereign");
  const treeRoot =
    nodes.find((n) => n.id === "usa") ||
    roots[0] ||
    nodes[0];
  if (treeRoot) roll(treeRoot);
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function enrichTreeFile(path, raw, agencyIndexExtra) {
  let data;
  try {
    data = await loadJson(path);
  } catch {
    console.warn(`skip missing ${path}`);
    return null;
  }
  const tree = data.tree || data;
  const nodes = walk(tree);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const index = buildAgencyIndex(nodes);

  let matchedPi = 0;
  let unmatchedPi = 0;
  let chamber = 0;
  let presidential = 0;

  for (const e of raw.events || []) {
    if (e.kind === "floor_session" || e.kind === "house_schedule") {
      const id =
        e.chamber === "Senate"
          ? ANCHOR.senate
          : e.chamber === "House"
            ? ANCHOR.house
            : ANCHOR.congress;
      if (attachDirect(byId, id, e)) chamber++;
      continue;
    }
    if (e.kind === "presidential_doc") {
      if (attachDirect(byId, ANCHOR.potus, e)) presidential++;
      // also light EOP lightly via roll-up from potus
      continue;
    }
    if (e.kind === "public_inspection") {
      const agencies = e.agencies || [];
      let any = false;
      for (const name of agencies) {
        const m = bestAgencyMatch(name, index, 0.52);
        if (m && attachDirect(byId, m.node.id, { ...e, matchHow: m.how })) {
          any = true;
        }
      }
      if (any) matchedPi++;
      else unmatchedPi++;
      continue;
    }
  }

  const asOf = raw.fetchedAt || new Date().toISOString();
  finalizeHeat(nodes, asOf);

  const withHeat = nodes.filter((n) => n.heat && n.heat.count > 0).length;
  const direct = nodes.filter((n) => n.heat && !n.heat.rolledUp).length;

  data.meta = data.meta || {};
  // incinerate old score meta
  data.meta.heat = {
    kind: "events",
    enrichedAt: new Date().toISOString(),
    asOf,
    nodesWithHeat: withHeat,
    nodesWithDirectHeat: direct,
    rawEventCount: (raw.events || []).length,
    matched: { chamber, presidential, publicInspection: matchedPi },
    unmatchedPublicInspection: unmatchedPi,
    sources: raw.sources || {},
    note: "Heat = dated official events. Pulse on the map when Heat is on. Old score formula removed.",
  };

  await writeFile(path, JSON.stringify(data, null, 2));
  console.log(
    `${path.split("/").pop()}: ${withHeat} nodes with heat (${direct} direct), PI matched ${matchedPi}, unmatched ${unmatchedPi}`
  );
  return data.meta.heat;
}

async function main() {
  let raw;
  try {
    raw = await loadJson(RAW);
  } catch {
    console.error("Missing data/raw/heat/events-raw.json — run npm run fetch:heat-events");
    process.exit(1);
  }

  // product tree is what the map loads
  await enrichTreeFile(PRODUCT, raw);
  // keep full tree consistent if present
  await enrichTreeFile(FULL, raw);
  // beyond map (chartered/igo) — only PI matches if any
  await enrichTreeFile(BEYOND, raw);

  console.log("Old score-based heat replaced with event heat.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
