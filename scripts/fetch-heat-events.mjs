#!/usr/bin/env node
/**
 * Fetch official "what's happening" caches for Heat.
 * Most sources are free with no key. House committee meetings use
 * Congress.gov (CONGRESS_API_KEY env or .env) + docs.house.gov calendar IDs.
 *
 *   npm run fetch:heat-events
 *   npm run fetch:heat-events -- --force
 */
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw", "heat");
const EVENTS_PATH = join(OUT, "events-raw.json");
const ENV_PATH = join(ROOT, ".env");

const UA = "GovDash/1 (citizen map; +https://govdash.markmaga.com)";
const CONGRESS_API = "https://api.congress.gov/v3";

function parseArgs(argv) {
  const opts = { force: false };
  for (const a of argv) if (a === "--force") opts.force = true;
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

const RETRYABLE = new Set([429, 502, 503, 504]);
const FETCH_ATTEMPTS = 4;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRes(url, headers) {
  let lastErr;
  for (let i = 0; i < FETCH_ATTEMPTS; i++) {
    try {
      const r = await fetch(url, { headers: { ...headers, "User-Agent": UA } });
      if (r.ok) return r;
      const err = new Error(`${url} → HTTP ${r.status}`);
      err.httpStatus = r.status;
      lastErr = err;
      if (!RETRYABLE.has(r.status)) throw err;
    } catch (e) {
      lastErr = e;
      if (e?.httpStatus && !RETRYABLE.has(e.httpStatus)) throw e;
      if (i === FETCH_ATTEMPTS - 1) throw e;
    }
    await sleep(400 * 2 ** i);
  }
  throw lastErr;
}

async function getText(url) {
  const r = await fetchRes(url, { Accept: "*/*" });
  return r.text();
}

async function getJson(url) {
  const r = await fetchRes(url, { Accept: "application/json" });
  return r.json();
}

async function loadCongressKey() {
  const fromEnv = (process.env.CONGRESS_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const text = await readFile(ENV_PATH, "utf8");
    const m = text.match(/^CONGRESS_API_KEY=(.+)$/m);
    if (!m) return null;
    const key = m[1].trim();
    return key || null;
  } catch {
    return null;
  }
}

/** U.S. Congress number for a calendar date (new Congress Jan 3 of odd years). */
function congressNumber(d = new Date()) {
  let y = d.getFullYear();
  if (d.getMonth() === 0 && d.getDate() < 3) y -= 1;
  return Math.floor((y - 1789) / 2) + 1;
}

function eachYmd(start, end) {
  const out = [];
  let t = Date.parse(`${start}T12:00:00Z`);
  const last = Date.parse(`${end}T12:00:00Z`);
  while (Number.isFinite(t) && t <= last) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 864e5;
  }
  return out;
}

/** docs.house.gov day calendar → EventIDs in the Heat window (no API key). */
async function discoverHouseEventIds(start, end) {
  const ids = new Set();
  for (const ymd of eachYmd(start, end)) {
    const [y, m, d] = ymd.split("-");
    const dayId = `${m}${d}${y}`;
    const html = await getText(
      `https://docs.house.gov/Committee/Calendar/ByDay.aspx?DayID=${dayId}`
    );
    for (const id of html.matchAll(/EventID=(\d+)/g)) ids.add(id[1]);
  }
  return [...ids];
}

