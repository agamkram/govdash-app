#!/usr/bin/env node
/**
 * Build the citizen-facing product tree from the full enriched nest.
 *
 * Keeps:  data/nested/gov-tree.json          (full — untouched)
 * Writes: data/nested/gov-tree-full.json     (copy of full, explicit archive)
 *         data/nested/gov-tree-product.json  (map UI)
 *         data/nested/gov-tree-beyond.json   (∞ map: chartered + international)
 *
 * Rules:
 * - Top doors: Legislative · Executive · Judicial · Independent
 * - Government corporations → shelf under Independent (from Industry GSEs)
 * - External actors (Industry nonprofits, IGOs, State/Local) out of the map
 * - Root orphans reparented when a clear home exists; else tiny "Other"
 *
 * Run: npm run curate
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { refineShorts } from "./lib/short-labels.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NESTED = join(ROOT, "data", "nested");
const FULL_PATH = join(NESTED, "gov-tree.json");
const FULL_COPY = join(NESTED, "gov-tree-full.json");
const PRODUCT_PATH = join(NESTED, "gov-tree-product.json");
const BEYOND_PATH = join(NESTED, "gov-tree-beyond.json");

const EXTERNAL_ROOT_NAMES = new Set([
  "Industry, Non-Profits, Associations",
  "International Governmental Organizations",
  "State and Local Governments",
]);

/** Executive top-level agencies that belong in the Independent door for citizens. */
const MOVE_EXEC_AGENCIES_TO_INDEPENDENT = new Set([
  "National Aeronautics and Space Administration (NASA)",
  "National Science Foundation (NSF)",
  "US Agency for International Development (USAID)",
  "US Environmental Protection Agency (EPA)",
  "US General Services Administration (GSA)",
  "US Nuclear Regulatory Commission (NRC)",
  "US Office of Personnel Management (OPM)",
  "US Small Business Administration (SBA)",
  "US Social Security Administration (SSA)",
]);

const ORPHAN_PARENT_BY_NAME = {
  "DOT Office of the Secretary Working Capital Fund (WCF)": "DOT Office of the Secretary (OST)",
  "USDA OCIO National Information Technology Center (NITC)":
    "USDA Office of the Chief Information Officer (OCIO)",
  "Office of Revenue Sharing": "US Department of the Treasury (TD)",
  // NORTHCOM is not in Crosswalk. Park under UCC until GSA adds it — then
  // build:tree nests ALCOM under NORTHCOM and this rule no longer fires.
  "US Alaskan Command (ALCOM)": "Unified Combatant Commands (UCC)",
  "USPS Facilities": "US Postal Service (USPS)",
  "USPS Finance and Planning": "US Postal Service (USPS)",
  "USPS Office of the Postmaster General": "US Postal Service (USPS)",
  "USPS Operations": "US Postal Service (USPS)",
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function countNodes(node) {
  let n = 1;
  for (const c of node.children || []) n += countNodes(c);
  return n;
}

function indexByName(node, map = new Map()) {
  if (node.name) {
    map.set(node.name, node);
    const trimmed = String(node.name).trim();
    if (trimmed) map.set(trimmed, node);
  }
  for (const c of node.children || []) indexByName(c, map);
  return map;
}

function findNamed(byName, name) {
  if (!name) return null;
  return byName.get(name) || byName.get(String(name).trim()) || null;
}

function detachChild(parent, child) {
  parent.children = (parent.children || []).filter((c) => c !== child);
  child.parentId = null;
}

function attachChild(parent, child) {
  child.parentId = parent.id;
  parent.children = parent.children || [];
  parent.children.push(child);
}

function sortChildren(nodes) {
  nodes.sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const n of nodes) {
    if (n.children?.length) sortChildren(n.children);
  }
}

function synthetic(id, name, short, kind, note) {
  return {
    id,
    name,
    short,
    kind,
    parentId: null,
    sources: {
      crosswalk: null,
      sam: null,
      usgm: null,
      note,
    },
    heat: null,
    children: [],
  };
}

