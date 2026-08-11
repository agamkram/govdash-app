#!/usr/bin/env node
/**
 * Download GSA FederalHierarchy-Crosswalk flat list into data/raw/.
 * Run: npm run fetch
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw");
const BASE =
  "https://raw.githubusercontent.com/GSA/FederalHierarchy-Crosswalk/master";

const FILES = [
  "federalhierarchycrosswalk.json",
  "federalhierarchycrosswalk.csv",
];

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const name of FILES) {
    const url = `${BASE}/${name}`;
    process.stdout.write(`Fetching ${name}… `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(join(OUT, name), buf);
    console.log(`${buf.length.toLocaleString()} bytes`);
  }
  console.log(`Done → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
