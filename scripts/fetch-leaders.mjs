#!/usr/bin/env node
/**
 * Refresh live leadership from official .gov pages (not the annual Manual).
 *
 *   npm run fetch:leaders
 *   npm run fetch:leaders -- --force
 *
 * Writes data/raw/leaders/current.json (keeps last good row if a page fails).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "data", "raw", "leaders");
const CATALOG = join(DIR, "catalog.json");
const CURRENT = join(DIR, "current.json");
const WH_URL = "https://www.whitehouse.gov/administration/the-cabinet/";
const WH_URL_ALT = "https://www.whitehouse.gov/administration/cabinet/";
const UA =
  "Mozilla/5.0 (compatible; GovDash/1; +https://govdash.markmaga.com) AppleWebKit/537.36";

/** White House Cabinet title → GovDash node id. Official .gov names. */
const WH_TITLE_TO_NODE = {
  "Secretary of the Treasury": "gsa-831",
  "Attorney General": "gsa-653",
  "Secretary of the Interior": "gsa-618",
  "Director of National Intelligence": "gsa-1700",
  "Secretary of Veterans Affairs": "gsa-848",
  "Secretary of Transportation": "gsa-798",
  "United States Trade Representative": "gsa-49",
  "Secretary of War": "gsa-162",
  "Secretary of Defense": "gsa-162",
  "Secretary of Health and Human Services": "gsa-531",
  "Administrator of the Small Business Administration": "gsa-1100",
  "Secretary of Commerce": "gsa-120",
  "Secretary of Education": "gsa-397",
  "Secretary of Homeland Security": "gsa-561",
  "Director of the Central Intelligence Agency": "gsa-911",
  "Secretary of Agriculture": "gsa-62",
  "Secretary of State": "gsa-728",
  "Secretary of Labor": "gsa-696",
  "Secretary of Housing and Urban Development": "gsa-579",
  "Director of the Office of Management and Budget": "gsa-45",
  "Secretary of Energy": "gsa-448",
  "Administrator of the Environmental Protection Agency": "gsa-930",
};

