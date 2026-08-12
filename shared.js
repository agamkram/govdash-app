/** Shared labels, kind colors, fill helpers for all map views. */

/** Constitutional order for top doors (matches Sankey). Independent last. */
export const BRANCH_ORDER = [
  "Executive",
  "Legislative",
  "Judicial",
  "Independent",
  "Chartered",
  "International",
];

/** Only the four product doors — not every agency whose name mentions a branch word. */
export function branchOrderKey(nodeOrData) {
  const n = nodeOrData?.data ?? nodeOrData;
  if (!n) return null;
  if (n.short && BRANCH_ORDER.includes(n.short)) return n.short;
  // Citizen short for the non-Cabinet door (not a constitutional branch)
  if (n.short === "Agencies") return "Independent";
  if (n.short === "Chartered") return "Chartered";
  if (n.short === "International") return "International";
  const name = n.name || "";
  // Exact / door-shaped labels only (curated product + Crosswalk branch titles).
  if (/^Federal Legislative Branch$/i.test(name)) return "Legislative";
  if (/^Federal Executive Branch$/i.test(name)) return "Executive";
  if (/^Federal Judicial Branch$/i.test(name)) return "Judicial";
  if (/^Independent\b/i.test(name) && /Agenc/i.test(name)) return "Independent";
  if (/^Independent & Regulatory Agencies$/i.test(name)) return "Independent";
  if (/^Federally Chartered$/i.test(name)) return "Chartered";
  if (/^International Organizations$/i.test(name)) return "International";
  return null;
}

/** Sort comparator for hierarchy nodes: branches in constitutional order, else by value/name. */
export function hierarchySort(a, b) {
  const ka = branchOrderKey(a);
  const kb = branchOrderKey(b);
  if (ka || kb) {
    const ia = ka ? BRANCH_ORDER.indexOf(ka) : 99;
    const ib = kb ? BRANCH_ORDER.indexOf(kb) : 99;
    if (ia !== ib) return ia - ib;
  }
  return (
    (b.value || 0) - (a.value || 0) ||
    String(a.data?.name || a.name || "").localeCompare(String(b.data?.name || b.name || ""))
  );
}

/** Stone / mineral fills — quiet, NDS-adjacent, readable on cool gray field. */
export const KIND_FILL = {
  sovereign: "#7e878e",
  branch: "#d4b45c",
  department: "#4a5f73",
  agency: "#5a6b78",
  independent: "#d4b45c",
  bureau: "#6a737a",
  office: "#7a8288",
  chamber: "#4a5f73",
  court: "#5a6e62",
  military: "#5c6a62",
  command: "#6a756c",
  bucket: "#9aa1a6",
  gse: "#d4b45c",
  nonprofit: "#7a6e72",
  igo: "#6a737a",
  carrier: "#6e7874",
  unknown: "#868e96",
};

/** Constitutional door colors (Sankey + any branch chrome). */
export const BRANCH_COLOR = {
  Legislative: "#4a5f73",
  Executive: "#8f5a52",
  Judicial: "#5a6e62",
  Independent: "#d4b45c",
  Chartered: "#7a6e72",
  International: "#4d6b7a",
  default: "#6a737a",
};

export function atlasRail(rootOrData) {
  const n = rootOrData?.data ?? rootOrData;
  if (n?.id === "beyond") {
    return { id: "beyond", name: "Beyond", short: "Beyond", kind: "sovereign" };
  }
  return {
    id: "usa",
    name: "The Constitution",
    short: "Constitution",
    kind: "constitution",
  };
}

export const CONSTITUTION_FILL = "#8a9399";
export const INK = "#2a3035";
export const MAP_FIELD = "#c8cbd0";
/** Branch door labels on stone fills (icicle). */
export const LABEL_ON_BRANCH = "#f0eeea";

/** Stamp each data node with its constitutional door (Legislative / Executive / …). */
export function stampDoorColors(root) {
  function walk(node, door) {
    if (!node) return;
    const here = branchOrderKey(node) || door || null;
    if (here) node.door = here;
    for (const c of node.children || []) walk(c, here);
  }
  walk(root, null);
}

