/**
 * Constitution Sankey view — same chrome hooks as Icicle/Tree/Circles.
 * Orientations: side (L→R) · top (T→B). Click node or line → detail.
 */
import * as d3 from "../vendor/d3.js";
import { sankey as d3Sankey, sankeyLeft } from "../vendor/d3-sankey.js";
import {
  hierarchySort,
  BRANCH_COLOR,
  CONSTITUTION_FILL,
  INK,
  MAP_FIELD,
  atlasRail,
  placeMapTip,
  brightenHex,
  noteScrubSuccess,
} from "../shared.js";

const CONST_ID = "constitution";

const DOOR_ORDER = ["Legislative", "Executive", "Judicial", "Independent"];

const DOOR_LABEL = {
  Legislative: "Legislative",
  Executive: "Executive",
  Judicial: "Judicial",
  Independent: "Agencies",
  Chartered: "Chartered",
  International: "International",
};

function branchKey(door) {
  if (door.short && BRANCH_COLOR[door.short]) return door.short;
  if (door.short === "Agencies") return "Independent";
  if (/Legislative/i.test(door.name)) return "Legislative";
  if (/Executive/i.test(door.name)) return "Executive";
  if (/Judicial/i.test(door.name)) return "Judicial";
  if (/Independent/i.test(door.name)) return "Independent";
  if (/^Federally Chartered$/i.test(door.name)) return "Chartered";
  if (/^International Organizations$/i.test(door.name)) return "International";
  return "default";
}

function doorOrderFromTree(tree) {
  const keys = (tree?.children || [])
    .map((d) => branchKey(d))
    .filter((k) => k && k !== "default");
  return keys.length ? keys : DOOR_ORDER;
}

function railCaption(tree) {
  return atlasRail(tree).name;
}

function colorFor(branch) {
  return BRANCH_COLOR[branch] || BRANCH_COLOR.default;
}

