#!/usr/bin/env node
/**
 * Fetch official "what's happening" caches for Heat.
 * Free endpoints only (no Congress.gov key required).
 *
 *   npm run fetch:heat-events
 *   npm run fetch:heat-events -- --force
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "raw", "heat");
const EVENTS_PATH = join(OUT, "events-raw.json");

const UA = "GovDash/1 (citizen map; +https://govdash.markmaga.com)";

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

async function getText(url) {
  const r = await fetch(url, {
    headers: { Accept: "*/*", "User-Agent": UA },
  });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}

async function getJson(url) {
  const r = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
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

function parseHouseClerkHtml(html) {
  const events = [];
  // "Next Session: August 17th, 2026 at 9:00 AM" (current clerk.house.gov)
  // older: "The next meeting is scheduled for 9:00 a.m. on August 17, 2026"
  const patterns = [
    /Next Session:\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,\s*\d{4}\s+at\s+\d{1,2}:\d{2}\s*[AP]M)/i,
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

  let when = null;
  const cleaned = phrase
    .replace(/(\d+)(st|nd|rd|th)/gi, "$1")
    .replace(/\bat\b/i, "");
  const t = Date.parse(cleaned);
  if (Number.isFinite(t)) when = new Date(t).toISOString();

  events.push({
    id: `house-next-${(when || phrase).slice(0, 40)}`,
    kind: "floor_session",
    chamber: "House",
    when: when || phrase,
    until: null,
    title: "House next session",
    summary: "",
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
  console.log("Next: npm run enrich:heat");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
