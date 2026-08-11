#!/usr/bin/env node
/**
 * Download latest U.S. Government Manual bulk XML (govinfo GOVMAN).
 * Usage: npm run fetch:usgm
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw", "usgm");
const UA = "GovDash/0.1 (+https://markmaga.com; citizen hierarchy map)";

function parseArgs(argv) {
  return { force: argv.includes("--force") };
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function main() {
  const { force } = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });

  const listing = await fetchJson("https://www.govinfo.gov/bulkdata/json/GOVMAN");
  const years = (listing.files || [])
    .filter((f) => f.folder)
    .map((f) => f.name)
    .sort((a, b) => Number(b) - Number(a));
  if (!years.length) throw new Error("No GOVMAN year folders found");
  const year = years[0];

  const yearListing = await fetchJson(
    `https://www.govinfo.gov/bulkdata/json/GOVMAN/${year}`
  );
  const zip = (yearListing.files || []).find((f) =>
    String(f.name).endsWith(".zip")
  );
  if (!zip) throw new Error(`No zip in GOVMAN/${year}`);

  const zipPath = join(OUT, zip.name);
  const extractDir = join(OUT, year);
  const metaPath = join(OUT, "manifest.json");

  if (!force && (await exists(zipPath))) {
    console.log(`Cache hit: ${zipPath}. Use --force to re-download.`);
  } else {
    console.log(`Downloading ${zip.link}…`);
    await download(zip.link, zipPath);
    console.log(`Saved ${zipPath}`);
  }

  await mkdir(extractDir, { recursive: true });
  execFileSync("unzip", ["-o", zipPath, "-d", extractDir], { stdio: "inherit" });

  const manifest = {
    fetchedAt: new Date().toISOString(),
    year,
    zip: zip.name,
    zipUrl: zip.link,
    extractDir: `data/raw/usgm/${year}`,
    source: "https://www.govinfo.gov/bulkdata/GOVMAN",
  };
  await writeFile(metaPath, JSON.stringify(manifest, null, 2));
  console.log(`Extracted → ${extractDir}`);
  console.log(`Manifest → ${metaPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