function decode(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(s) {
  let n = decode(s);
  n = n.replace(/\s+[–—-]\s+.*$/, ""); // "Tim Schell - Center for…"
  n = n.replace(/,?\s*(Chief Counsel|J\.D\.)\s*$/i, (m) =>
    /J\.D\./i.test(m) ? m.replace(/,\s*Chief Counsel/i, "") : ""
  );
  n = n.replace(/\s+/g, " ").trim();
  if (!n || n.length < 4) return "";
  if (/flag|logo|seal|banner|icon|photo|portrait/i.test(n)) return "";
  if (!/[A-Za-z]{2,}\s+[A-Za-z]/.test(n) && !/[A-Z][a-z]+\s+[A-Z]/.test(n)) {
    // Need at least two name-ish tokens (allow "Kyle Diamantas, J.D.")
    if (!/^[A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+)+/.test(n)) return "";
  }
  return n;
}

async function getHtml(url) {
  const r = await fetch(url, {
    headers: { Accept: "text/html", "User-Agent": UA },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function parseFdaCards(html) {
  const blocks = html.split(/<div class="lcds-card /);
  const people = [];
  const seen = new Set();
  for (const b of blocks.slice(1)) {
    const tm = b.match(/lcds-card__title[^>]*>([\s\S]*?)<\//);
    const am = b.match(/alt="([^"]+)"/);
    const title = decode(tm ? tm[1] : "");
    let name = cleanName(am ? am[1] : "");
    if (!title || title.length > 120) continue;
    if (!name || name.length < 4) continue;
    const key = `${title}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ title, name });
  }
  return people;
}

function parseGsaDirectory(html) {
  const people = [];
  const re =
    /<(?:h2|h3|p|div)[^>]*>\s*<a[^>]+>([^<]{3,80})<\/a>\s*<\/(?:h2|h3|p|div)>[\s\S]{0,200}?<(?:p|div|span)[^>]*>\s*([^<]{3,80})\s*</gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(html))) {
    const name = cleanName(m[1]);
    const title = decode(m[2]);
    if (!name || !title) continue;
    if (/skip to|menu|search/i.test(name)) continue;
    const key = `${title}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ title, name });
  }
  return people;
}

function parseFirstPersonHeading(html, seat) {
  const alt = html.match(/alt="([^"]{4,80})"/);
  const og = html.match(
    /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i
  );
  let name = "";
  if (alt) name = cleanName(alt[1]);
  if (!name && og) {
    name = cleanName(og[1].split("|")[0].split("–")[0].split("-")[0]);
  }
  if (!name) return [];
  return [{ title: seat || "Head", name }];
}

function parseWith(entry, html) {
  if (entry.parser === "fda-cards") return parseFdaCards(html);
  if (entry.parser === "gsa-directory") return parseGsaDirectory(html);
  if (entry.parser === "first-person-heading") {
    return parseFirstPersonHeading(html, entry.seat);
  }
  return [];
}

function parseWhiteHouseCabinet(html) {
  const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  const pairs = [];
  const h2 = [...stripped.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  for (const m of h2) {
    const name = cleanName(m[1]);
    if (!name) continue;
    if (/about|media|subscribe|download|updates|initiative/i.test(name)) continue;
    const after = stripped.slice(m.index + m[0].length, m.index + m[0].length + 900);
    const h3 = after.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const title = decode(h3 ? h3[1] : "");
    if (!title || title.length > 90) continue;
    if (!WH_TITLE_TO_NODE[title]) continue;
    pairs.push({ title, name, id: WH_TITLE_TO_NODE[title] });
  }
  return pairs;
}

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  await mkdir(DIR, { recursive: true });
  let catalog;
  try {
    catalog = JSON.parse(await readFile(CATALOG, "utf8"));
  } catch (e) {
    throw new Error(`Bad catalog.json: ${e.message}`);
  }
  const prev = await loadJson(CURRENT, { orgs: {} });
  const next = {
    fetchedAt: new Date().toISOString(),
    orgs: { ...(prev.orgs || {}) },
  };

  // 1) White House Cabinet page — official current principals
  try {
    let html;
    try {
      html = await getHtml(WH_URL);
    } catch {
      html = await getHtml(WH_URL_ALT);
    }
    const pairs = parseWhiteHouseCabinet(html);
    if (!pairs.length) throw new Error("parsed 0 cabinet seats");
    const seen = new Set();
    for (const p of pairs) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      next.orgs[p.id] = {
        id: p.id,
        short: p.title,
        url: WH_URL_ALT,
        sourceName: "White House Cabinet",
        fetchedAt: new Date().toISOString(),
        people: [{ title: p.title, name: p.name }],
      };
    }
    console.log(`OK  White House Cabinet: ${seen.size} principals`);
    for (const p of pairs) {
      console.log(`     ${p.title} — ${p.name}`);
    }
  } catch (e) {
    console.warn(`FAIL White House Cabinet: ${e.message} — keeping last good`);
  }

  // 2) Per-agency official pages in the catalog
  for (const entry of catalog.nodes || []) {
    try {
      const html = await getHtml(entry.url);
      const people = parseWith(entry, html).slice(0, entry.maxPeople || 14);
      if (!people.length) throw new Error("parsed 0 people");
      next.orgs[entry.id] = {
        id: entry.id,
        short: entry.short,
        url: entry.url,
        sourceName: entry.sourceName || entry.short,
        fetchedAt: new Date().toISOString(),
        people,
      };
      console.log(
        `OK  ${entry.short}: ${people.length}  (${people[0].title} — ${people[0].name})`
      );
    } catch (e) {
      const keep = next.orgs[entry.id];
      console.warn(
        `FAIL ${entry.short}: ${e.message}${keep ? " — keeping last good" : ""}`
      );
    }
  }

  await writeFile(CURRENT, JSON.stringify(next, null, 2));
  console.log(`Wrote ${Object.keys(next.orgs).length} orgs → data/raw/leaders/current.json`);
  console.log("Next: npm run enrich:leaders");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
