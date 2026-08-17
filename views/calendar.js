/**
 * Next-30-days page — Heat events in time, plus OPM federal holidays.
 * Same bake as the map. Empty days stay empty.
 */

import { HEAT_KIND_LABEL, displayName } from "../shared.js?v=2493";

const HORIZON_DAYS = 30;
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** OPM legal public holidays (observed). Calendar-only — not map Heat. */
const OPM_HOLIDAYS = [
  ["2026-09-07", "Labor Day"],
  ["2026-10-12", "Columbus Day"],
  ["2026-11-11", "Veterans Day"],
  ["2026-11-26", "Thanksgiving Day"],
  ["2026-12-25", "Christmas Day"],
  ["2027-01-01", "New Year's Day"],
  ["2027-01-18", "Birthday of Martin Luther King, Jr."],
  ["2027-02-15", "Washington's Birthday"],
  ["2027-05-31", "Memorial Day"],
  ["2027-06-18", "Juneteenth National Independence Day"],
  ["2027-07-05", "Independence Day (observed)"],
  ["2027-09-06", "Labor Day"],
  ["2027-10-11", "Columbus Day"],
  ["2027-11-11", "Veterans Day"],
  ["2027-11-25", "Thanksgiving Day"],
  ["2027-12-24", "Christmas Day (observed)"],
];

const HOLIDAY_URL =
  "https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function todayKey() {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function dayKey(iso) {
  const s = String(iso || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const dt = new Date(s);
  if (!Number.isFinite(dt.getTime())) return "";
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function sundayOfWeek(key) {
  const [y, m, d] = key.split("-").map(Number);
  return addDays(key, -new Date(y, m - 1, d).getDay());
}

function saturdayOnOrAfter(key) {
  const [y, m, d] = key.split("-").map(Number);
  return addDays(key, 6 - new Date(y, m - 1, d).getDay());
}

function keysInclusive(a, b) {
  const out = [];
  let k = a;
  while (k <= b) {
    out.push(k);
    k = addDays(k, 1);
  }
  return out;
}

function monthShort(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleString("en-US", { month: "short" })
    .toUpperCase();
}

function prettyRange(start, end) {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const left = new Date(ys, ms - 1, ds).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const right = new Date(ye, me - 1, de).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(ys === ye ? {} : { year: "numeric" }),
  });
  return `${left} – ${right}`;
}

function prettyDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function kindLabel(kind) {
  if (kind === "federal_holiday") return "Holiday";
  return HEAT_KIND_LABEL[kind] || kind || "Event";
}

function whenLine(ev) {
  const day = prettyDay(dayKey(ev.when));
  switch (ev.kind) {
    case "floor_session":
      return (ev.urgency === "recent" ? "Convened " : "Convenes ") + day;
    case "house_schedule":
      return "Week of " + day;
    case "public_inspection":
      return "Publishes " + day;
    case "presidential_doc":
      return "Published " + day;
    case "comment_deadline":
      return "Comments close " + day;
    case "sunshine_meeting":
      return "Meets " + day;
    case "hearing":
      return "Hearing " + day;
    case "court_argument":
      return "Argues " + day;
    case "federal_holiday":
      return "Closed " + day;
    default:
      return day;
  }
}

function collectHeat(root) {
  const out = [];
  const walk = (node) => {
    const h = node?.heat;
    if (h && !h.rolledUp && Array.isArray(h.events)) {
      for (const ev of h.events) {
        const when = dayKey(ev.when);
        if (!when) continue;
        out.push({
          ...ev,
          when,
          nodeId: node.id,
          nodeLabel: displayName(node),
        });
      }
    }
    for (const c of node?.children || []) walk(c);
  };
  if (root) walk(root);
  return out;
}

function holidayItems(start, end) {
  return OPM_HOLIDAYS.filter(([iso]) => iso >= start && iso <= end).map(
    ([iso, title]) => ({
      id: `holiday-${iso}`,
      kind: "federal_holiday",
      when: iso,
      title,
      summary: "Federal offices closed",
      url: HOLIDAY_URL,
      source: "OPM federal holidays",
      nodeId: null,
      nodeLabel: "",
    })
  );
}