function mapHouseCommitteeMeeting(detail, eventId) {
  const cm = detail?.committeeMeeting || detail;
  if (!cm) return null;
  const status = String(cm.meetingStatus || "");
  if (/canceled|cancelled/i.test(status)) return null;
  const whenRaw = cm.date;
  if (!whenRaw) return null;
  const when = String(whenRaw);
  const type = String(cm.type || "Meeting").trim() || "Meeting";
  const committees = Array.isArray(cm.committees)
    ? cm.committees.map((c) => c.name || c).filter(Boolean)
    : [];
  const committee = committees[0] || "House committee";
  const title = String(cm.title || "")
    .replace(/\s+/g, " ")
    .trim();
  const loc = cm.location || {};
  const room = [loc.building, loc.room].filter(Boolean).join(" ");
  const citizenUrl = `https://docs.house.gov/Committee/Calendar/ByEvent.aspx?EventID=${eventId}`;
  return {
    id: `house-hearing-${eventId}`,
    kind: "hearing",
    chamber: "House",
    committee,
    when,
    until: null,
    title: title || `${committee} ${type.toLowerCase()}`,
    summary: [committee, type, status, room].filter(Boolean).join(" · "),
    url: citizenUrl,
    source: "Congress.gov committee meeting API",
    sourceUrl: `${CONGRESS_API}/committee-meeting`,
    urgency: "upcoming",
    eventId: String(eventId),
    meetingType: type,
  };
}

/**
 * House committee hearings / markups / meetings on the House box
 * (committees are not separate map places — same pattern as Senate).
 */
async function fetchHouseHearings(start, end) {
  const key = await loadCongressKey();
  if (!key) {
    throw new Error(
      "CONGRESS_API_KEY missing (set the GitHub Actions secret CONGRESS_API_KEY or add it to .env)"
    );
  }
  const congress = congressNumber();
  const eventIds = await discoverHouseEventIds(start, end);
  const events = [];
  const skipped = [];
  for (const eventId of eventIds) {
    const url =
      `${CONGRESS_API}/committee-meeting/${congress}/house/${eventId}` +
      `?format=json&api_key=${encodeURIComponent(key)}`;
    let detail;
    try {
      detail = await getJson(url);
    } catch (e) {
      // docs.house.gov calendar can list EventIDs Congress.gov has not
      // indexed yet (or never will). Skip those; keep the rest.
      if (e?.httpStatus === 404) {
        skipped.push(String(eventId));
        continue;
      }
      throw e;
    }
    const mapped = mapHouseCommitteeMeeting(detail, eventId);
    if (!mapped) continue;
    const day = String(mapped.when).slice(0, 10);
    if (day < start || day > end) continue;
    events.push(mapped);
  }
  return { events, congress, eventIds: eventIds.length, skipped };
}

function xmlTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : null;
}

function parseSenateFloorXml(xml) {
  const events = [];
  const days = xml.match(/<LegislativeDay[\s\S]*?<\/LegislativeDay>/gi) || [];
  const now = Date.now();
  const horizon = now + 30 * 864e5; // 30 days — matches the C page
  const past = now - 2 * 864e5;

  for (const day of days) {
    const legDate = xmlTag(day, "LegislativeDayDate");
    const sessions = day.match(/<SessionDay[\s\S]*?<\/SessionDay>/gi) || [];
    for (const s of sessions) {
      const convene = xmlTag(s, "ConveneDate");
      const adjourn = xmlTag(s, "AdjournDate");
      const next = xmlTag(s, "NextConveneDate");
      const when = convene || legDate;
      if (!when) continue;
      const t = Date.parse(when);
      if (!Number.isFinite(t) || t < past || t > horizon) continue;
      const isFuture = t >= now - 6 * 36e5;
      const title = isFuture
        ? "Senate floor session"
        : "Senate floor (recent)";
      // Date is rendered with role label in the app; keep summary non-date context only.
      const summary = adjourn ? "Has adjourned" : "";
      events.push({
        id: `senate-floor-${when}`,
        kind: "floor_session",
        chamber: "Senate",
        when,
        until: adjourn || null,
        title,
        summary,
        url: "https://www.senate.gov/legislative/floor_activity_pail.htm",
        source: "Senate.gov floor schedule XML",
        sourceUrl:
          "https://www.senate.gov/legislative/schedule/floor_schedule.xml",
        urgency: isFuture ? "upcoming" : "recent",
      });
    }
    // Next convene listed on a day block
    const nextOnly = xmlTag(day, "NextConveneDate");
    if (nextOnly) {
      const t = Date.parse(nextOnly);
      if (Number.isFinite(t) && t >= now - 36e5 && t <= horizon) {
        events.push({
          id: `senate-next-${nextOnly}`,
          kind: "floor_session",
          chamber: "Senate",
          when: nextOnly,
          until: null,
          title: "Senate next convenes",
          summary: "",
          url: "https://www.senate.gov/legislative/floor_activity_pail.htm",
          source: "Senate.gov floor schedule XML",
          sourceUrl:
            "https://www.senate.gov/legislative/schedule/floor_schedule.xml",
          urgency: "upcoming",
        });
      }
    }
  }

  // De-dupe by id
  const byId = new Map();
  for (const e of events) byId.set(e.id, e);
  return [...byId.values()];
}