async function main() {
  const data = JSON.parse(await readFile(FULL_PATH, "utf8"));
  await copyFile(FULL_PATH, FULL_COPY);

  const tree = clone(data.tree);
  const byName = indexByName(tree);

  const legislative = byName.get("Federal Legislative Branch");
  const executive = byName.get("Federal Executive Branch");
  const judicial = byName.get("Federal Judicial Branch");
  const independentSrc = byName.get("Independent Federal Agencies");
  const industry = byName.get("Industry, Non-Profits, Associations");
  const igo = byName.get("International Governmental Organizations");

  if (!legislative || !executive || !judicial || !independentSrc) {
    throw new Error("Missing required branch/bucket nodes in full tree");
  }

  // --- Pull GSEs out of Industry before dropping externals ---
  const corporations = synthetic(
    "product-corporations",
    "Government Corporations",
    "Corporations",
    "bucket",
    "Product shelf: GSE / government corporation entities lifted from Crosswalk Industry bucket."
  );
  const gseMoved = [];
  if (industry) {
    for (const child of [...(industry.children || [])]) {
      if (child.kind === "gse") {
        detachChild(industry, child);
        attachChild(corporations, child);
        gseMoved.push(child.name);
      }
    }
  }

  // --- Reparent root orphans into known homes (on the clone) ---
  const reparented = [];
  const unresolved = [];
  for (const child of [...tree.children]) {
    const targetName =
      ORPHAN_PARENT_BY_NAME[child.name] ||
      ORPHAN_PARENT_BY_NAME[String(child.name || "").trim()];
    if (!targetName) continue;
    const parent = findNamed(byName, targetName);
    if (!parent) {
      unresolved.push({ name: child.name, wantedParent: targetName, reason: "parent missing" });
      continue;
    }
    detachChild(tree, child);
    attachChild(parent, child);
    reparented.push({ name: child.name, parent: parent.name.trim() });
  }

  // --- Move classic agencies from Executive → Independent door ---
  const movedFromExec = [];
  for (const child of [...(executive.children || [])]) {
    if (MOVE_EXEC_AGENCIES_TO_INDEPENDENT.has(child.name)) {
      detachChild(executive, child);
      // park temporarily on independentSrc; we'll rebuild the Independent door next
      attachChild(independentSrc, child);
      movedFromExec.push(child.name);
    }
  }

  // --- Build Independent product door ---
  const independent = synthetic(
    "product-independent",
    "Independent & Regulatory Agencies",
    "Agencies",
    "branch",
    "Product door: Crosswalk Independent Federal Agencies + major non-Cabinet agencies + government corporations shelf. Constitutionally many report through the Executive; shown separately for citizen clarity."
  );
  for (const child of [...(independentSrc.children || [])]) {
    detachChild(independentSrc, child);
    attachChild(independent, child);
  }
  if (corporations.children.length) {
    attachChild(independent, corporations);
  }

  // Friendly short labels on the three constitutional branches
  legislative.short = "Legislative";
  executive.short = "Executive";
  judicial.short = "Judicial";

  // --- Assemble product root ---
  const productRoot = synthetic(
    "usa",
    "United States Government",
    "USA",
    "sovereign",
    "Product root: curated for the citizen map. Full Crosswalk nest preserved in gov-tree-full.json."
  );

  const otherKids = [];
  for (const child of [...tree.children]) {
    if (EXTERNAL_ROOT_NAMES.has(child.name)) {
      detachChild(tree, child);
      continue;
    }
    if (child === independentSrc) {
      detachChild(tree, child);
      continue;
    }
    if (
      child === legislative ||
      child === executive ||
      child === judicial
    ) {
      detachChild(tree, child);
      continue;
    }
    // leftover root anomalies → Other
    detachChild(tree, child);
    otherKids.push(child);
  }

  attachChild(productRoot, legislative);
  attachChild(productRoot, executive);
  attachChild(productRoot, judicial);
  attachChild(productRoot, independent);

  let other = null;
  if (otherKids.length) {
    other = synthetic(
      "product-other",
      "Other Federal Entities",
      "Other",
      "bucket",
      "Catch-all for root nodes that could not be cleanly reparented. Keep this tiny."
    );
    for (const c of otherKids) attachChild(other, c);
    attachChild(productRoot, other);
    unresolved.push(...otherKids.map((c) => ({ name: c.name, reason: "left in Other" })));
  }

  // Fixed civic order at the root; alpha-sort below that.
  for (const door of productRoot.children) {
    if (door.children?.length) sortChildren(door.children);
  }

  const product = {
    meta: {
      ...(data.meta || {}),
      curatedAt: new Date().toISOString(),
      productOf: "gov-tree.json / gov-tree-full.json",
      nodeCount: countNodes(productRoot) - 1,
      fullNodeCount: data.meta?.nodeCount ?? null,
      curation: {
        topDoors: productRoot.children.map((c) => c.name),
        movedFromExecutiveToIndependent: movedFromExec,
        corporationsFromIndustry: gseMoved,
        reparented,
        unresolved,
        excludedRootBuckets: [...EXTERNAL_ROOT_NAMES],
      },
    },
    tree: productRoot,
  };

  // Distinct map labels (office acronyms; no parent-agency echo / sibling clones).
  refineShorts(productRoot);
  legislative.short = "Legislative";
  executive.short = "Executive";
  judicial.short = "Judicial";
  independent.short = "Agencies";
  productRoot.short = "USA";

  await writeFile(PRODUCT_PATH, JSON.stringify(product, null, 2));

  const chartered = synthetic(
    "product-chartered",
    "Federally Chartered",
    "Chartered",
    "branch",
    "∞ map door: Crosswalk Industry nonprofits / federally chartered bodies. GSEs live on the main map under Agencies → Corporations."
  );
  const charteredNames = [];
  if (industry) {
    for (const child of [...(industry.children || [])]) {
      detachChild(industry, child);
      attachChild(chartered, child);
      charteredNames.push(child.name);
    }
  }

  const international = synthetic(
    "product-international",
    "International Organizations",
    "International",
    "branch",
    "∞ map door: Crosswalk International Governmental Organizations. Not U.S. agencies; tables the United States sits at."
  );
  const igoNames = [];
  if (igo) {
    for (const child of [...(igo.children || [])]) {
      detachChild(igo, child);
      attachChild(international, child);
      igoNames.push(child.name);
    }
  }

  const beyondRoot = synthetic(
    "beyond",
    "Beyond the four doors",
    "Beyond",
    "sovereign",
    "Second map (∞): federally chartered bodies and international orgs kept off the constitutional four-door map. State/local stay out."
  );
  attachChild(beyondRoot, chartered);
  attachChild(beyondRoot, international);
  if (chartered.children?.length) sortChildren(chartered.children);
  if (international.children?.length) sortChildren(international.children);

  refineShorts(beyondRoot);
  chartered.short = "Chartered";
  international.short = "International";
  beyondRoot.short = "Beyond";

  const beyond = {
    meta: {
      generatedAt: data.meta?.generatedAt,
      curatedAt: product.meta.curatedAt,
      productOf: "gov-tree.json / gov-tree-full.json",
      atlas: "beyond",
      nodeCount: countNodes(beyondRoot) - 1,
      curation: {
        topDoors: beyondRoot.children.map((c) => c.name),
        charteredCount: charteredNames.length,
        internationalCount: igoNames.length,
        excluded: ["State and Local Governments"],
      },
    },
    tree: beyondRoot,
  };
  await writeFile(BEYOND_PATH, JSON.stringify(beyond, null, 2));

  console.log("Full tree archived →", FULL_COPY);
  console.log("Product tree      →", PRODUCT_PATH);
  console.log("Product nodes:     ", product.meta.nodeCount);
  console.log("Top doors:         ", product.meta.curation.topDoors.join(" · "));
  console.log("Beyond tree       →", BEYOND_PATH);
  console.log("Beyond nodes:      ", beyond.meta.nodeCount);
  console.log("Beyond doors:      ", beyond.meta.curation.topDoors.join(" · "));
  console.log("Moved exec→indep:  ", movedFromExec.length);
  console.log("Corporations shelf:", gseMoved.length);
  console.log("Reparented orphans:", reparented.length);
  console.log("Other / unresolved:", unresolved.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
