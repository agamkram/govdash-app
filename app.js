import { engagementActions } from "./engagement.js?v=2493";
import { enrichmentContext, indexById } from "./context.js?v=2493";
import {
  childCount,
  displayName,
  stampDoorColors,
  attachBeyondDoors,
  atlasRail,
  syncScrubCoach,
  initColorTheme,
  cycleColorTheme,
  themeMeta,
  getColorTheme,
  HEAT_KIND_LABEL,
  syncHeatPulse,
  setHeatPulseSink,
} from "./shared.js?v=2504";
import { createIcicleView } from "./views/icicle.js?v=2493";
import { createTreeView } from "./views/tree.js?v=2493";
import { createPackView } from "./views/pack.js?v=2501";
import { createSankeyView } from "./views/sankey.js?v=2493";
import { createFiscalPage } from "./views/fiscal.js?v=2493";
import { createYouPage, YOU_NODES } from "./views/you.js?v=2493";
import { createCalPage } from "./views/calendar.js?v=2503";
import { createRefugeesPage } from "./views/refugees.js?v=2531";
import { authorityLine } from "./authority.js?v=2493";
import { createSpendYearController } from "./spend-year.js?v=2493";

const TREE_URL = "./data/nested/gov-tree-product.json?v=2493";
const BEYOND_URL = "./data/nested/gov-tree-beyond.json?v=2493";
const SPEND_YEAR_URL = "./data/nested/spend-by-year.json?v=2493";

const factories = {
  icicle: createIcicleView,
  tree: createTreeView,
  pack: createPackView,
  sankey: createSankeyView,
};

/** Heat always starts off; not persisted (off label is the invite). */
function readHeatOn() {
  return false;
}

/** Places that actually pulse (own events, not parent rollup). */
let heatPulsePlaceCount = 0;
/** Raw events in this Heat bake (C page total; not the 30-day slice). */
let heatRawEventCount = 0;
/** Chip/pane snapshot day from meta.heat.asOf (e.g. "Aug 16"). */
let heatAsOfLabel = "";

/** Bake calendar day — YYYY-MM-DD in the ISO, not Idaho local clock. */
function formatHeatSnapshotDay(iso) {
  const s = String(iso || "").trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (day) {
    const d = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function heatOnChipText(n) {
  const count = String(n);
  return heatAsOfLabel ? `${count} as of ${heatAsOfLabel}` : count;
}

function countDirectHeatPlaces(root) {
  let n = 0;
  const walk = (node) => {
    const h = node?.heat;
    if (h && !h.rolledUp) {
      const c =
        typeof h.count === "number"
          ? h.count
          : Array.isArray(h.events)
            ? h.events.length
            : 0;
      if (c > 0) n += 1;
    }
    for (const ch of node?.children || []) walk(ch);
  };
  if (root) walk(root);
  return n;
}

function setHeatPulsePlaceCount(n) {
  heatPulsePlaceCount = Math.max(0, Math.round(Number(n) || 0));
  syncHeatChip();
}

const HEAT_OFF_LABEL = "Where's the action?";

/**
 * Heat switch: two functions only — off | on.
 * When on, the label always carries the pulse count (including 0).
 * Off after toggle must match cold-start off (same classes + label).
 */
function syncHeatChip() {
  if (!btnHeat) return;
  const on = document.documentElement.classList.contains("heat-on");
  const n = heatPulsePlaceCount;
  const nLabel = String(n);

  let text;
  let title;
  let aria;
  if (!on) {
    text = HEAT_OFF_LABEL;
    title =
      "Tap to show places with upcoming floor, Register filings, and other official activity";
    aria = "Heat off. Tap to show where the action is on the map.";
  } else {
    text = heatOnChipText(n);
    const asOfBit = heatAsOfLabel ? ` as of ${heatAsOfLabel}` : "";
    title =
      n > 0
        ? `${nLabel} place${n === 1 ? "" : "s"} with official activity${asOfBit} · zoom to find them · tap to hide`
        : `Heat on · nothing in this snapshot${asOfBit} · tap to hide`;
    aria =
      n > 0
        ? `Heat on. ${heatOnChipText(n)}. Zoom to find them. Tap to hide.`
        : `Heat on. ${heatOnChipText(0)}. Tap to hide.`;
  }

  // Explicit two-state face — never leave a sticky on/empty class when off.
  btnHeat.dataset.heatState = on ? "on" : "off";
  btnHeat.classList.toggle("is-on", on);
  btnHeat.classList.remove("is-empty", "is-active");
  btnHeat.setAttribute("aria-pressed", on ? "true" : "false");
  btnHeat.title = title;
  btnHeat.setAttribute("aria-label", aria);
  if (heatChipTextEl) heatChipTextEl.textContent = text;
}

function applyHeatChrome(on) {
  document.documentElement.classList.toggle("heat-on", !!on);
  syncHeatChip();
  // Lightweight redraw — avoid full icicle rebuild via resize().
  viewApi?.setSelected?.(selectedNode?.id ?? null);
  if (mode === "sankey") viewApi?.resize?.();
  syncHeatPulse();
}

const searchInput = document.getElementById("search");
const searchResults = document.getElementById("search-results");
const breadcrumbsEl = document.getElementById("breadcrumbs");
const atlasSubEl = document.getElementById("atlas-sub");
const detailEl = document.getElementById("detail");
const dKind = document.getElementById("d-kind");
const dTitle = document.getElementById("d-title");
const dAuthority = document.getElementById("d-authority");
const dWorkforce = document.getElementById("d-workforce");
const dSpending = document.getElementById("d-spending");
const dShort = document.getElementById("d-short");
const dHeat = document.getElementById("d-heat");
const dHeatList = document.getElementById("d-heat-list");
const dCodes = document.getElementById("d-codes");
const dMission = document.getElementById("d-mission");
const dMissionBody = document.getElementById("d-mission-body");
const dLeaders = document.getElementById("d-leaders");
const dLeadersList = document.getElementById("d-leaders-list");
const dEngage = document.getElementById("d-engage");
const dEngageList = document.getElementById("d-engage-list");
const dNote = document.getElementById("d-note");
const detailClose = document.getElementById("detail-close");
const btnEnter = document.getElementById("btn-enter");
const btnHeat = document.getElementById("btn-heat");
const heatChipTextEl = document.getElementById("heat-chip-text");
const btnFiscal = document.getElementById("btn-fiscal");
const btnYou = document.getElementById("btn-you");
const btnCal = document.getElementById("btn-cal");
const btnRefugees = document.getElementById("btn-refugees");
const btnAbout = document.getElementById("btn-about");
const btnTheme = document.getElementById("btn-theme");
const fiscalPageEl = document.getElementById("page-fiscal");
const fiscalBack = document.getElementById("fiscal-back");
const youPageEl = document.getElementById("page-you");
const youBack = document.getElementById("you-back");
const calPageEl = document.getElementById("page-cal");
const calBack = document.getElementById("cal-back");
const refugeesPageEl = document.getElementById("page-refugees");
const refugeesBack = document.getElementById("refugees-back");
const aboutPageEl = document.getElementById("page-about");
const aboutBack = document.getElementById("about-back");
const mapEl = document.getElementById("map");
const orientToggle = document.getElementById("orient-toggle");
const icicleDepthEl = document.getElementById("icicle-depth");
const icicleDepthRange = document.getElementById("icicle-depth-range");
const icicleDepthOut = document.getElementById("icicle-depth-out");
const detailFyEl = document.getElementById("detail-fy");
const fyRange = document.getElementById("fy-range");
const fyOut = document.getElementById("fy-out");
const shellEl = document.querySelector(".shell");

/** @type {ReturnType<typeof createSpendYearController> | null} */
let spendYear = null;

let layoutResizeTimer = null;
let lastFillKey = "";
let lastSafeInset = { w: 0, h: 0, v: 0 };
let lastMapBoxKey = "";

function isStandaloneDisplay() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

function isTouchShell() {
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent || "")) return true;
  if (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1) {
    return true;
  }
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

function isTabletShell() {
  const minSide = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  if (minSide < 600) return false;
  if (/iPhone|iPod/i.test(navigator.userAgent || "")) return false;
  return isTouchShell();
}

function syncTabletClass() {
  document.documentElement.classList.toggle("is-tablet", isTabletShell());
}

function pwaFillHeightPx() {
  const iw = window.innerWidth || 0;
  const ih = window.innerHeight || 0;
  const sw = window.screen?.width || 0;
  const sh = window.screen?.height || 0;
  const screenMax = Math.max(sw, sh);
  const screenMin = Math.min(sw, sh);
  return ih >= iw ? Math.max(ih, screenMax) : Math.max(ih, screenMin);
}

function pwaExtraBottomPx() {
  const iw = window.innerWidth || 0;
  const ih = window.innerHeight || 0;
  const sw = window.screen?.width || 0;
  const sh = window.screen?.height || 0;
  const screenMax = Math.max(sw, sh);
  /* iPad: screen.* often undershoots inner → safe-area extra (Bug B tablet). */
  if (Math.min(iw, ih) >= 600 && screenMax < ih - 10) {
    return Math.max(readSafeInsetBottom(), 20);
  }
  return 0;
}

function readSafeInsetBottom() {
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  if (lastSafeInset.w === w && lastSafeInset.h === h) return lastSafeInset.v;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)";
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  lastSafeInset = { w, h, v: px };
  return px;
}

