#!/usr/bin/env node
/**
 * Fetch SAM.gov Federal Hierarchy public orgs into data/raw/sam/ (cached).
 * Non-federal keys ≈ 10 requests/day — uses cache unless --force.
 *
 * Usage:
 *   npm run fetch:sam
 *   npm run fetch:sam -- --force
 *   npm run fetch:sam -- --max-requests 4
 *
 * Requires SAM_API_KEY in .env
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw", "sam");
const ENV_PATH = join(ROOT, ".env");
const BASE = "https://api.sam.gov/prod/federalorganizations/v1/orgs";

function parseArgs(argv) {
  const opts = { force: false, maxRequests: 6 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--force") opts.force = true;
    if (argv[i] === "--max-requests") opts.maxRequests = Number(argv[++i]);
  }
  return opts;
}

async function loadKey() {
  const text = await readFile(ENV_PATH, "utf8");
  const m = text.match(/^SAM_API_KEY=(.+)$/m);
  if (!m) throw new Error("SAM_API_KEY missing in .env");
  return m[1].trim();
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchPage(key, params) {
  const u = new URL(BASE);
  u.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await fetch(u);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`SAM ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

async function fetchAllDepartments(key, maxRequests) {
  const all = [];
  let total = Infinity;
  let offset = 0;
  let used = 0;
  const limit = 100;

  while (offset < total && used < maxRequests) {
    process.stdout.write(`  departments offset=${offset}… `);
    const page = await fetchPage(key, {
      fhorgtype: "Department/Ind. agency",
      status: "active",
      limit,
      offset,
    });
    used++;
    total = Number(page.totalrecords) || 0;
    const list = page.orglist || [];
    console.log(`got ${list.length} (total ${total})`);
    await writeFile(
      join(OUT, `departments-offset-${offset}.json`),
      JSON.stringify(page, null, 2)
    );
    all.push(...list);
    if (!list.length) break;
    offset += limit;
  }

  if (offset < total) {
    console.warn(
      `Stopped early: need more pages for ${total} depts (used ${used}/${maxRequests} requests). Re-run tomorrow or raise --max-requests.`
    );
  }

  return { all, used, total };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });
  const cachePath = join(OUT, "departments-active.json");

  if (!opts.force && (await exists(cachePath))) {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    console.log(
      `Cache hit: ${cached.count} departments (${cached.fetchedAt}). Use --force to refresh.`
    );
    return;
  }

  const key = await loadKey();
  console.log(`Fetching SAM departments (max ${opts.maxRequests} requests)…`);
  const { all, used, total } = await fetchAllDepartments(key, opts.maxRequests);

  const payload = {
    fetchedAt: new Date().toISOString(),
    source: "https://api.sam.gov/prod/federalorganizations/v1/orgs",
    fhorgtype: "Department/Ind. agency",
    status: "active",
    totalrecords: total,
    count: all.length,
    requestsUsed: used,
    orglist: all,
  };
  await writeFile(cachePath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${all.length} orgs → ${cachePath} (${used} API requests)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
