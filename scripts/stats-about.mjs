#!/usr/bin/env node
/**
 * Write About coverage from the merged product + Beyond map.
 * Usage: npm run stats:about
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachBeyondDoors } from "../shared.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "nested", "about-stats.json");

function walk(n, out = []) {
  out.push(n);
  for (const c of n.children || []) walk(c, out);
  return out;
}

function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${Math.round(a / 1e6)}M`;
  return `${sign}$${a.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtCount(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

function monthLabel(raw) {
  const s = String(raw || "");
  if (s.length === 6) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const m = months[Number(s.slice(4, 6)) - 1];
    return m ? `${m} ${s.slice(0, 4)}` : s;
  }
  return s;
}

function desc(n) {
  let c = 0;
  for (const k of n.children || []) c += 1 + desc(k);
  return c;
}

function hasSpend(node) {
  const sp = node.spending;
  return !!(sp && (sp.obligatedAmount != null || sp.outlayAmount != null));
}

function cabinetLabel(d) {
  if (/Army/i.test(d.name || "")) return d.short ? `Army (${d.short})` : "Army (USA)";
  if (d.short && d.short.length <= 8) return d.short;
  return d.name || d.short || "—";
}

const prod = JSON.parse(
  await readFile(join(ROOT, "data/nested/gov-tree-product.json"), "utf8")
);
const beyondData = JSON.parse(
  await readFile(join(ROOT, "data/nested/gov-tree-beyond.json"), "utf8")
);
const root = attachBeyondDoors(prod.tree, beyondData.tree);
const nodes = walk(root);
const n = nodes.length;

const kinds = {};
let leaves = 0;
const fan = { 0: 0, 1: 0, "2-5": 0, "6-20": 0, "21+": 0 };
let wfDirect = 0;
let wfRoll = 0;
const wfLevel = {};
let spendTop = 0;
let spendSub = 0;
let spendRoll = 0;
let usgm = 0;
let sam = 0;
let mission = 0;
let leaders = 0;
let web = 0;
let phone = 0;
let short = 0;
let cw = 0;
let dept = 0;
let independents = 0;

for (const node of nodes) {
  const kind = node.kind || "unknown";
  kinds[kind] = (kinds[kind] || 0) + 1;
  if (!node.children?.length) leaves++;
  const kc = (node.children || []).length;
  if (kc === 0) fan[0]++;
  else if (kc === 1) fan[1]++;
  else if (kc <= 5) fan["2-5"]++;
  else if (kc <= 20) fan["6-20"]++;
  else fan["21+"]++;

  if (node.workforce?.count != null) {
    if (node.workforce.rolledUp) wfRoll++;
    else {
      wfDirect++;
      const level = node.workforce.level || "direct";
      wfLevel[level] = (wfLevel[level] || 0) + 1;
    }
  }
  const sp = node.spending;
  if (hasSpend(node)) {
    if (sp.rolledUp) spendRoll++;
    else if (sp.grain === "subtier") spendSub++;
    else spendTop++;
  }
  if (node.sources?.usgm) usgm++;
  if (node.sources?.sam) sam++;
  if (node.sources?.usgm?.mission?.length) mission++;
  if (node.sources?.usgm?.leadership?.length) leaders++;
  if (node.sources?.usgm?.web) web++;
  if (node.sources?.usgm?.phone) phone++;
  if (node.short) short++;
  if (node.sources?.crosswalk) cw++;
  if (node.kind === "department") dept++;
  if (node.kind === "independent") independents++;
}

function depthMap(node, d = 0, acc = {}) {
  acc[d] = (acc[d] || 0) + 1;
  for (const c of node.children || []) depthMap(c, d + 1, acc);
  return acc;
}
const depth = depthMap(root);
const maxDepth = Math.max(...Object.keys(depth).map(Number));

const spendShown = spendTop + spendSub + spendRoll;
const spendDirect = spendTop + spendSub;
const wfShown = wfDirect + wfRoll;
const leafPct = n ? ((leaves / n) * 100).toFixed(1) : "0";

const wfAsOf = prod.meta?.workforce?.asOf || "";
let spendPeriod = "FY snapshot";
for (const node of nodes) {
  if (node.spending?.asOf && !node.spending.rolledUp && node.spending.grain !== "subtier") {
    spendPeriod = node.spending.asOf;
    break;
  }
}

const kindOrder = Object.entries(kinds).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const kindRows = [];
let bucket = 0;
let sovereign = 0;
for (const [k, v] of kindOrder) {
  if (k === "bucket") bucket = v;
  else if (k === "sovereign") sovereign = v;
  else kindRows.push({ label: k, count: v });
}
if (bucket || sovereign) {
  kindRows.push({
    label: "bucket / sovereign",
    countLabel: `${fmtCount(bucket)} / ${fmtCount(sovereign)}`,
    count: null,
  });
}

const depthRows = Object.keys(depth)
  .map(Number)
  .sort((a, b) => a - b)
  .map((d) => ({
    label: d === 0 ? "0 (root)" : d === 1 ? "1 (six doors)" : String(d),
    count: depth[d],
  }));

const doors = (root.children || []).map((d) => {
  const under = walk(d);
  const doorLeaves = under.filter((x) => !x.children?.length).length;
  return {
    short: d.short,
    name: d.name,
    nodes: under.length,
    leaves: doorLeaves,
    withSpend: under.filter(hasSpend).length,
    wf: d.workforce?.count ?? null,
    wfFmt: fmtCount(d.workforce?.count),
    obligated: d.spending?.obligatedAmount ?? null,
    obligatedFmt: fmtUsd(d.spending?.obligatedAmount),
  };
});

const chartered = doors.find((d) => d.short === "Chartered");
const international = doors.find((d) => d.short === "International");

const stats = {
  generatedAt: new Date().toISOString(),
  nodes: n,
  leaves,
  leafPct,
  parents: n - leaves,
  departments: dept,
  independents,
  shorts: short,
  maxDepth,
  opmAsOf: wfAsOf,
  opmAsOfLabel: monthLabel(wfAsOf) || "OPM snapshot",
  spendPeriod,
  spendPeriodNote: `${spendPeriod} + sub-agency FY${String(spendPeriod).replace(/^FY/, "").split(" ")[0] || ""}`.replace(/\s+$/, ""),
  wfShown,
  wfBlank: n - wfShown,
  wfPct: n ? ((wfShown / n) * 100).toFixed(1) : "0",
  wfDirect,
  wfRoll,
  wfLevel,
  mission,
  spendShown,
  spendBlank: n - spendShown,
  spendPct: n ? ((spendShown / n) * 100).toFixed(1) : "0",
  spendTop,
  spendSub,
  spendRoll,
  spendDirect,
  kinds: kindRows,
  depth: depthRows,
  fan: [
    { label: "0 (leaf)", count: fan[0] },
    { label: "1", count: fan[1] },
    { label: "2–5", count: fan["2-5"] },
    { label: "6–20", count: fan["6-20"] },
    { label: "21+", count: fan["21+"] },
  ],
  identity: [
    { label: "Crosswalk identity", with: cw },
    { label: "Spending (toptier + subtier)", with: spendShown },
    { label: "USGM Manual entry", with: usgm },
    { label: "SAM.gov status", with: sam },
    { label: "Mission summary", with: mission },
    { label: "Leadership list", with: leaders },
    { label: "Manual web", with: web },
    { label: "Manual phone", with: phone },
    { label: "Short label", with: short },
  ].map((row) => ({ ...row, blank: n - row.with })),
  wfMatchRows: [
    { label: "subelement", count: wfLevel.subelement || 0 },
    { label: "rollup", count: wfRoll },
    { label: "agency", count: wfLevel.agency || 0 },
    { label: "department", count: wfLevel.department || 0 },
  ],
  spendMatchRows: [
    { label: "direct toptier", count: spendTop },
    { label: "sub-agency", count: spendSub },
    { label: "rollup", count: spendRoll },
    { label: "blank", count: n - spendShown },
  ],
  doors,
  cabinets: walk(root)
    .filter((x) => x.kind === "department")
    .map((d) => ({
      label: cabinetLabel(d),
      name: d.name,
      wf: d.workforce?.count ?? null,
      wfFmt: fmtCount(d.workforce?.count),
      obligated: d.spending?.obligatedAmount ?? null,
      obligatedFmt: fmtUsd(d.spending?.obligatedAmount),
      grain: d.spending?.grain || (d.spending?.rolledUp ? "rollup" : null),
      beneath: desc(d),
    }))
    .sort((a, b) => (b.wf || 0) - (a.wf || 0)),
  chartered: chartered
    ? {
        nodes: chartered.nodes,
        leaves: chartered.leaves,
        wf: chartered.wf,
        obligatedFmt: chartered.obligatedFmt,
      }
    : null,
  international: international
    ? {
        nodes: international.nodes,
        leaves: international.leaves,
        wf: international.wf,
        obligatedFmt: international.obligatedFmt,
      }
    : null,
  bar: {
    spendDirectPct: n ? ((spendDirect / n) * 100).toFixed(1) : "0",
    spendRollPct: n ? ((spendRoll / n) * 100).toFixed(1) : "0",
    wfDirectPct: n ? ((wfDirect / n) * 100).toFixed(1) : "0",
    wfRollPct: n ? ((wfRoll / n) * 100).toFixed(1) : "0",
  },
  fmt: {
    nodes: fmtCount(n),
    leaves: fmtCount(leaves),
    parents: fmtCount(n - leaves),
    departments: fmtCount(dept),
    wfShown: fmtCount(wfShown),
    wfBlank: fmtCount(n - wfShown),
    mission: fmtCount(mission),
    spendShown: fmtCount(spendShown),
    spendBlank: fmtCount(n - spendShown),
    spendDirect: fmtCount(spendDirect),
    spendTop: fmtCount(spendTop),
    spendSub: fmtCount(spendSub),
    spendRoll: fmtCount(spendRoll),
    wfDirect: fmtCount(wfDirect),
    wfRoll: fmtCount(wfRoll),
    shorts: fmtCount(short),
    independents: fmtCount(independents),
  },
};

await writeFile(OUT, JSON.stringify(stats, null, 2) + "\n");
console.log(
  `About stats → ${OUT} · ${stats.fmt.nodes} nodes · spend ${stats.fmt.spendShown} · ${stats.opmAsOfLabel} · ${stats.spendPeriod}`
);
