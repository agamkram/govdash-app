#!/usr/bin/env node
/**
 * Download RPC public reports (USRAP + SIV), then parse.
 *
 *   npm run fetch:wraps
 *   npm run fetch:wraps -- --force
 *
 * Free — no API key. Writes data/raw/wraps/* and data/nested/{wraps,siv}.json.
 */
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw", "wraps");
const INDEX = "https://www.rpc.state.gov/admissions-and-arrivals/";
const UA = "GovDash/1 (citizen map; +https://govdash.markmaga.com)";

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

async function getText(url) {
  const r = await fetch(url, { headers: { Accept: "text/html", "User-Agent": UA } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}

async function download(url, dest) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
}

function absUrl(href) {
  if (/^https?:/i.test(href)) return href;
  if (href.startsWith("/")) return `https://www.rpc.state.gov${href}`;
  return `https://www.rpc.state.gov/${href}`;
}

function pickLatest(html, re) {
  const hits = [];
  let m;
  const r = new RegExp(re, "gi");
  while ((m = r.exec(html))) {
    hits.push({ href: m[1].replace(/&amp;/g, "&"), label: m[2] || m[1] });
  }
  if (!hits.length) return null;
  return hits[0];
}

function runParse(script) {
  const parsed = spawnSync("python3", [join(ROOT, "scripts", script)], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (parsed.stdout) process.stdout.write(parsed.stdout);
  if (parsed.stderr) process.stderr.write(parsed.stderr);
  if (parsed.status !== 0) {
    throw new Error(`${script} failed (need: pip install pypdf)`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });

  const admissionsPath = join(OUT, "admissions.xlsx");
  const arrivalsPath = join(OUT, "arrivals.pdf");
  const sivPath = join(OUT, "siv-arrivals.pdf");
  const manifestPath = join(OUT, "manifest.json");

  if (
    !opts.force &&
    (await exists(admissionsPath)) &&
    (await exists(arrivalsPath)) &&
    (await exists(sivPath)) &&
    (await exists(manifestPath))
  ) {
    const age = Date.now() - JSON.parse(await readFile(manifestPath, "utf8")).fetchedAtMs;
    if (Number.isFinite(age) && age < 12 * 3600e3) {
      console.log("wraps raw is fresh (<12h). Use --force to refetch.");
    } else {
      opts.force = true;
    }
  } else {
    opts.force = true;
  }

  let manifest = {
    fetchedAt: new Date().toISOString(),
    fetchedAtMs: Date.now(),
    sourceUrl: INDEX,
  };

  if (opts.force) {
    console.log("Fetching RPC admissions & arrivals index…");
    const html = await getText(INDEX);
    const admissions =
      pickLatest(
        html,
        /href="([^"]*Refugee(?:%20| )Admissions(?:%20| )Report[^"]+\.xlsx)"[^>]*>([^<]*)</i
      ) ||
      pickLatest(html, /href="([^"]*Admissions(?:%20| )Report[^"]+\.xlsx)"/i) ||
      pickLatest(html, /href="([^"]*Refugee Admissions Report[^"]+\.xlsx)"/i);
    const arrivals =
      pickLatest(
        html,
        /href="([^"]*Refugee(?:%20| )Arrivals(?:%20| )by(?:%20| )State[^"]+\.pdf)"[^>]*>([^<]*)</i
      ) ||
      pickLatest(html, /href="([^"]*Refugee Arrivals by State[^"]+\.pdf)"/i);
    const siv =
      pickLatest(
        html,
        /href="([^"]*SIV(?:%20| )Arrivals[^"]+\.pdf)"[^>]*>([^<]*)</i
      ) || pickLatest(html, /href="([^"]*SIV Arrivals[^"]+\.pdf)"/i);

    if (!admissions) throw new Error("Could not find Admissions .xlsx on RPC page");
    if (!arrivals) throw new Error("Could not find Arrivals .pdf on RPC page");
    if (!siv) throw new Error("Could not find SIV Arrivals .pdf on RPC page");

    const admUrl = absUrl(admissions.href);
    const arrUrl = absUrl(arrivals.href);
    const sivUrl = absUrl(siv.href);
    console.log(`Admissions: ${admUrl}`);
    console.log(`Arrivals:   ${arrUrl}`);
    console.log(`SIV:        ${sivUrl}`);
    await download(admUrl, admissionsPath);
    await download(arrUrl, arrivalsPath);
    await download(sivUrl, sivPath);
    manifest = {
      ...manifest,
      admissionsUrl: admUrl,
      arrivalsUrl: arrUrl,
      sivUrl,
      admissionsLabel: admissions.label,
      arrivalsLabel: arrivals.label,
      sivLabel: siv.label,
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Wrote raw files → ${OUT}`);
  }

  console.log("Parsing USRAP…");
  runParse("parse-wraps.py");
  console.log("Parsing SIV…");
  runParse("parse-siv.py");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