/**
 * Pin .shell to the visible box.
 * PWA: screen fillH (Bug B). Safari tab: visualViewport only — never stack
 * VV height + env(safe-area-inset-bottom). Desktop: 100%.
 */
function pinShellViewport() {
  const root = document.documentElement;
  syncTabletClass();
  const standalone =
    isStandaloneDisplay() || root.classList.contains("pwa-standalone");

  if (standalone) {
    const fillH = pwaFillHeightPx();
    const extra = pwaExtraBottomPx();
    const total = fillH + extra;
    const key = `pwa:${fillH}+${extra}`;
    root.classList.add("pwa-standalone");
    if (key !== lastFillKey) {
      lastFillKey = key;
      root.style.setProperty("--pwa-fill-h", `${fillH}px`);
      root.style.setProperty("--pwa-extra-b", `${extra}px`);
      root.style.setProperty("--vv-top", "0px");
      root.style.setProperty("--vv-left", "0px");
      root.style.setProperty("--vv-w", `${window.innerWidth || 0}px`);
      root.style.setProperty("--vv-h", `${total}px`);
      root.style.height = `${total}px`;
      root.style.minHeight = `${total}px`;
    }
    return total;
  }

  root.classList.remove("pwa-standalone");
  root.style.removeProperty("--pwa-fill-h");
  root.style.removeProperty("--pwa-extra-b");
  root.style.removeProperty("height");
  root.style.removeProperty("min-height");

  const vv = window.visualViewport;
  const iw = window.innerWidth || 0;
  const ih = window.innerHeight || 0;
  let top = 0;
  let left = 0;
  let width = iw;
  let height = ih;
  if (isTouchShell() && vv && vv.height > 40 && vv.width > 40) {
    top = Math.max(0, Math.round(vv.offsetTop) || 0);
    left = Math.max(0, Math.round(vv.offsetLeft) || 0);
    width = Math.round(vv.width);
    height = Math.round(vv.height);
  } else {
    width = 0;
    height = 0;
  }
  const key = `vv:${top},${left},${width}x${height}`;
  if (key === lastFillKey) return height || ih;
  lastFillKey = key;
  if (width > 0 && height > 0) {
    root.style.setProperty("--vv-top", `${top}px`);
    root.style.setProperty("--vv-left", `${left}px`);
    root.style.setProperty("--vv-w", `${width}px`);
    root.style.setProperty("--vv-h", `${height}px`);
    return height;
  }
  root.style.setProperty("--vv-top", "0px");
  root.style.setProperty("--vv-left", "0px");
  root.style.setProperty("--vv-w", "100%");
  root.style.setProperty("--vv-h", "100%");
  return ih;
}

function layoutMapBox() {
  pinShellViewport();
}

function mapBoxKey() {
  const box = mapEl?.getBoundingClientRect();
  return `${Math.round(box?.width || 0)}x${Math.round(box?.height || 0)}`;
}

function scheduleViewResize() {
  clearTimeout(layoutResizeTimer);
  layoutResizeTimer = setTimeout(() => {
    layoutMapBox();
    const key = mapBoxKey();
    if (key === lastMapBoxKey) return;
    lastMapBoxKey = key;
    requestAnimationFrame(() => viewApi?.resize());
  }, 100);
}

function onViewportChange() {
  layoutMapBox();
  scheduleViewResize();
}