function byDay(items) {
  const map = new Map();
  for (const ev of items) {
    const k = ev.when;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(ev);
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      String(a.kind).localeCompare(String(b.kind)) ||
      String(a.title).localeCompare(String(b.title))
    );
  }
  return map;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function createCalPage(root, { getRoot, getAsOf, getItemCount, onMap }) {
  if (!root) return { show() {} };
  const body = root.querySelector("#cal-body");
  let selected = "";

  function windowRange() {
    const start = todayKey();
    const end = addDays(start, HORIZON_DAYS - 1);
    return { start, end };
  }

  function allItems() {
    const { start, end } = windowRange();
    const heat = collectHeat(getRoot?.());
    const inWin = heat.filter((e) => e.when >= start && e.when <= end);
    return [...inWin, ...holidayItems(start, end)];
  }

  function renderDayList(key, grouped) {
    const box = el("div", "cal-day-list");
    const list = grouped.get(key) || [];
    box.append(el("p", "cal-day-count", plural(list.length, "item", "items")));
    box.append(el("h3", "cal-day-head", prettyDay(key)));
    if (!list.length) {
      box.append(
        el(
          "p",
          "fiscal-note",
          "Nothing in this snapshot for this day — not a hidden list."
        )
      );
      return box;
    }
    const ul = el("ul", "cal-events");
    for (const ev of list) {
      const li = el("li", "cal-event");
      li.append(el("span", "heat-kind", kindLabel(ev.kind)));
      if (ev.url) {
        const a = el("a", "heat-title", ev.title || "Open source");
        a.href = ev.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        li.append(a);
      } else {
        li.append(el("span", "heat-title", ev.title || "Event"));
      }
      const who =
        ev.summary && ev.summary.includes(",")
          ? ev.summary
          : ev.nodeLabel || ev.summary || "";
      const sum = [whenLine(ev), who].filter(Boolean).join(" · ");
      if (sum) li.append(el("p", "heat-summary", sum));
      if (ev.source) li.append(el("p", "heat-source", ev.source));
      if (ev.nodeId) {
        const mapBtn = el("button", "btn", "Map");
        mapBtn.type = "button";
        mapBtn.addEventListener("click", () => onMap?.(ev.nodeId));
        li.append(mapBtn);
      }
      ul.append(li);
    }
    box.append(ul);
    return box;
  }

  function renderSheet(start, end, grouped) {
    const wrap = el("div", "cal-sheet");
    wrap.append(el("h3", "cal-sheet-title", prettyRange(start, end)));
    const grid = el("div", "cal-grid");
    for (const w of WEEKDAYS) grid.append(el("span", "cal-dow", w));
    const gridStart = sundayOfWeek(start);
    const gridEnd = saturdayOnOrAfter(end);
    for (const key of keysInclusive(gridStart, gridEnd)) {
      const inWin = key >= start && key <= end;
      const n = (grouped.get(key) || []).length;
      const btn = el("button", "cal-cell");
      btn.type = "button";
      if (inWin && key.slice(8, 10) === "01") {
        btn.classList.add("has-month");
        btn.append(el("span", "cal-month-mark", monthShort(key)));
      }
      btn.append(el("span", "cal-num", String(Number(key.slice(8, 10)))));
      if (!inWin) {
        btn.classList.add("is-out");
        btn.disabled = true;
      } else {
        if (key === todayKey()) btn.classList.add("is-today");
        if (key === selected) btn.classList.add("is-selected");
        if (n) {
          btn.classList.add("is-busy");
          btn.append(el("span", "cal-dot"));
        }
        btn.setAttribute(
          "aria-label",
          n
            ? `${prettyDay(key)}, ${n} item${n === 1 ? "" : "s"}`
            : prettyDay(key)
        );
        btn.addEventListener("click", () => {
          selected = key;
          paint();
        });
      }
      grid.append(btn);
    }
    wrap.append(grid);
    return wrap;
  }

  function paint() {
    if (!body) return;
    body.replaceChildren();
    const { start, end } = windowRange();
    const items = allItems();
    const grouped = byDay(items);
    if (!selected || selected < start || selected > end) {
      selected =
        grouped.has(todayKey()) && todayKey() >= start
          ? todayKey()
          : [...grouped.keys()].sort()[0] || todayKey();
    }

    const asOf = getAsOf?.() || "";
    const itemCount = Number(getItemCount?.()) || 0;
    const total = el("p", "cal-items");
    total.append(el("span", null, plural(itemCount, "item", "items")));
    if (asOf) {
      total.append(el("span", "cal-items-sub", ` · as of ${asOf}`));
    }
    body.append(total);
    const lede = el(
      "p",
      "fiscal-lede",
      `Official activity in this Heat snapshot through ${prettyDay(end)}.`
    );
    body.append(lede);

    body.append(renderSheet(start, end, grouped));
    body.append(renderDayList(selected, grouped));
  }

  function show() {
    paint();
  }

  return { show };
}