export function doorKey(nodeOrData) {
  const n = nodeOrData?.data ?? nodeOrData;
  if (!n) return null;
  if (n.door && BRANCH_COLOR[n.door]) return n.door;
  const keyed = branchOrderKey(n);
  if (keyed) return keyed;
  let h = nodeOrData?.parent ? nodeOrData : null;
  while (h) {
    const k = branchOrderKey(h) || h.data?.door;
    if (k && BRANCH_COLOR[k]) return k;
    h = h.parent;
  }
  return null;
}

export function kindFill(nodeOrData) {
  const door = doorKey(nodeOrData);
  if (door) return BRANCH_COLOR[door];
  const kind = nodeOrData?.data?.kind ?? nodeOrData?.kind;
  return KIND_FILL[kind] || KIND_FILL.unknown;
}

export function displayName(nodeOrData) {
  const n = nodeOrData?.data ?? nodeOrData;
  if (n.short && n.short.length >= 2 && n.short.length <= 16) return n.short;
  let name = (n.name || "")
    .replace(/^US\s+/i, "")
    .replace(/^United States\s+/i, "")
    .replace(/^Federal\s+/i, "")
    // Trailing GSA-style letter codes and redundant final acronyms
    .replace(/\s*\([A-Z0-9]\)\s*$/, "")
    .replace(/\s*\(([A-Z0-9][A-Z0-9&/.+-]{1,16})\)\s*$/, "")
    .trim();
  if (name.length <= 32) return name;
  return name.slice(0, 30) + "…";
}

/** Phone + iPad tip placement — iPad often reports pointer:fine, so don't rely on coarse alone. */
export function isTouchTipUi() {
  if (typeof navigator === "undefined") return false;
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent || "")) return true;
  if (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1) return true;
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/** Position #map-tip: above the finger on phone/iPad; below the cursor on Mac. */
export function placeMapTip(tipEl, clientX, clientY, { fromTouch = false } = {}) {
  if (!tipEl) return;
  const above = fromTouch || isTouchTipUi();
  const pad = above ? 56 : 14;
  tipEl.style.left = "0px";
  tipEl.style.top = "0px";
  const tipRect = tipEl.getBoundingClientRect();
  let left = clientX + pad;
  let top = above ? clientY - tipRect.height - pad : clientY + pad;
  if (left + tipRect.width > window.innerWidth - 8) left = clientX - tipRect.width - pad;
  if (above) {
    if (top < 8) top = 8;
  } else if (top + tipRect.height > window.innerHeight - 8) {
    top = Math.max(8, clientY - tipRect.height - pad);
  }
  tipEl.style.left = `${Math.max(8, left)}px`;
  tipEl.style.top = `${Math.max(8, top)}px`;
}

const SCRUB_COACH_KEY = "govdash-scrub-coach";
const SCRUB_NUDGE_KEY = "govdash-scrub-nudge";
let scrubNudgeTimer = 0;

function coachEl() {
  return document.getElementById("scrub-coach");
}

function scrubCoachDismissed() {
  try {
    return localStorage.getItem(SCRUB_COACH_KEY) === "1";
  } catch {
    return true;
  }
}

/** Hide and remember — Got it, or first successful long-press scrub. */
export function dismissScrubCoach() {
  try {
    localStorage.setItem(SCRUB_COACH_KEY, "1");
  } catch {
    /* ignore */
  }
  const el = coachEl();
  if (el) {
    el.hidden = true;
    el.classList.remove("is-nudge");
  }
}

/** Call when a long-press scrub arms a node — teaches by doing. */
export function noteScrubSuccess() {
  try {
    localStorage.setItem(SCRUB_NUDGE_KEY, "1");
  } catch {
    /* ignore */
  }
  dismissScrubCoach();
}

/**
 * Phone/iPad only. Show once until Got it or a successful scrub.
 * Hidden on Tree (no scrub) and when already dismissed.
 */
