/**
 * ZIP → place-of-performance awards by awarding agency (USAspending).
 * Same-origin so Monterey Safari does not have to talk to that API directly.
 */
const ZIPPO = "https://api.zippopotam.us/us/";
const USA =
  "https://api.usaspending.gov/api/v2/search/spending_by_category/awarding_agency/";

function fyWindow() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const fy = m >= 10 ? y + 1 : y;
  const end = [
    y,
    String(m).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return {
    fy,
    start: `${fy - 1}-10-01`,
    end,
  };
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: {
      Accept: "application/json",
      "User-Agent": "GovDash/1",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

async function agenciesAt(location, start, end) {
  const json = await fetchJson(USA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters: {
        time_period: [{ start_date: start, end_date: end }],
        place_of_performance_locations: [location],
      },
      limit: 8,
    }),
  });
  return (json?.results || []).map((row) => ({
    name: row.name || "",
    code: row.code || "",
    agencySlug: row.agency_slug || "",
    amount: Number(row.amount) || 0,
  }));
}

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=600"
  );
  const zip = String(req.query?.zip || "").replace(/\D/g, "").slice(0, 5);
  if (!/^\d{5}$/.test(zip)) {
    res.status(400).json({ error: "Need a 5-digit ZIP" });
    return;
  }
  try {
    let place;
    try {
      place = await fetchJson(ZIPPO + zip);
    } catch (e) {
      if (e.status === 404) {
        res.status(404).json({ error: "Unknown ZIP" });
        return;
      }
      throw e;
    }
    const loc = place?.places?.[0];
    if (!loc) {
      res.status(404).json({ error: "Unknown ZIP" });
      return;
    }
    const state = loc["state abbreviation"];
    const { fy, start, end } = fyWindow();
    const [zipAgencies, stateAgencies] = await Promise.all([
      agenciesAt({ country: "USA", zip }, start, end),
      agenciesAt({ country: "USA", state }, start, end),
    ]);
    res.status(200).json({
      zip,
      city: loc["place name"],
      state,
      stateName: loc.state || state,
      fy,
      start,
      end,
      zipAgencies,
      stateAgencies,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