const fiscalPage = createFiscalPage(fiscalPageEl, {
  getRoot: () => usaRoot,
  onMap: (id) => {
    if (!id) return;
    closeAppPage();
    viewApi?.zoomToId(id);
    const node = nodeById.get(id);
    if (node) showDetail(node, { revealRoot: true });
  },
});
const youPage = createYouPage(youPageEl, {
  onMap: (chamber) => showYouOnMap(chamber),
});
const calPage = createCalPage(calPageEl, {
  getRoot: () => usaRoot,
  getAsOf: () => heatAsOfLabel,
  getItemCount: () => heatRawEventCount,
  onMap: (id) => {
    if (!id) return;
    closeAppPage();
    applyHeatChrome(true);
    viewApi?.zoomToId(id);
    const node = nodeById.get(id);
    if (node) showDetail(node, { revealRoot: true });
  },
});
const refugeesPage = createRefugeesPage(refugeesPageEl);

function pageName() {
  const h = location.hash.replace(/^#/, "");
  if (
    h === "fiscal" ||
    h === "you" ||
    h === "cal" ||
    h === "refugees" ||
    h === "about"
  ) {
    return h;
  }
  return "map";
}

function hideAppPages() {
  fiscalPageEl.hidden = true;
  youPageEl.hidden = true;
  if (calPageEl) calPageEl.hidden = true;
  if (refugeesPageEl) refugeesPageEl.hidden = true;
  if (aboutPageEl) aboutPageEl.hidden = true;
  btnFiscal?.classList.remove("is-active");
  btnYou?.classList.remove("is-active");
  btnCal?.classList.remove("is-active");
  btnRefugees?.classList.remove("is-active");
  btnAbout?.classList.remove("is-active");
}

function openFiscalPage() {
  detailEl.hidden = true;
  hideAppPages();
  if (location.hash !== "#fiscal") location.hash = "fiscal";
  shellEl.dataset.page = "fiscal";
  fiscalPageEl.hidden = false;
  btnFiscal?.classList.add("is-active");
  syncBottomChrome();
  fiscalPage.load().catch(() => {});
}

function openYouPage() {
  detailEl.hidden = true;
  hideAppPages();
  if (location.hash !== "#you") location.hash = "you";
  shellEl.dataset.page = "you";
  youPageEl.hidden = false;
  btnYou?.classList.add("is-active");
  syncBottomChrome();
  youPage.prepare();
}

function openCalPage() {
  detailEl.hidden = true;
  hideAppPages();
  if (location.hash !== "#cal") location.hash = "cal";
  shellEl.dataset.page = "cal";
  if (calPageEl) calPageEl.hidden = false;
  btnCal?.classList.add("is-active");
  syncBottomChrome();
  calPage.show();
}

function openRefugeesPage() {
  detailEl.hidden = true;
  hideAppPages();
  if (location.hash !== "#refugees") location.hash = "refugees";
  shellEl.dataset.page = "refugees";
  if (refugeesPageEl) refugeesPageEl.hidden = false;
  btnRefugees?.classList.add("is-active");
  syncBottomChrome();
  refugeesPage.show();
}

function openAboutPage() {
  detailEl.hidden = true;
  hideAppPages();
  if (location.hash !== "#about") location.hash = "about";
  shellEl.dataset.page = "about";
  if (aboutPageEl) aboutPageEl.hidden = false;
  btnAbout?.classList.add("is-active");
  syncBottomChrome();
  syncAboutTheme();
}

function closeAppPage() {
  const leaving =
    shellEl.dataset.page === "fiscal" ||
    shellEl.dataset.page === "you" ||
    shellEl.dataset.page === "cal" ||
    shellEl.dataset.page === "refugees" ||
    shellEl.dataset.page === "about" ||
    pageName() === "fiscal" ||
    pageName() === "you" ||
    pageName() === "cal" ||
    pageName() === "refugees" ||
    pageName() === "about";
  hideAppPages();
  shellEl.dataset.page = "map";
  if (
    location.hash === "#fiscal" ||
    location.hash === "#you" ||
    location.hash === "#cal" ||
    location.hash === "#refugees" ||
    location.hash === "#about"
  ) {
    history.pushState("", document.title, location.pathname + location.search);
  }
  if (leaving) {
    syncIcicleDepthChrome();
    requestAnimationFrame(() => viewApi?.resize());
  }
}

function showYouOnMap(chamber) {
  const id = YOU_NODES[chamber] || YOU_NODES.legislative;
  closeAppPage();
  viewApi?.zoomToId(id);
}

function syncPageFromHash() {
  const p = pageName();
  if (p === "fiscal") openFiscalPage();
  else if (p === "you") openYouPage();
  else if (p === "cal") openCalPage();
  else if (p === "refugees") openRefugeesPage();
  else if (p === "about") openAboutPage();
  else {
    closeAppPage();
    if (location.hash.replace(/^#/, "") === "beyond") {
      requestAnimationFrame(() => goBeyondDoor());
    }
  }
}

let rootNode = null;
let usaRoot = null;
let nodeById = new Map();
let selectedNode = null;
let focusId = null;
let searchableAll = [];
let viewApi = null;
let mode = "icicle";
let orientation = "top";
let icicleNestLevels = 11;

function flattenTagged(node, atlasId = "usa", out = []) {
  out.push({
    id: node.id,
    name: node.name,
    short: node.short,
    kind: node.kind,
    atlas: atlasId,
    door: node.door,
  });
  for (const c of node.children || []) {
    const next =
      atlasId === "beyond" ||
      c.door === "Chartered" ||
      c.door === "International"
        ? "beyond"
        : "usa";
    flattenTagged(c, next, out);
  }
  return out;
}

function applyRoot({ preserve = false } = {}) {
  rootNode = usaRoot;
  stampDoorColors(rootNode);
  nodeById = indexById(rootNode);
  searchableAll = flattenTagged(rootNode, "usa");
  selectedNode = null;
  detailEl.hidden = true;
  mountView(mode, { preserve });
}

const BEYOND_DOOR_ID = "product-chartered";

function goBeyondDoor() {
  closeAppPage();
  const id = nodeById.has(BEYOND_DOOR_ID)
    ? BEYOND_DOOR_ID
    : nodeById.has("product-international")
      ? "product-international"
      : null;
  if (!id) return;
  viewApi?.zoomToId(id);
  const node = nodeById.get(id);
  if (node) showDetail(node);
}

function syncThemeChrome() {
  if (!btnTheme) return;
  const cur = themeMeta(getColorTheme());
  const nextId = getColorTheme() === "dark" ? "light" : "dark";
  const next = themeMeta(nextId);
  btnTheme.textContent = next.short;
  btnTheme.title = `Switch to ${next.label}`;
  btnTheme.setAttribute(
    "aria-label",
    `Color is ${cur.label}. Tap for ${next.label}.`
  );
  syncAboutTheme();
}

function syncAboutTheme() {
  const frame = document.getElementById("about-frame");
  const win = frame?.contentWindow;
  if (!win) return;
  try {
    win.postMessage(
      {
        type: "govdash-theme",
        theme: getColorTheme(),
        heatAsOf: heatAsOfLabel,
        heatPlaces: heatPulsePlaceCount,
      },
      "*"
    );
  } catch {
    /* ignore */
  }
}

document.getElementById("about-frame")?.addEventListener("load", () => {
  syncAboutTheme();
});

function defaultOrientation() {
  return "top";
}

function defaultIcicleNestLevels() {
  return 11;
}

function syncOrientChrome() {
  const show = mode === "icicle" || mode === "sankey";
  orientToggle.hidden = !show;
  if (!show) return;
  orientToggle.setAttribute(
    "aria-label",
    mode === "sankey" ? "Sankey direction" : "Icicle direction"
  );
  orientToggle.querySelectorAll(".orient-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.orient === orientation);
  });
}

function onMapPage() {
  return !shellEl.dataset.page || shellEl.dataset.page === "map";
}

/** Detail-pane year readout: 2026 / 2026 Q3 (label already says FY). */
function scrubYearLabel(asOf, y) {
  const s = String(asOf || "");
  const m = s.match(/FY(\d{2,4})(?:\s*(Q\d))?/i);
  if (m) {
    let year = m[1];
    if (year.length === 2) year = `20${year}`;
    return m[2] ? `${year} ${m[2].toUpperCase()}` : year;
  }
  if (y != null && Number.isFinite(Number(y))) return String(y);
  return s || "";
}

/** True when this place has a multi-year $ series (or current spend to scrub). */
function nodeHasFyScrub(node) {
  if (!node || !spendYear?.hasPack?.()) return false;
  if (isConstitutionNode(node)) return false;
  if (spendYear.hasNode?.(node.id)) return true;
  return !!(
    node.spending &&
    (node.spending.obligatedAmount != null || node.spending.outlayAmount != null)
  );
}

function syncDetailFy(node) {
  if (!detailFyEl || !fyRange || !fyOut) return;
  const show = !detailEl.hidden && nodeHasFyScrub(node);
  detailFyEl.hidden = !show;
  if (!show) return;
  const y = spendYear.currentYear() ?? spendYear.defaultYear();
  const list = spendYear.years();
  if (list.length) {
    fyRange.min = String(list[0]);
    fyRange.max = String(list[list.length - 1]);
  }
  if (y != null) {
    fyRange.value = String(y);
    const label = scrubYearLabel(spendYear.asOfFor(y), y);
    fyOut.textContent = label;
    fyRange.setAttribute("aria-valuetext", `Fiscal year ${label}`);
  }
}

function syncBottomChrome() {
  const showBottom = onMapPage() && mode === "icicle";
  document.documentElement.classList.toggle("has-depth", showBottom);
  const bottom = document.getElementById("chrome-bottom");
  if (bottom) bottom.hidden = !showBottom;

  if (icicleDepthEl && icicleDepthRange && icicleDepthOut) {
    icicleDepthEl.hidden = !showBottom;
    if (showBottom) {
      icicleDepthRange.value = String(icicleNestLevels);
      icicleDepthOut.textContent = String(icicleNestLevels);
      icicleDepthRange.setAttribute(
        "aria-valuetext",
        `${icicleNestLevels} level${icicleNestLevels === 1 ? "" : "s"} from here`
      );
    }
  }

  layoutMapBox();
  lastMapBoxKey = mapBoxKey();
  requestAnimationFrame(() => viewApi?.resize());
}

/** @deprecated name kept for call sites — bottom bar is Depth-only again */
function syncIcicleDepthChrome() {
  syncBottomChrome();
}

function applySpendYear(y, { refreshDetail = true } = {}) {
  if (!spendYear?.hasPack?.()) return;
  spendYear.apply(y);
  if (
    refreshDetail &&
    selectedNode &&
    !detailEl.hidden &&
    !isConstitutionNode(selectedNode)
  ) {
    showDetail(selectedNode);
  } else {
    syncDetailFy(selectedNode);
  }
}

function renderEngage(node) {
  dEngageList.replaceChildren();
  const actions = engagementActions(node, { byId: nodeById });
  for (const action of actions) {
    const li = document.createElement("li");
    const main = document.createElement(action.href || action.tel ? "a" : "span");
    main.className = "engage-label";
    main.textContent = action.label;
    if (action.href) {
      main.href = action.href;
      main.target = "_blank";
      main.rel = "noopener noreferrer";
    } else if (action.tel) {
      main.href = `tel:${action.tel}`;
    }
    li.append(main);
    if (action.detail) {
      const detail = document.createElement("p");
      detail.className = "engage-detail";
      detail.textContent = action.detail;
      li.append(detail);
    }
    dEngageList.append(li);
  }
  dEngage.hidden = !actions.length;
}

function isAtlasRoot(node) {
  return !!(
    node &&
    (node.id === "usa" ||
      node.id === "beyond" ||
      node.id === "constitution" ||
      node.kind === "sovereign")
  );
}

function isConstitutionNode(node) {
  return !!(node && (node.id === "usa" || node.id === "constitution") && node.id !== "beyond");
}

/** Calendar day for YYYY-MM-DD (no UTC day-shift, no fake time). */
function formatHeatWhen(when, { time = "auto" } = {}) {
  if (!when) return "";
  const s = String(when).trim();
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dayOnly) {
    const dt = new Date(
      Date.UTC(+dayOnly[1], +dayOnly[2] - 1, +dayOnly[3], 12, 0, 0)
    );
    return dt.toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return s;
  const wantTime = time === true || (time === "auto" && /T\d{2}:\d{2}/.test(s));
  try {
    return wantTime
      ? new Date(t).toLocaleString("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : new Date(t).toLocaleDateString("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          month: "short",
          day: "numeric",
        });
  } catch {
    return s;
  }
}

