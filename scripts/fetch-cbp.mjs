#!/usr/bin/env node
/**
 * Download CBP Nationwide Encounters CSV and bake a Border snapshot.
 *
 *   npm run fetch:cbp
 *   npm run fetch:cbp -- --force
 *
 * Free — no API key. Writes data/raw/cbp/* and data/nested/cbp-encounters.json.
 *
 * Metric: encounters (apprehensions / inadmissibles / expulsions) — NOT admissions.
 * Regions from Land Border Region: Southwest, Northern, Other, plus Nationwide sum.
 * Home card still leads with Southwest; detail shows all regions.
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
const INDEX = "https://www.cbp.gov/document/stats/nationwide-encounters";
const SW_PAGE = "https://www.cbp.gov/newsroom/stats/southwest-land-border-encounters";
const NW_PAGE = "https://www.cbp.gov/newsroom/stats/nationwide-encounters";
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

const MON_PRETTY = {
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
  const r = await fetch(url, {
    headers: { Accept: "text/html", "User-Agent": UA },
  });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}

async function download(url, dest) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
}

/** Prefer latest FYTD nationwide AOR CSV (has Land Border Region). */
function pickLatestCsv(html) {
  const re = /href="([^"]*nationwide-encounters-fy[^"]+-aor\.csv)"/gi;
  const hits = [];
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].replace(/&amp;/g, "&");
    if (!hits.includes(href)) hits.push(href);
  }
  if (!hits.length) return null;
  const scored = hits.map((href) => {
    const mon = (href.match(
      /-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:-aor)?\.csv/i
    ) || [])[1];
    const order = mon ? MONTHS[mon.toUpperCase().slice(0, 3)] || 0 : 0;
    const fyBits = [...href.matchAll(/fy(\d{2})/gi)].map((x) => Number(x[1]));
    const maxFy = fyBits.length ? Math.max(...fyBits) : 0;
    return { href, order, maxFy };
  });
  scored.sort((a, b) => b.maxFy - a.maxFy || b.order - a.order);
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

function regionKey(label) {
  const s = String(label || "");
  if (/southwest/i.test(s)) return "southwest";
  if (/northern/i.test(s)) return "northern";
  if (/^other$/i.test(s)) return "other";
  return null;
}

function packRegion(byMonth) {
  const present = [...byMonth.keys()].sort(
    (a, b) => (MONTHS[a] || 0) - (MONTHS[b] || 0)
  );
  const latest = present.at(-1) || null;
  const latestTotal = latest ? byMonth.get(latest) || 0 : 0;
  const fytdTotal = [...byMonth.values()].reduce((a, b) => a + b, 0);
  return {
    latestMonth: latest,
    latestTotal,
    fytdTotal,
    months: present.map((m) => ({ month: m, total: byMonth.get(m) || 0 })),
  };
}

async function bake(csvPath, sourceUrl) {
  const rl = createInterface({
    input: createReadStream(csvPath, "utf8"),
    crlfDelay: Infinity,
  });
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

  const fys = [...new Set(rows.map((r) => r["Fiscal Year"]))];
  const fytd = fys.find((f) => /FYTD/i.test(f)) || fys.sort().at(-1);
  const fyRows = rows.filter(
    (r) => r["Fiscal Year"] === fytd && r["Month Grouping"] === "FYTD"
  );

  const byRegionMonth = {
    southwest: new Map(),
    northern: new Map(),
    other: new Map(),
    nationwide: new Map(),
  };

  for (const r of fyRows) {
    const mon = r["Month (abbv)"];
    const n = Number(r["Encounter Count"] || 0);
    if (!mon || !Number.isFinite(n)) continue;
    const key = regionKey(r["Land Border Region"]);
    if (key) {
      byRegionMonth[key].set(mon, (byRegionMonth[key].get(mon) || 0) + n);
    }
    byRegionMonth.nationwide.set(
      mon,
      (byRegionMonth.nationwide.get(mon) || 0) + n
    );
  }

  const southwest = packRegion(byRegionMonth.southwest);
  const northern = packRegion(byRegionMonth.northern);
  const other = packRegion(byRegionMonth.other);
  const nationwide = packRegion(byRegionMonth.nationwide);

  const latest = southwest.latestMonth || nationwide.latestMonth;
  const fiscalYear = Number(String(fytd).match(/20\d{2}/)?.[0] || 0) || null;

  // SW latest-month demographics (same slice the old SBO card showed)
  const latestDemo = new Map();
  for (const r of fyRows) {
    if (r["Month (abbv)"] !== latest) continue;
    if (regionKey(r["Land Border Region"]) !== "southwest") continue;
    const n = Number(r["Encounter Count"] || 0);
    if (!Number.isFinite(n)) continue;
    const demo = r.Demographic || "Other";
    latestDemo.set(demo, (latestDemo.get(demo) || 0) + n);
  }
  const demoRows = [...latestDemo.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  let asOfLabel = latest || "—";
  if (latest && fiscalYear) {
    const calYear = ["OCT", "NOV", "DEC"].includes(latest)
      ? fiscalYear - 1
      : fiscalYear;
    asOfLabel = `${MON_PRETTY[latest] || latest} ${calYear}`;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    asOfLabel,
    fiscalYear,
    // Home card still leads with Southwest land border.
    latestMonth: southwest.latestMonth,
    latestTotal: southwest.latestTotal,
    fytdTotal: southwest.fytdTotal,
    southwest,
    northern,
    other,
    nationwide,
    byDemographic: demoRows,
    months: southwest.months,
    sourceName: "CBP encounters (nationwide CSV)",
    sourceUrl: NW_PAGE,
    southwestSourceUrl: SW_PAGE,
    csvUrl: sourceUrl,
    note:
      "CBP encounters (USBP + OFO): Southwest and Northern land borders, plus Other. " +
      "Nationwide is the sum. Card total is Southwest. One person can appear more than once.",
  };

  await writeFile(NESTED, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${NESTED} — ${asOfLabel} SW=${southwest.latestTotal} N=${northern.latestTotal} US=${nationwide.latestTotal} (FYTD SW=${southwest.fytdTotal})`
  );
  return payload;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });
  const csvPath = join(OUT, "nationwide-encounters-aor.csv");
  const manifestPath = join(OUT, "manifest.json");

  if (!opts.force && (await exists(csvPath)) && (await exists(manifestPath))) {
    const man = JSON.parse(await readFile(manifestPath, "utf8"));
    const age = Date.now() - man.fetchedAtMs;
    if (Number.isFinite(age) && age < 12 * 3600e3) {
      console.log("cbp raw is fresh (<12h). Use --force to refetch.");
      await bake(csvPath, man.csvUrl);
      return;
    }
  }

  console.log("Fetching CBP nationwide encounters document page…");
  const html = await getText(INDEX);
  const href = pickLatestCsv(html);
  if (!href) {
    throw new Error("Could not find nationwide-encounters AOR CSV on CBP page");
  }
  const csvUrl = absUrl(href);
  console.log(`CSV: ${csvUrl}`);
  await download(csvUrl, csvPath);
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        fetchedAtMs: Date.now(),
        csvUrl,
        index: INDEX,
      },
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
