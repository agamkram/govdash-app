#!/usr/bin/env node
/**
 * Fetch heat-signal caches (USAspending toptier + Federal Register agencies/counts).
 *
 * Usage:
 *   npm run fetch:heat
 *   npm run fetch:heat -- --force
 *   npm run fetch:heat -- --fr-limit 60
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw", "heat");
const TREE = join(ROOT, "data", "nested", "gov-tree.json");

function parseArgs(argv) {
  const opts = { force: false, frLimit: 80 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--force") opts.force = true;
    if (argv[i] === "--fr-limit") opts.frLimit = Number(argv[++i]);
  }
  return opts;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

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
    .replace(/\bNATIONAL AERONAUTICS AND SPACE ADMINISTRATION\b/g, " NASA ")
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

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });

  const spendPath = join(OUT, "usaspending-toptier.json");
  const frAgenciesPath = join(OUT, "federal-register-agencies.json");
  const frCountsPath = join(OUT, "federal-register-counts.json");

  // --- USAspending (1 call) ---
  if (!opts.force && (await exists(spendPath))) {
    console.log("Cache hit: usaspending-toptier.json");
  } else {
    console.log("Fetching USAspending toptier agencies…");
    const data = await fetchJson(
      "https://api.usaspending.gov/api/v2/references/toptier_agencies/"
    );
    const payload = {
      fetchedAt: new Date().toISOString(),
      source: "https://api.usaspending.gov/api/v2/references/toptier_agencies/",
      count: (data.results || []).length,
      results: data.results || [],
    };
    await writeFile(spendPath, JSON.stringify(payload, null, 2));
    console.log(`  ${payload.count} agencies → ${spendPath}`);
  }

  // --- Federal Register agency directory (1 call) ---
  if (!opts.force && (await exists(frAgenciesPath))) {
    console.log("Cache hit: federal-register-agencies.json");
  } else {
    console.log("Fetching Federal Register agencies…");
    const agencies = await fetchJson(
      "https://www.federalregister.gov/api/v1/agencies.json"
    );
    const payload = {
      fetchedAt: new Date().toISOString(),
      source: "https://www.federalregister.gov/api/v1/agencies.json",
      count: agencies.length,
      agencies,
    };
    await writeFile(frAgenciesPath, JSON.stringify(payload, null, 2));
    console.log(`  ${payload.count} agencies → ${frAgenciesPath}`);
  }

  // --- FR document counts for best-matched tree nodes ---
  if (!opts.force && (await exists(frCountsPath))) {
    console.log("Cache hit: federal-register-counts.json (use --force to refresh)");
  } else {
    const tree = JSON.parse(await readFile(TREE, "utf8"));
    const fr = JSON.parse(await readFile(frAgenciesPath, "utf8"));
    const nodes = walk(tree.tree).filter(
      (n) => n.sources?.sam || n.sources?.usgm || n.kind === "department"
    );

    // Pick FR agencies that look like a tree node
    const candidates = [];
    for (const agency of fr.agencies || []) {
      if (agency.parent_id != null) continue; // prefer top-level
      let best = null;
      for (const n of nodes) {
        const j = Math.max(
          jaccard(agency.name, n.name),
          agency.short_name ? jaccard(agency.short_name, n.short || n.name) : 0
        );
        if (!best || j > best.j) best = { n, j };
      }
      if (best && best.j >= 0.72) {
        candidates.push({
          frId: agency.id,
          frName: agency.name,
          frSlug: agency.slug,
          nodeId: best.n.id,
          nodeName: best.n.name,
          match: best.j,
        });
      }
    }

    // Prefer higher match / unique node
    candidates.sort((a, b) => b.match - a.match);
    const usedNodes = new Set();
    const selected = [];
    for (const c of candidates) {
      if (usedNodes.has(c.nodeId)) continue;
      usedNodes.add(c.nodeId);
      selected.push(c);
      if (selected.length >= opts.frLimit) break;
    }

    console.log(
      `Fetching Federal Register doc counts for ${selected.length} matched agencies (since 2025-01-01)…`
    );
    const since = "2025-01-01";
    const counts = [];
    const concurrency = 6;
    let i = 0;
    async function worker() {
      while (i < selected.length) {
        const idx = i++;
        const c = selected[idx];
        const url =
          `https://www.federalregister.gov/api/v1/documents.json?per_page=1` +
          `&conditions%5Bagency_ids%5D%5B%5D=${c.frId}` +
          `&conditions%5Bpublication_date%5D%5Bgte%5D=${since}`;
        try {
          const d = await fetchJson(url);
          counts.push({ ...c, documentCount: d.count ?? 0, since });
          process.stdout.write(".");
        } catch (err) {
          counts.push({ ...c, documentCount: null, error: String(err.message || err), since });
          process.stdout.write("x");
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    process.stdout.write("\n");

    const payload = {
      fetchedAt: new Date().toISOString(),
      since,
      count: counts.length,
      results: counts.sort((a, b) => (b.documentCount || 0) - (a.documentCount || 0)),
    };
    await writeFile(frCountsPath, JSON.stringify(payload, null, 2));
    console.log(`  Wrote ${frCountsPath}`);
  }

  console.log("Done. Next: npm run enrich:heat");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
