import { engagementActions } from "./engagement.js";
import { enrichmentContext, indexById } from "./context.js";
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
} from "./shared.js";
import { createIcicleView } from "./views/icicle.js";
import { createTreeView } from "./views/tree.js";
import { createPackView } from "./views/pack.js";
import { createSankeyView } from "./views/sankey.js";
import { createFiscalPage } from "./views/fiscal.js";
import { createYouPage, YOU_NODES } from "./views/you.js";
import { authorityLine } from "./authority.js";
import { createSpendYearController } from "./spend-year.js";

const TREE_URL = "./data/nested/gov-tree-product.json";
const BEYOND_URL = "./data/nested/gov-tree-beyond.json";
const SPEND_YEAR_URL = "./data/nested/spend-by-year.json";

const factories = {
  icicle: createIcicleView,
  tree: createTreeView,
  pack: createPackView,
  sankey: createSankeyView,
};

/** Persist only which chart (Icicle / Tree / Circles / Sankey) — nothing else. */
const CHART_MODE_KEY = "govdash-chart-mode";

function readSavedChartMode() {
  try {
    const m = localStorage.getItem(CHART_MODE_KEY);
    if (m && factories[m]) return m;
  } catch {
    /* ignore */
  }
  return "icicle";
}

function saveChartMode(m) {
  if (!factories[m]) return;
  try {
    localStorage.setItem(CHART_MODE_KEY, m);
  } catch {
    /* ignore */
  }
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
const btnFiscal = document.getElementById("btn-fiscal");
const btnYou = document.getElementById("btn-you");
const btnAbout = document.getElementById("btn-about");
const btnTheme = document.getElementById("btn-theme");
const fiscalPageEl = document.getElementById("page-fiscal");
const fiscalBack = document.getElementById("fiscal-back");
const youPageEl = document.getElementById("page-you");
const youBack = document.getElementById("you-back");
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

function isPortrait() {
  if (window.matchMedia("(orientation: portrait)").matches) return true;
  if (window.matchMedia("(orientation: landscape)").matches) return false;
  return (window.innerHeight || 0) >= (window.innerWidth || 0);
}

function isMobileTouch() {
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

function readSafeInsetBottom() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)";
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  return px;
}

function appFillHeightPx() {
  const ih = window.innerHeight || 0;
  const vv = Math.round(window.visualViewport?.height || 0);
  const sw = window.screen.width || 0;
  const sh = window.screen.height || 0;
  const screenMax = Math.max(sw, sh);
  const screenMin = Math.min(sw, sh);
  const screenH = isPortrait() ? screenMax : screenMin;
  /* PWA: must include screen axis or the shell stops short (void under Depth). */
  if (document.documentElement.classList.contains("pwa-standalone")) {
    return Math.max(ih, vv, screenH);
  }
  return Math.max(ih, vv);
}

function appExtraBottomPx() {
  if (!document.documentElement.classList.contains("pwa-standalone")) return 0;
  const iw = window.innerWidth || 0;
  const ih = window.innerHeight || 0;
  const screenMax = Math.max(window.screen.width || 0, window.screen.height || 0);
  /* Phone: fillH already hits screen — no extra. iPad undershoot only. */
  if (Math.min(iw, ih) < 600) return 0;
  if (screenMax >= ih - 10) return 0;
  return Math.max(readSafeInsetBottom(), 20);
}

function syncAppFillHeight() {
  const root = document.documentElement;
  const useFill =
    root.classList.contains("pwa-standalone") || isMobileTouch();
  if (!useFill) {
    root.classList.remove("app-fill");
    root.style.removeProperty("--app-fill-h");
    root.style.removeProperty("--app-extra-b");
    return 0;
  }
  root.classList.add("app-fill");
  const fillH = appFillHeightPx();
  const extra = appExtraBottomPx();
  const key = `${fillH}+${extra}`;
  if (key !== lastFillKey) {
    lastFillKey = key;
    root.style.setProperty("--app-fill-h", `${fillH}px`);
    root.style.setProperty("--app-extra-b", `${extra}px`);
  }
  return fillH + extra;
}

