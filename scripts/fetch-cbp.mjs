#!/usr/bin/env node
/**
 * Download CBP Southwest Land Border Encounters CSV and bake a snapshot.
 *
 *   npm run fetch:cbp
 *   npm run fetch:cbp -- --force
 *
 * Free — no API key. Writes data/raw/cbp/* and data/nested/cbp-encounters.json.
 *
 * Metric: encounters (apprehensions / inadmissibles / expulsions) — NOT admissions.
 */
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw", "cbp");
const NESTED = join(ROOT, "data", "nested", "cbp-encounters.json");
const INDEX = "https://www.cbp.gov/document/stats/southwest-land-border-encounters";
const UA = "GovDash/1 (citizen map; +https://govdash.markmaga.com)";

const MONTHS = {
  OCT: 1,
  NOV: 2,
  DEC: 3,
  JAN: 4,
  FEB: 5,
  MAR: 6,
  APR: 7,
  MAY: 8,
  JUN: 9,
  JUL: 10,
  AUG: 11,
  SEP: 12,
};

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

function absUrl(href) {
  if (/^https?:/i.test(href)) return href;
  if (href.startsWith("/")) return `https://www.cbp.gov${href}`;
  return `https://www.cbp.gov/${href}`;
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

function pickLatestCsv(html) {
  const re =
    /href="([^"]*sbo-encounters-fy[^"]+\.csv)"[^>]*>[\s\S]*?<\/a>/gi;
  const hits = [];
  let m;
  while ((m = re.exec(html))) {
    hits.push(m[1].replace(/&amp;/g, "&"));
  }
  // Also bare hrefs
  const re2 = /href="([^"]*sbo-encounters-fy[^"]+\.csv)"/gi;
  while ((m = re2.exec(html))) {
    const href = m[1].replace(/&amp;/g, "&");
    if (!hits.includes(href)) hits.push(href);
  }
  if (!hits.length) return null;
  // Prefer FYTD current file with latest month in path (jul > jun > …)
  const scored = hits.map((href) => {
    const mon = (href.match(/-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\.csv/i) || [])[1];
    const order = mon ? MONTHS[mon.toUpperCase().slice(0, 3)] || 0 : 0;
    const fytd = /fytd|fy\d{2}-fy\d{2}/i.test(href) ? 1 : 0;
    return { href, order, fytd };
  });
  scored.sort((a, b) => b.fytd - a.fytd || b.order - a.order);
  return scored[0].href;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function bake(csvPath, sourceUrl) {
  const rl = createInterface({ input: createReadStream(csvPath, "utf8"), crlfDelay: Infinity });
  let headers = null;
  const rows = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!headers) {
      headers = cols;
      continue;
    }
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? "";
    });
    rows.push(obj);
  }

  // Current FY rows: "2026 (FYTD)" or highest FY
  const fys = [...new Set(rows.map((r) => r["Fiscal Year"]))];
  const fytd = fys.find((f) => /FYTD/i.test(f)) || fys.sort().at(-1);
  const fyRows = rows.filter(
    (r) => r["Fiscal Year"] === fytd && r["Month Grouping"] === "FYTD"
  );

  const byMonth = new Map();
  const byDemo = new Map();
  for (const r of fyRows) {
    const mon = r["Month (abbv)"];
    const n = Number(r["Encounter Count"] || 0);
    if (!Number.isFinite(n)) continue;
    byMonth.set(mon, (byMonth.get(mon) || 0) + n);
    const demo = r.Demographic || "Other";
    byDemo.set(demo, (byDemo.get(demo) || 0) + n);
  }

  // Latest month in FY order (OCT…SEP)
  const present = [...byMonth.keys()].sort(
    (a, b) => (MONTHS[a] || 0) - (MONTHS[b] || 0)
  );
  const latest = present.at(-1);
  const latestTotal = byMonth.get(latest) || 0;

  // FYTD cumulative through latest = sum of monthly values in this file
  // (CBP labels Month Grouping FYTD but values are that month’s encounters.)
  const fytdTotal = [...byMonth.values()].reduce((a, b) => a + b, 0);

  const fiscalYear = Number(String(fytd).match(/20\d{2}/)?.[0] || 0) || null;

  // Latest-month demographic slice
  const latestDemo = new Map();
  for (const r of fyRows) {
    if (r["Month (abbv)"] !== latest) continue;
    const n = Number(r["Encounter Count"] || 0);
    if (!Number.isFinite(n)) continue;
    const demo = r.Demographic || "Other";
    latestDemo.set(demo, (latestDemo.get(demo) || 0) + n);
  }

  const monthRows = present.map((m) => ({
    month: m,
    total: byMonth.get(m) || 0,
  }));

  const demoRows = [...latestDemo.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const monPretty = {
    OCT: "Oct",
    NOV: "Nov",
    DEC: "Dec",
    JAN: "Jan",
    FEB: "Feb",
    MAR: "Mar",
    APR: "Apr",
    MAY: "May",
    JUN: "Jun",
    JUL: "Jul",
    AUG: "Aug",
    SEP: "Sep",
  };
  // Calendar year of that FY month (FY starts in Oct of prior calendar year).
  let asOfLabel = latest || "—";
  if (latest && fiscalYear) {
    const calYear = ["OCT", "NOV", "DEC"].includes(latest)
      ? fiscalYear - 1
      : fiscalYear;
    asOfLabel = `${monPretty[latest] || latest} ${calYear}`;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    asOfLabel,
    fiscalYear,
    latestMonth: latest,
    latestTotal,
    fytdTotal,
    sourceName: "CBP Southwest Land Border Encounters",
    sourceUrl: "https://www.cbp.gov/newsroom/stats/southwest-land-border-encounters",
    csvUrl: sourceUrl,
    months: monthRows,
    byDemographic: demoRows,
    note:
      "Southwest land border encounters (USBP + OFO). Monthly public CSV from CBP. " +
      "One person can appear more than once.",
  };

  await writeFile(NESTED, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${NESTED} — FY${fiscalYear} ${latest}=${latestTotal} FYTD=${fytdTotal}`
  );
  return payload;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });
  const csvPath = join(OUT, "sbo-encounters.csv");
  const manifestPath = join(OUT, "manifest.json");

  if (!opts.force && (await exists(csvPath)) && (await exists(manifestPath))) {
    const age = Date.now() - JSON.parse(await readFile(manifestPath, "utf8")).fetchedAtMs;
    if (Number.isFinite(age) && age < 12 * 3600e3) {
      console.log("cbp raw is fresh (<12h). Use --force to refetch.");
      await bake(csvPath, JSON.parse(await readFile(manifestPath, "utf8")).csvUrl);
      return;
    }
  }

  console.log("Fetching CBP encounters document page…");
  const html = await getText(INDEX);
  const href = pickLatestCsv(html);
  if (!href) throw new Error("Could not find sbo-encounters CSV on CBP page");
  const csvUrl = absUrl(href);
  console.log(`CSV: ${csvUrl}`);
  await download(csvUrl, csvPath);
  await writeFile(
    manifestPath,
    JSON.stringify(
      { fetchedAt: new Date().toISOString(), fetchedAtMs: Date.now(), csvUrl, index: INDEX },
      null,
      2
    )
  );
  await bake(csvPath, csvUrl);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