function hexAlpha(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function buildGraph(tree) {
  const nodes = [];
  const links = [];
  const seen = new Set();
  const doors = {};

  nodes.push({
    id: CONST_ID,
    name: "The Constitution",
    kind: "constitution",
    branch: null,
  });
  seen.add(CONST_ID);

  function addNode(n, branch) {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push({
      id: n.id,
      name: n.name,
      short: n.short,
      kind: n.kind,
      branch,
    });
  }

  function walk(n, branch) {
    addNode(n, branch);
    for (const c of n.children || []) {
      walk(c, branch);
      links.push({ source: n.id, target: c.id, value: 1, branch });
    }
  }

  for (const door of tree.children || []) {
    const b = branchKey(door);
    doors[b] = door;
    walk(door, b);
    links.push({
      source: CONST_ID,
      target: door.id,
      value: 1,
      branch: b,
    });
  }

  return { nodes, links, doors };
}

function transposeSankey(nodes) {
  for (const n of nodes) {
    const { x0, x1, y0, y1 } = n;
    n.x0 = y0;
    n.x1 = y1;
    n.y0 = x0;
    n.y1 = x1;
  }
}

export function createSankeyView(
  container,
  { onSelect, onFocusChange, orientation = "side" }
) {
  const el = typeof container === "string" ? document.querySelector(container) : container;
  const tipEl = document.getElementById("map-tip");

  const canvas = document.createElement("canvas");
  canvas.className = "sankey-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Government hierarchy Sankey");
  const ctx = canvas.getContext("2d", { alpha: false });

  let treeData = null;
  let fullRoot = null;
  let byId = new Map();
  let graphRef = null;
  let focus = null;
  let selectedId = null;
  let hoverId = null;
  let armedId = null;
  let scrubId = null;
  let ignoreClicksUntil = 0;
  let longTimer = 0;
  let gesture = null;
  let orient = orientation === "top" ? "top" : "side";
  let cssSize = { w: 0, h: 0, dpr: 1 };
  let layoutNodes = [];
  let stage1Meta = [];
  let constGeom = null;
  let linkPaths = [];
  let deepLayoutSig = "";
  let cam = { k: 1, x: 0, y: 0 };
  const pointers = new Map();
  let pinch = null;
  const CAM_MIN = 1;
  const CAM_MAX = 5;
  const isIPad =
    /iPad/i.test(navigator.userAgent || "") ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
  const isPhone =
    !isIPad &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const LINE_W = isIPad ? 1.5 : 0.6;
  const LINE_SEL = isIPad ? 1.7 : isPhone ? 1.75 : 0.7;

  const LONG_MS = 400;
  const SLOP = 12;

  const centerLinkH = d3
    .linkHorizontal()
    .source((d) => [d.source.x1, (d.source.y0 + d.source.y1) / 2])
    .target((d) => [d.target.x0, (d.target.y0 + d.target.y1) / 2]);

  const centerLinkV = d3
    .linkVertical()
    .source((d) => [(d.source.x0 + d.source.x1) / 2, d.source.y1])
    .target((d) => [(d.target.x0 + d.target.x1) / 2, d.target.y0]);

  function isTop() {
    return orient === "top";
  }

  function activeHighlightId() {
    return scrubId || armedId || hoverId || selectedId;
  }

  function isHotId(id) {
    return !!(id && id === activeHighlightId());
  }

  function hapticPulse() {
    try {
      navigator.vibrate?.(16);
    } catch {
      /* ignore */
    }
  }

  function clearLongTimer() {
    if (longTimer) {
      clearTimeout(longTimer);
      longTimer = 0;
    }
  }

  function shouldIgnoreClick() {
    return performance.now() < ignoreClicksUntil;
  }

  function screenXY(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      sx: ((clientX - rect.left) / rect.width) * cssSize.w,
      sy: ((clientY - rect.top) / rect.height) * cssSize.h,
    };
  }

  function worldXY(clientX, clientY) {
    const { sx, sy } = screenXY(clientX, clientY);
    return {
      mx: (sx - cam.x) / cam.k,
      my: (sy - cam.y) / cam.k,
    };
  }

  function resetCam() {
    cam = { k: 1, x: 0, y: 0 };
    pinch = null;
  }

  function clampCam() {
    const w = cssSize.w;
    const h = cssSize.h;
    if (cam.k <= CAM_MIN + 0.001) {
      cam.k = CAM_MIN;
      cam.x = 0;
      cam.y = 0;
      return;
    }
    cam.k = Math.min(CAM_MAX, Math.max(CAM_MIN, cam.k));
    cam.x = Math.min(0, Math.max(w - w * cam.k, cam.x));
    cam.y = Math.min(0, Math.max(h - h * cam.k, cam.y));
  }

  function zoomAt(sx, sy, factor) {
    const k1 = cam.k;
    const k2 = Math.min(CAM_MAX, Math.max(CAM_MIN, k1 * factor));
    cam.x = sx - ((sx - cam.x) * k2) / k1;
    cam.y = sy - ((sy - cam.y) * k2) / k1;
    cam.k = k2;
    clampCam();
  }

  function indexTree(node) {
    byId.set(node.data.id, node);
    for (const c of node.children || []) indexTree(c);
  }

  function hideTip() {
    if (tipEl) tipEl.hidden = true;
  }

  function showTip(node, clientX, clientY, footer = "Click for details") {
    if (!tipEl || !node) {
      hideTip();
      return;
    }
    const kind = node.kind || "org";
    const branch = node.branch ? ` · ${node.branch}` : "";
    tipEl.innerHTML = `
      <p class="tip-kind">${kind}${branch}</p>
      <p class="tip-name">${node.name || ""}</p>
      ${
        node.short && node.short !== node.name
          ? `<p class="tip-meta">${node.short}</p>`
          : ""
      }
      <p class="tip-meta">${footer}</p>
    `;
    tipEl.hidden = false;
    placeMapTip(tipEl, clientX, clientY);
  }

  function resolveDataNode(hit) {
    if (!hit) return null;
    if (hit.id === CONST_ID || hit.kind === "constitution") {
      return fullRoot?.data || treeData;
    }
    const h = byId.get(hit.id);
    return h?.data || null;
  }

  function paint() {
    if (!graphRef) return;
    const width = cssSize.w;
    const height = cssSize.h;
    const dpr = cssSize.dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = MAP_FIELD;
    ctx.fillRect(0, 0, width, height);
    el.dataset.orient = orient;
    ctx.setTransform(
      dpr * cam.k,
      0,
      0,
      dpr * cam.k,
      dpr * cam.x,
      dpr * cam.y
    );

    if (isTop()) paintTop(width, height);
    else paintSide(width, height);
  }

  function paintSide(width, height) {
    // Left rail: Constitution | black | door bands. Flows stay right of door edge.
    const constW = 18;
    const blackW = 2.5;
    const doorW = 16;
    const doorLeft = constW + blackW;
    const doorRight = doorLeft + doorW;
    const doorMidX = (doorLeft + doorRight) / 2;
    const deepLeft = doorRight + 28;

    constGeom = {
      mode: "side",
      x: constW / 2,
      x0: 0,
      x1: constW,
      y0: 0,
      y1: height,
    };

    const order = doorOrderFromTree(treeData);
    const segH = height / Math.max(1, order.length);
    stage1Meta = [];
    order.forEach((branch, i) => {
      const y0 = i * segH;
      const y1 = (i + 1) * segH;
      stage1Meta.push({
        mode: "side",
        branch,
        door: graphRef.doors[branch],
        x: doorMidX,
        x0: doorLeft,
        x1: doorRight,
        y0,
        y1,
        midY: (y0 + y1) / 2,
      });
    });

    ctx.fillStyle = CONSTITUTION_FILL;
    ctx.fillRect(0, 0, constW, height);
    ctx.fillStyle = INK;
    ctx.fillRect(constW, 0, blackW, height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(doorRight, 0, Math.max(0, width - doorRight), height);
    ctx.clip();
    drawDeepGraph({
      vertical: false,
      deep0: deepLeft,
      deep1: width - 4,
      cross0: 6,
      cross1: height - 6,
      doorAnchor: doorRight,
    });
    ctx.restore();

    for (const s of stage1Meta) {
      const doorActive = s.door && isHotId(s.door.id);
      ctx.fillStyle = doorActive
        ? brightenHex(colorFor(s.branch))
        : colorFor(s.branch);
      ctx.fillRect(doorLeft, s.y0, doorW, segH);

      ctx.save();
      ctx.translate(doorMidX, s.midY);
      ctx.rotate(-Math.PI / 2);
      ctx.font = "400 0.78rem 'IBM Plex Sans', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = INK;
      ctx.fillText(DOOR_LABEL[s.branch] || s.branch, 0, 0);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(constW / 2, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = "400 0.78rem 'IBM Plex Sans', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = INK;
    ctx.fillText(railCaption(treeData), 0, 0);
    ctx.restore();
  }

  function paintTop(width, height) {
    const constH = 20;
    const blackH = 2.5;
    const doorH = 14;
    const constY = 0;
    const blackY = constY + constH;
    const doorY = blackY + blackH;
    const deepTop = doorY + doorH + 8;

    constGeom = {
      mode: "top",
      x0: 0,
      x1: width,
      y: constY + constH / 2,
      y0: constY,
      y1: blackY + blackH,
    };

    ctx.fillStyle = CONSTITUTION_FILL;
    ctx.fillRect(0, constY, width, constH);
    ctx.fillStyle = INK;
    ctx.fillRect(0, blackY, width, blackH);

    ctx.font = "400 0.78rem 'IBM Plex Sans', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = INK;
    ctx.fillText(railCaption(treeData), width / 2, constY + constH / 2);

    const order = doorOrderFromTree(treeData);
    const segW = width / Math.max(1, order.length);
    stage1Meta = [];
    order.forEach((branch, i) => {
      const x0 = i * segW;
      const x1 = (i + 1) * segW;
      const midX = (x0 + x1) / 2;
      const door = graphRef.doors[branch];
      stage1Meta.push({
        mode: "top",
        branch,
        door,
        x0,
        x1,
        y: doorY + doorH / 2,
        y0: doorY,
        y1: doorY + doorH,
        midX,
      });

      const doorActive = door && isHotId(door.id);
      ctx.fillStyle = doorActive
        ? brightenHex(colorFor(branch))
        : colorFor(branch);
      ctx.fillRect(x0, doorY, segW, doorH);

      ctx.font = "400 0.78rem 'IBM Plex Sans', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = INK;
      ctx.fillText(DOOR_LABEL[branch] || branch, midX, doorY + doorH / 2);
    });

    drawDeepGraph({
      vertical: true,
      deep0: deepTop,
      deep1: height - 4,
      cross0: 4,
      cross1: width - 4,
      doorAnchor: doorY + doorH,
    });
  }

  function drawDeepGraph(opts) {
    ensureDeepLayout(opts);
    paintDeepGraph();
  }

  function ensureDeepLayout({ vertical, deep0, deep1, cross0, cross1, doorAnchor }) {
    const sig = `${orient}|${cssSize.w}|${cssSize.h}|${treeData?.id}|${graphRef.nodes.length}`;
    if (deepLayoutSig === sig && linkPaths.length) return;

    const deepNodes = graphRef.nodes.filter((n) => n.id !== CONST_ID);
    const deepLinks = graphRef.links.filter((l) => l.source !== CONST_ID);

    const layout = d3Sankey()
      .nodeId((d) => d.id)
      .nodeWidth(1)
      .nodePadding(0.7)
      .nodeAlign(sankeyLeft)
      .extent([
        [deep0, cross0],
        [deep1, cross1],
      ])
      .iterations(40);

    const { nodes, links } = layout({
      nodes: deepNodes.map((d) => ({ ...d })),
      links: deepLinks.map((d) => ({ ...d })),
    });

    if (vertical) transposeSankey(nodes);

    const doorIdToSeg = new Map();
    for (const s of stage1Meta) {
      if (s.door) doorIdToSeg.set(s.door.id, s);
    }

    for (const n of nodes) {
      const seg = doorIdToSeg.get(n.id);
      if (!seg) continue;
      if (vertical) {
        n.x0 = seg.x0;
        n.x1 = seg.x1;
        n.y0 = seg.y0;
        n.y1 = seg.y1;
      } else {
        n.x0 = seg.x1;
        n.x1 = seg.x1;
        n.y0 = seg.y0;
        n.y1 = seg.y1;
      }
    }

    layoutNodes = nodes;
    linkPaths = [];
    links.sort((a, b) => b.value - a.value);

    for (const L of links) {
      const branch = L.branch || L.source.branch || L.target.branch;
      const col = colorFor(branch);
      const srcIsDoor = doorIdToSeg.has(L.source.id);
      let pathStr;
      let x0;
      let y0;
      let x1;
      let y1;
      if (srcIsDoor) {
        const seg = doorIdToSeg.get(L.source.id);
        if (vertical) {
          const sx = seg.midX;
          const sy = doorAnchor;
          const tx = (L.target.x0 + L.target.x1) / 2;
          const ty = L.target.y0;
          const my = (sy + ty) / 2;
          pathStr = `M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty}`;
          x0 = sx;
          y0 = sy;
          x1 = tx;
          y1 = ty;
        } else {
          const sy = seg.midY;
          const tx = L.target.x0;
          const ty = (L.target.y0 + L.target.y1) / 2;
          const mx = (doorAnchor + deep0) / 2;
          pathStr = `M${doorAnchor},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
          x0 = doorAnchor;
          y0 = sy;
          x1 = tx;
          y1 = ty;
        }
      } else {
        pathStr = vertical ? centerLinkV(L) : centerLinkH(L);
        if (vertical) {
          x0 = (L.source.x0 + L.source.x1) / 2;
          y0 = L.source.y1;
          x1 = (L.target.x0 + L.target.x1) / 2;
          y1 = L.target.y0;
        } else {
          x0 = L.source.x1;
          y0 = (L.source.y0 + L.source.y1) / 2;
          x1 = L.target.x0;
          y1 = (L.target.y0 + L.target.y1) / 2;
        }
      }
      const pad = 16;
      linkPaths.push({
        link: L,
        col,
        sourceId: L.source.id,
        targetId: L.target.id,
        path2d: new Path2D(pathStr),
        target: L.target,
        bbox: {
          minX: Math.min(x0, x1) - pad,
          maxX: Math.max(x0, x1) + pad,
          minY: Math.min(y0, y1) - pad,
          maxY: Math.max(y0, y1) + pad,
        },
      });
    }
    deepLayoutSig = sig;
  }

  function paintDeepGraph() {
    const doorIds = new Set(
      stage1Meta.filter((s) => s.door).map((s) => s.door.id)
    );
    const lw = (w) => w / cam.k;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const restLinks = [];
    const hotLinks = [];
    for (const rec of linkPaths) {
      const isSelPath = isHotId(rec.sourceId) || isHotId(rec.targetId);
      (isSelPath ? hotLinks : restLinks).push(rec);
    }

    const strokeLink = (rec, isSelPath) => {
      if (isSelPath) {
        ctx.strokeStyle = brightenHex(rec.col);
        ctx.lineWidth = lw(LINE_SEL);
        ctx.stroke(rec.path2d);
        return;
      }
      ctx.strokeStyle = hexAlpha(rec.col, 0.4);
      ctx.lineWidth = lw(LINE_W);
      ctx.stroke(rec.path2d);
    };
    for (const rec of restLinks) strokeLink(rec, false);
    for (const rec of hotLinks) strokeLink(rec, true);

    const restNodes = [];
    const hotNodes = [];
    for (const n of layoutNodes) {
      if (doorIds.has(n.id)) continue;
      (isHotId(n.id) ? hotNodes : restNodes).push(n);
    }
    const paintNode = (n, isSel) => {
      const x = (n.x0 + n.x1) / 2;
      const y = (n.y0 + n.y1) / 2;
      const col = colorFor(n.branch);
      if (isSel) {
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = brightenHex(col);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = lw(1.2);
        ctx.stroke();
        return;
      }
      ctx.beginPath();
      ctx.arc(x, y, 1.15, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    };
    for (const n of restNodes) paintNode(n, false);
    for (const n of hotNodes) paintNode(n, true);
  }

  function hitTestLink(mx, my) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = 14 / cam.k;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let best = null;
    let bestDist = Infinity;
    for (const item of linkPaths) {
      const b = item.bbox;
      if (mx < b.minX || mx > b.maxX || my < b.minY || my > b.maxY) continue;
      if (!ctx.isPointInStroke(item.path2d, mx, my)) continue;
      const t = item.target;
      const tx = (t.x0 + t.x1) / 2;
      const ty = (t.y0 + t.y1) / 2;
      const d = Math.hypot(mx - tx, my - ty);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    ctx.restore();
    return best;
  }

  function hitTest(mx, my) {
    if (constGeom) {
      if (constGeom.mode === "top") {
        if (
          my >= constGeom.y0 - 4 &&
          my <= constGeom.y1 + 4 &&
          mx >= constGeom.x0 &&
          mx <= constGeom.x1
        ) {
          return {
            id: CONST_ID,
            name: railCaption(treeData),
            kind: "constitution",
            branch: null,
          };
        }
      } else if (
        mx >= (constGeom.x0 ?? constGeom.x - 12) &&
        mx <= (constGeom.x1 ?? constGeom.x + 12) &&
        my >= constGeom.y0 &&
        my <= constGeom.y1
      ) {
        return {
          id: CONST_ID,
          name: railCaption(treeData),
          kind: "constitution",
          branch: null,
        };
      }
    }

    for (const s of stage1Meta) {
      if (s.mode === "top") {
        if (my >= s.y0 - 4 && my <= s.y1 + 4 && mx >= s.x0 && mx <= s.x1) {
          const d = s.door;
          return {
            id: d?.id || s.branch,
            name: d?.name || s.branch,
            short: s.branch,
            kind: d?.kind || "branch",
            branch: s.branch,
          };
        }
      } else if (
        mx >= (s.x0 ?? s.x - 12) &&
        mx <= (s.x1 ?? s.x + 12) &&
        my >= s.y0 &&
        my <= s.y1
      ) {
        const d = s.door;
        return {
          id: d?.id || s.branch,
          name: d?.name || s.branch,
          short: s.branch,
          kind: d?.kind || "branch",
          branch: s.branch,
        };
      }
    }

    let best = null;
    let bestDist = Infinity;
    for (const n of layoutNodes) {
      if (stage1Meta.some((s) => s.door && s.door.id === n.id)) continue;
      const x = (n.x0 + n.x1) / 2;
      const y = (n.y0 + n.y1) / 2;
      const d = Math.hypot(mx - x, my - y);
      if (d <= 14 / cam.k && d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    if (best) return best;
    return hitTestLink(mx, my);
  }

  function measure() {
    // Keep CSS size at 100% — a fixed px width prevents the grid from shrinking (min-width: auto)
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    cssSize.w = Math.max(1, w);
    cssSize.h = Math.max(1, h);
    cssSize.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.floor(cssSize.w * cssSize.dpr);
    canvas.height = Math.floor(cssSize.h * cssSize.dpr);
  }

  function selectHit(hit, { openDetail = true } = {}) {
    if (!hit) return;
    const data = resolveDataNode(hit);
    if (!data) return;
    const id = hit.id === CONST_ID ? fullRoot?.data?.id || "usa" : hit.id;
    selectedId = id;
    scrubId = null;
    armedId = null;
    const hier = hit.id === CONST_ID ? fullRoot : byId.get(hit.id);
    const revealRoot =
      hit.id === CONST_ID && (focus === fullRoot || !focus?.parent);
    if (hier) {
      focus = hier;
      onFocusChange?.(focus);
    }
    if (openDetail) onSelect?.(data, hier || focus, { revealRoot });
    paint();
  }

  function previewScrub(hit, clientX, clientY) {
    if (!hit) {
      scrubId = null;
      paint();
      hideTip();
      return;
    }
    scrubId = hit.id === CONST_ID ? fullRoot?.data?.id || "usa" : hit.id;
    paint();
    showTip(hit, clientX, clientY, "Slide · lift to arm");
  }

  function armHit(hit, clientX, clientY) {
    if (!hit) {
      scrubId = null;
      paint();
      hideTip();
      return;
    }
    scrubId = null;
    armedId = hit.id === CONST_ID ? fullRoot?.data?.id || "usa" : hit.id;
    selectedId = armedId;
    hapticPulse();
    paint();
    noteScrubSuccess();
    showTip(hit, clientX, clientY, "Armed · tap for details");
  }

  function initPinch() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return;
    const a = screenXY(pts[0].x, pts[0].y);
    const b = screenXY(pts[1].x, pts[1].y);
    pinch = {
      d0: Math.hypot(b.sx - a.sx, b.sy - a.sy) || 1,
      k0: cam.k,
      wx: ((a.sx + b.sx) / 2 - cam.x) / cam.k,
      wy: ((a.sy + b.sy) / 2 - cam.y) / cam.k,
    };
  }

  function updatePinch() {
    if (!pinch || pointers.size < 2) return;
    const pts = [...pointers.values()];
    const a = screenXY(pts[0].x, pts[0].y);
    const b = screenXY(pts[1].x, pts[1].y);
    const d = Math.hypot(b.sx - a.sx, b.sy - a.sy) || 1;
    const cx = (a.sx + b.sx) / 2;
    const cy = (a.sy + b.sy) / 2;
    cam.k = Math.min(CAM_MAX, Math.max(CAM_MIN, pinch.k0 * (d / pinch.d0)));
    cam.x = cx - pinch.wx * cam.k;
    cam.y = cy - pinch.wy * cam.k;
    clampCam();
    paint();
  }

  function onWheel(e) {
    e.preventDefault();
    const { sx, sy } = screenXY(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0016);
    zoomAt(sx, sy, factor);
    paint();
  }

  function onDblClick(e) {
    if (cam.k <= 1.001) return;
    e.preventDefault();
    resetCam();
    paint();
  }

  function beginScrub() {
    if (!gesture) return;
    gesture.scrubbing = true;
    hapticPulse();
    el.classList.add("is-scrubbing");
    const { mx, my } = worldXY(gesture.x, gesture.y);
    previewScrub(hitTest(mx, my), gesture.x, gesture.y);
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    clearLongTimer();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      clearLongTimer();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (gesture) {
        gesture.pinching = true;
        gesture.moved = true;
        gesture.scrubbing = false;
        el.classList.remove("is-scrubbing");
      }
      initPinch();
      return;
    }

    const { mx, my } = worldXY(e.clientX, e.clientY);
    const { sx, sy } = screenXY(e.clientX, e.clientY);
    gesture = {
      pointerId: e.pointerId,
      pointerType: e.pointerType || "mouse",
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      lastSX: sx,
      lastSY: sy,
      moved: false,
      scrubbing: false,
      panning: false,
      pinching: false,
      hit0: hitTest(mx, my),
    };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (gesture.pointerType === "touch" || gesture.pointerType === "pen") {
      longTimer = window.setTimeout(() => {
        longTimer = 0;
        if (!gesture || gesture.moved) return;
        beginScrub();
      }, LONG_MS);
    } else if (gesture.hit0) {
      showTip(gesture.hit0, e.clientX, e.clientY);
    }
  }

  function onPointerMove(e) {
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointers.size >= 2) {
      if (!pinch) initPinch();
      if (gesture) {
        gesture.pinching = true;
        gesture.moved = true;
        gesture.scrubbing = false;
        el.classList.remove("is-scrubbing");
      }
      updatePinch();
      e.preventDefault();
      return;
    }

    if (gesture && e.pointerId === gesture.pointerId) {
      gesture.x = e.clientX;
      gesture.y = e.clientY;
      const { sx, sy } = screenXY(e.clientX, e.clientY);
      const dist = Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY);

      if (gesture.scrubbing) {
        const { mx, my } = worldXY(e.clientX, e.clientY);
        previewScrub(hitTest(mx, my), e.clientX, e.clientY);
        e.preventDefault();
        return;
      }

      if (
        gesture.panning ||
        (dist > SLOP && cam.k > 1.001 && !gesture.scrubbing)
      ) {
        if (!gesture.panning) {
          gesture.panning = true;
          gesture.moved = true;
          clearLongTimer();
        }
        cam.x += sx - gesture.lastSX;
        cam.y += sy - gesture.lastSY;
        gesture.lastSX = sx;
        gesture.lastSY = sy;
        clampCam();
        paint();
        e.preventDefault();
        return;
      }

      if (gesture.pointerType === "touch" || gesture.pointerType === "pen") {
        if (dist > SLOP) {
          gesture.moved = true;
          clearLongTimer();
        }
        return;
      }
    }

    if (e.pointerType === "touch") return;
    if (gesture?.scrubbing || gesture?.panning) return;
    const { mx, my } = worldXY(e.clientX, e.clientY);
    const hit = hitTest(mx, my);
    const nextId = hit?.id || null;
    if (nextId !== hoverId) {
      hoverId = nextId;
      paint();
    }
    if (!armedId) {
      showTip(
        hit,
        e.clientX,
        e.clientY,
        hit ? "Click for details" : undefined
      );
    }
    canvas.style.cursor =
      cam.k > 1 ? (gesture?.panning ? "grabbing" : "grab") : hit ? "pointer" : "default";
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (pointers.size < 2) pinch = null;

    if (!gesture) return;
    if (e.pointerId !== gesture.pointerId) {
      if (gesture.pinching) gesture.moved = true;
      return;
    }

    clearLongTimer();
    const g0 = gesture;
    gesture = null;
    el.classList.remove("is-scrubbing");

    if (g0.pinching || g0.panning) {
      ignoreClicksUntil = performance.now() + 300;
      return;
    }

    if (g0.scrubbing) {
      const { mx, my } = worldXY(g0.x, g0.y);
      armHit(hitTest(mx, my) || (scrubId ? { id: scrubId } : null), g0.x, g0.y);
      ignoreClicksUntil = performance.now() + 500;
      return;
    }

    if (g0.moved) {
      ignoreClicksUntil = performance.now() + 100;
      return;
    }

    const touch = g0.pointerType === "touch" || g0.pointerType === "pen";
    if (armedId && touch) {
      ignoreClicksUntil = 0;
      onClick(e);
      ignoreClicksUntil = performance.now() + 500;
    }
  }

  function onPointerLeave() {
    if (gesture?.scrubbing) return;
    if (hoverId) {
      hoverId = null;
      paint();
    }
    if (!armedId) hideTip();
    canvas.style.cursor = "default";
  }

  function onClick(e) {
    if (shouldIgnoreClick()) return;
    hideTip();
    hoverId = null;

    // After scrub-arm, next tap confirms the armed node (ignore fat-finger target)
    if (armedId) {
      const id = armedId;
      armedId = null;
      scrubId = null;
      if (id === (fullRoot?.data?.id || "usa")) {
        selectHit({
          id: CONST_ID,
          name: railCaption(treeData),
          kind: "constitution",
          branch: null,
        });
      } else {
        const door = stage1Meta.find((s) => s.door?.id === id)?.door;
        const node = layoutNodes.find((n) => n.id === id);
        selectHit(
          door
            ? {
                id: door.id,
                name: door.name,
                short: door.short,
                kind: door.kind,
                branch: door.branch,
              }
            : node || { id }
        );
      }
      return;
    }

    const { mx, my } = worldXY(e.clientX, e.clientY);
    const hit = hitTest(mx, my);
    if (hit) selectHit(hit);
  }

  function build(data) {
    el.replaceChildren();
    el.appendChild(canvas);
    treeData = data;
    byId.clear();
    fullRoot = d3
      .hierarchy(data)
      .sum((d) => (d.children && d.children.length ? 0 : 1))
      .sort(hierarchySort);
    indexTree(fullRoot);
    graphRef = buildGraph(data);
    focus = fullRoot;
    selectedId = null;
    armedId = null;
    scrubId = null;
    deepLayoutSig = "";
    resetCam();
    pointers.clear();
    measure();
    paint();
    onFocusChange?.(focus);
  }

  function zoomToId(id) {
    if (id === "usa" || id === "beyond" || id === CONST_ID || id === fullRoot?.data?.id) {
      selectedId = fullRoot?.data?.id || "usa";
      armedId = null;
      scrubId = null;
      focus = fullRoot;
      onSelect?.(fullRoot.data, fullRoot);
      onFocusChange?.(focus);
      paint();
      return fullRoot;
    }
    const d = byId.get(id);
    if (!d) return null;
    selectedId = id;
    armedId = null;
    scrubId = null;
    focus = d;
    onSelect?.(d.data, d);
    onFocusChange?.(focus);
    paint();
    return d;
  }

  function goUp() {
    if (!focus?.parent) return;
    focus = focus.parent;
    selectedId = focus.data.id;
    armedId = null;
    scrubId = null;
    onSelect?.(focus.data, focus);
    onFocusChange?.(focus);
    paint();
  }

  function setSelected(id) {
    selectedId = id || null;
    armedId = null;
    scrubId = null;
    if (id && byId.has(id)) focus = byId.get(id);
    paint();
  }

  function setOrientation(next) {
    orient = next === "top" ? "top" : "side";
    deepLayoutSig = "";
    resetCam();
    paint();
  }

  function pathToFocus() {
    if (!focus) return [];
    return focus.ancestors().reverse().map((d) => {
      if (d.data.id === "usa" || d.data.id === "beyond" || d.data.kind === "sovereign") {
        const rail = atlasRail(d.data);
        return {
          ...d,
          data: {
            ...d.data,
            short: rail.short,
            name: rail.name,
          },
        };
      }
      return d;
    });
  }

  function resize() {
    if (!treeData) return;
    measure();
    clampCam();
    paint();
  }

  function destroy() {
    clearLongTimer();
    hideTip();
    el.classList.remove("is-scrubbing");
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("click", onClick);
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("dblclick", onDblClick);
    pointers.clear();
    pinch = null;
    ro.disconnect();
    el.replaceChildren();
    delete el.dataset.orient;
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(el);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove, { passive: false });
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDblClick);
  canvas.setAttribute("draggable", "false");

  return {
    build,
    zoomToId,
    goUp,
    setSelected,
    setOrientation,
    getOrientation: () => orient,
    pathToFocus,
    resize,
    destroy,
    getFocus: () => focus,
  };
}
