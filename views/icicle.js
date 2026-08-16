/** Zoomable icicle — side / top orientation, depth 1–11 from focus. */
import * as d3 from "../vendor/d3.js?v=2463";
import {
  displayName,
  cellFill,
  paintFill,
  selectionFill,
  sliceTree,
  hierarchySort,
  BRANCH_ORDER,
  branchOrderKey,
  leafLayoutWeight,
  CONSTITUTION_FILL,
  INK,
  LABEL_ON_BRANCH,
  getColorTheme,
  atlasRail,
  placeMapTip,
  noteScrubSuccess,
  nodeHasHeat,
  zoomJumpNode,
} from "../shared.js?v=2493";

const CONST_W = 28;
const FOCUS_W = 28;
const CONST_H = 32;
const FOCUS_H = 32;
const BLACK_W = 3;
const BLACK_H = 3;
const RAIL_GAP = 0;
const ICICLE_MAX_LEVELS = 11;

export function createIcicleView(
  container,
  { onSelect, onFocusChange, orientation = "top", nestLevels = 11 } = {}
) {
  const el = typeof container === "string" ? document.querySelector(container) : container;
  let width = 0;
  let height = 0;
  let treeData = null;
  let fullRoot = null;
  let focus = null;
  let selectedId = null;
  let hoverId = null;
  let orient = orientation === "top" ? "top" : "side";
  let nestDepth = clampNestLevels(nestLevels);
  let nestPaintRaf = 0;
  const byId = new Map();

  function clampNestLevels(n) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return 3;
    return Math.min(ICICLE_MAX_LEVELS, Math.max(1, v));
  }

  function sliceDepthLeft() {
    return Math.max(0, nestDepth - 1);
  }

  const tipEl = document.getElementById("map-tip");

  const svg = d3.select(el).append("svg").attr("class", "map-svg").attr("role", "img");
  const viewport = svg.append("g").attr("class", "icicle-viewport");
  const railG = viewport.append("g").attr("class", "icicle-rail");
  const focusRailG = viewport.append("g").attr("class", "icicle-focus-rail");
  const g = viewport.append("g").attr("class", "icicle-g");

  let panFocusId = null;
  let armedId = null;
  let scrubId = null; // live highlight while scrubbing
  let ignoreClicksUntil = 0;
  let longTimer = 0;
  /** @type {{ id:string, x0:number, y0:number, x1:number, y1:number, node:* }[]} */
  let layoutCells = [];
  /** @type {{ pointerId:number, pointerType:string, startX:number, startY:number, x:number, y:number, cellNode:*, moved:boolean, scrubbing:boolean, panning:boolean, pinching:boolean, lastSX:number, lastSY:number } | null} */
  let gesture = null;
  let cam = { k: 1, x: 0, y: 0 };
  const pointers = new Map();
  let pinch = null;
  const CAM_MIN = 1;
  const CAM_MAX = 40;

  const LONG_MS = 400;
  const SLOP = 12;

  function cellStroke() {
    // Light: true black. Dark: white.
    return getColorTheme() === "dark" ? "#ffffff" : "#000000";
  }

  function cellStrokeW() {
    const phone =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 720px)").matches;
    return phone ? 0.1 : 0.15;
  }

  function isTop() {
    return orient === "top";
  }

  function applyCam() {
    viewport.attr(
      "transform",
      `translate(${cam.x},${cam.y}) scale(${cam.k})`
    );
    // Only base cells — heat ring uses non-scaling CSS stroke (works on iOS).
    g.selectAll("rect.icicle-rect").attr("stroke-width", cellStrokeW() / cam.k);
    // Screen size for heat boost (small cells pulse bigger when zoomed out).
    const mapRoot = typeof el === "object" && el?.closest ? el.closest(".map") || el : null;
    const host = mapRoot || document.getElementById("map");
    if (host?.dataset) host.dataset.heatCamK = String(cam.k);
  }

  function resetCam() {
    cam = { k: 1, x: 0, y: 0 };
    pinch = null;
    applyCam();
  }

  function clampCam() {
    if (!width || !height) return;
    if (cam.k <= CAM_MIN + 0.001) {
      cam.k = CAM_MIN;
      cam.x = 0;
      cam.y = 0;
      return;
    }
    cam.k = Math.min(CAM_MAX, Math.max(CAM_MIN, cam.k));
    cam.x = Math.min(0, Math.max(width - width * cam.k, cam.x));
    cam.y = Math.min(0, Math.max(height - height * cam.k, cam.y));
  }

  function zoomAt(sx, sy, factor) {
    const k1 = cam.k;
    const k2 = Math.min(CAM_MAX, Math.max(CAM_MIN, k1 * factor));
    cam.x = sx - ((sx - cam.x) * k2) / k1;
    cam.y = sy - ((sy - cam.y) * k2) / k1;
    cam.k = k2;
    clampCam();
  }

  function screenXY(clientX, clientY) {
    const svgNode = svg.node();
    if (!svgNode) return { sx: 0, sy: 0 };
    const ctm = svgNode.getScreenCTM();
    if (!ctm) return { sx: 0, sy: 0 };
    const pt = svgNode.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const loc = pt.matrixTransform(ctm.inverse());
    return { sx: loc.x, sy: loc.y };
  }

  function worldXY(clientX, clientY) {
    const { sx, sy } = screenXY(clientX, clientY);
    return {
      mx: (sx - cam.x) / cam.k,
      my: (sy - cam.y) / cam.k,
    };
  }

  function maybeResetCamForFocus() {
    const id = focus?.data?.id ?? null;
    if (id !== panFocusId) {
      panFocusId = id;
      resetCam();
    } else {
      applyCam();
    }
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

  function highlightId() {
    return scrubId || armedId || hoverId || selectedId;
  }

  function stampHeatFills(sel) {
    const hid = highlightId();
    // Never rewrite data-w-base / data-h-base here — those are layout sizes from
    // paint(). Reading width after a heat pulse corrupts the base and the pulse
    // drifts to one side.
    sel
      .attr("data-fill-rest", (d) => paintFill(d))
      .attr("data-fill-sel", (d) => selectionFill(d))
      .attr("data-heat-hold", (d) => (d.data.id === hid ? "1" : null))
      .attr("fill", function (d) {
        if (d.data.id === hid) return selectionFill(d);
        // Leave heat cells to the pulse timer so we don’t stomp their fill mid-frame.
        if (
          typeof document !== "undefined" &&
          document.documentElement.classList.contains("heat-on") &&
          nodeHasHeat(d)
        ) {
          return this.getAttribute("fill") || paintFill(d);
        }
        return paintFill(d);
      });
  }

  function paintArmedStroke() {
    const hid = highlightId();
    const rects = g.selectAll("rect.icicle-rect");
    stampHeatFills(rects);
    rects
      .attr("stroke", cellStroke())
      .attr("stroke-width", cellStrokeW() / cam.k);
  }

  function previewUnderFinger(clientX, clientY, footer) {
    const node = nodeAtClient(clientX, clientY);
    if (node) {
      scrubId = node.data.id;
      paintArmedStroke();
      showTip(node.data, clientX, clientY, footer, true);
      return node;
    }
    scrubId = null;
    paintArmedStroke();
    hideTip();
    return null;
  }

  function armNode(node, clientX, clientY) {
    if (!node) return;
    scrubId = null;
    armedId = node.data.id;
    selectedId = node.data.id;
    paintArmedStroke();
    hapticPulse();
    noteScrubSuccess();
    showTip(node.data, clientX, clientY, "Armed · tap box for details", true);
  }

  function nodeFromEventTarget(target) {
    if (!target || !target.closest) return null;
    const cell = target.closest("g.icicle-cell");
    if (cell) {
      const id = cell.__data__?.data?.id;
      return id ? byId.get(id) : null;
    }
    return null;
  }

  function nodeAtClient(clientX, clientY) {
    if (!layoutCells.length) return null;
    const { mx: x, my: y } = worldXY(clientX, clientY);
    let best = null;
    let bestArea = Infinity;
    for (const c of layoutCells) {
      if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1) {
        const area = Math.max(1, (c.x1 - c.x0) * (c.y1 - c.y0));
        if (area < bestArea) {
          bestArea = area;
          best = c;
        }
      }
    }
    return best?.node || null;
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
    applyCam();
  }

  function beginScrub() {
    if (!gesture) return;
    gesture.scrubbing = true;
    hapticPulse();
    el.classList.add("is-scrubbing");
    previewUnderFinger(gesture.x, gesture.y, "Slide to a box · lift to arm");
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    clearLongTimer();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      clearLongTimer();
      try {
        svg.node().setPointerCapture(event.pointerId);
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

    const cellNode = nodeFromEventTarget(event.target);
    const { sx, sy } = screenXY(event.clientX, event.clientY);
    gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      lastSX: sx,
      lastSY: sy,
      cellNode,
      moved: false,
      scrubbing: false,
      panning: false,
      pinching: false,
    };

    try {
      svg.node().setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }

    if (gesture.pointerType === "touch" || gesture.pointerType === "pen") {
      longTimer = window.setTimeout(() => {
        longTimer = 0;
        if (!gesture || gesture.moved) return;
        beginScrub();
      }, LONG_MS);
    }

    if (gesture.pointerType === "mouse" && cellNode) {
      showTip(cellNode.data, event.clientX, event.clientY);
    }
  }

  function onPointerMove(event) {
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
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
      event.preventDefault();
      return;
    }

    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    const { sx, sy } = screenXY(event.clientX, event.clientY);
    const dist = Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY);

    if (gesture.scrubbing) {
      previewUnderFinger(gesture.x, gesture.y, "Slide to a box · lift to arm");
      event.preventDefault();
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
      applyCam();
      event.preventDefault();
      return;
    }

    if (gesture.pointerType === "mouse") {
      if (dist > SLOP) {
        gesture.moved = true;
        ignoreClicksUntil = performance.now() + 100;
      }
      return;
    }

    // Touch before scrub: slip cancels long-press
    if (dist > SLOP) {
      gesture.moved = true;
      clearLongTimer();
    }
  }

  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    try {
      svg.node().releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    if (pointers.size < 2) pinch = null;

    if (!gesture) return;
    if (event.pointerId !== gesture.pointerId) {
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
      const node =
        nodeAtClient(g0.x, g0.y) ||
        (scrubId && byId.get(scrubId)) ||
        null;
      if (node) armNode(node, g0.x, g0.y);
      else {
        scrubId = null;
        paintArmedStroke();
        hideTip();
      }
      ignoreClicksUntil = performance.now() + 500;
      return;
    }

    if (g0.moved) {
      ignoreClicksUntil = performance.now() + 100;
      return;
    }

    const touch = g0.pointerType === "touch" || g0.pointerType === "pen";
    if (armedId && touch) {
      const armed = byId.get(armedId);
      ignoreClicksUntil = performance.now() + 500;
      if (armed) activateHierarchyNode(armed, event, { ignoreGate: false });
    }
  }

  function onWheel(event) {
    event.preventDefault();
    const { sx, sy } = screenXY(event.clientX, event.clientY);
    zoomAt(sx, sy, Math.exp(-event.deltaY * 0.0016));
    applyCam();
  }

  function onDblClick(event) {
    if (cam.k <= 1.001) return;
    event.preventDefault();
    resetCam();
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  function shouldIgnoreClick() {
    return performance.now() < ignoreClicksUntil;
  }

  svg
    .on("pointerdown", onPointerDown)
    .on("pointermove", onPointerMove)
    .on("pointerup", onPointerUp)
    .on("pointercancel", onPointerUp)
    .on("dblclick", onDblClick)
    .on("click", (event) => {
      if (shouldIgnoreClick()) return;
      if (!armedId) return;
      const armed = byId.get(armedId);
      if (armed) activateHierarchyNode(armed, event);
    })
    .on("contextmenu", onContextMenu);

  const svgDom = svg.node();
  if (svgDom) {
    svgDom.setAttribute("draggable", "false");
    svgDom.addEventListener("wheel", onWheel, { passive: false });
  }

  function measure() {
    const rect = el.getBoundingClientRect();
    width = Math.max(320, rect.width || el.clientWidth || 800);
    height = Math.max(280, rect.height || el.clientHeight || 600);
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", "100%").attr("height", "100%");
  }

  function ancestorRailNodes() {
    if (!focus || !fullRoot || focus === fullRoot) return [];
    return focus
      .ancestors()
      .reverse()
      .filter((d) => d !== fullRoot);
  }

  function railStripeWidth(count) {
    if (count <= 3) return FOCUS_W;
    if (count <= 6) return 22;
    return 20;
  }

  function railStripeHeight(count) {
    if (count <= 3) return FOCUS_H;
    if (count <= 6) return 26;
    return 24;
  }

  function contentLeft() {
    if (isTop()) return 0;
    const rails = ancestorRailNodes();
    if (!rails.length) return CONST_W + BLACK_W + RAIL_GAP;
    return CONST_W + BLACK_W + RAIL_GAP + rails.length * railStripeWidth(rails.length);
  }

  function contentTop() {
    if (!isTop()) return 0;
    const rails = ancestorRailNodes();
    if (!rails.length) return CONST_H + BLACK_H + RAIL_GAP;
    return CONST_H + BLACK_H + RAIL_GAP + rails.length * railStripeHeight(rails.length);
  }

  function indexTree(node) {
    byId.set(node.data.id, node);
    for (const c of node.children || []) indexTree(c);
  }

  function hideTip() {
    if (tipEl) tipEl.hidden = true;
  }

  function showTip(data, clientX, clientY, footer = "Click for details", fromTouch = false) {
    if (!tipEl || !data) {
      hideTip();
      return;
    }
    const kind = data.kind || "org";
    tipEl.innerHTML = `
      <p class="tip-kind">${kind}</p>
      <p class="tip-name">${data.name || ""}</p>
      ${
        data.short && data.short !== data.name
          ? `<p class="tip-meta">${data.short}</p>`
          : ""
      }
      <p class="tip-meta">${footer}</p>
    `;
    tipEl.hidden = false;
    placeMapTip(tipEl, clientX, clientY, { fromTouch: !!fromTouch });
  }

  function goHome(event) {
    if (shouldIgnoreClick()) return;
    event.stopPropagation();
    hideTip();
    if (!fullRoot) return;
    const revealRoot = focus === fullRoot;
    armedId = null;
    hoverId = null;
    focus = fullRoot;
    selectedId = fullRoot.data.id;
    onSelect?.(fullRoot.data, fullRoot, { revealRoot });
    onFocusChange?.(focus);
    paint();
  }

  function activateHierarchyNode(node, event, { ignoreGate = true } = {}) {
    if (ignoreGate && shouldIgnoreClick()) return;
    if (event) event.stopPropagation();
    hideTip();
    if (!node) return;
    scrubId = null;
    armedId = null;
    hoverId = null;
    selectedId = node.data.id;
    onSelect?.(node.data, node);
    if (node.children?.length) {
      focus = node;
      onFocusChange?.(focus);
      paint();
    } else {
      styleSelected();
    }
  }

  /** After scrub-arm, the next tap confirms the armed box (ignore fat-finger hit target). */
  function confirmArmedOrSelect(event, fallbackNode) {
    if (shouldIgnoreClick()) return;
    if (armedId) {
      const armed = byId.get(armedId);
      if (armed) {
        activateHierarchyNode(armed, event);
        return;
      }
    }
    activateHierarchyNode(fallbackNode, event);
  }

  function drawConstitutionRail() {
    railG.selectAll("*").remove();

    if (isTop()) {
      const band = CONST_H + BLACK_H;
      railG
        .append("rect")
        .attr("class", "const-hit")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", band)
        .attr("fill", "transparent")
        .style("cursor", "pointer")
        .on("click", goHome)
        .on("pointermove", (event) => {
          showTip(atlasRail(fullRoot?.data), event.clientX, event.clientY);
        })
        .on("pointerleave", hideTip);

      railG
        .append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", CONST_H)
        .attr("fill", CONSTITUTION_FILL)
        .style("pointer-events", "none");

      railG
        .append("rect")
        .attr("x", 0)
        .attr("y", CONST_H)
        .attr("width", width)
        .attr("height", BLACK_H)
        .attr("fill", INK)
        .style("pointer-events", "none");

      railG
        .append("text")
        .attr("class", "const-label")
        .attr("fill", INK)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("x", width / 2)
        .attr("y", CONST_H / 2)
        .style("pointer-events", "none")
        .text(atlasRail(fullRoot?.data).name);
      return;
    }

    const cy0 = 0;
    const cy1 = height;
    const constX = CONST_W / 2;
    const blackX = CONST_W + BLACK_W / 2;

    railG
      .append("rect")
      .attr("class", "const-hit")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", CONST_W + BLACK_W)
      .attr("height", height)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("click", goHome)
      .on("pointermove", (event) => {
        showTip(atlasRail(fullRoot?.data), event.clientX, event.clientY);
      })
      .on("pointerleave", hideTip);

    railG
      .append("line")
      .attr("x1", constX)
      .attr("x2", constX)
      .attr("y1", cy0)
      .attr("y2", cy1)
      .attr("stroke", CONSTITUTION_FILL)
      .attr("stroke-width", CONST_W)
      .attr("stroke-linecap", "butt")
      .style("pointer-events", "none");

    railG
      .append("line")
      .attr("x1", blackX)
      .attr("x2", blackX)
      .attr("y1", cy0)
      .attr("y2", cy1)
      .attr("stroke", INK)
      .attr("stroke-width", BLACK_W)
      .attr("stroke-linecap", "butt")
      .style("pointer-events", "none");

    railG
      .append("text")
      .attr("class", "const-label")
      .attr("fill", INK)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("transform", `translate(${constX}, ${height / 2}) rotate(-90)`)
      .style("pointer-events", "none")
      .text(atlasRail(fullRoot?.data).name);
  }

  function drawFocusRail() {
    focusRailG.selectAll("*").remove();
    const rails = ancestorRailNodes();
    if (!rails.length) return;

    if (isTop()) {
      const stripe = railStripeHeight(rails.length);
      let y0 = CONST_H + BLACK_H;
      for (const node of rails) {
        const midY = y0 + stripe / 2;
        const fill = paintFill(node);
        const label = displayName(node);
        const gRail = focusRailG.append("g").attr("class", "focus-rail-stripe");

        gRail
          .append("rect")
          .attr("class", "focus-hit")
          .attr("x", 0)
          .attr("y", y0)
          .attr("width", width)
          .attr("height", stripe)
          .attr("fill", fill)
          .attr("stroke", cellStroke())
          .attr("stroke-width", cellStrokeW())
          .style("cursor", "pointer")
          .on("click", (event) => activateHierarchyNode(node, event))
          .on("pointermove", (event) => {
            if (event.pointerType === "touch") return;
            showTip(node.data, event.clientX, event.clientY);
          })
          .on("pointerleave", hideTip);

        gRail
          .append("text")
          .attr("class", "focus-rail-label")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("x", width / 2)
          .attr("y", midY)
          .text(label);

        y0 += stripe;
      }
      return;
    }

    const stripe = railStripeWidth(rails.length);
    let x0 = CONST_W + BLACK_W;
    for (const node of rails) {
      const midX = x0 + stripe / 2;
      const fill = paintFill(node);
      const label = displayName(node);
      const gRail = focusRailG.append("g").attr("class", "focus-rail-stripe");

      gRail
        .append("rect")
        .attr("class", "focus-hit")
        .attr("x", x0)
        .attr("y", 0)
        .attr("width", stripe)
        .attr("height", height)
        .attr("fill", fill)
        .attr("stroke", cellStroke())
        .attr("stroke-width", cellStrokeW())
        .style("cursor", "pointer")
        .on("click", (event) => activateHierarchyNode(node, event))
        .on("pointermove", (event) => {
          if (event.pointerType === "touch") return;
          showTip(node.data, event.clientX, event.clientY);
        })
        .on("pointerleave", hideTip);

      gRail
        .append("text")
        .attr("class", "focus-rail-label")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("transform", `translate(${midX}, ${height / 2}) rotate(-90)`)
        .text(label);

      x0 += stripe;
    }
  }

  function paint() {
    if (!focus) return;
    measure();
    el.dataset.orient = orient;
    maybeResetCamForFocus();
    drawConstitutionRail();
    drawFocusRail();

    const left = contentLeft();
    const top = contentTop();
    const contentW = Math.max(80, width - left);
    const contentH = Math.max(80, height - top);
    const kids = focus.data.children || [];

    if (!kids.length) {
      g.selectAll("*").remove();
      g.append("text")
        .attr("class", "icicle-label")
        .attr("x", left + 12)
        .attr("y", top + 28)
        .text("No subunits — use Up or the Constitution rail");
      return;
    }

    const orderedKids = [...kids].sort((a, b) => {
      const ka = branchOrderKey(a);
      const kb = branchOrderKey(b);
      if (ka || kb) {
        const ia = ka ? BRANCH_ORDER.indexOf(ka) : 99;
        const ib = kb ? BRANCH_ORDER.indexOf(kb) : 99;
        if (ia !== ib) return ia - ib;
      }
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    const sliced = {
      id: "__icicle_virtual__",
      name: "",
      children: orderedKids.map((c) => sliceTree(c, sliceDepthLeft())),
    };
    const layoutRoot = d3
      .hierarchy(sliced)
      .sum((d) => leafLayoutWeight(d))
      .sort(hierarchySort);

    // side: x=vertical breadth, y=depth columns
    // top:  x=horizontal breadth, y=depth rows
    if (isTop()) {
      d3.partition().size([contentW, contentH]).padding(0)(layoutRoot);
    } else {
      d3.partition().size([contentH, contentW]).padding(0)(layoutRoot);
    }

    const visible = layoutRoot.descendants().filter((d) => d.depth > 0);

    if (isTop()) {
      const yMin = d3.min(visible, (d) => d.y0) ?? 0;
      const yMax = d3.max(visible, (d) => d.y1) ?? contentH;
      const span = Math.max(1, yMax - yMin);
      for (const d of visible) {
        d.y0 = top + ((d.y0 - yMin) / span) * contentH;
        d.y1 = top + ((d.y1 - yMin) / span) * contentH;
        d.x0 += left;
        d.x1 += left;
      }
    } else {
      const yMin = d3.min(visible, (d) => d.y0) ?? 0;
      const yMax = d3.max(visible, (d) => d.y1) ?? contentW;
      const span = Math.max(1, yMax - yMin);
      for (const d of visible) {
        d.y0 = left + ((d.y0 - yMin) / span) * contentW;
        d.y1 = left + ((d.y1 - yMin) / span) * contentW;
        d.x0 += top;
        d.x1 += top;
      }
    }

    const cell = g
      .selectAll("g.icicle-cell")
      .data(visible, (d) => d.data.id)
      .join((enter) => {
        const e = enter
          .append("g")
          .attr("class", "icicle-cell")
          .attr("data-id", (d) => d.data.id)
          .style("cursor", "pointer")
          .style("-webkit-tap-highlight-color", "transparent");
        e.append("rect").attr("class", "icicle-rect");
        e.append("text").attr("class", "icicle-label").attr("dy", "0.35em");
        e.on("click", (event, d) => {
          const real = byId.get(d.data.id);
          confirmArmedOrSelect(event, real);
        });
        e.on("pointermove", (event, d) => {
          if (event.pointerType === "touch") return;
          if (hoverId !== d.data.id) {
            hoverId = d.data.id;
            paintArmedStroke();
          }
          showTip(
            d.data,
            event.clientX,
            event.clientY,
            armedId === d.data.id ? "Armed · tap box for details" : "Click for details"
          );
        });
        e.on("pointerleave", () => {
          if (hoverId) {
            hoverId = null;
            paintArmedStroke();
          }
          hideTip();
        });
        return e;
      });

    cell
      .classed("has-heat", (d) => nodeHasHeat(d))
      .attr("data-id", (d) => d.data.id);
    // Pulse geometry is drawn on g.icicle-heat-pulse (above all cells) so
    // neighbor paint order can’t hide the right/bottom half of the grow.

    layoutCells = [];
    for (const d of visible) {
      const node = byId.get(d.data.id);
      if (!node) continue;
      if (isTop()) {
        layoutCells.push({
          id: d.data.id,
          x0: d.x0,
          y0: d.y0,
          x1: d.x1,
          y1: d.y1,
          node,
        });
      } else {
        layoutCells.push({
          id: d.data.id,
          x0: d.y0,
          y0: d.x0,
          x1: d.y1,
          y1: d.x1,
          node,
        });
      }
    }

    const atConstitution = focus === fullRoot;

    /** Layout box for a partition cell (user units). */
    function cellBox(d) {
      if (isTop()) {
        return { w: Math.max(0, d.x1 - d.x0), h: Math.max(0, d.y1 - d.y0) };
      }
      return { w: Math.max(0, d.y1 - d.y0), h: Math.max(0, d.x1 - d.x0) };
    }

    function stackLeading(fs) {
      if (fs < 6) return 0.78;
      if (fs < 8) return 0.82;
      if (fs < 10) return 0.88;
      return 0.94;
    }

    function applyStackSpans(node, text, fs) {
      const chars = [...text];
      const leading = stackLeading(fs);
      const x = node.attr("x");
      // Stack downward from the text y; centerInkInCell recenters the whole ink box
      node
        .selectAll("tspan")
        .data(chars)
        .join("tspan")
        .attr("x", x)
        .attr("dy", (_, i) => `${i === 0 ? 0 : leading}em`)
        .text((c) => c);
    }

    /** Branch door labels: full name, fill cell; paint sizes via getBBox. */
    function branchLabelPlan(d) {
      if (!atConstitution || d.depth !== 1) return null;
      if (!branchOrderKey(d)) return null;
      const text = displayName(d);
      if (!text) {
        return { text: "", mode: "hide", fill: LABEL_ON_BRANCH, fs: null };
      }

      const { w, h } = cellBox(d);
      if (w < 2 || h < 2) {
        return { text: "", mode: "hide", fill: LABEL_ON_BRANCH, fs: null };
      }
      const availW = w;
      const availH = h;
      const floor = 3.1;
      // Hard caps by device (binary-search still fills up to this)
      const isPhone =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 720px)").matches;
      const isIPad =
        /iPad/i.test(navigator.userAgent || "") ||
        (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
      const ceilingCap = isPhone ? 11 : isIPad ? 22 : 14;
      const ceiling = Math.min(ceilingCap, Math.max(availW, availH) * 0.98);

      const maxFsHoriz = Math.min(
        availW / Math.max(1, text.length * 0.4),
        availH / 0.85
      );
      const maxFsStack = isTop()
        ? Math.min(availW / 0.45, availH / Math.max(1, text.length * 0.76))
        : 0;

      const useStack = isTop() && maxFsStack > maxFsHoriz;
      const mode = useStack ? "stack" : "horizontal";
      let fs = useStack ? maxFsStack : maxFsHoriz;
      fs = Math.min(ceiling, Math.max(fs, floor * 0.85));
      if (!(fs > 0)) {
        return { text: "", mode: "hide", fill: LABEL_ON_BRANCH, fs: null };
      }

      return {
        text,
        mode,
        fill: LABEL_ON_BRANCH,
        fs: Math.round(fs * 100) / 100,
        availW,
        availH,
        ceiling,
        floor,
        clip: true,
      };
    }

    function cellLabelPlan(d) {
      const branch = branchLabelPlan(d);
      if (branch) return branch;

      if (atConstitution) {
        return { text: "", mode: "hide", fill: INK, fs: null };
      }

      const { w, h } = cellBox(d);
      if (h < 14 || w < 36) return { text: "", mode: "hide", fill: INK, fs: null };
      const text = displayName(d);
      if (!text) return { text: "", mode: "hide", fill: INK, fs: null };
      if (w < text.length * 6.2 + 12) {
        return { text: "", mode: "hide", fill: INK, fs: null };
      }
      return { text, mode: "horizontal", fill: INK, fs: null };
    }

    /** Snap ink box to true cell center (Safari stack+baseline is biased high). */
    function centerInkInCell(node, el, cellW, cellH) {
      let bb;
      try {
        bb = el.getBBox();
      } catch {
        return;
      }
      if (!(bb.width > 0 && bb.height > 0)) return;
      const x = (+node.attr("x") || 0) + (cellW / 2 - (bb.x + bb.width / 2));
      const y = (+node.attr("y") || 0) + (cellH / 2 - (bb.y + bb.height / 2));
      node.attr("x", x).attr("y", y);
      node.selectAll("tspan").attr("x", x);
    }

    function paintCellLabel(selection) {
      selection.each(function (d) {
        const node = d3.select(this);
        const el = this;
        const plan = cellLabelPlan(d);
        const box = cellBox(d);
        node.selectAll("tspan").remove();
        node.text(null);
        node.attr("fill", null);
        node.style("fill", plan.fill);
        node.attr("opacity", plan.text ? 1 : 0);
        if (!plan.text) return;

        const tracking = (fs) =>
          fs < 7 ? "-0.07em" : fs < 9 ? "-0.05em" : fs < 11 ? "-0.03em" : "-0.015em";

        const applyFs = (fs) => {
          node.style("font-size", `${Math.round(fs * 100) / 100}px`);
          node.style("letter-spacing", tracking(fs));
          if (plan.mode === "stack") {
            node.attr("dominant-baseline", "alphabetic");
            applyStackSpans(node, plan.text, fs);
          } else {
            node.attr("dominant-baseline", "middle");
            if (!node.text()) node.text(plan.text);
          }
        };

        if (plan.mode === "stack") {
          node.attr("dominant-baseline", "alphabetic");
          applyStackSpans(node, plan.text, plan.fs ?? 12);
        } else {
          node.attr("dominant-baseline", "middle");
          node.text(plan.text);
        }

        if (plan.fs == null || plan.availW == null) {
          if (plan.fs != null) applyFs(plan.fs);
          centerInkInCell(node, el, box.w, box.h);
          return;
        }

        const floor = plan.floor ?? 3.1;
        const ceiling = plan.ceiling ?? 22;
        const readBb = () => {
          try {
            return el.getBBox();
          } catch {
            return null;
          }
        };

        // Binary search: largest font whose ink box still fits the cell
        let lo = floor;
        let hi = ceiling;
        let best = floor;
        applyFs(lo);
        for (let i = 0; i < 16; i++) {
          const mid = (lo + hi) / 2;
          applyFs(mid);
          const bb = readBb();
          if (!bb || !(bb.width > 0 && bb.height > 0)) {
            hi = mid;
            continue;
          }
          if (bb.width <= plan.availW && bb.height <= plan.availH) {
            best = mid;
            lo = mid;
          } else {
            hi = mid;
          }
        }
        applyFs(best);
        centerInkInCell(node, el, box.w, box.h);

        // One last nudge if centering exposed unused room on the long axis
        const bb2 = readBb();
        if (bb2 && bb2.width > 0 && bb2.height > 0) {
          const room = Math.min(
            plan.availW / bb2.width,
            plan.availH / bb2.height
          );
          if (room > 1.01 && best * room <= ceiling + 0.01) {
            best = Math.min(ceiling, best * room);
            applyFs(best);
            centerInkInCell(node, el, box.w, box.h);
          }
        }

        if (plan.clip) {
          const g = d3.select(el.parentNode);
          const safe = String(d.data.id).replace(/[^a-zA-Z0-9_-]/g, "_");
          const cid = `door-clip-${safe}`;
          let cp = g.select("clipPath.door-clip");
          if (cp.empty()) {
            cp = g.insert("clipPath", "text").attr("class", "door-clip").attr("id", cid);
            cp.append("rect");
            node.attr("clip-path", `url(#${cid})`);
          }
          cp.select("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", box.w)
            .attr("height", box.h);
        }
      });
    }

    if (isTop()) {
      cell
        .attr("data-tx", (d) => d.x0)
        .attr("data-ty", (d) => d.y0)
        .attr("transform", (d) => `translate(${d.x0},${d.y0})`);
      cell
        .select("rect.icicle-rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", (d) => Math.max(0, d.x1 - d.x0))
        .attr("height", (d) => Math.max(0, d.y1 - d.y0))
        .attr("data-w-base", (d) => Math.max(0, d.x1 - d.x0))
        .attr("data-h-base", (d) => Math.max(0, d.y1 - d.y0))
        // Top view: sibling axis is horizontal → widen X.
        .attr("data-grow", "x");
      cell
        .select("text")
        .style("pointer-events", "none")
        .attr("transform", "")
        .attr("dominant-baseline", "middle")
        .attr("text-anchor", "middle")
        .attr("x", (d) => Math.max(0, d.x1 - d.x0) / 2)
        .attr("y", (d) => Math.max(0, d.y1 - d.y0) / 2);
      paintCellLabel(cell.select("text"));
    } else {
      cell
        .attr("data-tx", (d) => d.y0)
        .attr("data-ty", (d) => d.x0)
        .attr("transform", (d) => `translate(${d.y0},${d.x0})`);
      cell
        .select("rect.icicle-rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", (d) => Math.max(0, d.y1 - d.y0))
        .attr("height", (d) => Math.max(0, d.x1 - d.x0))
        .attr("data-w-base", (d) => Math.max(0, d.y1 - d.y0))
        .attr("data-h-base", (d) => Math.max(0, d.x1 - d.x0))
        // Side view: sibling axis is vertical → widen Y (not depth length).
        .attr("data-grow", "y");
      cell
        .select("text")
        .style("pointer-events", "none")
        .attr("transform", "")
        .attr("dominant-baseline", "middle")
        .attr("text-anchor", (d) =>
          atConstitution && d.depth === 1 && branchOrderKey(d)
            ? "middle"
            : "start"
        )
        .attr("x", (d) =>
          atConstitution && d.depth === 1 && branchOrderKey(d)
            ? Math.max(0, d.y1 - d.y0) / 2
            : 8
        )
        .attr("y", (d) => (d.x1 - d.x0) / 2);
      paintCellLabel(cell.select("text"));
    }

    stampHeatFills(cell.select("rect.icicle-rect"));
    cell
      .select("rect.icicle-rect")
      .attr("stroke", cellStroke())
      .attr("stroke-width", cellStrokeW() / cam.k);
  }

  function styleSelected() {
    paintArmedStroke();
  }

  function build(data) {
    if (!el.contains(svg.node())) {
      el.replaceChildren();
      el.appendChild(svg.node());
    }
    treeData = data;
    byId.clear();
    fullRoot = d3
      .hierarchy(data)
      .sum((d) => leafLayoutWeight(d))
      .sort(hierarchySort);
    indexTree(fullRoot);
    focus = fullRoot;
    selectedId = fullRoot.data.id;
    paint();
    onFocusChange?.(focus);
  }

  function zoomToId(id) {
    const d = byId.get(id);
    if (!d) return null;
    selectedId = id;
    onSelect?.(d.data, d);
    focus = zoomJumpNode(d);
    onFocusChange?.(focus);
    paint();
    return d;
  }

  function goUp() {
    if (!focus?.parent) return;
    focus = focus.parent;
    selectedId = null;
    onSelect?.(focus.data, focus);
    onFocusChange?.(focus);
    paint();
  }

  function setSelected(id) {
    selectedId = id || null;
    // Match Sankey UX: clearing selection returns to the whole map
    // (icicle otherwise stays drilled into the current focus subtree).
    if (!id && fullRoot && focus && focus !== fullRoot) {
      focus = fullRoot;
      armedId = null;
      hoverId = null;
      scrubId = null;
      resetCam();
      onFocusChange?.(focus);
      paint();
      return;
    }
    styleSelected();
  }

  function setOrientation(next) {
    orient = next === "top" ? "top" : "side";
    resetCam();
    paint();
  }

  function setNestLevels(next) {
    const v = clampNestLevels(next);
    if (v === nestDepth) return;
    nestDepth = v;
    if (nestPaintRaf) return;
    nestPaintRaf = requestAnimationFrame(() => {
      nestPaintRaf = 0;
      resetCam();
      paint();
    });
  }

  function getNestLevels() {
    return nestDepth;
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
    const id = focus?.data?.id;
    const sel = selectedId;
    build(treeData);
    if (id && byId.has(id)) {
      focus = byId.get(id);
      selectedId = sel;
      paint();
      onFocusChange?.(focus);
    }
  }


  function destroy() {
    if (nestPaintRaf) {
      cancelAnimationFrame(nestPaintRaf);
      nestPaintRaf = 0;
    }
    clearLongTimer();
    hideTip();
    el.classList.remove("is-scrubbing");
    pointers.clear();
    pinch = null;
    const node = svg.node();
    if (node) node.removeEventListener("wheel", onWheel);
    svg
      .on("pointerdown", null)
      .on("pointermove", null)
      .on("pointerup", null)
      .on("pointercancel", null)
      .on("dblclick", null)
      .on("click", null)
      .on("contextmenu", null);
    svg.remove();
    el.replaceChildren();
    delete el.dataset.orient;
  }

  return {
    build,
    zoomToId,
    goUp,
    setSelected,
    setOrientation,
    getOrientation: () => orient,
    setNestLevels,
    getNestLevels,
    pathToFocus,
    resize,
    destroy,
    getFocus: () => focus,
  };
}