/** YYYY-MM-DD for America/New_York, plus calendar-day offset. */
function nyYmdPlus(offsetDays) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const ymd = fmt.format(new Date());
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d + offsetDays);
  const dd = new Date(utc);
  const mm = String(dd.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dd.getUTCDate()).padStart(2, "0");
  return `${dd.getUTCFullYear()}-${mm}-${day}`;
}

/** Wall clock in a zone → ISO. House clerk times are Eastern. */
function wallTimeToIso(ymd, hour, minute, tz = "America/New_York") {
  const [y, mo, d] = ymd.split("-").map(Number);
  let utc = Date.UTC(y, mo - 1, d, hour, minute, 0);
  const partsOf = (ms) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    let h = get("hour");
    if (h === 24) h = 0;
    return {
      y: get("year"),
      mo: get("month"),
      d: get("day"),
      h,
      min: get("minute"),
    };
  };
  const got = partsOf(utc);
  const want = Date.UTC(y, mo - 1, d, hour, minute);
  const asGot = Date.UTC(got.y, got.mo - 1, got.d, got.h, got.min);
  utc += want - asGot;
  return new Date(utc).toISOString();
}

function parseClock12(clock) {
  const m = String(clock || "").match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return { h, min };
}

function parseHouseSessionWhen(phrase) {
  const rel = phrase.match(
    /^(today|tomorrow|yesterday)\s+at\s+(\d{1,2}:\d{2}\s*[AP]M)$/i
  );
  if (rel) {
    const which = rel[1].toLowerCase();
    const offset = which === "today" ? 0 : which === "tomorrow" ? 1 : -1;
    const clock = parseClock12(rel[2]);
    if (clock) return wallTimeToIso(nyYmdPlus(offset), clock.h, clock.min);
  }
  const cleaned = phrase
    .replace(/(\d+)(st|nd|rd|th)/gi, "$1")
    .replace(/\bat\b/i, "");
  const t = Date.parse(cleaned);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return null;
}

function parseHouseClerkHtml(html) {
  const events = [];
  // Dated: "Next Session: August 17th, 2026 at 9:00 AM"
  // Relative (recess weeks flip to this): "Next Session: Tomorrow at 10:00 AM"
  // Older: "The next meeting is scheduled for 9:00 a.m. on August 17, 2026"
  const patterns = [
    /Next Session:\s*([^<\n]+)/i,
    /next meeting is scheduled for\s+([^.<]+?\d{4})/i,
  ];
  let phrase = null;
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      phrase = m[1].replace(/\s+/g, " ").trim();
      break;
    }
  }
  if (!phrase) return events;

  const when = parseHouseSessionWhen(phrase);

  events.push({
    id: `house-next-${(when || phrase).slice(0, 40)}`,
    kind: "floor_session",
    chamber: "House",
    when: when || phrase,
    until: null,
    title: "House next session",
    summary: phrase,
    url: "https://clerk.house.gov/",
    source: "Office of the Clerk, U.S. House",
    sourceUrl: "https://clerk.house.gov/",
    urgency: "upcoming",
  });
  return events;
}

