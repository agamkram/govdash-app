/**
 * In-app Treasury page — same shell as the map, not a separate site.
 * Official monthly interest + daily debt; per-person uses a dated population vintage.
 */

const FISCAL_BASE =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";

const POP_FALLBACK = { pop: 341784857, year: "2025", source: "World Bank (fallback)" };

function fiscalUrl(path, params) {
  const u = new URL(`${FISCAL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function formatUsd(n, { digits = 2, compact = false } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  if (compact) {
    if (Math.abs(x) >= 1e12) return `$${(x / 1e12).toFixed(3)}T`;
    if (Math.abs(x) >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
    if (Math.abs(x) >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  }
  return x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function monthLabel(iso) {
  if (!iso) return "—";
  const [y, m] = String(iso).split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function isPublicCategory(row) {
  const blob = `${row.expense_catg_desc || ""} ${row.expense_group_desc || ""}`.toLowerCase();
  if (/government account|intragov|\bgas\b/.test(blob)) return false;
  return /public/.test(blob);
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

async function loadInterest() {
  const json = await fetchTreasury(
    "interest_expense",
    "/v2/accounting/od/interest_expense",
    {
      sort: "-record_date",
      "page[size]": "100",
    }
  );
  const rows = json?.data || [];
  if (!rows.length) throw new Error("No interest rows");
  const latest = rows.reduce((a, b) => (a.record_date >= b.record_date ? a : b)).record_date;
  const monthRows = rows.filter((r) => r.record_date === latest);
  const publicRows = monthRows.filter(isPublicCategory);
  const use = publicRows.length ? publicRows : monthRows;
  const total = use.reduce((s, r) => s + Number(r.month_expense_amt || 0), 0);
  return {
    recordDate: latest,
    total,
    publicOnly: publicRows.length > 0,
    rowCount: use.length,
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

async function loadPopulation() {
  try {
    const json = await fetchJson(
      "https://api.worldbank.org/v2/country/USA/indicator/SP.POP.TOTL?format=json&per_page=1&mrnev=1"
    );
    const row = json?.[1]?.[0];
    const pop = Number(row?.value);
    if (!Number.isFinite(pop) || pop < 1e8) throw new Error("bad pop");
    return { pop, year: String(row.date), source: "World Bank population, United States" };
  } catch {
    return POP_FALLBACK;
  }
}

export function createFiscalPage(el) {
  let cache = null;
  let inflight = null;

  function renderLoading() {
    el.querySelector("#fiscal-body").innerHTML = `<p class="fiscal-note">Loading Treasury figures…</p>`;
  }

  function renderError(msg) {
    el.querySelector("#fiscal-body").innerHTML =
      `<p class="fiscal-note">Could not load live figures (${msg}). Treasury Fiscal Data needs no key — try again on a network.</p>`;
  }

  function render(data) {
    const { debt, interest, pop } = data;
    const per = interest.total / pop.pop;
    const scope = interest.publicOnly
      ? "Interest on debt held as public issues (not intragovernmental GAS)"
      : "Interest (all categories in the Treasury table for this month)";
    el.querySelector("#fiscal-body").innerHTML = `
      <section class="fiscal-block">
        <h3>Interest, ${monthLabel(interest.recordDate)}</h3>
        <p class="fiscal-hero">${formatUsd(interest.total, { compact: true })}</p>
        <p class="fiscal-sub">${formatUsd(interest.total, { digits: 0 })} total</p>
        <p class="fiscal-hero fiscal-hero-2">${formatUsd(per, { digits: 2 })}</p>
        <p class="fiscal-sub">per U.S. resident · pop. ${pop.pop.toLocaleString("en-US")} (${pop.year})</p>
        <p class="fiscal-note">${scope}. Monthly Treasury release — not a live clock. Population: ${pop.source}.</p>
      </section>
      <section class="fiscal-block">
        <h3>Debt to the Penny</h3>
        <dl class="fiscal-dl">
          <dt>As of</dt><dd>${debt.recordDate}</dd>
          <dt>Held by the public</dt><dd>${formatUsd(debt.publicHeld, { compact: true })}</dd>
          <dt>Intragovernmental</dt><dd>${formatUsd(debt.intragov, { compact: true })}</dd>
          <dt>Total public debt</dt><dd>${formatUsd(debt.total, { compact: true })}</dd>
        </dl>
        <p class="fiscal-note">The carrying-cost conversation is about debt held by the public, plus the interest line above — not the summed total alone.</p>
      </section>
    `;
  }

  async function load() {
    if (cache) {
      render(cache);
      return cache;
    }
    if (inflight) return inflight;
    renderLoading();
    inflight = Promise.all([loadDebt(), loadInterest(), loadPopulation()])
      .then(([debt, interest, pop]) => {
        cache = { debt, interest, pop };
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
