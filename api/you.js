/**
 * ZIP → House + Senate. Census CD + @unitedstates legislators.
 */
const ZIPPO = "https://api.zippopotam.us/us/";
const CENSUS =
  "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
const LEGS =
  "https://unitedstates.github.io/congress-legislators/legislators-current.json";

let legsCache = null;
let legsAt = 0;

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "GovDash/1" },
  });
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

async function legislators() {
  const now = Date.now();
  if (legsCache && now - legsAt < 6 * 60 * 60 * 1000) return legsCache;
  legsCache = await fetchJson(LEGS);
  legsAt = now;
  return legsCache;
}

function currentTerm(person) {
  const terms = person?.terms || [];
  return terms.length ? terms[terms.length - 1] : {};
}

function matchMembers(legs, state, district) {
  const house = [];
  const senate = [];
  for (const p of legs) {
    const t = currentTerm(p);
    if (t.state !== state) continue;
    const rec = {
      name: p.name?.official_full || [p.name?.first, p.name?.last].filter(Boolean).join(" "),
      party: t.party || "",
      phone: t.phone || "",
      url: t.url || "",
      state,
      chamber: t.type === "sen" ? "senate" : "house",
      district: t.type === "sen" ? null : t.district ?? null,
    };
    if (t.type === "sen") senate.push(rec);
    else if (t.type === "rep" && Number(t.district ?? 0) === Number(district)) {
      house.push(rec);
    }
  }
  return [...house, ...senate];
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
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
    const city = loc["place name"];
    const lat = loc.latitude;
    const lng = loc.longitude;
    const census = await fetchJson(
      `${CENSUS}?x=${encodeURIComponent(lng)}&y=${encodeURIComponent(lat)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`
    );
    const cd =
      census?.result?.geographies?.["119th Congressional Districts"]?.[0] || {};
    const raw = cd.CD119 != null ? String(cd.CD119) : "";
    const district = /^\d+$/.test(raw) ? Number(raw) : 0;
    const legs = await legislators();
    const members = matchMembers(legs, state, district);
    res.status(200).json({
      zip,
      city,
      state,
      stateName: loc.state || state,
      district,
      atLarge: district === 0,
      members,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
