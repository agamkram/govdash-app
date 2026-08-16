#!/usr/bin/env node
/**
 * Overlay live leadership onto product + full trees.
 * sources.leadership wins in the UI; Manual stays as historical text.
 *
 *   npm run enrich:leaders
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "data", "raw", "leaders");
const CURRENT = join(DIR, "current.json");
const OVERRIDES = join(DIR, "overrides.json");
const TREES = [
  join(ROOT, "data", "nested", "gov-tree-product.json"),
  join(ROOT, "data", "nested", "gov-tree.json"),
];

function walk(node, out = []) {
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  let current = { orgs: {} };
  let overrides = { nodes: {} };
  try {
    current = await loadJson(CURRENT);
  } catch {
    console.warn("No current.json yet — run npm run fetch:leaders");
  }
  try {
    overrides = await loadJson(OVERRIDES);
  } catch {
    /* optional */
  }

  const byId = { ...(current.orgs || {}) };
  for (const [id, row] of Object.entries(overrides.nodes || {})) {
    if (!row?.people?.length) continue;
    byId[id] = {
      id,
      url: row.sourceUrl || byId[id]?.url || null,
      sourceName: row.sourceName || "manual override",
      fetchedAt: row.asOf || new Date().toISOString(),
      people: row.people,
      override: true,
      reason: row.reason || null,
    };
  }

  for (const path of TREES) {
    let data;
    try {
      data = await loadJson(path);
    } catch {
      console.warn("skip", path);
      continue;
    }
    const nodes = walk(data.tree || data);
    let n = 0;
    for (const node of nodes) {
      const row = byId[node.id];
      if (!row?.people?.length) continue;
      node.sources = node.sources || {};
      node.sources.leadership = {
        asOf: row.fetchedAt,
        sourceUrl: row.url,
        sourceName: row.sourceName,
        override: !!row.override,
        people: row.people.map((p) => ({
          title: p.title,
          name: p.name,
        })),
      };
      n++;
    }
    if (data.meta) {
      data.meta.leadership = {
        enrichedAt: new Date().toISOString(),
        fetchedAt: current.fetchedAt || null,
        nodesWithLiveLeaders: n,
      };
    }
    await writeFile(path, JSON.stringify(data, null, 2));
    console.log(`${path.split("/").pop()}: ${n} nodes with live leadership`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