function parseMajorityLeaderWeekly(html) {
  const events = [];
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ");
  const week =
    text.match(/WEEK OF\s+([A-Z]+ \d{1,2}(?:,\s*\d{4})?)/i)?.[1] || null;
  // Drop clearly stale weekly posts (page sometimes lags recess weeks).
  if (week) {
    const year = new Date().getFullYear();
    const weekStr = /,\s*\d{4}/.test(week) ? week : `${week}, ${year}`;
    const weekStart = Date.parse(weekStr);
    if (Number.isFinite(weekStart) && Date.now() - weekStart > 16 * 864e5) {
      return events; // older than ~2 weeks — not useful as "upcoming"
    }
  }
  const bills = [];
  const re =
    /\b((?:H\.?\s*R\.?|H\.?\s*Res\.?|H\.?\s*J\.?\s*Res\.?|S\.?|S\.?\s*Res\.?)\s*\d+)\b\s*[–—-]\s*([^\n(]{8,120})/gi;
  let m;
  while ((m = re.exec(text)) && bills.length < 40) {
    const bill = m[1].replace(/\s+/g, " ").trim();
    const title = m[2].replace(/\s+/g, " ").trim().replace(/,?\s*as amended$/i, "");
    bills.push({ bill, title });
  }
  // unique bills
  const seen = new Set();
  for (const b of bills) {
    const key = b.bill.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      id: `house-ml-${key.replace(/\W+/g, "")}`,
      kind: "house_schedule",
      chamber: "House",
      when: week || null,
      until: null,
      title: `${b.bill} — ${b.title}`,
      summary: "Majority Leader weekly schedule",
      url: "https://www.majorityleader.gov/schedule/weekly-schedule.htm",
      source: "House Majority Leader weekly schedule",
      sourceUrl: "https://www.majorityleader.gov/schedule/weekly-schedule.htm",
      urgency: "upcoming",
      bill: b.bill,
    });
  }
  if (week && !events.length) {
    events.push({
      id: `house-ml-week-${week}`,
      kind: "house_schedule",
      chamber: "House",
      when: week,
      until: null,
      title: "House floor week",
      summary: "Majority Leader weekly schedule",
      url: "https://www.majorityleader.gov/schedule/weekly-schedule.htm",
      source: "House Majority Leader weekly schedule",
      sourceUrl: "https://www.majorityleader.gov/schedule/weekly-schedule.htm",
      urgency: "upcoming",
    });
  }
  return events;
}

function mapPublicInspection(doc) {
  const agencies = (doc.agencies || []).map((a) => a.name).filter(Boolean);
  // when = FR publication day (the action this heat row is about).
  const pub = doc.publication_date || null;
  const filed = doc.filed_at || doc.filing_date || null;
  const num = doc.document_number || null;
  // HTML pages on federalregister.gov often hit the bot wall on phones.
  // The PI PDF lives on a separate host and opens as the actual filing.
  const pdf =
    doc.pdf_url ||
    (num ? `https://public-inspection.federalregister.gov/${num}.pdf` : null);
  return {
    id: `fr-pi-${num || doc.html_url}`,
    kind: "public_inspection",
    when: pub || filed,
    until: null,
    filedAt: filed,
    title: (doc.title || "Federal Register document").replace(/\s+/g, " ").trim(),
    summary: agencies.length > 0 ? agencies.join(", ") : "",
    url: pdf || doc.html_url || "https://www.federalregister.gov/public-inspection/current",
    htmlUrl: doc.html_url || null,
    pdfUrl: pdf,
    source: "Federal Register public inspection (PDF)",
    sourceUrl: "https://www.federalregister.gov/public-inspection/current",
    urgency: "upcoming",
    agencies,
    documentType: doc.type || doc.filing_type || null,
    documentNumber: num,
  };
}

function mapPresidentialDoc(doc) {
  const pdf = doc.pdf_url || null; // usually govinfo.gov — no FR bot wall
  const published = doc.publication_date || null;
  const signed = doc.signing_date || null;
  return {
    id: `fr-pres-${doc.document_number || doc.html_url}`,
    kind: "presidential_doc",
    when: published || signed,
    until: null,
    signedAt: signed,
    title: (doc.title || "Presidential document").replace(/\s+/g, " ").trim(),
    summary: [
      doc.type,
      doc.presidential_document_type,
      doc.subtype,
    ]
      .filter(Boolean)
      .join(" · ") || "",
    url: pdf || doc.html_url || "https://www.federalregister.gov/",
    htmlUrl: doc.html_url || null,
    pdfUrl: pdf,
    source: pdf
      ? "Federal Register presidential documents (PDF)"
      : "Federal Register presidential documents",
    sourceUrl: "https://www.federalregister.gov/presidential-documents",
    urgency: "recent",
    documentType: doc.presidential_document_type || doc.type || null,
  };
}

