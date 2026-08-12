import { engagementActions } from "./engagement.js";
import { enrichmentContext, indexById } from "./context.js";
import {
  childCount,
  displayName,
  stampDoorColors,
  atlasRail,
} from "./shared.js";
import { createIcicleView } from "./views/icicle.js";
import { createTreeView } from "./views/tree.js";
import { createPackView } from "./views/pack.js";
import { createSankeyView } from "./views/sankey.js";
import { createFiscalPage } from "./views/fiscal.js";
import { createYouPage, YOU_NODES } from "./views/you.js";

const TREE_URL = "./data/nested/gov-tree-product.json";
const BEYOND_URL = "./data/nested/gov-tree-beyond.json";

const factories = {
  icicle: createIcicleView,
  tree: createTreeView,
  pack: createPackView,
  sankey: createSankeyView,
};

const metaEl = document.getElementById("meta");
const searchInput = document.getElementById("search");
const searchResults = document.getElementById("search-results");
const breadcrumbsEl = document.getElementById("breadcrumbs");
const atlasSubEl = document.getElementById("atlas-sub");
const detailEl = document.getElementById("detail");
const dKind = document.getElementById("d-kind");
const dTitle = document.getElementById("d-title");
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
const btnBeyond = document.getElementById("btn-beyond");
const fiscalPageEl = document.getElementById("page-fiscal");
const fiscalBack = document.getElementById("fiscal-back");
const youPageEl = document.getElementById("page-you");
const youBack = document.getElementById("you-back");
const mapEl = document.getElementById("map");
const orientToggle = document.getElementById("orient-toggle");
const shellEl = document.querySelector(".shell");
const fiscalPage = createFiscalPage(fiscalPageEl);
const youPage = createYouPage(youPageEl, {
  onMap: (chamber) => showYouOnMap(chamber),
});

