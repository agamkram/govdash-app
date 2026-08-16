/** Shared labels, kind colors, fill helpers for all map views. */

/** Constitutional order for top doors (matches Sankey). Independent last. */
export const BRANCH_ORDER = [
  "Legislative",
  "Executive",
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

/**
 * Layout weight for map views (parents with visible children contribute 0 via d3.sum).
 * Leg/Jud leaves are boosted (DOOR_LEAF_WEIGHT). Each node stores layoutWeight =
 * full subtree sum so truncated slices (depth 1, etc.) stay proportional.
 */
export const DOOR_LEAF_WEIGHT = {
  Legislative: 4,
  Judicial: 4,
  // Beyond doors: narrower than Leg (20×4 = 80). Chartered 33×1=33; International 116×0.5=58.
  Chartered: 1,
  International: 0.5,
};

function doorLeafUnit(data) {
  const door = data?.door;
  const w = door != null ? DOOR_LEAF_WEIGHT[door] : null;
  return w > 0 ? w : 1;
}

/** d3.hierarchy.sum callback — works for true leaves and depth-truncated parents. */
export function leafLayoutWeight(data) {
  if (data?.children?.length) return 0;
  if (data?.layoutWeight > 0) return data.layoutWeight;
  return doorLeafUnit(data);
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

/** Constitutional door colors — mutated by applyColorTheme (live bindings). */
export const BRANCH_COLOR = {
  Legislative: "#5a8eb0",
  Executive: "#d47868",
  Judicial: "#5fa87a",
  Independent: "#e0c04a",
  Chartered: "#a8888c",
  International: "#5a8fa0",
  default: "#8a9299",
};

/** Cycle order: Dark ↔ Light (dark is default; not persisted). */
export const THEME_ORDER = ["dark", "light"];

const THEME_PRESETS = {
  light: {
    label: "Light",
    short: "L",
    branch: {
      Legislative: "#3a6d94",
      Executive: "#b85a4a",
      Judicial: "#3f7a58",
      Independent: "#c9a12a",
      Chartered: "#8a6e72",
      International: "#3d6f82",
      default: "#6a737a",
    },
    mapField: "#c8cbd0",
    constitution: "#8a9399",
    labelOnBranch: "#f0eeea",
    ink: "#2a3035",
  },
  dark: {
    label: "Dark",
    short: "D",
    branch: {
      Legislative: "#5a8eb0",
      Executive: "#d47868",
      Judicial: "#5fa87a",
      Independent: "#e0c04a",
      Chartered: "#a8888c",
      International: "#5a8fa0",
      default: "#8a9299",
    },
    mapField: "#1a1d21",
    constitution: "#6a737a",
    labelOnBranch: "#0f1214",
    ink: "#e8eaed",
  },
};

export let MAP_FIELD = THEME_PRESETS.dark.mapField;
export let CONSTITUTION_FILL = THEME_PRESETS.dark.constitution;
export let LABEL_ON_BRANCH = THEME_PRESETS.dark.labelOnBranch;
export let INK = THEME_PRESETS.dark.ink;

let activeThemeId = "dark";

export function getColorTheme() {
  return activeThemeId;
}

export function themeMeta(id = activeThemeId) {
  return THEME_PRESETS[id] || THEME_PRESETS.dark;
}

export function applyColorTheme(id) {
  const raw = id === "classic" ? "dark" : id;
  const next = THEME_ORDER.includes(raw) ? raw : "dark";
  const preset = THEME_PRESETS[next];
  activeThemeId = next;
  Object.assign(BRANCH_COLOR, preset.branch);
  MAP_FIELD = preset.mapField;
  CONSTITUTION_FILL = preset.constitution;
  LABEL_ON_BRANCH = preset.labelOnBranch;
  INK = preset.ink;
  try {
    document.documentElement.dataset.theme = next;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "light" ? "#e8eaed" : "#121518");
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(
      new CustomEvent("govdash-theme", { detail: { theme: next } })
    );
  } catch {
    /* ignore */
  }
  return next;
}

export function cycleColorTheme() {
  const i = THEME_ORDER.indexOf(activeThemeId);
  const next = THEME_ORDER[(i < 0 ? 0 : i + 1) % THEME_ORDER.length];
  return applyColorTheme(next);
}

export function initColorTheme() {
  try {
    localStorage.removeItem("govdash-color-theme");
    localStorage.removeItem("govdash-scrub-coach");
    localStorage.removeItem("govdash-scrub-nudge");
    localStorage.removeItem("govdash-zip");
    localStorage.removeItem("govdash-heat"); // Heat is session-only, always starts off
    // Keep govdash-chart-mode — chart view only.
  } catch {
    /* ignore */
  }
  return applyColorTheme("dark");
}

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

/** Stamp each data node with its constitutional door (Legislative / Executive / …). */
export function stampDoorColors(root) {
  function walkDoor(node, door) {
    if (!node) return;
    const here = branchOrderKey(node) || door || null;
    if (here) node.door = here;
    for (const c of node.children || []) walkDoor(c, here);
  }
  walkDoor(root, null);

  // Subtree layout weights (boosted Leg/Jud leaves) so depth-sliced maps stay proportional.
  function walkWeight(node) {
    if (!node) return 0;
    const kids = node.children || [];
    if (!kids.length) {
      node.layoutWeight = doorLeafUnit(node);
      return node.layoutWeight;
    }
    let sum = 0;
    for (const c of kids) sum += walkWeight(c);
    node.layoutWeight = sum;
    return sum;
  }
  walkWeight(root);
}

/** Append Chartered + International after Agencies (mutates usa root). */
export function attachBeyondDoors(usaRoot, beyondRoot) {
  if (!usaRoot || !beyondRoot?.children?.length) return usaRoot;
  const kids = [...(usaRoot.children || [])];
  for (const door of beyondRoot.children) {
    if (!door?.id) continue;
    if (kids.some((k) => k.id === door.id)) continue;
    kids.push(door);
  }
  kids.sort((a, b) => {
    const ka = branchOrderKey(a);
    const kb = branchOrderKey(b);
    const ia = ka ? BRANCH_ORDER.indexOf(ka) : 99;
    const ib = kb ? BRANCH_ORDER.indexOf(kb) : 99;
    if (ia !== ib) return ia - ib;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  usaRoot.children = kids;
  return usaRoot;
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

let scrubNudgeTimer = 0;
let scrubCoachDismissedSession = false;
let scrubNudgeShownSession = false;

function coachEl() {
  return document.getElementById("scrub-coach");
}

function scrubCoachDismissed() {
  return scrubCoachDismissedSession;
}

/** Hide for this session — Got it, or first successful long-press scrub. */
export function dismissScrubCoach() {
  scrubCoachDismissedSession = true;
  const el = coachEl();
  if (el) {
    el.hidden = true;
    el.classList.remove("is-nudge");
  }
}

/** Call when a long-press scrub arms a node — teaches by doing. */
export function noteScrubSuccess() {
  scrubNudgeShownSession = true;
  dismissScrubCoach();
}

/**
 * Phone/iPad only. Show until Got it or a successful scrub (this session).
 * Hidden on Tree / Circles (tap-to-enter) and when already dismissed.
 */
export function syncScrubCoach(mode) {
  const el = coachEl();
  if (!el) return;
  if (
    !isTouchTipUi() ||
    scrubCoachDismissed() ||
    mode === "tree" ||
    mode === "pack"
  ) {
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
  if (scrubNudgeShownSession) return;
  scrubNudgeShownSession = true;
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

/** Pulse only when this node has its own events — not a parent echo. */
export function nodeHasHeat(nodeOrData) {
  const d = nodeOrData?.data ?? nodeOrData;
  const h = d?.heat;
  if (!h || h.rolledUp) return false;
  if (typeof h.count === "number" && h.count > 0) return true;
  return Array.isArray(h.events) && h.events.length > 0;
}

/** Heat here or below (rolled-up). Used for tree branch marks. */
export function nodeHasHeatDeep(nodeOrData) {
  const d = nodeOrData?.data ?? nodeOrData;
  const h = d?.heat;
  if (!h) return false;
  if (typeof h.count === "number" && h.count > 0) return true;
  return Array.isArray(h.events) && h.events.length > 0;
}

export function heatEventCount(nodeOrData) {
  const d = nodeOrData?.data ?? nodeOrData;
  const h = d?.heat;
  if (!h) return 0;
  if (typeof h.count === "number") return h.count;
  return Array.isArray(h.events) ? h.events.length : 0;
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
    spending: node.spending,
    door: node.door,
    layoutWeight: node.layoutWeight,
    children: kids,
  };
}

export const HEAT_KIND_LABEL = {
  floor_session: "Floor",
  house_schedule: "House schedule",
  public_inspection: "Public inspection",
  presidential_doc: "Presidential",
  hearing: "Hearing",
  comment_deadline: "Comment deadline",
  vote_recent: "Vote",
};

/**
 * JS-driven Heat pulse for all maps.
 *
 * Why not CSS: iOS Safari often skips opacity keyframes on SVG under transforms.
 * Why setInterval (not only rAF): Low Power Mode / background tabs stall rAF;
 * interval keeps a visible pulse on phone/pad.
 *
 * Cost: ~70 nodes × ~15 Hz attribute writes. Negligible next to map layout.
 */
let heatPulseTimer = 0;
let heatPulseWanted = false;
/** Optional canvas/view hook (Sankey) — (t, now) => void */
let heatPulseSink = null;

export function heatPulsePhase(now = performance.now()) {
  // 0 = rest fill, 1 = selected/bright fill
  return 0.5 + 0.5 * Math.sin(now / 380);
}

/**
 * How hard to boost a heat cell from on-screen size (px).
 * Tiny / hard to see → 1. Large / zoomed in → 0 (normal pulse).
 */
export function heatSizeBoost(screenPx) {
  const n = Number(screenPx);
  if (!(n > 0)) return 1;
  if (n >= 72) return 0;
  if (n <= 18) return 1;
  return 1 - (n - 18) / (72 - 18);
}

/** Stronger color swing when boost > 0 (still ends at selected at t=1 when large). */
export function heatPulseT(t, boost = 0) {
  const b = Math.max(0, Math.min(1, boost));
  // Widen the sine around 0.5 so small cells flash harder.
  const amp = 1 + 0.55 * b;
  return Math.max(0, Math.min(1, 0.5 + (t - 0.5) * amp));
}

/** Lerp rest (unselected) → selected color. */
export function heatPulseFill(rest, selected, t) {
  return mixHex(rest, selected, t);
}

/** Width scale for tiny heat cells (1 = no grow). Peaks at 2 (= double area, height fixed). */
export function heatPulseScale(t, boost = 0) {
  const b = Math.max(0, Math.min(1, boost));
  // s=2 at full boost/peak → double width, equal left+right from center.
  return 1 + b * 1.0 * t;
}

export function setHeatPulseSink(fn) {
  heatPulseSink = typeof fn === "function" ? fn : null;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Overlay above all icicle cells so L+R growth isn’t covered by neighbors. */
function ensureIcicleHeatOverlay() {
  const viewport =
    document.querySelector("#map .icicle-viewport") ||
    document.querySelector(".icicle-viewport");
  if (!viewport) return null;
  let o = viewport.querySelector("g.icicle-heat-pulse");
  if (!o) {
    o = document.createElementNS(SVG_NS, "g");
    o.setAttribute("class", "icicle-heat-pulse");
    o.style.pointerEvents = "none";
    viewport.appendChild(o);
  } else if (viewport.lastElementChild !== o) {
    viewport.appendChild(o);
  }
  return o;
}

function clearIcicleHeatOverlay() {
  document.querySelectorAll("g.icicle-heat-pulse").forEach((o) => {
    o.replaceChildren();
  });
}

function heatPulseApply() {
  if (!heatPulseWanted) return;
  if (
    typeof document === "undefined" ||
    !document.documentElement.classList.contains("heat-on")
  ) {
    stopHeatPulse();
    return;
  }

  const now = performance.now();
  const t = heatPulsePhase(now);
  const mapEl = document.getElementById("map");
  const camK = Math.max(0.001, Number(mapEl?.dataset?.heatCamK) || 1);

  const icicleCells = document.querySelectorAll(
    "html.heat-on .icicle-cell.has-heat > rect.icicle-rect"
  );
  const overlay = ensureIcicleHeatOverlay();
  const seen = new Set();

  for (const el of icicleCells) {
    const g = el.parentElement;
    if (!g) continue;
    const hold = el.getAttribute("data-heat-hold") === "1";
    const rest = el.getAttribute("data-fill-rest");
    const sel = el.getAttribute("data-fill-sel");
    // Layout size only — never fall back to live width/height (those pulse).
    const wBase = Number(el.getAttribute("data-w-base"));
    const hBase = Number(el.getAttribute("data-h-base"));
    if (!(wBase > 0) || !(hBase > 0)) continue;
    const tx = Number(g.getAttribute("data-tx"));
    const ty = Number(g.getAttribute("data-ty"));
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;

    // Real cell stays at layout size (hit-test + neighbors don’t cover a grown box).
    g.setAttribute("transform", `translate(${tx},${ty})`);
    el.removeAttribute("transform");
    el.setAttribute("x", "0");
    el.setAttribute("y", "0");
    el.setAttribute("width", String(wBase));
    el.setAttribute("height", String(hBase));

    const screenMin = Math.min(wBase, hBase) * camK;
    const boost = heatSizeBoost(screenMin);
    const tt = heatPulseT(t, boost);
    const s = hold ? 1 : heatPulseScale(tt, Math.max(boost, 0.35));
    const grow = el.getAttribute("data-grow") === "y" ? "y" : "x";

    const fill =
      hold && sel
        ? sel
        : rest && sel
          ? heatPulseFill(rest, sel, tt)
          : rest || sel || null;
    if (fill) {
      el.setAttribute("fill", fill);
      el.setAttribute("fill-opacity", "1");
    }

    // Expanded visual on overlay (above every cell) so L and R both show.
    if (!overlay || hold || s <= 1.001) continue;
    const id = g.getAttribute("data-id") || rest;
    const key = String(id ?? `${tx},${ty}`).replace(/"/g, "");
    seen.add(key);
    let pulse = null;
    for (const r of overlay.querySelectorAll("rect[data-heat-id]")) {
      if (r.getAttribute("data-heat-id") === key) {
        pulse = r;
        break;
      }
    }
    if (!pulse) {
      pulse = document.createElementNS(SVG_NS, "rect");
      pulse.setAttribute("data-heat-id", key);
      pulse.style.pointerEvents = "none";
      overlay.appendChild(pulse);
    }
    if (grow === "y") {
      const hPulse = hBase * s;
      pulse.setAttribute("x", String(tx));
      pulse.setAttribute("y", String(ty + (hBase - hPulse) / 2));
      pulse.setAttribute("width", String(wBase));
      pulse.setAttribute("height", String(hPulse));
    } else {
      const wPulse = wBase * s;
      pulse.setAttribute("x", String(tx + (wBase - wPulse) / 2));
      pulse.setAttribute("y", String(ty));
      pulse.setAttribute("width", String(wPulse));
      pulse.setAttribute("height", String(hBase));
    }
    if (fill) pulse.setAttribute("fill", fill);
    pulse.setAttribute("fill-opacity", "1");
  }

  if (overlay) {
    overlay.querySelectorAll("rect[data-heat-id]").forEach((r) => {
      if (!seen.has(r.getAttribute("data-heat-id"))) r.remove();
    });
  }

  // Circles — gentle color pulse only (no exaggerated size like icicle/sankey).
  const packNodes = document.querySelectorAll("html.heat-on circle.map-node.has-heat");
  for (const el of packNodes) {
    if (el.getAttribute("data-heat-hold") === "1") continue;
    const rest = el.getAttribute("data-fill-rest");
    const sel = el.getAttribute("data-fill-sel");
    const rBase = Number(el.getAttribute("data-r-base"));
    if (rest && sel) el.setAttribute("fill", heatPulseFill(rest, sel, t));
    if (rBase > 0) el.setAttribute("r", String(rBase));
    el.removeAttribute("rx");
    el.removeAttribute("ry");
    const baseOp = el.getAttribute("data-base-op");
    if (baseOp != null) el.setAttribute("fill-opacity", baseOp);
  }

  // Tree — direct heat: swatch + row wash. Branch with heat below: pulsing bracket only.
  const rows = document.querySelectorAll(
    "html.heat-on .org-row.has-heat, html.heat-on .org-row.has-heat-deep"
  );
  for (const el of rows) {
    if (el.classList.contains("is-selected") || el.classList.contains("is-focus")) continue;
    const rest = el.getAttribute("data-fill-rest");
    const sel = el.getAttribute("data-fill-sel");
    if (!rest || !sel) continue;
    const deepOnly = el.classList.contains("has-heat-deep");
    const tt = heatPulseT(t, deepOnly ? 0.4 : 0.55);
    const fill = heatPulseFill(rest, sel, tt);
    const bracket = el.querySelector(".org-heat-bracket");
    if (bracket) bracket.style.background = fill;
    if (deepOnly) continue;
    const swatch = el.querySelector(".org-swatch");
    if (swatch) swatch.style.background = fill;
    const rgb = parseColorRgb(fill);
    if (rgb) {
      const a = (0.1 + 0.14 * tt).toFixed(3);
      el.style.backgroundColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    }
  }

  if (heatPulseSink) {
    try {
      heatPulseSink(t, now);
    } catch {
      /* ignore */
    }
  }
}

function stopHeatPulse() {
  heatPulseWanted = false;
  if (heatPulseTimer) {
    clearInterval(heatPulseTimer);
    heatPulseTimer = 0;
  }
  // Reset size boost / overlay so layout stays clean when Heat is off.
  try {
    clearIcicleHeatOverlay();
    document.querySelectorAll(".icicle-cell.has-heat").forEach((g) => {
      const tx = g.getAttribute("data-tx");
      const ty = g.getAttribute("data-ty");
      if (tx != null && ty != null) {
        g.setAttribute("transform", `translate(${tx},${ty})`);
      }
      const el = g.querySelector("rect.icicle-rect");
      if (!el) return;
      el.removeAttribute("transform");
      const w = el.getAttribute("data-w-base");
      const h = el.getAttribute("data-h-base");
      if (w != null) {
        el.setAttribute("x", "0");
        el.setAttribute("width", w);
      }
      if (h != null) {
        el.setAttribute("y", "0");
        el.setAttribute("height", h);
      }
      const rest = el.getAttribute("data-fill-rest");
      if (rest) el.setAttribute("fill", rest);
    });
    document.querySelectorAll("circle.map-node.has-heat").forEach((el) => {
      const r = el.getAttribute("data-r-base");
      if (r != null) {
        el.setAttribute("r", r);
        el.removeAttribute("rx");
        el.removeAttribute("ry");
      }
      const rest = el.getAttribute("data-fill-rest");
      if (rest) el.setAttribute("fill", rest);
      const baseOp = el.getAttribute("data-base-op");
      if (baseOp != null) el.setAttribute("fill-opacity", baseOp);
    });
    document
      .querySelectorAll(".org-row.has-heat, .org-row.has-heat-deep")
      .forEach((el) => {
        el.style.backgroundColor = "";
        const swatch = el.querySelector(".org-swatch");
        if (swatch) {
          swatch.style.transform = "";
          const rest = el.getAttribute("data-fill-rest");
          if (rest) swatch.style.background = rest;
        }
        const bracket = el.querySelector(".org-heat-bracket");
        if (bracket) bracket.style.background = "";
      });
  } catch {
    /* ignore */
  }
}

/** Call when Heat is toggled on/off (or after mount). */
export function syncHeatPulse() {
  const on =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("heat-on");
  if (!on) {
    stopHeatPulse();
    return;
  }
  heatPulseWanted = true;
  heatPulseApply(); // immediate first frame
  if (!heatPulseTimer) {
    // ~15 Hz — smooth enough, light on battery
    heatPulseTimer = setInterval(heatPulseApply, 66);
  }
}