function mapCommentDeadline(doc) {
  const agencies = (doc.agencies || []).map((a) => a.name).filter(Boolean);
  const close = doc.comments_close_on || null;
  const num = doc.document_number || null;
  const pdf = doc.pdf_url || null;
  const regs = doc.regulations_dot_gov_url || doc.comment_url || null;
  return {
    id: `fr-comment-${num || doc.html_url}`,
    kind: "comment_deadline",
    when: close,
    until: close,
    title: (doc.title || "Proposed rule — comments close").replace(/\s+/g, " ").trim(),
    summary: agencies.length > 0 ? agencies.join(", ") : "",
    url: regs || pdf || doc.html_url || "https://www.federalregister.gov/",
    htmlUrl: doc.html_url || null,
    pdfUrl: pdf,
    source: "Federal Register proposed rule (comments close)",
    sourceUrl: "https://www.federalregister.gov/",
    urgency: "upcoming",
    agencies,
    documentNumber: num,
    documentType: doc.type || "PRORULE",
  };
}

function ymdLocal(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function horizonYmd() {
  const start = ymdLocal(new Date());
  const end = ymdLocal(new Date(Date.now() + 29 * 864e5));
  return { start, end };
}

function parseNamedDates(text) {
  const months = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };
  const re =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  const out = [];
  let m;
  while ((m = re.exec(String(text || "")))) {
    const mo = months[m[1].toLowerCase()];
    const dt = new Date(Number(m[3]), mo, Number(m[2]));
    if (Number.isFinite(dt.getTime())) out.push(ymdLocal(dt));
  }
  return [...new Set(out)];
}

function mapSunshineDoc(doc, meetingDay) {
  const agencies = (doc.agencies || []).map((a) => a.name).filter(Boolean);
  const num = doc.document_number || null;
  const pdf = doc.pdf_url || null;
  return {
    id: `fr-sun-${num || doc.html_url}-${meetingDay}`,
    kind: "sunshine_meeting",
    when: meetingDay,
    until: meetingDay,
    title: (doc.title || "Sunshine Act meeting").replace(/\s+/g, " ").trim(),
    summary: agencies.length > 0 ? agencies.join(", ") : "",
    url: pdf || doc.html_url || "https://www.federalregister.gov/",
    htmlUrl: doc.html_url || null,
    pdfUrl: pdf,
    source: "Federal Register Sunshine Act meeting",
    sourceUrl: "https://www.federalregister.gov/",
    urgency: "upcoming",
    agencies,
    documentNumber: num,
  };
}

function parseSenateHearingsXml(xml, start, end) {
  const events = [];
  const blocks = xml.match(/<meeting>[\s\S]*?<\/meeting>/gi) || [];
  for (const block of blocks) {
    const committee = xmlTag(block, "committee");
    const matter = xmlTag(block, "matter") || "";
    if (!committee) continue;
    if (/no committee hearings/i.test(matter)) continue;
    const when = xmlTag(block, "date_iso_8601");
    if (!when || when < start || when > end) continue;
    const type = xmlTag(block, "type") || "Hearing";
    const room = xmlTag(block, "room");
    const time = xmlTag(block, "time") || xmlTag(block, "time_iso_8601");
    const id = xmlTag(block, "identifier") || `senate-hearing-${committee}-${when}`;
    events.push({
      id: `senate-hearing-${id}`,
      kind: "hearing",
      chamber: "Senate",
      committee,
      when,
      until: null,
      title: matter.replace(/\s+/g, " ").trim() || `${committee} hearing`,
      summary: [committee, type, time, room].filter(Boolean).join(" · "),
      url: "https://www.senate.gov/committees/hearings_meetings.htm",
      source: "Senate.gov committee hearings XML",
      sourceUrl: "https://www.senate.gov/general/committee_schedules/hearings.xml",
      urgency: "upcoming",
    });
  }
  const byId = new Map();
  for (const e of events) byId.set(e.id, e);
  return [...byId.values()];
}