function pageName() {
  const h = location.hash.replace(/^#/, "");
  if (h === "fiscal" || h === "you") return h;
  return "map";
}

function hideAppPages() {
  fiscalPageEl.hidden = true;
  youPageEl.hidden = true;
  btnFiscal?.classList.remove("is-active");
  btnYou?.classList.remove("is-active");
}

function openFiscalPage() {
  detailEl.hidden = true;
  hideAppPages();
  if (location.hash !== "#fiscal") location.hash = "fiscal";
  shellEl.dataset.page = "fiscal";
  fiscalPageEl.hidden = false;
  btnFiscal?.classList.add("is-active");
  fiscalPage.load().catch(() => {});
}

function openYouPage() {
  detailEl.hidden = true;
  hideAppPages();
  if (location.hash !== "#you") location.hash = "you";
  shellEl.dataset.page = "you";
  youPageEl.hidden = false;
  btnYou?.classList.add("is-active");
  youPage.prepare();
}

function closeAppPage() {
  const leaving =
    shellEl.dataset.page === "fiscal" ||
    shellEl.dataset.page === "you" ||
    pageName() === "fiscal" ||
    pageName() === "you";
  hideAppPages();
  shellEl.dataset.page = "map";
  if (location.hash === "#fiscal" || location.hash === "#you") {
    if (atlas === "beyond") location.hash = "beyond";
    else history.pushState("", document.title, location.pathname + location.search);
  }
  if (leaving) viewApi?.resize();
}

function showYouOnMap(chamber) {
  const id = YOU_NODES[chamber] || YOU_NODES.legislative;
  closeAppPage();
  if (atlas !== "usa") setAtlas("usa");
  viewApi?.zoomToId(id);
}

function syncPageFromHash() {
  const p = pageName();
  if (p === "fiscal") openFiscalPage();
  else if (p === "you") openYouPage();
  else {
    closeAppPage();
    const want = location.hash.replace(/^#/, "") === "beyond" ? "beyond" : "usa";
    if (want !== atlas) setAtlas(want);
  }
}

let rootNode = null;
let usaRoot = null;
let beyondRoot = null;
let usaMeta = {};
let beyondMeta = {};
let atlas = "usa";
let nodeById = new Map();
let selectedNode = null;
let focusId = null;
let searchable = [];
let searchableAll = [];
let viewApi = null;
let mode = "icicle";
let orientation = "side";

function writeMeta() {
  const m = atlas === "beyond" ? beyondMeta : usaMeta;
  metaEl.textContent = [
    atlas === "beyond" ? "∞" : null,
    `${m.nodeCount?.toLocaleString?.() ?? "?"} nodes`,
    m.sam ? `SAM ${m.sam.matched}` : null,
    m.usgm ? `Manual ${m.usgm.matched}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function flattenTagged(node, atlasId, out = []) {
  out.push({
    id: node.id,
    name: node.name,
    short: node.short,
    kind: node.kind,
    atlas: atlasId,
  });
  for (const c of node.children || []) flattenTagged(c, atlasId, out);
  return out;
}

function applyAtlas({ preserve = false } = {}) {
  rootNode = atlas === "beyond" ? beyondRoot : usaRoot;
  stampDoorColors(rootNode);
  nodeById = indexById(rootNode);
  searchable = flattenSearch(rootNode);
  btnBeyond?.classList.toggle("is-active", atlas === "beyond");
  shellEl.dataset.atlas = atlas;
  writeMeta();
  selectedNode = null;
  detailEl.hidden = true;
  mountView(mode, { preserve });
}

function setAtlas(next) {
  if (next !== "usa" && next !== "beyond") return;
  if (next === atlas && rootNode) return;
  atlas = next;
  applyAtlas({ preserve: false });
}

function defaultOrientation() {
  const saved = localStorage.getItem("govdash-orient");
  if (saved === "top" || saved === "side") return saved;
  // Portrait / phone: prefer top-down
  return window.innerHeight > window.innerWidth * 1.05 ? "top" : "side";
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

function flattenSearch(node, out = []) {
  out.push({ id: node.id, name: node.name, short: node.short, kind: node.kind });
  for (const c of node.children || []) flattenSearch(c, out);
  return out;
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

  const formatCount = (n) =>
    typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—";

  const rows = asConstitution
    ? [
        ["branches in map", String((node.children || []).length)],
        ["orgs nested under map", String(childCount(node))],
        ["primary source", "constitution.congress.gov"],
      ]
    : [];
  if (!asConstitution && node.workforce?.count != null) {
    rows.push(["civilian employees", formatCount(node.workforce.count)]);
  }
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
    const isWorkforce = k === "civilian employees";
    if (isWorkforce) {
      dt.className = "workforce-label";
      dd.className = "workforce-count";
    }
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
        if (usgm) parts.push(`U.S. Government Manual ${usgm.edition || ""} · SAM.gov · GSA Crosswalk`);
        else if (ctx?.template || ctx?.ancestorUsgm || ctx?.ancestorSam) {
          parts.push("GSA Crosswalk · parent / type context");
        } else parts.push("GSA Crosswalk · SAM.gov");
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
  if (atlas !== "beyond") {
    atlasSubEl.hidden = true;
    atlasSubEl.textContent = "";
    return;
  }
  const ids = new Set((path || []).map((d) => d.data?.id || d.data?.short));
  const shorts = new Set((path || []).map((d) => d.data?.short));
  let line =
    "Chartered U.S. bodies and international orgs.";
  if (shorts.has("International") || ids.has("product-international")) {
    line = "Organizations the United States sits at — not U.S. agencies.";
  } else if (shorts.has("Chartered") || ids.has("product-chartered")) {
    line = "Federally created, not Cabinet or independent agencies.";
  }
  atlasSubEl.textContent = line;
  atlasSubEl.hidden = false;
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
        n.name.toLowerCase().includes(query) ||
        (n.short && n.short.toLowerCase().includes(query))
    )
    .slice(0, 12);
  searchResults.replaceChildren();
  for (const hit of hits) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    const mark = hit.atlas === "beyond" && atlas !== "beyond" ? "∞ " : "";
    btn.type = "button";
    btn.innerHTML = `<span class="sr-kind">${hit.kind || ""}</span> ${mark}${hit.name}`;
    btn.addEventListener("click", () => {
      closeAppPage();
      if (hit.atlas && hit.atlas !== atlas) setAtlas(hit.atlas);
      viewApi.zoomToId(hit.id);
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
}

function mountView(nextMode, { preserve = true } = {}) {
  const keepFocus = preserve ? focusId || rootNode?.id : rootNode?.id;
  const priorSelected = preserve ? selectedNode : null;
  const restoreDetail = !!(priorSelected && !detailEl.hidden);
  let suppressSelect = true;

  if (viewApi) viewApi.destroy();
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

  viewApi = factories[mode](mapEl, opts);
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
}

async function main() {
  metaEl.textContent = "Loading…";
  const [usaRes, beyondRes] = await Promise.all([fetch(TREE_URL), fetch(BEYOND_URL)]);
  if (!usaRes.ok) throw new Error(`Failed to load ${TREE_URL}`);
  if (!beyondRes.ok) throw new Error(`Failed to load ${BEYOND_URL}`);
  const usaData = await usaRes.json();
  const beyondData = await beyondRes.json();
  usaRoot = usaData.tree;
  beyondRoot = beyondData.tree;
  usaMeta = usaData.meta || {};
  beyondMeta = beyondData.meta || {};
  stampDoorColors(usaRoot);
  stampDoorColors(beyondRoot);
  searchableAll = [
    ...flattenTagged(usaRoot, "usa"),
    ...flattenTagged(beyondRoot, "beyond"),
  ];

  const saved = localStorage.getItem("govdash-mode");
  if (saved && factories[saved]) mode = saved;
  orientation = defaultOrientation();

  atlas = location.hash.replace(/^#/, "") === "beyond" ? "beyond" : "usa";
  applyAtlas({ preserve: false });
  syncPageFromHash();

  document.querySelectorAll(".mode-btn[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === mode) return;
      localStorage.setItem("govdash-mode", btn.dataset.mode);
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
      localStorage.setItem("govdash-orient", orientation);
      syncOrientChrome();
      if (
        (mode === "icicle" || mode === "sankey") &&
        viewApi?.setOrientation
      ) {
        viewApi.setOrientation(orientation);
      }
    });
  });

  btnFiscal?.addEventListener("click", () => {
    if (pageName() === "fiscal") closeAppPage();
    else openFiscalPage();
  });
  btnYou?.addEventListener("click", () => {
    if (pageName() === "you") closeAppPage();
    else openYouPage();
  });
  btnBeyond?.addEventListener("click", () => {
    closeAppPage();
    if (atlas === "beyond") {
      atlas = "usa";
      if (location.hash === "#beyond") {
        history.pushState("", document.title, location.pathname + location.search);
      }
      applyAtlas({ preserve: false });
    } else {
      atlas = "beyond";
      if (location.hash !== "#beyond") location.hash = "beyond";
      applyAtlas({ preserve: false });
    }
  });
  fiscalBack?.addEventListener("click", () => closeAppPage());
  youBack?.addEventListener("click", () => closeAppPage());
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
  document.addEventListener("click", (e) => {
    if (!searchResults.contains(e.target) && e.target !== searchInput) {
      searchResults.hidden = true;
    }
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => viewApi?.resize(), 150);
  });
}

main().catch((err) => {
  metaEl.textContent = String(err.message || err);
  console.error(err);
});