/** Sync fill height; CSS flex sizes the stage/map. */
function layoutMapBox() {
  syncAppFillHeight();
  paintLayoutDebug();
}

/** ?layoutDebug=1 — live numbers so we can fix PWA bottom without screenshots. */
function paintLayoutDebug() {
  if (!/\blayoutDebug=1\b/.test(location.search)) return;
  let el = document.getElementById("layout-debug");
  if (!el) {
    el = document.createElement("pre");
    el.id = "layout-debug";
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, {
      position: "fixed",
      left: "4px",
      bottom: "4px",
      zIndex: "99999",
      margin: "0",
      padding: "6px 8px",
      font: "10px/1.35 ui-monospace, monospace",
      color: "#0f0",
      background: "rgba(0,0,0,0.82)",
      pointerEvents: "none",
      maxWidth: "96vw",
      whiteSpace: "pre-wrap",
    });
    document.body.appendChild(el);
  }
  const root = document.documentElement;
  const bar = document.getElementById("chrome-bottom");
  const br = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
  const ih = window.innerHeight || 0;
  const vv = Math.round(window.visualViewport?.height || 0);
  const sh = Math.max(window.screen.width || 0, window.screen.height || 0);
  const smin = Math.min(window.screen.width || 0, window.screen.height || 0);
  const screenH = isPortrait() ? sh : smin;
  const fill = root.style.getPropertyValue("--app-fill-h") || "(css)";
  const extra = root.style.getPropertyValue("--app-extra-b") || "0";
  const safe = readSafeInsetBottom();
  const shortfall = screenH - ih;
  const depth = document.getElementById("icicle-depth");
  const dr = depth && !depth.hidden ? depth.getBoundingClientRect() : null;
  const barBot = br ? Math.round(br.bottom) : null;
  const depthBot = dr ? Math.round(dr.bottom) : null;
  const gap = br ? Math.round(ih - br.bottom) : null;
  el.textContent = [
    `standalone=${root.classList.contains("pwa-standalone")}`,
    `ih=${ih} vv=${vv} screenH=${screenH} shortfall=${shortfall}`,
    `fillH=${fill} extraB=${extra} safeB=${safe.toFixed(1)}`,
    br
      ? `bar top=${Math.round(br.top)} bot=${barBot} h=${Math.round(br.height)} gapBar→ih=${gap}`
      : "bar=hidden",
    dr
      ? `depthRow bot=${depthBot} (must be ≤ ih-safeB≈${Math.round(ih - safe)})`
      : "depthRow=hidden",
    `target: depthRow above home zone; bar.bot≈ih`,
  ].join("\n");
}