function parseScotusCalendars(html, start, end) {
  const events = [];
  const seen = new Set();
  function add(when, title, url) {
    if (!when || when < start || when > end) return;
    const key = `${when}|${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push({
      id: `scotus-${when}-${title.replace(/\W+/g, "").slice(0, 24)}`,
      kind: "court_argument",
      when,
      until: null,
      title,
      summary: "Supreme Court of the United States",
      url: url || "https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx",
      source: "Supreme Court calendars and lists",
      sourceUrl: "https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx",
      urgency: "upcoming",
    });
  }

  const sessRe = /Session Beginning\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/gi;
  let m;
  while ((m = sessRe.exec(html))) {
    const days = parseNamedDates(m[1]);
    for (const when of days) {
      add(
        when,
        "Oral argument session begins",
        "https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx"
      );
    }
  }

  const hrefRe = /href="([^"]*?(\d{2})-(\d{2})-(\d{2})\.pdf)"/gi;
  while ((m = hrefRe.exec(html))) {
    const mm = m[2];
    const dd = m[3];
    const yy = Number(m[4]);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    const when = `${year}-${mm}-${dd}`;
    let url = m[1].replace(/&amp;/g, "&");
    if (url.startsWith("/")) url = "https://www.supremecourt.gov" + url;
    else if (!/^https?:/i.test(url)) {
      url = "https://www.supremecourt.gov/oral_arguments/" + url.replace(/^\.\//, "");
    }
    add(when, "Oral argument", url);
  }
  return events;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(OUT, { recursive: true });

  if (!opts.force && (await exists(EVENTS_PATH))) {
    const age =
      Date.now() - (await import("node:fs")).statSync(EVENTS_PATH).mtimeMs;
    if (age < 2 * 3600e3) {
      console.log("events-raw.json is fresh (<2h). Use --force to refetch.");
      return;
    }
  }

  const pack = {
    fetchedAt: new Date().toISOString(),
    sources: {},
    events: [],
  };

  // Senate floor
  try {
    const xml = await getText(
      "https://www.senate.gov/legislative/schedule/floor_schedule.xml"
    );
    const list = parseSenateFloorXml(xml);
    pack.sources.senateFloor = {
      ok: true,
      count: list.length,
      url: "https://www.senate.gov/legislative/schedule/floor_schedule.xml",
    };
    pack.events.push(...list);
    console.log(`Senate floor: ${list.length} events`);
  } catch (e) {
    pack.sources.senateFloor = { ok: false, error: String(e.message || e) };
    console.warn("Senate floor failed:", e.message || e);
  }

  // House clerk next meeting
  try {
    const html = await getText("https://clerk.house.gov/");
    const list = parseHouseClerkHtml(html);
    pack.sources.houseClerk = {
      ok: true,
      count: list.length,
      url: "https://clerk.house.gov/",
    };
    pack.events.push(...list);
    console.log(`House clerk: ${list.length} events`);
  } catch (e) {
    pack.sources.houseClerk = { ok: false, error: String(e.message || e) };
    console.warn("House clerk failed:", e.message || e);
  }

  // Majority Leader weekly
  try {
    const html = await getText(
      "https://www.majorityleader.gov/schedule/weekly-schedule.htm"
    );
    const list = parseMajorityLeaderWeekly(html);
    pack.sources.majorityLeader = {
      ok: true,
      count: list.length,
      url: "https://www.majorityleader.gov/schedule/weekly-schedule.htm",
    };
    pack.events.push(...list);
    console.log(`Majority Leader: ${list.length} events`);
  } catch (e) {
    pack.sources.majorityLeader = { ok: false, error: String(e.message || e) };
    console.warn("Majority Leader failed:", e.message || e);
  }

  // FR public inspection (current desk — free, no key)
  try {
    const data = await getJson(
      "https://www.federalregister.gov/api/v1/public-inspection-documents/current.json?per_page=1000"
    );
    const results = data.results || [];
    const list = results.map(mapPublicInspection);
    pack.sources.publicInspection = {
      ok: true,
      count: list.length,
      url: "https://www.federalregister.gov/api/v1/public-inspection-documents/current.json",
    };
    pack.events.push(...list);
    console.log(`Public inspection: ${list.length} docs`);
  } catch (e) {
    pack.sources.publicInspection = {
      ok: false,
      error: String(e.message || e),
    };
    console.warn("Public inspection failed:", e.message || e);
  }

  // Presidential docs last 14 days
  try {
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const url =
      "https://www.federalregister.gov/api/v1/documents.json?" +
      new URLSearchParams({
        "conditions[presidential_document_type][]": "executive_order",
        "conditions[publication_date][gte]": since,
        order: "newest",
        per_page: "40",
      }).toString();
    // Also pull proclamations / memoranda via broader presidential filter
    const dataEo = await getJson(url);
    const url2 =
      "https://www.federalregister.gov/api/v1/documents.json?" +
      new URLSearchParams({
        "conditions[type][]": "PRESDOCU",
        "conditions[publication_date][gte]": since,
        order: "newest",
        per_page: "40",
      }).toString();
    let dataAll = { results: [] };
    try {
      dataAll = await getJson(url2);
    } catch {
      /* optional */
    }
    const byNum = new Map();
    for (const r of [...(dataEo.results || []), ...(dataAll.results || [])]) {
      byNum.set(r.document_number || r.html_url, r);
    }
    const list = [...byNum.values()].map(mapPresidentialDoc);
    pack.sources.presidential = {
      ok: true,
      count: list.length,
      since,
      url: "https://www.federalregister.gov/presidential-documents",
    };
    pack.events.push(...list);
    console.log(`Presidential docs: ${list.length}`);
  } catch (e) {
    pack.sources.presidential = { ok: false, error: String(e.message || e) };
    console.warn("Presidential docs failed:", e.message || e);
  }

  const { start, end } = horizonYmd();

  // Proposed-rule comment close dates — citizen can still speak. Notices skipped.
  try {
    const sp = new URLSearchParams();
    sp.set("conditions[comment_date][gte]", start);
    sp.set("conditions[comment_date][lte]", end);
    sp.set("conditions[type][]", "PRORULE");
    sp.set("order", "newest");
    sp.set("per_page", "200");
    for (const f of [
      "title",
      "agencies",
      "comments_close_on",
      "html_url",
      "pdf_url",
      "document_number",
      "type",
      "regulations_dot_gov_url",
      "comment_url",
    ]) {
      sp.append("fields[]", f);
    }
    const url =
      "https://www.federalregister.gov/api/v1/documents.json?" + sp.toString();
    const data = await getJson(url);
    const list = (data.results || [])
      .map(mapCommentDeadline)
      .filter((e) => e.when && e.when >= start && e.when <= end);
    pack.sources.commentDeadlines = {
      ok: true,
      count: list.length,
      start,
      end,
      type: "PRORULE",
      url: "https://www.federalregister.gov/",
    };
    pack.events.push(...list);
    console.log(`Comment deadlines (proposed rules): ${list.length}`);
  } catch (e) {
    pack.sources.commentDeadlines = {
      ok: false,
      error: String(e.message || e),
    };
    console.warn("Comment deadlines failed:", e.message || e);
  }

  // Sunshine Act meetings — meeting day, not FR publish day.
  try {
    const pubSince = ymdLocal(new Date(Date.now() - 21 * 864e5));
    const sp = new URLSearchParams();
    sp.set("conditions[notice_type]", "sunshine_act_meeting");
    sp.set("conditions[publication_date][gte]", pubSince);
    sp.set("order", "newest");
    sp.set("per_page", "40");
    const data = await getJson(
      "https://www.federalregister.gov/api/v1/documents.json?" + sp.toString()
    );
    const list = [];
    for (const row of data.results || []) {
      const num = row.document_number;
      if (!num) continue;
      let doc = row;
      try {
        doc = await getJson(
          `https://www.federalregister.gov/api/v1/documents/${encodeURIComponent(num)}.json`
        );
      } catch {
        /* list row may lack dates */
      }
      const days = parseNamedDates(doc.dates);
      for (const when of days) {
        if (when < start || when > end) continue;
        list.push(mapSunshineDoc(doc, when));
      }
    }
    pack.sources.sunshine = {
      ok: true,
      count: list.length,
      start,
      end,
      url: "https://www.federalregister.gov/",
    };
    pack.events.push(...list);
    console.log(`Sunshine meetings: ${list.length}`);
  } catch (e) {
    pack.sources.sunshine = { ok: false, error: String(e.message || e) };
    console.warn("Sunshine meetings failed:", e.message || e);
  }

  // Senate committee hearings (chamber box — committees are not map places).
  try {
    const xml = await getText(
      "https://www.senate.gov/general/committee_schedules/hearings.xml"
    );
    const list = parseSenateHearingsXml(xml, start, end);
    pack.sources.senateHearings = {
      ok: true,
      count: list.length,
      start,
      end,
      url: "https://www.senate.gov/general/committee_schedules/hearings.xml",
    };
    pack.events.push(...list);
    console.log(`Senate hearings: ${list.length}`);
  } catch (e) {
    pack.sources.senateHearings = { ok: false, error: String(e.message || e) };
    console.warn("Senate hearings failed:", e.message || e);
  }

  // House committee meetings (Congress.gov + docs.house.gov calendar IDs).
  try {
    const { events: list, congress, eventIds, skipped } =
      await fetchHouseHearings(start, end);
    pack.sources.houseHearings = {
      ok: true,
      count: list.length,
      start,
      end,
      congress,
      calendarIds: eventIds,
      skipped404: skipped,
      url: `${CONGRESS_API}/committee-meeting/${congress}/house`,
    };
    pack.events.push(...list);
    const skipNote = skipped.length
      ? `, skipped ${skipped.length} Congress.gov 404`
      : "";
    console.log(
      `House hearings: ${list.length} (from ${eventIds} calendar ids, ${congress}th${skipNote})`
    );
  } catch (e) {
    pack.sources.houseHearings = { ok: false, error: String(e.message || e) };
    console.warn("House hearings failed:", e.message || e);
  }

  // SCOTUS argument days from the official calendars page (PDFs / session starts).
  try {
    const html = await getText(
      "https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx"
    );
    const list = parseScotusCalendars(html, start, end);
    pack.sources.scotus = {
      ok: true,
      count: list.length,
      start,
      end,
      url: "https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx",
    };
    pack.events.push(...list);
    console.log(`SCOTUS arguments: ${list.length}`);
  } catch (e) {
    pack.sources.scotus = { ok: false, error: String(e.message || e) };
    console.warn("SCOTUS calendar failed:", e.message || e);
  }

  await writeFile(EVENTS_PATH, JSON.stringify(pack, null, 2));
  console.log(
    `Wrote ${pack.events.length} raw events → data/raw/heat/events-raw.json`
  );

  // Core daily pulse sources — do not enrich a bake that missed these.
  const CORE = [
    "senateFloor",
    "houseClerk",
    "publicInspection",
    "presidential",
  ];
  const failed = Object.entries(pack.sources).filter(
    ([, s]) => s && s.ok === false
  );
  const coreFailed = failed.filter(([k]) => CORE.includes(k));
  if (failed.length) {
    console.warn("Sources failed:");
    for (const [k, s] of failed) {
      console.warn(`  - ${k}: ${s.error || "failed"}`);
    }
  }
  if (coreFailed.length) {
    console.error(
      "Core Heat sources failed — re-run with --force before enrich:heat (do not commit this bake)."
    );
    process.exit(1);
  }

  console.log("Next: npm run enrich:heat");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
