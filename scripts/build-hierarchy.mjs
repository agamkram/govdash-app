#!/usr/bin/env node
/**
 * Convert GSA Crosswalk flat Parent list → nested JSON tree.
 *
 * Input:  data/raw/federalhierarchycrosswalk.json
 * Output: data/nested/gov-tree.json
 *         data/nested/samples/legislative.json
 *         data/nested/samples/defense.json
 *
 * Run: npm run build:tree
 *      npm run build:samples   (same; samples always written)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { refineShorts, shortNameFromRow } from "./lib/short-labels.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data", "raw", "federalhierarchycrosswalk.json");
const OUT_DIR = join(ROOT, "data", "nested");
const SAMPLES = join(OUT_DIR, "samples");

const SYNTHETIC = {
  BRANCH: "[Branch]",
  BUCKET: "[Bucket]",
};

const KIND_FROM_ENTITY = {
  Agency: "agency",
  Bureau: "bureau",
  "Ind Agency": "independent",
  IGO: "igo",
  Nonprofit: "nonprofit",
  GSE: "gse",
  Carrier: "carrier",
  Bucket: "bucket",
  "": "unknown",
};

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanLabel(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function inferKind(row, depthFromBranch) {
  const name = row["GSA SFP Name"];
  if (row.Parent === SYNTHETIC.BRANCH) return "branch";
  if (/^US Department of /i.test(name) || / Department of /.test(name)) {
    return "department";
  }
  return KIND_FROM_ENTITY[row["GSA SFP Entity Type"]] || "unknown";
}

function rowToNode(row, depthFromBranch) {
  const name = cleanLabel(row["GSA SFP Name"]);
  const key = String(row["GSA SFP Key"] ?? "").trim();
  return {
    id: key ? `gsa-${key}` : `gsa-${slugify(name)}`,
    name,
    short: shortNameFromRow(row),
    kind: inferKind(row, depthFromBranch),
    parentId: null, // filled after link
    sources: {
      crosswalk: {
        gsaSfpKey: key || null,
        gsaSfpName: name,
        gsaSfpEntityType: row["GSA SFP Entity Type"] || null,
        parentName: cleanLabel(row.Parent) || null,
        ombAgencyCode: row["OMB Agency Code"] || null,
        ombBureauCode: row["OMB Bureau Code"] || null,
        treasuryAgencyCode: row["Treasury Agency Code"] || null,
        treasuryBureauCode: row["Treasury Bureau Code"] || null,
        nistAgencyCode: row["NIST Agency Code"] || null,
        nistBureauCode: row["NIST Bureau Code"] || null,
        cgacAgencyCode: row["CGAC Agency Code"] || null,
      },
      sam: null,
      usgm: null,
    },
    heat: null,
    children: [],
  };
}

function sortChildren(nodes) {
  nodes.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const n of nodes) sortChildren(n.children);
}

function countNodes(node) {
  let n = 1;
  for (const c of node.children) n += countNodes(c);
  return n;
}

function findByName(node, name) {
  if (node.name === name) return node;
  for (const c of node.children) {
    const hit = findByName(c, name);
    if (hit) return hit;
  }
  return null;
}

function cloneSubtree(node) {
  return JSON.parse(JSON.stringify(node));
}

async function main() {
  const raw = JSON.parse(await readFile(RAW, "utf8"));
  if (!Array.isArray(raw)) throw new Error("Expected Crosswalk JSON array");

  const byName = new Map();
  const uniqueRows = [];
  for (const row of raw) {
    const name = cleanLabel(row["GSA SFP Name"]);
    if (!name) continue;
    if (byName.has(name)) {
      console.warn(`Duplicate GSA SFP Name (keeping first): ${name}`);
      continue;
    }
    const node = rowToNode(row);
    byName.set(name, node);
    uniqueRows.push(row);
  }

  const root = {
    id: "usa",
    name: "United States Government",
    short: "USA",
    kind: "sovereign",
    parentId: null,
    sources: {
      crosswalk: null,
      sam: null,
      usgm: null,
      note: "Synthetic root. Crosswalk branches attach under Parent=[Branch].",
    },
    heat: null,
    children: [],
  };

  const orphans = [];
  const syntheticParents = new Set([SYNTHETIC.BRANCH, SYNTHETIC.BUCKET]);

  for (const row of uniqueRows) {
    const name = cleanLabel(row["GSA SFP Name"]);
    const node = byName.get(name);
    const parentName = cleanLabel(row.Parent);

    if (syntheticParents.has(parentName) || !parentName) {
      node.parentId = root.id;
      root.children.push(node);
      continue;
    }

    const parent = byName.get(parentName);
    if (!parent) {
      orphans.push({ name, parentName });
      node.parentId = root.id;
      node.sources.crosswalk.orphanParent = parentName;
      root.children.push(node);
      continue;
    }

    node.parentId = parent.id;
    parent.children.push(node);
  }

  sortChildren(root.children);
  refineShorts(root);

  const meta = {
    generatedAt: new Date().toISOString(),
    source: "GSA/FederalHierarchy-Crosswalk",
    recordCount: raw.length,
    nodeCount: countNodes(root) - 1, // exclude synthetic root
    orphanCount: orphans.length,
    orphans,
  };

  await mkdir(SAMPLES, { recursive: true });
  const full = { meta, tree: root };
  await writeFile(join(OUT_DIR, "gov-tree.json"), JSON.stringify(full, null, 2));

  const legislative = findByName(root, "Federal Legislative Branch");
  const defense = findByName(root, "US Department of Defense (DOD)");

  if (legislative) {
    await writeFile(
      join(SAMPLES, "legislative.json"),
      JSON.stringify(
        {
          meta: { ...meta, sample: "Federal Legislative Branch", nodeCount: countNodes(legislative) },
          tree: cloneSubtree(legislative),
        },
        null,
        2
      )
    );
  } else {
    console.warn("Legislative sample not found");
  }

  if (defense) {
    await writeFile(
      join(SAMPLES, "defense.json"),
      JSON.stringify(
        {
          meta: { ...meta, sample: "US Department of Defense (DOD)", nodeCount: countNodes(defense) },
          tree: cloneSubtree(defense),
        },
        null,
        2
      )
    );
  } else {
    console.warn("Defense sample not found");
  }

  console.log(`Records in:     ${raw.length}`);
  console.log(`Nodes nested:   ${meta.nodeCount}`);
  console.log(`Root children:  ${root.children.length}`);
  console.log(`Orphans:        ${orphans.length}`);
  if (legislative) console.log(`Legislative:    ${countNodes(legislative)} nodes → samples/legislative.json`);
  if (defense) console.log(`Defense:        ${countNodes(defense)} nodes → samples/defense.json`);
  console.log(`Full tree:      ${join(OUT_DIR, "gov-tree.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