/** Role-labeled date so the day matches the action. */
function formatHeatEventWhen(ev) {
  if (!ev) return "";
  const when = ev.when;
  if (!when) return "";
  const day = formatHeatWhen(when);
  if (!day) return "";
  switch (ev.kind) {
    case "floor_session":
      return (ev.urgency === "recent" ? "Convened " : "Convenes ") + day;
    case "house_schedule":
      return "Week of " + day;
    case "public_inspection": {
      const bits = ["Publishes " + day];
      if (ev.filedAt) {
        const f = formatHeatWhen(ev.filedAt, { time: false });
        if (f && f !== day) bits.push("Filed " + f);
      }
      return bits.join(" · ");
    }
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
    case "presidential_doc": {
      if (ev.signedAt) {
        const signed = formatHeatWhen(ev.signedAt, { time: false });
        const pub = formatHeatWhen(when, { time: false });
        if (signed && pub && signed !== pub) {
          return "Signed " + signed + " · Published " + pub;
        }
        if (signed) return "Signed " + signed;
      }
      return "Published " + day;
    }
    default:
      return day;
  }
}

const CONSTITUTION_BLURB = [
  "The Constitution is the supreme law of the United States. It establishes the national government, defines the powers of its three branches, and protects fundamental rights.",
  "Ratified in 1788 and amended since (including the Bill of Rights), it is the charter that organizes the federal structure you explore in this map — Legislative, Executive, and Judicial — with independent agencies operating under statutes Congress passes within that framework.",
];

