/**
 * Zoomable icicle with Sankey-style Constitution rail.
 * Orientations: side (L→R columns) · top (T→B rows) — phone-friendly.
 * Three levels from focus: children · grandchildren · great-grandchildren.
 */
import * as d3 from "../vendor/d3.js";
import {
  displayName,
  cellFill,
  paintFill,
  sliceTree,
  hierarchySort,
  BRANCH_ORDER,
  branchOrderKey,
  CONSTITUTION_FILL,
  INK,
  atlasRail,
} from "../shared.js";

const CONST_W = 20;
const BLACK_W = 2.5;
const FOCUS_W = 20;
const CONST_H = 22;
const BLACK_H = 2.5;
const FOCUS_H = 22;
const RAIL_GAP = 0;

export function createIcicleView(
  container,
  { onSelect, onFocusChange, orientation = "side" }
) {
  const el = typeof container === "string" ? document.querySelector(container) : container;
  let width = 0;
  let height = 0;
  let treeData = null;
  let fullRoot = null;
  let focus = null;
  let selectedId = null;
  let orient = orientation === "top" ? "top" : "side";
  const byId = new Map();

  const tipEl = document.getElementById("map-tip");

  const svg = d3.select(el).append("svg").attr("class", "map-svg").attr("role", "img");
  const viewport = svg.append("g").attr("class", "icicle-viewport");
  const railG = viewport.append("g").attr("class", "icicle-rail");
  const focusRailG = viewport.append("g").attr("class", "icicle-focus-rail");
  const g = viewport.append("g").attr("class", "icicle-g");

  let panX = 0;
  let panY = 0;
  let panFocusId = null;
  let armedId = null;
  let scrubId = null; // live highlight while scrubbing
  let ignoreClicksUntil = 0;
  let longTimer = 0;
  /** @type {{ id:string, x0:number, y0:number, x1:number, y1:number, node:* }[]} */
  let layoutCells = [];
  /** @type {{ pointerId:number, pointerType:string, startX:number, startY:number, x:number, y:number, cellNode:*, moved:boolean, scrubbing:boolean, pan0x:number, pan0y:number, originX:number, originY:number } | null} */
  let gesture = null;

  const LONG_MS = 400;
  const SLOP = 12;

  function isTop() {
    return orient === "top";
  }

  function applyPan() {
    viewport.attr("transform", `translate(${panX},${panY})`);
  }

  function clampPan() {
    if (!width || !height) return;
    // Keep most of the chart on-screen (no stepping off into empty space)
    const maxX = width * 0.35;
    const maxY = height * 0.35;
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  function resetPan() {
    panX = 0;
    panY = 0;
    applyPan();
  }

  function maybeResetPanForFocus() {
    const id = focus?.data?.id ?? null;
    if (id !== panFocusId) {
      panFocusId = id;
      resetPan();
    } else {
      applyPan();
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
    return scrubId || armedId || selectedId;
  }

  function paintArmedStroke() {
    const hid = highlightId();
    g.selectAll("rect.icicle-rect")
      .attr("fill", (d) => cellFill(d, d.data.id === hid))
      .attr("stroke", (d) => (d.data.id === hid ? INK : "rgba(0,0,0,0.22)"))
      .attr("stroke-width", (d) => (d.data.id === hid ? 2.5 : 1));
  }

  function previewUnderFinger(clientX, clientY, footer) {
    const node = nodeAtClient(clientX, clientY);
    if (node) {
      scrubId = node.data.id;
      paintArmedStroke();
      showTip(node.data, clientX, clientY, footer);
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
    showTip(node.data, clientX, clientY, "Armed · tap box for details");
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
    const svgNode = svg.node();
    if (!svgNode || !layoutCells.length) return null;
    const ctm = svgNode.getScreenCTM();
    if (!ctm) return null;
    const pt = svgNode.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const loc = pt.matrixTransform(ctm.inverse());
    const x = loc.x - panX;
    const y = loc.y - panY;
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

  function beginScrub() {
    if (!gesture) return;
    gesture.scrubbing = true;
    // Lock chart in place for scrub (discard any leftover pan)
    resetPan();
    hapticPulse();
    el.classList.add("is-scrubbing");
    previewUnderFinger(gesture.x, gesture.y, "Slide to a box · lift to arm");
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    clearLongTimer();
    const cellNode = nodeFromEventTarget(event.target);
    gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      cellNode,
      moved: false,
      scrubbing: false,
      pan0x: panX,
      pan0y: panY,
      originX: event.clientX,
      originY: event.clientY,
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
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    const dist = Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY);

    // Desktop: drag pans (no scrub)
    if (gesture.pointerType === "mouse") {
      if (dist > SLOP) {
        gesture.moved = true;
        ignoreClicksUntil = performance.now() + 100;
        panX = gesture.pan0x + (gesture.x - gesture.startX);
        panY = gesture.pan0y + (gesture.y - gesture.startY);
        clampPan();
        applyPan();
      }
      return;
    }

    // Touch before scrub: slip cancels long-press
    if (!gesture.scrubbing) {
      if (dist > SLOP) {
        gesture.moved = true;
        clearLongTimer();
      }
      return;
    }

    // Scrub: chart stays put — only the selection outline follows the finger
    previewUnderFinger(gesture.x, gesture.y, "Slide to a box · lift to arm");
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    clearLongTimer();
    const g0 = gesture;
    gesture = null;
    el.classList.remove("is-scrubbing");
    try {
      svg.node().releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
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
      // Kill the ghost click that would open the wrong detail
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
    if (count <= 6) return 16;
    return 14;
  }

  function railStripeHeight(count) {
    if (count <= 3) return FOCUS_H;
    if (count <= 6) return 18;
    return 16;
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

  function showTip(data, clientX, clientY, footer = "Click for details") {
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
    tipEl.style.left = "0px";
    tipEl.style.top = "0px";
    const pad = 14;
    let left = clientX + pad;
    let top = clientY + pad;
    const tipRect = tipEl.getBoundingClientRect();
    if (left + tipRect.width > window.innerWidth - 8) left = clientX - tipRect.width - pad;
    if (top + tipRect.height > window.innerHeight - 8) top = clientY - tipRect.height - pad;
    tipEl.style.left = `${Math.max(8, left)}px`;
    tipEl.style.top = `${Math.max(8, top)}px`;
  }

  function goHome(event) {
    if (shouldIgnoreClick()) return;
    event.stopPropagation();
    hideTip();
    if (!fullRoot) return;
    armedId = null;
    focus = fullRoot;
    selectedId = fullRoot.data.id;
    onSelect?.(fullRoot.data, fullRoot);
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
          .attr("stroke", "rgba(0,0,0,0.22)")
          .attr("stroke-width", 1)
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
        .attr("stroke", "rgba(0,0,0,0.22)")
        .attr("stroke-width", 1)
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
    maybeResetPanForFocus();
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
      children: orderedKids.map((c) => sliceTree(c, 2)),
    };
    const layoutRoot = d3
      .hierarchy(sliced)
      .sum((d) => (d.children && d.children.length ? 0 : 1))
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
        const e = enter.append("g").attr("class", "icicle-cell").style("cursor", "pointer");
        e.append("rect").attr("class", "icicle-rect");
        e.append("text").attr("class", "icicle-label").attr("dy", "0.35em");
        e.on("click", (event, d) => {
          const real = byId.get(d.data.id);
          confirmArmedOrSelect(event, real);
        });
        e.on("pointermove", (event, d) => {
          if (event.pointerType === "touch") return;
          showTip(
            d.data,
            event.clientX,
            event.clientY,
            armedId === d.data.id ? "Armed · tap box for details" : "Click for details"
          );
        });
        e.on("pointerleave", hideTip);
        return e;
      });

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

    /** Top-down only: stack Leg/Exec/Jud as upright letters. Sideways stays horizontal. */
    function stackUprightBranch(d) {
      if (!isTop() || !atConstitution || d.depth !== 1) return false;
      const key = branchOrderKey(d);
      return key === "Legislative" || key === "Executive" || key === "Judicial";
    }

    function cellLabelText(d) {
      // Constitution root: only name the 4 branches — no OPM / GSA / etc.
      if (atConstitution && d.depth !== 1) return "";
      if (isTop()) {
        const h = d.y1 - d.y0;
        const w = d.x1 - d.x0;
        if (stackUprightBranch(d)) {
          if (h < 48 || w < 16) return "";
          return displayName(d);
        }
        if (atConstitution && d.depth === 1) {
          if (h < 12 || w < 40) return "";
          return displayName(d);
        }
        if (h < 14 || w < 36) return "";
        return displayName(d);
      }
      const h = d.x1 - d.x0;
      const w = d.y1 - d.y0;
      if (atConstitution && d.depth === 1) {
        if (h < 12 || w < 40) return "";
        return displayName(d);
      }
      if (h < 14 || w < 44) return "";
      return displayName(d);
    }

    function paintCellLabel(selection) {
      selection.each(function (d) {
        const node = d3.select(this);
        const label = cellLabelText(d);
        node.selectAll("tspan").remove();
        node.text(null);
        node.attr("opacity", label ? 1 : 0);
        if (!label) return;

        if (stackUprightBranch(d)) {
          // Upright letters stacked top→bottom (top-down icicle only)
          const chars = [...label];
          const startDy = -((chars.length - 1) / 2) * 1.05;
          const x = node.attr("x");
          node
            .selectAll("tspan")
            .data(chars)
            .join("tspan")
            .attr("x", x)
            .attr("dy", (_, i) => `${i === 0 ? startDy : 1.05}em`)
            .text((c) => c);
        } else {
          node.text(label);
        }
      });
    }

    if (isTop()) {
      cell.attr("transform", (d) => `translate(${d.x0},${d.y0})`);
      cell
        .select("rect")
        .attr("width", (d) => Math.max(0, d.x1 - d.x0))
        .attr("height", (d) => Math.max(0, d.y1 - d.y0));
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
      cell.attr("transform", (d) => `translate(${d.y0},${d.x0})`);
      cell
        .select("rect")
        .attr("width", (d) => Math.max(0, d.y1 - d.y0))
        .attr("height", (d) => Math.max(0, d.x1 - d.x0));
      cell
        .select("text")
        .style("pointer-events", "none")
        .attr("transform", "")
        .attr("dominant-baseline", "middle")
        .attr("text-anchor", (d) =>
          atConstitution && d.depth === 1 ? "middle" : "start"
        )
        .attr("x", (d) =>
          atConstitution && d.depth === 1
            ? Math.max(0, d.y1 - d.y0) / 2
            : 8
        )
        .attr("y", (d) => (d.x1 - d.x0) / 2);
      paintCellLabel(cell.select("text"));
    }

    cell
      .select("rect")
      .attr("fill", (d) => cellFill(d, d.data.id === highlightId()))
      .attr("fill-opacity", 1)
      .attr("stroke", (d) =>
        d.data.id === highlightId() ? INK : "rgba(0,0,0,0.22)"
      )
      .attr("stroke-width", (d) => (d.data.id === highlightId() ? 2.5 : 1));
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
      .sum((d) => (d.children && d.children.length ? 0 : 1))
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
    focus = d.children?.length ? d : d.parent || d;
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
    styleSelected();
  }

  function setOrientation(next) {
    orient = next === "top" ? "top" : "side";
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
    clearLongTimer();
    hideTip();
    el.classList.remove("is-scrubbing");
    svg
      .on("pointerdown", null)
      .on("pointermove", null)
      .on("pointerup", null)
      .on("pointercancel", null)
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
    pathToFocus,
    resize,
    destroy,
    getFocus: () => focus,
  };
}
