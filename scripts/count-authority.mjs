#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachBeyondDoors, stampDoorColors } from "../shared.js";
import { indexById } from "../context.js";
import { countAuthority, AUTHORITY_CITES } from "../authority.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const prod = JSON.parse(await readFile(join(ROOT, "data/nested/gov-tree-product.json"), "utf8"));
const beyond = JSON.parse(await readFile(join(ROOT, "data/nested/gov-tree-beyond.json"), "utf8"));
const root = attachBeyondDoors(prod.tree, beyond.tree);
stampDoorColors(root);
const byId = indexById(root);
const { withLine, withCite } = countAuthority(root, byId);

function walk(n, out = []) {
  out.push(n);
  for (const c of n.children || []) walk(c, out);
  return out;
}
const n = walk(root).length;
const missingCite = Object.keys(AUTHORITY_CITES).filter((id) => !byId.has(id));

console.log(
  JSON.stringify(
    {
      nodes: n,
      withLine,
      withCite,
      tableEntries: Object.keys(AUTHORITY_CITES).length,
      tableIdsMissingFromMap: missingCite,
      linePct: ((withLine / n) * 100).toFixed(1),
      citePct: ((withCite / n) * 100).toFixed(1),
    },
    null,
    2
  )
);