function showDetail(node, opts = {}) {
  if (!node) return;

  // Going back to the root keeps the map clear. Already there + tap again opens it.
  if (isAtlasRoot(node) && opts.revealRoot !== true) {
    selectedNode = node;
    detailEl.hidden = true;
    if (detailFyEl) detailFyEl.hidden = true;
    return;
  }

  selectedNode = node;
  detailEl.hidden = false;
  closeAppPage();

  const asConstitution = isConstitutionNode(node);
  const ctx = asConstitution ? null : enrichmentContext(node, nodeById);
  const rail = isAtlasRoot(node) ? atlasRail(node) : null;

  dKind.textContent = asConstitution
    ? "constitution"
    : rail?.kind || node.kind || "org";
  dTitle.textContent = asConstitution
    ? "The Constitution"
    : rail?.name || node.name;

  if (dAuthority) {
    const auth = asConstitution
      ? authorityLine({ id: "usa", kind: "sovereign", name: "United States Government" }, nodeById)
      : authorityLine(node, nodeById);
    if (auth?.line) {
      dAuthority.hidden = false;
      dAuthority.textContent = auth.line;
    } else {
      dAuthority.hidden = true;
      dAuthority.textContent = "";
    }
  }

  const formatCount = (n) =>
    typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—";

  const formatDollars = (n) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
    return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  };

  if (!asConstitution && node.workforce?.count != null) {
    dWorkforce.hidden = false;
    dWorkforce.textContent = `${formatCount(node.workforce.count)} civilian employees`;
  } else {
    dWorkforce.hidden = true;
    dWorkforce.textContent = "";
  }

  if (
    !asConstitution &&
    dSpending &&
    (node.spending?.obligatedAmount != null || node.spending?.outlayAmount != null)
  ) {
    const when = node.spending.asOf ? ` · ${node.spending.asOf}` : "";
    dSpending.hidden = false;
    dSpending.replaceChildren();
    const lines = [];
    if (node.spending.obligatedAmount != null) {
      lines.push(`${formatDollars(node.spending.obligatedAmount)} committed`);
    }
    if (node.spending.outlayAmount != null) {
      lines.push(`${formatDollars(node.spending.outlayAmount)} paid`);
    }
    lines.forEach((text, i) => {
      const row = document.createElement("span");
      row.className = "detail-spend-line";
      row.textContent = i === lines.length - 1 ? `${text}${when}` : text;
      dSpending.append(row);
    });
    if (
      node.spending.agencySlug &&
      !node.spending.rolledUp &&
      node.spending.grain !== "subtier"
    ) {
      const last = dSpending.querySelector(".detail-spend-line:last-child") || dSpending;
      last.append(document.createTextNode(" · "));
      const a = document.createElement("a");
      a.href = `https://www.usaspending.gov/agency/${node.spending.agencySlug}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "USAspending";
      a.title = "Open this agency on USAspending.gov";
      last.append(a);
    }
  } else if (dSpending) {
    dSpending.hidden = true;
    dSpending.replaceChildren();
  }

  // FY scrub lives only in the detail pane (affects $ line for this place).
  syncDetailFy(asConstitution ? null : node);

  dShort.textContent = asConstitution
    ? "Supreme law of the United States"
    : !rail && node.short
      ? `Short: ${node.short}`
      : "";

  if (dHeat && dHeatList) {
    dHeatList.replaceChildren();
    const heat = !asConstitution && node.heat;
    const events = heat?.events || [];
    if (heat && (events.length || heat.count > 0)) {
      dHeat.hidden = false;
      const h3 = dHeat.querySelector("h3");
      let asOfEl = dHeat.querySelector(".heat-asof");
      if (heatAsOfLabel) {
        if (!asOfEl) {
          asOfEl = document.createElement("p");
          asOfEl.className = "heat-asof";
          if (h3) h3.after(asOfEl);
          else dHeatList.before(asOfEl);
        }
        asOfEl.textContent = `as of ${heatAsOfLabel}`;
      } else if (asOfEl) {
        asOfEl.remove();
      }
      if (heat.rolledUp) {
        const note = document.createElement("p");
        note.className = "heat-roll-note";
        note.textContent =
          heat.count > 1
            ? `${heat.count} live events lower in this branch (sample below).`
            : "Live activity lower in this branch.";
        dHeatList.append(note);
      }
      for (const ev of events.slice(0, 8)) {
        const li = document.createElement("li");
        const kind = document.createElement("span");
        kind.className = "heat-kind";
        kind.textContent =
          HEAT_KIND_LABEL[ev.kind] || ev.kind || "Event";
        li.append(kind);

        if (ev.url) {
          const a = document.createElement("a");
          a.className = "heat-title";
          a.href = ev.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = ev.title || "Open source";
          li.append(a);
        } else {
          const t = document.createElement("span");
          t.className = "heat-title";
          t.textContent = ev.title || "Event";
          li.append(t);
        }

        if (ev.summary || ev.when || ev.filedAt || ev.signedAt) {
          const sum = document.createElement("p");
          sum.className = "heat-summary";
          const whenBit = formatHeatEventWhen(ev);
          sum.textContent = [whenBit, ev.summary].filter(Boolean).join(" · ");
          li.append(sum);
        }
        if (ev.source) {
          const src = document.createElement("p");
          src.className = "heat-source";
          src.textContent = ev.source;
          li.append(src);
        }
        dHeatList.append(li);
      }
    } else {
      dHeat.hidden = true;
    }
  }

  dCodes.replaceChildren();
  dMissionBody.replaceChildren();
  dLeadersList.replaceChildren();

  const cw = node.sources?.crosswalk;
  const sam = node.sources?.sam;
  const usgm = node.sources?.usgm;

  if (asConstitution) {
    dMission.hidden = false;
    dMission.querySelector("h3").textContent = "About";
    for (const para of CONSTITUTION_BLURB) {
      const p = document.createElement("p");
      p.textContent = para;
      dMissionBody.append(p);
    }
  } else if (ctx?.mission?.length) {
    dMission.hidden = false;
    dMission.querySelector("h3").textContent = usgm?.mission?.length ? "Mission" : "About";
    if (ctx.missionNote) {
      const note = document.createElement("p");
      note.className = "mission-note";
      note.textContent = ctx.missionNote;
      dMissionBody.append(note);
    }
    for (const para of ctx.mission.slice(0, 4)) {
      const p = document.createElement("p");
      p.textContent = para;
      dMissionBody.append(p);
    }
  } else {
    dMission.hidden = true;
    dMission.querySelector("h3").textContent = "Mission";
  }

  if (!asConstitution && ctx?.leadership?.length) {
    dLeaders.hidden = false;
    const h3 = dLeaders.querySelector("h3");
    const live = ctx.leadershipMeta;
    if (h3) {
      h3.textContent = "Leadership";
    }
    const oldNote = dLeaders.querySelector(".leaders-asof");
    if (oldNote) oldNote.remove();
    if (live?.sourceName) {
      const note = document.createElement("p");
      note.className = "leaders-asof";
      note.textContent = live.sourceName;
      if (h3) h3.after(note);
      else dLeadersList.before(note);
    }
    for (const person of ctx.leadership.slice(0, 12)) {
      const title = (person.title || "").trim();
      const name = (person.name || "").trim();
      if (!name && /^-+$/.test(title)) continue;
      if (!title && !name) continue;
      const li = document.createElement("li");
      li.textContent = title && name ? `${title} — ${name}` : title || name;
      dLeadersList.append(li);
    }
    if (!dLeadersList.children.length) dLeaders.hidden = true;
  } else {
    dLeaders.hidden = true;
  }

  renderEngage(node);

  const rows = asConstitution
    ? [
        ["branches in map", String((node.children || []).length)],
        ["orgs nested under map", String(childCount(node))],
        ["primary source", "constitution.congress.gov"],
      ]
    : [];
  if (!asConstitution) {
    rows.push(
      ["children", String((node.children || []).length)],
      ["descendants", String(childCount(node))]
    );
  }
  if (!asConstitution && usgm) {
    rows.push(
      ["Manual edition", usgm.edition ?? "—"],
      ["Manual web", usgm.web ?? "—"],
      ["Manual phone", usgm.phone ?? "—"]
    );
  } else if (!asConstitution && ctx?.ancestorUsgm?.sources?.usgm) {
    const p = ctx.ancestorUsgm;
    rows.push(
      ["Parent Manual", p.short || p.name],
      ["Parent web", p.sources.usgm.web ?? "—"],
      ["Parent phone", p.sources.usgm.phone ?? "—"]
    );
  }
  if (!asConstitution && sam) {
    rows.push(["SAM status", sam.status ?? "—"], ["SAM name", sam.fhorgname ?? "—"]);
  } else if (!asConstitution && ctx?.ancestorSam?.sources?.sam) {
    const p = ctx.ancestorSam;
    rows.push(
      ["Parent SAM", p.short || p.name],
      ["Parent SAM status", p.sources.sam.status ?? "—"]
    );
  }
  if (!asConstitution && cw) {
    rows.push(["GSA key", cw.gsaSfpKey ?? "—"], ["entity type", cw.gsaSfpEntityType ?? "—"]);
  }

  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    if (k === "primary source") {
      const a = document.createElement("a");
      a.href = "https://constitution.congress.gov/constitution/";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "U.S. Constitution (Congress.gov)";
      dd.append(a);
    } else if (
      (k === "Manual web" || k === "Parent web") &&
      v &&
      String(v).startsWith("http")
    ) {
      const a = document.createElement("a");
      a.href = v;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = v;
      dd.append(a);
    } else {
      dd.textContent = v || "—";
    }
    dCodes.append(dt, dd);
  }

  dNote.textContent = asConstitution
    ? "Congress.gov Constitution Annotated · National Archives founding documents"
    : (() => {
        const parts = [];
        if (node.workforce?.count != null) {
          const raw = String(node.workforce.asOf || "");
          const label =
            raw.length === 6
              ? `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(raw.slice(4, 6)) - 1] || raw.slice(4, 6)} ${raw.slice(0, 4)}`
              : raw;
          parts.push(
            `OPM civilian employees${label ? ` · ${label}` : ""}${
              node.workforce.rolledUp ? " (rolled up)" : ""
            }`
          );
        }
        if (node.spending?.obligatedAmount != null || node.spending?.outlayAmount != null) {
          const grain =
            node.spending.rolledUp
              ? "USAspending (rolled up)"
              : node.spending.grain === "subtier"
                ? "USAspending sub-agency"
                : "USAspending toptier";
          parts.push(`${grain}${node.spending.asOf ? ` · ${node.spending.asOf}` : ""}`);
        }
        if (usgm) parts.push(`U.S. Government Manual ${usgm.edition || ""} · SAM.gov · GSA Crosswalk`);
        else if (ctx?.template || ctx?.ancestorUsgm || ctx?.ancestorSam) {
          parts.push("GSA Crosswalk · parent / type context");
        } else parts.push("GSA Crosswalk · SAM.gov");
        const auth = authorityLine(node, nodeById);
        if (auth?.cited) parts.push("authority cite from official statute table");
        else if (auth?.line) parts.push("authority from kind + GSA nest");
        return parts.join(" · ");
      })();

  const canEnter = !!(node.children && node.children.length);
  const focusNow = viewApi?.getFocus?.();
  const alreadyHere = !!(focusNow && focusNow.data?.id === node.id);
  btnEnter.hidden = !canEnter || alreadyHere || mode === "sankey";
  btnEnter.disabled = btnEnter.hidden;
  btnEnter.textContent = asConstitution ? "Enter the government map" : "Enter this level";
  const actions = document.querySelector(".detail-actions");
  if (actions) actions.hidden = btnEnter.hidden;
}

function renderBreadcrumbs() {
  breadcrumbsEl.replaceChildren();
  const path = viewApi?.pathToFocus() || [];
  path.forEach((d, i) => {
    if (i) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "/";
      breadcrumbsEl.append(sep);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "crumb";
    btn.textContent =
      d.data.id === "usa" || d.data.id === "beyond" || d.data.kind === "sovereign"
        ? atlasRail(d.data).short
        : displayName(d.data);
    btn.addEventListener("click", () => {
      const revealRoot =
        isConstitutionNode(d.data) && isConstitutionNode(selectedNode);
      viewApi.zoomToId(d.data.id);
      showDetail(d.data, { revealRoot });
    });
    breadcrumbsEl.append(btn);
  });
  focusId = path.length ? path[path.length - 1].data.id : null;
  renderAtlasSub(path);
}

function renderAtlasSub(path) {
  if (!atlasSubEl) return;
  const doors = new Set((path || []).map((d) => d.data?.door));
  const shorts = new Set((path || []).map((d) => d.data?.short));
  const ids = new Set((path || []).map((d) => d.data?.id));
  let line = "";
  if (
    doors.has("International") ||
    shorts.has("International") ||
    ids.has("product-international")
  ) {
    line = "Organizations the United States sits at — not U.S. agencies.";
  } else if (
    doors.has("Chartered") ||
    shorts.has("Chartered") ||
    ids.has("product-chartered")
  ) {
    line = "Federally created, not Cabinet or independent agencies.";
  }
  if (!line) {
    atlasSubEl.hidden = true;
    atlasSubEl.textContent = "";
    return;
  }
  atlasSubEl.textContent = line;
  atlasSubEl.hidden = false;
}

function searchRank(n, q) {
  const name = (n.name || "").toLowerCase();
  const short = (n.short || "").toLowerCase();
  const kindRank =
    {
      department: 0,
      independent: 1,
      agency: 2,
      branch: 3,
      chamber: 3,
      bureau: 4,
    }[n.kind] ?? 8;
  if (short === q) return [0, kindRank];
  if (short.startsWith(q)) return [1, kindRank];
  if (name.includes(`(${q})`)) return [2, kindRank];
  const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((t) => t === q)) return [3, kindRank];
  if (tokens.some((t) => t.startsWith(q))) return [4, kindRank];
  if (short.includes(q)) return [5, kindRank];
  if (name.includes(q)) return [6, kindRank];
  return [9, kindRank];
}

function updateSearch(q) {
  const query = q.trim().toLowerCase();
  if (query.length < 2) {
    searchResults.hidden = true;
    searchResults.replaceChildren();
    return;
  }
  const hits = searchableAll
    .filter(
      (n) =>
        (n.name || "").toLowerCase().includes(query) ||
        (n.short && n.short.toLowerCase().includes(query))
    )
    .sort((a, b) => {
      const ra = searchRank(a, query);
      const rb = searchRank(b, query);
      return ra[0] - rb[0] || ra[1] - rb[1] || (a.name || "").localeCompare(b.name || "");
    })
    .slice(0, 12);
  searchResults.replaceChildren();
  for (const hit of hits) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    const kind = document.createElement("span");
    kind.className = "sr-kind";
    kind.textContent = hit.kind || "";
    btn.type = "button";
    btn.append(kind, " ");
    if (hit.atlas === "beyond") btn.append("∞ ");
    if (hit.short && hit.short.length <= 8) {
      const sh = document.createElement("span");
      sh.className = "sr-short";
      sh.textContent = hit.short;
      btn.append(sh, " ");
    }
    btn.append(hit.name);
    btn.addEventListener("click", () => {
      closeAppPage();
      viewApi.zoomToId(hit.id);
      showDetail(nodeById.get(hit.id));
      searchResults.hidden = true;
      searchInput.value = hit.name;
    });
    li.append(btn);
    searchResults.append(li);
  }
  searchResults.hidden = !hits.length;
}

function setModeChrome() {
  document.querySelectorAll(".mode-btn[data-mode]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.mode === mode);
  });
  mapEl.dataset.mode = mode;
  syncOrientChrome();
  syncBottomChrome();
}

function mountView(nextMode, { preserve = true } = {}) {
  const keepFocus = preserve ? focusId || rootNode?.id : rootNode?.id;
  const priorSelected = preserve ? selectedNode : null;
  const restoreDetail = !!(priorSelected && !detailEl.hidden);
  let suppressSelect = true;

  if (viewApi) viewApi.destroy();
  setHeatPulseSink(null);
  mode = nextMode;
  setModeChrome();

  const opts = {
    onSelect: (node, _hier, selectOpts) => {
      if (suppressSelect) return;
      showDetail(node, selectOpts);
    },
    onFocusChange: () => {
      renderBreadcrumbs();
      if (
        !suppressSelect &&
        selectedNode &&
        !detailEl.hidden &&
        !isConstitutionNode(selectedNode)
      ) {
        showDetail(selectedNode);
      }
    },
  };
  if (mode === "icicle" || mode === "sankey") opts.orientation = orientation;
  if (mode === "icicle") opts.nestLevels = icicleNestLevels;

  viewApi = factories[mode](mapEl, opts);
  layoutMapBox();
  viewApi.build(rootNode);

  if (keepFocus) viewApi.zoomToId(keepFocus);

  suppressSelect = false;
  if (restoreDetail && priorSelected && !isConstitutionNode(priorSelected)) {
    viewApi.setSelected?.(priorSelected.id);
    showDetail(priorSelected);
  } else {
    selectedNode = null;
    detailEl.hidden = true;
    viewApi.setSelected?.(null);
  }
  renderBreadcrumbs();
  syncScrubCoach(mode);
  // Sankey: canvas pulse via shared driver (SVG views update opacity in the same loop).
  if (typeof viewApi.onHeatPulse === "function") {
    setHeatPulseSink((t, now) => viewApi.onHeatPulse(t, now));
  }
  syncHeatPulse();
}

async function main() {
  if (atlasSubEl) {
    atlasSubEl.hidden = false;
    atlasSubEl.textContent = "Loading…";
  }
  initColorTheme();
  syncThemeChrome();
  applyHeatChrome(readHeatOn());
  window.addEventListener("govdash-theme", () => {
    syncThemeChrome();
    viewApi?.resize?.();
  });
  const [usaRes, beyondRes, spendYearRes] = await Promise.all([
    fetch(TREE_URL),
    fetch(BEYOND_URL),
    fetch(SPEND_YEAR_URL).catch(() => null),
  ]);
  if (!usaRes.ok) throw new Error(`Failed to load ${TREE_URL}`);
  if (!beyondRes.ok) throw new Error(`Failed to load ${BEYOND_URL}`);
  const usaData = await usaRes.json();
  const beyondData = await beyondRes.json();
  usaRoot = usaData.tree;
  attachBeyondDoors(usaRoot, beyondData.tree);

  heatAsOfLabel = formatHeatSnapshotDay(
    usaData.meta?.heat?.asOf || usaData.meta?.heat?.enrichedAt || ""
  );
  const metaDirect = usaData.meta?.heat?.nodesWithDirectHeat;
  const metaItems = usaData.meta?.heat?.rawEventCount;
  heatRawEventCount =
    typeof metaItems === "number" && metaItems >= 0 ? metaItems : 0;
  setHeatPulsePlaceCount(
    typeof metaDirect === "number" && metaDirect >= 0
      ? metaDirect
      : countDirectHeatPlaces(usaRoot)
  );
  // Re-sync chip labels now that the pulse count is known.
  applyHeatChrome(readHeatOn());
  syncAboutTheme();

  spendYear = createSpendYearController(usaRoot);
  if (spendYearRes?.ok) {
    try {
      const pack = await spendYearRes.json();
      spendYear.load(pack);
    } catch {
      /* keep tree-baked spending */
    }
  }

  // Fresh visit: Icicle. Orientation / nest / focus / FY / pages stay fresh too.
  mode = "icicle";
  orientation = defaultOrientation();
  icicleNestLevels = defaultIcicleNestLevels();

  // Don't reopen Z / C / I / $ / A from a leftover #hash (PWA / last URL).
  {
    const h = location.hash.replace(/^#/, "");
    if (
      h === "fiscal" ||
      h === "you" ||
      h === "cal" ||
      h === "refugees" ||
      h === "about"
    ) {
      history.replaceState("", document.title, location.pathname + location.search);
    }
  }

  applyRoot({ preserve: false });
  syncPageFromHash();
  syncBottomChrome();

  document.querySelectorAll(".mode-btn[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === mode) return;
      closeAppPage();
      mountView(btn.dataset.mode);
    });
  });

  orientToggle.querySelectorAll(".orient-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.orient;
      if (next !== "top" && next !== "side") return;
      if (next === orientation) return;
      orientation = next;
      syncOrientChrome();
      if (
        (mode === "icicle" || mode === "sankey") &&
        viewApi?.setOrientation
      ) {
        viewApi.setOrientation(orientation);
      }
    });
  });

  icicleDepthRange?.addEventListener("input", () => {
    const next = Math.min(11, Math.max(1, Math.round(Number(icicleDepthRange.value) || 11)));
    icicleNestLevels = next;
    if (icicleDepthOut) icicleDepthOut.textContent = String(next);
    icicleDepthRange.setAttribute(
      "aria-valuetext",
      `${next} level${next === 1 ? "" : "s"} from here`
    );
    viewApi?.setNestLevels?.(next);
  });

  fyRange?.addEventListener("input", () => {
    const y = Math.round(Number(fyRange.value));
    if (!Number.isFinite(y)) return;
    applySpendYear(y);
  });

  function toggleHeat() {
    const next = !document.documentElement.classList.contains("heat-on");
    applyHeatChrome(next);
    // Phone keeps :focus after tap → looked like a third “mode” until refresh.
    try {
      btnHeat.blur();
    } catch {
      /* ignore */
    }
  }
  btnHeat?.addEventListener("click", toggleHeat);
  btnFiscal?.addEventListener("click", () => {
    if (pageName() === "fiscal") closeAppPage();
    else openFiscalPage();
  });
  btnYou?.addEventListener("click", () => {
    if (pageName() === "you") closeAppPage();
    else openYouPage();
  });
  btnCal?.addEventListener("click", () => {
    if (pageName() === "cal") closeAppPage();
    else openCalPage();
  });
  btnRefugees?.addEventListener("click", () => {
    if (pageName() === "refugees") closeAppPage();
    else openRefugeesPage();
  });
  btnAbout?.addEventListener("click", () => {
    if (pageName() === "about") closeAppPage();
    else openAboutPage();
  });
  btnTheme?.addEventListener("click", () => {
    cycleColorTheme();
  });
  fiscalBack?.addEventListener("click", () => closeAppPage());
  youBack?.addEventListener("click", () => closeAppPage());
  calBack?.addEventListener("click", () => closeAppPage());
  refugeesBack?.addEventListener("click", () => closeAppPage());
  aboutBack?.addEventListener("click", () => closeAppPage());
  document.getElementById("about-frame")?.addEventListener("load", () => {
    syncAboutTheme();
  });
  window.addEventListener("hashchange", () => syncPageFromHash());
  btnEnter.addEventListener("click", () => {
    if (!selectedNode?.children?.length) return;
    viewApi.zoomToId(selectedNode.id);
  });
  detailClose.addEventListener("click", () => {
    detailEl.hidden = true;
    selectedNode = null;
    viewApi?.setSelected?.(null);
  });
  searchInput.addEventListener("input", () => updateSearch(searchInput.value));
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchResults.hidden = true;
      searchInput.blur();
    }
  });
  document.getElementById("search-refresh")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    location.reload();
  });
  document.addEventListener("click", (e) => {
    if (!searchResults.contains(e.target) && e.target !== searchInput) {
      searchResults.hidden = true;
    }
  });

  layoutMapBox();
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("pageshow", onViewportChange);
  window.addEventListener("orientationchange", () => {
    clearTimeout(layoutResizeTimer);
    layoutResizeTimer = setTimeout(onViewportChange, 350);
  });
  window.screen?.orientation?.addEventListener?.("change", () => {
    clearTimeout(layoutResizeTimer);
    layoutResizeTimer = setTimeout(onViewportChange, 350);
  });
  window.matchMedia("(orientation: portrait)").addEventListener("change", onViewportChange);
  window.visualViewport?.addEventListener("resize", onViewportChange);
  window.visualViewport?.addEventListener("scroll", onViewportChange);

}

main().catch((err) => {
  if (atlasSubEl) {
    atlasSubEl.hidden = false;
    atlasSubEl.textContent = String(err.message || err);
  }
  console.error(err);
});
