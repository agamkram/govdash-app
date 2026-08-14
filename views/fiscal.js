/**
 * In-app federal money page — debt, interest, receipts/outlays, agency
 * obligated, ZIP place-of-performance. Official Treasury + USAspending.
 */

const FISCAL_BASE =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";

/** Last-resort Census PEP figure if us-population.json cannot be loaded. */
const POP_FALLBACK = {
  pop: 340110988,
  year: "2024",
  asOf: "2024-07-01",
  source: "U.S. Census Bureau PEP (bundled fallback)",
};

const POP_URL = "./data/raw/census/us-population.json";

const LINKS = [
  {
    href: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/debt-to-the-penny",
    label: "Debt to the Penny",
  },
  {
    href: "https://fiscaldata.treasury.gov/datasets/interest-expense-debt-outstanding/interest-expense-on-the-public-debt-outstanding",
    label: "Interest expense",
  },
  {
    href: "https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/summary-of-receipts-outlays-and-the-deficit-surplus-of-the-u-s-government",
    label: "Monthly Treasury Statement",
  },
  { href: "https://www.usaspending.gov/", label: "USAspending.gov" },
];

function fiscalUrl(path, params) {
  const u = new URL(`${FISCAL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatUsd(n, { digits = 2, compact = false } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  if (compact) {
    const sign = x < 0 ? "-" : "";
    const a = Math.abs(x);
    if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  }
  return x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function perPerson(n, pop) {
  const p = Number(n) / Number(pop);
  if (!Number.isFinite(p)) return "—";
  return formatUsd(p, { digits: Math.abs(p) >= 1000 ? 0 : 2 });
}

function monthLabel(iso) {
  if (!iso) return "—";
  const [y, m] = String(iso).split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function monthLong(iso) {
  if (!iso) return "—";
  const [y, m] = String(iso).split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function monthsAgoIso(n) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

function isPublicCategory(row) {
  const blob = `${row.expense_catg_desc || ""} ${row.expense_group_desc || ""}`.toLowerCase();
  if (/government account|intragov|\bgas\b/.test(blob)) return false;
  return /public/.test(blob);
}

function printOrder(row) {
  return Number(row.print_order_nbr) || 0;
}

function amt(row, key) {
  const n = Number(row?.[key]);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function proxyUrl(dataset, params) {
  const u = new URL("/api/fiscal", location.origin);
  u.searchParams.set("dataset", dataset);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

async function fetchTreasury(dataset, path, params) {
  try {
    return await fetchJson(proxyUrl(dataset, params));
  } catch {
    return await fetchJson(fiscalUrl(path, params));
  }
}

function walk(node, fn) {
  if (!node) return;
  fn(node);
  for (const c of node.children || []) walk(c, fn);
}

function topSpendingNodes(root, n = 10) {
  const out = [];
  walk(root, (node) => {
    if (node.spending?.rolledUp) return;
    const v = node.spending?.obligatedAmount;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out.push(node);
  });
  out.sort(
    (a, b) => (b.spending.obligatedAmount || 0) - (a.spending.obligatedAmount || 0)
  );
  return out.slice(0, n);
}

function matchAgencyNode(root, hit) {
  if (!root || !hit) return null;
  const slug = String(hit.agencySlug || hit.agency_slug || "").toLowerCase();
  const code = String(hit.code || hit.abbreviation || "").toUpperCase();
  const name = String(hit.name || "").toLowerCase();
  let slugHit = null;
  let codeHit = null;
  let nameHit = null;
  walk(root, (node) => {
    const sp = node.spending;
    if (
      slug &&
      sp?.agencySlug &&
      sp.agencySlug.toLowerCase() === slug &&
      !slugHit
    ) {
      slugHit = node;
    }
    const abbr = String(sp?.abbreviation || node.short || "").toUpperCase();
    if (code && abbr && abbr === code && !codeHit) codeHit = node;
    if (name && node.name && node.name.toLowerCase() === name && !nameHit) {
      nameHit = node;
    }
  });
  return slugHit || nameHit || codeHit;
}

function sparkSvg(series, colorClass) {
  if (!series || series.length < 3) return "";
  const vals = series.map((s) => s.value).filter(Number.isFinite);
  if (vals.length < 3) return "";
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const w = 240;
  const h = 44;
  const p = 3;
  const pts = series
    .map((s, i) => {
      const x = p + (i / (series.length - 1)) * (w - 2 * p);
      const y = p + (1 - (s.value - min) / span) * (h - 2 * p);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const first = series[0];
  const last = series[series.length - 1];
  return `
    <svg class="fiscal-spark ${colorClass || ""}" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true">
      <polyline fill="none" stroke="currentColor" stroke-width="1.75" points="${pts}" />
    </svg>
    <p class="fiscal-spark-ends">
      <span>${esc(monthLabel(first.date))} · ${formatUsd(first.value, { compact: true })}</span>
      <span>${esc(monthLabel(last.date))} · ${formatUsd(last.value, { compact: true })}</span>
    </p>`;
}

async function loadInterest() {
  const json = await fetchTreasury(
    "interest_expense",
    "/v2/accounting/od/interest_expense",
    {
      sort: "-record_date",
      "page[size]": "2000",
      filter: `record_date:gte:${monthsAgoIso(26)}`,
    }
  );
  const rows = json?.data || [];
  if (!rows.length) throw new Error("No interest rows");
  const byDate = new Map();
  for (const r of rows) {
    const d = r.record_date;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }
  const dates = [...byDate.keys()].sort();
  const series = dates.map((d) => {
    const monthRows = byDate.get(d);
    const publicRows = monthRows.filter(isPublicCategory);
    const use = publicRows.length ? publicRows : monthRows;
    const total = use.reduce((s, r) => s + Number(r.month_expense_amt || 0), 0);
    return { date: d, value: total, publicOnly: publicRows.length > 0 };
  });
  const latest = series[series.length - 1];
  return {
    recordDate: latest.date,
    total: latest.value,
    publicOnly: latest.publicOnly,
    series: series.slice(-24),
  };
}

async function loadDebt() {
  const json = await fetchTreasury(
    "debt_to_penny",
    "/v2/accounting/od/debt_to_penny",
    {
      sort: "-record_date",
      "page[size]": "1",
    }
  );
  const row = json?.data?.[0];
  if (!row) throw new Error("No debt row");
  return {
    recordDate: row.record_date,
    total: Number(row.tot_pub_debt_out_amt),
    publicHeld: Number(row.debt_held_public_amt),
    intragov: Number(row.intragov_hold_amt),
  };
}

async function loadDebtSeries() {
  const json = await fetchTreasury(
    "debt_to_penny",
    "/v2/accounting/od/debt_to_penny",
    {
      sort: "-record_date",
      "page[size]": "24",
      filter: "record_calendar_day:eq:01",
      fields: "record_date,tot_pub_debt_out_amt",
    }
  );
  const rows = (json?.data || [])
    .map((r) => ({ date: r.record_date, value: Number(r.tot_pub_debt_out_amt) }))
    .filter((r) => Number.isFinite(r.value))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return rows;
}

function parseMtsSummary(json) {
  const rows = json?.data || [];
  if (!rows.length) throw new Error("No MTS rows");
  const latest = rows.reduce((a, b) => (a.record_date >= b.record_date ? a : b))
    .record_date;
  const month = rows.filter((r) => r.record_date === latest);
  const fyHeaders = month
    .filter((r) => /^FY\s+\d{4}/i.test(r.classification_desc || ""))
    .sort((a, b) => printOrder(a) - printOrder(b));
  const header = fyHeaders[fyHeaders.length - 1];
  const after = header
    ? month.filter((r) => printOrder(r) > printOrder(header))
    : month;
  const ytd = after.find((r) => r.classification_desc === "Year-to-Date");
  const months = after
    .filter(
      (r) =>
        r.record_type_cd === "MTH" && amt(r, "current_month_gross_rcpt_amt") != null
    )
    .sort((a, b) => printOrder(a) - printOrder(b));
  const last = months[months.length - 1];
  const fy = (header?.classification_desc || "").replace(/^FY\s+/i, "").trim();
  if (!ytd) throw new Error("No MTS year-to-date");
  return {
    fy,
    recordDate: latest,
    monthLabel: last?.classification_desc || "",
    ytdIn: amt(ytd, "current_month_gross_rcpt_amt"),
    ytdOut: amt(ytd, "current_month_gross_outly_amt"),
    ytdGap: amt(ytd, "current_month_dfct_sur_amt"),
    monthIn: last ? amt(last, "current_month_gross_rcpt_amt") : null,
    monthOut: last ? amt(last, "current_month_gross_outly_amt") : null,
    monthGap: last ? amt(last, "current_month_dfct_sur_amt") : null,
  };
}

async function loadMts() {
  const json = await fetchTreasury("mts_table_1", "/v1/accounting/mts/mts_table_1", {
    sort: "-record_date",
    "page[size]": "50",
  });
  return parseMtsSummary(json);
}

function pickReceipt(rows, desc) {
  const row = rows.find((r) => r.classification_desc === desc);
  return amt(row, "current_fytd_net_rcpt_amt");
}

async function loadReceipts() {
  const json = await fetchTreasury("mts_table_4", "/v1/accounting/mts/mts_table_4", {
    sort: "-record_date",
    "page[size]": "100",
  });
  const rows = json?.data || [];
  if (!rows.length) throw new Error("No receipt rows");
  const latest = rows.reduce((a, b) => (a.record_date >= b.record_date ? a : b))
    .record_date;
  const month = rows.filter((r) => r.record_date === latest);
  const total = pickReceipt(month, "Total -- Receipts");
  const individual = pickReceipt(month, "Total -- Individual Income Taxes");
  const oasi = pickReceipt(
    month,
    "Total -- Federal Old-Age and Survivors Insurance Trust Fund"
  );
  const di = pickReceipt(month, "Total -- Federal Disability Insurance Trust Fund");
  const hi = pickReceipt(month, "Total -- Federal Hospital Insurance Trust Fund");
  const corp = pickReceipt(month, "Corporation Income Taxes");
  const social = (oasi || 0) + (di || 0);
  const medicare = hi || 0;
  const named = (individual || 0) + social + medicare + (corp || 0);
  const other = total != null ? Math.max(0, total - named) : null;
  const slices = [
    { id: "income", label: "Individual income taxes", value: individual },
    { id: "ss", label: "Social Security (OASI + DI)", value: social },
    { id: "medicare", label: "Medicare (hospital insurance)", value: medicare },
    { id: "corp", label: "Corporation income taxes", value: corp },
    { id: "other", label: "Excise, customs, and other", value: other },
  ].filter((s) => s.value != null && s.value > 0);
  return { recordDate: latest, total, slices };
}

async function loadPopulation() {
  try {
    const json = await fetchJson(POP_URL);
    const pop = Number(json?.pop);
    if (!Number.isFinite(pop) || pop < 1e8) throw new Error("bad pop");
    return {
      pop,
      year: String(json.year || json.asOf || ""),
      source: json.source || "U.S. Census Bureau",
    };
  } catch {
    return POP_FALLBACK;
  }
}

function flowRow(cls, label, value, pop) {
  if (value == null) return "";
  return `
    <div class="fiscal-flow-row">
      <span class="fiscal-flow-k">${label}</span>
      <span class="fiscal-flow-v ${cls}">${formatUsd(value, { compact: true })}</span>
      <span class="fiscal-flow-p">${perPerson(value, pop)} / person</span>
    </div>`;
}

function flowBars(inn, out) {
  if (inn == null || out == null) return "";
  const max = Math.max(Math.abs(inn), Math.abs(out), 1);
  return `
    <div class="fiscal-flow-bars" aria-hidden="true">
      <div class="fiscal-flow-bar"><span class="fiscal-in-bar" style="width:${((Math.abs(inn) / max) * 100).toFixed(1)}%"></span></div>
      <div class="fiscal-flow-bar"><span class="fiscal-out-bar" style="width:${((Math.abs(out) / max) * 100).toFixed(1)}%"></span></div>
    </div>`;
}

function receiptStack(slices, total) {
  if (!slices?.length || !total) return "";
  const segs = slices
    .map((s) => {
      const pct = (s.value / total) * 100;
      return `<span class="fiscal-seg fiscal-seg-${s.id}" style="width:${pct.toFixed(2)}%" title="${esc(s.label)} ${pct.toFixed(1)}%"></span>`;
    })
    .join("");
  const legend = slices
    .map((s) => {
      const pct = (s.value / total) * 100;
      return `<li><span class="fiscal-swatch fiscal-seg-${s.id}"></span>${esc(s.label)} · ${pct.toFixed(0)}% · ${formatUsd(s.value, { compact: true })}</li>`;
    })
    .join("");
  return `
    <div class="fiscal-stack" role="img" aria-label="Share of federal receipts this fiscal year">${segs}</div>
    <ul class="fiscal-legend">${legend}</ul>`;
}

function agencyButtons(nodes) {
  if (!nodes?.length) return "";
  return nodes
    .map((node) => {
      const label = node.short || node.name;
      return `<button type="button" class="fiscal-agency" data-map-id="${esc(node.id)}">
        <span class="fiscal-agency-name">${esc(label)}</span>
        <span class="fiscal-agency-amt">${formatUsd(node.spending.obligatedAmount, { compact: true })}</span>
      </button>`;
    })
    .join("");
}

function awardRow(root, hit) {
  const node = matchAgencyNode(root, hit);
  const label = node ? node.short || node.name : hit.name || hit.code || "Agency";
  const amtHtml = formatUsd(hit.amount, { compact: true });
  if (node) {
    return `<button type="button" class="fiscal-agency" data-map-id="${esc(node.id)}">
      <span class="fiscal-agency-name">${esc(label)}</span>
      <span class="fiscal-agency-amt">${amtHtml}</span>
    </button>`;
  }
  if (hit.agencySlug) {
    return `<a class="fiscal-agency" href="https://www.usaspending.gov/agency/${esc(hit.agencySlug)}" target="_blank" rel="noopener noreferrer">
      <span class="fiscal-agency-name">${esc(label)}</span>
      <span class="fiscal-agency-amt">${amtHtml}</span>
    </a>`;
  }
  return `<div class="fiscal-agency is-static">
    <span class="fiscal-agency-name">${esc(label)}</span>
    <span class="fiscal-agency-amt">${amtHtml}</span>
  </div>`;
}

export function createFiscalPage(el, { getRoot, onMap } = {}) {
  if (!el) return { load: async () => {} };

  let cache = null;
  let inflight = null;
  let lastZip = { zip: "", data: null };

  const body = () => el.querySelector("#fiscal-body");

  el.addEventListener("submit", (e) => {
    if (e.target?.id !== "fiscal-zip-form") return;
    e.preventDefault();
    lookupZip(el.querySelector("#fiscal-zip")?.value);
  });
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-map-id]");
    if (!btn) return;
    onMap?.(btn.getAttribute("data-map-id"));
  });
  el.addEventListener("input", (e) => {
    if (e.target?.id !== "fiscal-zip") return;
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 5);
  });

  function setLocal(html) {
    const slot = el.querySelector("#fiscal-local");
    if (slot) slot.innerHTML = html;
  }

  function renderLocal(data) {
    const root = getRoot?.() || null;
    const where = `${data.city}, ${data.stateName}`;
    const zipList = (data.zipAgencies || []).map((h) => awardRow(root, h)).join("");
    const stateList = (data.stateAgencies || [])
      .map((h) => awardRow(root, h))
      .join("");
    setLocal(`
      <p class="you-where">${esc(where)} · FY${esc(data.fy)}</p>
      <p class="fiscal-sub">Awards performed in ${esc(data.zip)}</p>
      ${zipList || `<p class="fiscal-note">No awards matched this ZIP for FY${esc(data.fy)} so far.</p>`}
      <p class="fiscal-sub fiscal-sub-gap">Statewide · ${esc(data.state)}</p>
      ${stateList || `<p class="fiscal-note">No statewide awards returned.</p>`}
      <p class="fiscal-note">Place of performance — where the work happened — not the agency’s nationwide obligated total. FY${esc(data.fy)} from ${esc(data.start)} through ${esc(data.end)}. Source: USAspending.</p>
    `);
  }

  async function lookupZip(zip) {
    const z = String(zip || "").replace(/\D/g, "").slice(0, 5);
    if (!/^\d{5}$/.test(z)) {
      setLocal(`<p class="fiscal-note">Five digits.</p>`);
      return;
    }
    const input = el.querySelector("#fiscal-zip");
    if (input) input.value = z;
    lastZip = { zip: z, data: null };
    setLocal(`<p class="fiscal-note">Looking up awards in ${esc(z)}…</p>`);
    try {
      const res = await fetch(`/api/spend?zip=${z}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      lastZip = { zip: z, data: json };
      renderLocal(json);
    } catch (err) {
      setLocal(
        `<p class="fiscal-note">Could not look up ${esc(z)} (${esc(err.message || err)}).</p>`
      );
    }
  }

  function renderLoading() {
    body().innerHTML = `<p class="fiscal-note">Loading federal money figures…</p>`;
  }

  function renderError(msg) {
    body().innerHTML = `<p class="fiscal-note">Could not load live figures (${esc(msg)}). Treasury Fiscal Data needs no key — try again on a network.</p>`;
  }

  function render(data) {
    const { debt, interest, pop, mts, receipts, debtSeries } = data;
    const agencies = topSpendingNodes(getRoot?.() || null, 10);
    const spendAsOf = agencies[0]?.spending?.asOf || "";
    const youZip = document.getElementById("you-zip")?.value || lastZip.zip || "";

    const pubPct = debt.total ? ((debt.publicHeld / debt.total) * 100).toFixed(0) : "0";
    const intraPct = debt.total ? ((debt.intragov / debt.total) * 100).toFixed(0) : "0";
    const debtBlock = debt
      ? `
      <section class="fiscal-block">
        <h3>What we owe</h3>
        <p class="fiscal-hero fiscal-debt">${formatUsd(debt.total, { digits: 0 })}</p>
        <p class="fiscal-sub">total public debt · as of ${esc(debt.recordDate)} · ${perPerson(debt.total, pop.pop)} / person</p>
        <dl class="fiscal-dl fiscal-dl-debt">
          <dt>Held by the public</dt><dd>${formatUsd(debt.publicHeld, { digits: 0 })} <span class="fiscal-inline-per">${perPerson(debt.publicHeld, pop.pop)}</span></dd>
          <dt>Intragovernmental</dt><dd>${formatUsd(debt.intragov, { digits: 0 })} <span class="fiscal-inline-per">${perPerson(debt.intragov, pop.pop)}</span></dd>
          <dt>Total</dt><dd>${formatUsd(debt.total, { digits: 0 })}</dd>
        </dl>
        ${sparkSvg(debtSeries, "fiscal-spark-debt")}
        <p class="fiscal-note">Held by the public is debt owned outside the government. Source: Treasury Debt to the Penny. First-of-month sparkline, last 24 months.</p>
      </section>
      <section class="fiscal-block">
        <h3>Trust funds vs the public</h3>
        <div class="fiscal-stack" role="img" aria-label="Share of debt held by the public versus inside government">
          <span class="fiscal-seg fiscal-seg-public" style="width:${debt.total ? ((debt.publicHeld / debt.total) * 100).toFixed(1) : 0}%"></span>
          <span class="fiscal-seg fiscal-seg-intra" style="width:${debt.total ? ((debt.intragov / debt.total) * 100).toFixed(1) : 0}%"></span>
        </div>
        <ul class="fiscal-legend">
          <li><span class="fiscal-swatch fiscal-seg-public"></span>Held by the public · ${pubPct}% — people, the Fed, pension funds, foreign governments.</li>
          <li><span class="fiscal-swatch fiscal-seg-intra"></span>Intragovernmental · ${intraPct}% — one part of government owing another, mostly Social Security and Medicare trust funds holding Treasury securities. Not a second pile of cash sitting somewhere else.</li>
        </ul>
      </section>`
      : "";

    const interestBlock = interest
      ? `
      <section class="fiscal-block">
        <h3>Interest last month</h3>
        <p class="fiscal-sub">${esc(monthLong(interest.recordDate))}</p>
        <p class="fiscal-hero fiscal-debt">${formatUsd(interest.total, { digits: 0 })}</p>
        <p class="fiscal-sub">total interest expense · ${perPerson(interest.total, pop.pop)} / person</p>
        ${sparkSvg(interest.series, "fiscal-spark-debt")}
        <p class="fiscal-note">${
          interest.publicOnly
            ? "Paid to outside holders; excludes interest credited inside the government."
            : "All categories in the Treasury table for this month."
        } Monthly release — not live. Sparkline is the same public-interest total, last 24 months.</p>
      </section>`
      : "";

    const gapWord =
      mts?.ytdGap != null && mts.ytdGap < 0 ? "surplus" : "deficit";
    const gapAbs = mts?.ytdGap != null ? Math.abs(mts.ytdGap) : null;
    const mtsBlock = mts
      ? `
      <section class="fiscal-block">
        <h3>Money in / money out</h3>
        <p class="fiscal-sub">FY${esc(mts.fy)} through ${esc(mts.monthLabel)} · Monthly Treasury Statement</p>
        ${flowBars(mts.ytdIn, mts.ytdOut)}
        ${flowRow("fiscal-in", "Receipts", mts.ytdIn, pop.pop)}
        ${flowRow("fiscal-out", "Outlays", mts.ytdOut, pop.pop)}
        ${
          gapAbs != null
            ? flowRow(
                mts.ytdGap < 0 ? "fiscal-in" : "fiscal-debt",
                gapWord[0].toUpperCase() + gapWord.slice(1),
                gapAbs,
                pop.pop
              )
            : ""
        }
        <p class="fiscal-note">${esc(mts.monthLabel)} alone: in ${formatUsd(mts.monthIn, { compact: true })} · out ${formatUsd(mts.monthOut, { compact: true })}. Deficit is this year’s gap (outlays minus receipts). Debt is the running total still owed. Pop. ${pop.pop.toLocaleString("en-US")} (${esc(pop.year)}) · ${esc(pop.source)}.</p>
      </section>`
      : "";

    const receiptBlock = receipts
      ? `
      <section class="fiscal-block">
        <h3>Where a federal receipt dollar comes from</h3>
        <p class="fiscal-hero fiscal-in">${formatUsd(receipts.total, { compact: true })}</p>
        <p class="fiscal-sub">FYTD receipts · ${perPerson(receipts.total, pop.pop)} / person</p>
        ${receiptStack(receipts.slices, receipts.total)}
        <p class="fiscal-note">A paycheck’s federal bite is mostly income-tax withholding plus Social Security and Medicare. Those three are the bulk of all federal receipts; the rest is corporate tax, excise, customs, and other. Shares of net receipts, Monthly Treasury Statement Table 4 — not a personal W-2.</p>
      </section>`
      : "";

    const agencyBlock = agencies.length
      ? `
      <section class="fiscal-block">
        <h3>Where obligated dollars go</h3>
        <p class="fiscal-sub">${esc(spendAsOf) || "USAspending toptier"} · tap to open on the map</p>
        <div class="fiscal-agency-list">${agencyButtons(agencies)}</div>
        <p class="fiscal-note">Nationwide obligated amounts on matched Cabinet / independent agencies — the same snapshot as the detail pane. Not ZIP-level awards (those are below).</p>
      </section>`
      : "";

    body().innerHTML = `
      ${debtBlock}
      ${interestBlock}
      ${mtsBlock}
      ${receiptBlock}
      ${agencyBlock}
      <section class="fiscal-block">
        <h3>Where you live</h3>
        <p class="fiscal-note">Federal awards performed in a ZIP this fiscal year. Different question from obligated totals above.</p>
        <form id="fiscal-zip-form" class="you-form">
          <label class="sr-only" for="fiscal-zip">ZIP code</label>
          <input id="fiscal-zip" type="text" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="ZIP" autocomplete="postal-code" enterkeyhint="search" value="${esc(youZip)}" />
          <button type="submit" class="btn primary">Look up</button>
        </form>
        <div id="fiscal-local">${
          lastZip.data
            ? ""
            : `<p class="fiscal-note">Five digits. We’ll show awarding agencies at that ZIP and statewide.</p>`
        }</div>
      </section>
      <section class="fiscal-block">
        <h3>Four words</h3>
        <dl class="fiscal-gloss">
          <dt>Obligated</dt><dd>The government committed the dollar (an award or contract). Not always paid yet.</dd>
          <dt>Outlay</dt><dd>The dollar actually left the Treasury.</dd>
          <dt>Debt</dt><dd>What is still owed from borrowing over time.</dd>
          <dt>Deficit</dt><dd>This year’s gap: outlays minus receipts. Adds to the debt.</dd>
        </dl>
      </section>
      <section class="fiscal-block">
        <h3>Read the official number</h3>
        <p class="fiscal-links">${LINKS.map(
          (l) =>
            `<a href="${l.href}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`
        ).join("")}</p>
      </section>
    `;

    if (lastZip.data) renderLocal(lastZip.data);
    else if (/^\d{5}$/.test(youZip)) lookupZip(youZip);
  }

  async function load() {
    if (cache) {
      render(cache);
      return cache;
    }
    if (inflight) return inflight;
    renderLoading();
    inflight = Promise.all([
      loadDebt(),
      loadInterest().catch(() => null),
      loadPopulation(),
      loadMts().catch(() => null),
      loadReceipts().catch(() => null),
      loadDebtSeries().catch(() => []),
    ])
      .then(([debt, interest, pop, mts, receipts, debtSeries]) => {
        cache = { debt, interest, pop, mts, receipts, debtSeries };
        render(cache);
        return cache;
      })
      .catch((err) => {
        renderError(err.message || err);
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return { load };
}
