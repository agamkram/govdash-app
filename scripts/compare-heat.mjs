#!/usr/bin/env node
/**
 * Compare Heat places on the product tree: last commit (HEAD) vs working tree.
 * Prints the daily refresh reply block (asOf, chip, raw events, stayed/left/arrived).
 *
 *   npm run compare:heat
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCT = join(ROOT, "data", "nested", "gov-tree-product.json");
const PRODUCT_GIT = "data/nested/gov-tree-product.json";

function loadJson(text) {
  return JSON.parse(text);
}

function gitShow(path) {
  return execFileSync("git", ["show", `HEAD:${path}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
}

/** Same rule as app.js countDirectHeatPlaces — own events, not parent rollup. */
function directHeatPlaces(data) {
  const tree = data.tree || data;
  const places = [];
  const walk = (node) => {
    const h = node?.heat;
    if (h && !h.rolledUp) {
      const c =
        typeof h.count === "number"
          ? h.count
          : Array.isArray(h.events)
            ? h.events.length
            : 0;
      if (c > 0) {
        places.push({
          id: node.id,
          name: node.name || node.shortName || node.id,
        });
      }
    }
    for (const ch of node?.children || []) walk(ch);
  };
  if (tree) walk(tree);
  places.sort((a, b) => a.name.localeCompare(b.name));
  return places;
}

function heatMeta(data) {
  return data.meta?.heat || {};
}

function fmtAsOf(iso) {
  const s = String(iso || "").trim();
  if (!s) return "(none)";
  return s;
}

async function main() {
  let beforeRaw;
  try {
    beforeRaw = gitShow(PRODUCT_GIT);
  } catch (e) {
    console.error("Could not read HEAD:" + PRODUCT_GIT, e.message || e);
    process.exit(1);
  }

  let afterRaw;
  try {
    afterRaw = await readFile(PRODUCT, "utf8");
  } catch (e) {
    console.error("Could not read working tree product:", e.message || e);
    process.exit(1);
  }

  const before = loadJson(beforeRaw);
  const after = loadJson(afterRaw);
  const bMeta = heatMeta(before);
  const aMeta = heatMeta(after);
  const bPlaces = directHeatPlaces(before);
  const aPlaces = directHeatPlaces(after);
  const bNames = new Set(bPlaces.map((p) => p.name));
  const aNames = new Set(aPlaces.map((p) => p.name));

  const stayed = [...bNames].filter((n) => aNames.has(n)).sort();
  const left = [...bNames].filter((n) => !aNames.has(n)).sort();
  const arrived = [...aNames].filter((n) => !bNames.has(n)).sort();

  const failed = Object.entries(aMeta.sources || {})
    .filter(([, s]) => s && s.ok === false)
    .map(([k, s]) => `${k}: ${s.error || "failed"}`);

  console.log("=== HEAT bake compare (HEAD → working tree) ===");
  console.log(`asOf before → after`);
  console.log(`  ${fmtAsOf(bMeta.asOf)} → ${fmtAsOf(aMeta.asOf)}`);
  console.log(`Places (chip) before → after`);
  console.log(`  ${bPlaces.length} → ${aPlaces.length}`);
  console.log(`Events (raw bake) before → after`);
  console.log(
    `  ${bMeta.rawEventCount ?? "?"} → ${aMeta.rawEventCount ?? "?"}`
  );
  console.log(
    `Stayed ${stayed.length} · left ${left.length} · arrived ${arrived.length}`
  );
  if (left.length) {
    console.log("Left:");
    for (const n of left) console.log(`  - ${n}`);
  } else {
    console.log("Left: (none)");
  }
  if (arrived.length) {
    console.log("Arrived:");
    for (const n of arrived) console.log(`  - ${n}`);
  } else {
    console.log("Arrived: (none)");
  }

  if (failed.length) {
    console.log("");
    console.log("WARNING — sources marked ok:false in this bake:");
    for (const line of failed) console.log(`  - ${line}`);
    console.log(
      "Re-run: npm run fetch:heat-events -- --force && npm run enrich:heat"
    );
  }

  const pulse = [
    ["House", (n) => n === "US House of Representatives"],
    ["Senate", (n) => n === "US Senate"],
    ["POTUS", (n) => n.includes("President of the United States")],
    ["FDA", (n) => n.includes("Food and Drug Administration")],
  ];
  console.log("");
  console.log("Pulse check (chip places):");
  for (const [label, match] of pulse) {
    const ok = aPlaces.some((p) => match(p.name));
    console.log(`  ${label}: ${ok ? "yes" : "NO"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