export function syncScrubCoach(mode) {
  const el = coachEl();
  if (!el) return;
  if (!isTouchTipUi() || scrubCoachDismissed() || mode === "tree") {
    if (!el.classList.contains("is-nudge")) el.hidden = true;
    return;
  }
  el.classList.remove("is-nudge");
  const copy = el.querySelector(".scrub-coach-copy");
  if (copy) {
    copy.textContent = "Press and hold, then slide to pick a place.";
  }
  el.hidden = false;
  const btn = el.querySelector("[data-dismiss-coach]");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => dismissScrubCoach());
  }
}

/** One-shot toast after a dead tap on unlabeled Circles (coach already gone). */
export function nudgeScrubHint() {
  if (!isTouchTipUi()) return;
  if (!scrubCoachDismissed()) return;
  try {
    if (localStorage.getItem(SCRUB_NUDGE_KEY) === "1") return;
    localStorage.setItem(SCRUB_NUDGE_KEY, "1");
  } catch {
    return;
  }
  const el = coachEl();
  if (!el) return;
  const copy = el.querySelector(".scrub-coach-copy");
  if (copy) copy.textContent = "Press and hold to choose.";
  el.classList.add("is-nudge");
  el.hidden = false;
  if (scrubNudgeTimer) clearTimeout(scrubNudgeTimer);
  scrubNudgeTimer = window.setTimeout(() => {
    scrubNudgeTimer = 0;
    el.hidden = true;
    el.classList.remove("is-nudge");
  }, 2800);
}

export function paintFill(nodeOrData) {
  const base = kindFill(nodeOrData);
  const depth = nodeOrData?.depth;
  if (!(depth > 1)) return base;
  const t = Math.min(0.48, (depth - 1) * 0.16);
  return mixHex(base, MAP_FIELD, t);
}

/** Push saturation/lightness so selected / hover / scrub stands out (Sankey-style). */
export function brightenHex(color) {
  const rgb = parseColorRgb(color);
  if (!rgb) return color;
  let [r, g, b] = rgb.map((n) => n / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  let sat = 0;
  const lit = (max + min) / 2;
  const d = max - min;
  if (d > 1e-6) {
    sat = d / (1 - Math.abs(2 * lit - 1));
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  sat = Math.min(1, sat * 1.85 + 0.18);
  const L = Math.min(0.52, Math.max(0.38, lit * 1.08 + 0.06));
  const c = (1 - Math.abs(2 * L - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = L - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hue < 60) {
    rp = c;
    gp = x;
  } else if (hue < 120) {
    rp = x;
    gp = c;
  } else if (hue < 180) {
    gp = c;
    bp = x;
  } else if (hue < 240) {
    gp = x;
    bp = c;
  } else if (hue < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  const to = (n) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(rp)}${to(gp)}${to(bp)}`;
}

/** Clicked / hovered org fill — brighten the segment color (no outline box). */
export function selectionFill(nodeOrData) {
  return brightenHex(paintFill(nodeOrData));
}

export function cellFill(nodeOrData, selected) {
  return selected ? selectionFill(nodeOrData) : paintFill(nodeOrData);
}

function mixHex(a, b, t) {
  const pa = hexRgb(a);
  const pb = hexRgb(b);
  if (!pa || !pb) return a;
  const m = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

function parseColorRgb(color) {
  const s = String(color || "").trim();
  const hex = s.replace("#", "");
  if (hex.length === 6 && /^[0-9a-fA-F]+$/.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function hexRgb(hex) {
  return parseColorRgb(hex);
}

export function childCount(node) {
  let n = 0;
  for (const c of node.children || []) n += 1 + childCount(c);
  return n;
}

/** Truncate a data node for local layout (does not mutate source). */
export function sliceTree(node, depthLeft) {
  const kids =
    depthLeft > 0 && node.children?.length
      ? node.children.map((c) => sliceTree(c, depthLeft - 1))
      : undefined;
  return {
    id: node.id,
    name: node.name,
    short: node.short,
    kind: node.kind,
    heat: node.heat,
    door: node.door,
    children: kids,
  };
}