function scheduleViewResize() {
  clearTimeout(layoutResizeTimer);
  layoutResizeTimer = setTimeout(() => {
    layoutMapBox();
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

function pageName() {
  const h = location.hash.replace(/^#/, "");
  if (h === "fiscal" || h === "you" || h === "about") return h;
  return "map";
}

function hideAppPages() {
  fiscalPageEl.hidden = true;
  youPageEl.hidden = true;
  if (aboutPageEl) aboutPageEl.hidden = true;
  btnFiscal?.classList.remove("is-active");
  btnYou?.classList.remove("is-active");
  btnAbout?.classList.remove("is-active");
}

function openFiscalPage() {
  detailEl.hidden = true;
  hideAppPages();
  if (location.hash !== "#fiscal") location.hash = "fiscal";
  shellEl.dataset.page = "fiscal";
  fiscalPageEl.hidden = false;
  btnFiscal?.classList.add("is-active");
  const bottom = document.getElementById("chrome-bottom");
  if (bottom) bottom.hidden = true;
  fiscalPage.load().catch(() => {});
}

function openYouPage() {
  detailEl.hidden = true;
  hideAppPages();
  if (location.hash !== "#you") location.hash = "you";
  shellEl.dataset.page = "you";
  youPageEl.hidden = false;
  btnYou?.classList.add("is-active");
  const bottom = document.getElementById("chrome-bottom");
  if (bottom) bottom.hidden = true;
  youPage.prepare();
}

function openAboutPage() {
  detailEl.hidden = true;
  hideAppPages();
  if (location.hash !== "#about") location.hash = "about";
  shellEl.dataset.page = "about";
  if (aboutPageEl) aboutPageEl.hidden = false;
  btnAbout?.classList.add("is-active");
  const bottom = document.getElementById("chrome-bottom");
  if (bottom) bottom.hidden = true;
  syncAboutTheme();
}

function closeAppPage() {
  const leaving =
    shellEl.dataset.page === "fiscal" ||
    shellEl.dataset.page === "you" ||
    shellEl.dataset.page === "about" ||
    pageName() === "fiscal" ||
    pageName() === "you" ||
    pageName() === "about";
  hideAppPages();
  shellEl.dataset.page = "map";
  if (
    location.hash === "#fiscal" ||
    location.hash === "#you" ||
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
    win.postMessage({ type: "govdash-theme", theme: getColorTheme() }, "*");
  } catch {
    /* ignore */
  }
}

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
  const bottom = document.getElementById("chrome-bottom");
  const showBottom = onMapPage() && mode === "icicle";
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
    const amt =
      node.spending.obligatedAmount != null
        ? node.spending.obligatedAmount
        : node.spending.outlayAmount;
    const label =
      node.spending.obligatedAmount != null ? "obligated" : "outlay";
    const when = node.spending.asOf ? ` · ${node.spending.asOf}` : "";
    dSpending.hidden = false;
    dSpending.replaceChildren();
    dSpending.append(
      document.createTextNode(`${formatDollars(amt)} ${label}${when}`)
    );
    if (
      node.spending.agencySlug &&
      !node.spending.rolledUp &&
      node.spending.grain !== "subtier"
    ) {
      dSpending.append(document.createTextNode(" · "));
      const a = document.createElement("a");
      a.href = `https://www.usaspending.gov/agency/${node.spending.agencySlug}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "USAspending";
      a.title = "Open this agency on USAspending.gov";
      dSpending.append(a);
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
  mode = nextMode;
  saveChartMode(mode);
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
}

async function main() {
  if (atlasSubEl) {
    atlasSubEl.hidden = false;
    atlasSubEl.textContent = "Loading…";
  }
  initColorTheme();
  syncThemeChrome();
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

  spendYear = createSpendYearController(usaRoot);
  if (spendYearRes?.ok) {
    try {
      const pack = await spendYearRes.json();
      spendYear.load(pack);
    } catch {
      /* keep tree-baked spending */
    }
  }

  // Chart mode remembered; orientation / nest / focus / FY / pages stay fresh.
  mode = readSavedChartMode();
  orientation = defaultOrientation();
  icicleNestLevels = defaultIcicleNestLevels();

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
    syncBottomChrome();
    viewApi?.setNestLevels?.(next);
  });

  fyRange?.addEventListener("input", () => {
    const y = Math.round(Number(fyRange.value));
    if (!Number.isFinite(y)) return;
    applySpendYear(y);
  });

  btnFiscal?.addEventListener("click", () => {
    if (pageName() === "fiscal") closeAppPage();
    else openFiscalPage();
  });
  btnYou?.addEventListener("click", () => {
    if (pageName() === "you") closeAppPage();
    else openYouPage();
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

}

main().catch((err) => {
  if (atlasSubEl) {
    atlasSubEl.hidden = false;
    atlasSubEl.textContent = String(err.message || err);
  }
  console.error(err);
});
