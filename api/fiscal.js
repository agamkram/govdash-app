/**
 * Same-origin Treasury proxy. Monterey Safari cannot verify
 * Sectigo R46 on api.fiscaldata.treasury.gov; Vercel can.
 */
const BASE =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";

const DATASETS = {
  debt_to_penny: "/v2/accounting/od/debt_to_penny",
  interest_expense: "/v2/accounting/od/interest_expense",
  mts_table_1: "/v1/accounting/mts/mts_table_1",
  mts_table_4: "/v1/accounting/mts/mts_table_4",
};

const PASS = new Set(["sort", "page[size]", "page[number]", "fields", "filter"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  const dataset = String(req.query?.dataset || "");
  const path = DATASETS[dataset];
  if (!path) {
    res.status(400).json({ error: "bad dataset" });
    return;
  }
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k === "dataset" || !PASS.has(k)) continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (val != null && val !== "") u.searchParams.set(k, String(val));
  }
  const r = await fetch(u, {
    headers: { Accept: "application/json", "User-Agent": "GovDash/1" },
  });
  const text = await r.text();
  res.status(r.status);
  res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
  res.send(text);
}
