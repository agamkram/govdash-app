/**
 * Zoomable circle pack — size / bulk. Nested children, grandchildren,
 * and great-grandchildren. Circle labels are short names only; hover
 * and the detail pane carry the full title.
 * Phone: tap only a labeled (resolvable) node; long-press scrub unlabeled
 * like Icicle/Sankey. Tap the outer ring (or empty map) to go back.
 */
import * as d3 from "../vendor/d3.js?v=2463";
import {
  paintFill,
  selectionFill,
  hierarchySort,
  leafLayoutWeight,
  MAP_FIELD,
  placeMapTip,
  atlasRail,
  INK,
  noteScrubSuccess,
  nodeHasHeat,
} from "../shared.js?v=2463";

export function createPackView(container, { onSelect, onFocusChange }) {
  const el = typeof container === "string" ? document.querySelector(container) : container;
  let width = 0;
  let height = 0;
  let packRoot = null;
  let focus = null;
  let view = [0, 0, 1];
  let transitioning = false;
  let selectedId = null;
  let treeData = null;
  const byId = new Map();

  const svg = d3.select(el).append("svg").attr("class", "map-svg").attr("role", "img");
  const hitRect = svg
    .append("rect")
    .attr("class", "pack-hit")
    .attr("fill", "transparent");
  const nodeG = svg.append("g").attr("class", "nodes").style("pointer-events", "none");
  const haloG = svg
    .append("g")
    .attr("class", "pack-halo")
    .style("pointer-events", "none")
    .attr("display", "none");
  const haloOuter = haloG
    .append("circle")
    .attr("fill", "none")
    .attr("stroke", MAP_FIELD)
    .attr("stroke-width", 5);
  const haloInner = haloG
    .append("circle")
    .attr("fill", "none")
    .attr("stroke", "rgba(42,48,53,0.92)")
    .attr("stroke-width", 2);
  const labelG = svg.append("g").attr("class", "labels").style("pointer-events", "none");
  const focusChrome = svg
    .append("g")
    .attr("class", "pack-focus-chrome")
    .style("pointer-events", "none");
  const focusRim = focusChrome
    .append("circle")
    .attr("class", "pack-focus-rim")
    .attr("fill", "none")
    .attr("stroke", INK)
    .attr("stroke-width", 2.5);
  const focusCaption = focusChrome
    .append("text")
    .attr("class", "pack-focus-caption")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("fill", INK);

  let nodeSel = null;
  let labelSel = null;

  const VIEW_PAD = 2.18;
  const NEST_DEPTH = 3;
  const LABEL_R = 14;
  const LONG_MS = 400;
  const SLOP = 12;
  const MIN_HIT = 16;

  const tipEl = document.getElementById("map-tip");
  let armedId = null;
  let scrubId = null;
  let suppressMouseUntil = 0;
  let longTimer = 0;
  /** @type {{ pointerId:number, pointerType:string, startX:number, startY:number, x:number, y:number, moved:boolean, scrubbing:boolean } | null} */
  let gesture = null;

  function measure() {
    const rect = el.getBoundingClientRect();
    width = Math.max(320, rect.width || el.clientWidth || 800);
    height = Math.max(280, rect.height || el.clientHeight || 600);
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", "100%").attr("height", "100%");
    hitRect.attr("width", width).attr("height", height);
  }

  function visibleNodes(from = focus) {
    if (!from) return [];
    const maxD = from.depth + NEST_DEPTH;
    const nodes = [];
    from.each((d) => {
      if (d.depth <= maxD) nodes.push(d);
    });
    nodes.sort((a, b) => a.depth - b.depth);
    return nodes;
  }

  function scaleK(v = view) {
    return Math.min(width, height) / v[2];
  }

  function placed(d, v = view) {
    const k = scaleK(v);
    return {
      x: (d.x - v[0]) * k + width / 2,
      y: (d.y - v[1]) * k + height / 2,
      r: Math.max(0.4, d.r * k),
    };
  }

  function packAbbrev(d) {
    const s = (d?.data?.short || "").trim();
    return s.length >= 2 ? s : "";
  }

  function isLabeled(d) {
    if (!d || !focus || d.parent !== focus) return false;
    if (!packAbbrev(d)) return false;
    return placed(d).r > LABEL_R;
  }

  function highlightId() {
    return scrubId || armedId || selectedId;
  }

  function focusCaptionText(d = focus) {
    if (!d?.data) return "";
    const data = d.data;
    if (
      data.id === "usa" ||
      data.id === "beyond" ||
      data.kind === "sovereign"
    ) {
      return atlasRail(data).name;
    }
    return packAbbrev(d) || data.short || data.name || "";
  }

  function placeFocusChrome(v = view) {
    if (!focus) {
      focusChrome.attr("display", "none");
      return;
    }
    const p = placed(focus, v);
    focusChrome.attr("display", null);
    focusRim
      .attr("cx", p.x)
      .attr("cy", p.y)
      .attr("r", Math.max(p.r + 3, 12));
    // Caption sits in the gutter above the focus ring (VIEW_PAD leaves room).
    const captionY = Math.max(16, p.y - p.r - 18);
    focusCaption
      .attr("x", p.x)
      .attr("y", captionY)
      .style("font-size", "0.82rem")
      .text(focusCaptionText(focus));
  }

  function renderFrame(v) {
    if (!nodeSel) return;
    const k = scaleK(v);
    const place = (d) =>
      `translate(${(d.x - v[0]) * k + width / 2},${(d.y - v[1]) * k + height / 2})`;
    const rad = (d) => Math.max(0.4, d.r * k);

    nodeSel
      .attr("transform", place)
      .attr("r", rad)
      .attr("data-r-base", rad);

    labelSel
      .attr("transform", place)
      .style("font-size", (d) => `${Math.min(17, Math.max(10, d.r * k * 0.22))}px`)
      .attr("opacity", (d) => (d.r * k > LABEL_R ? 1 : 0));
    placeHalo(v);
    placeFocusChrome(v);
  }

  function haloTarget() {
    const id = highlightId();
    if (!id) return null;
    const d = byId.get(id);
    if (!d || d === focus) return null;
    return d;
  }

  function placeHalo(v = view) {
    const d = haloTarget();
    if (!d) {
      haloG.attr("display", "none");
      return;
    }
    const p = placed(d, v);
    const pad = p.r < 10 ? 5 : 3;
    const r = Math.max(p.r + pad, 11);
    haloG.attr("display", null).attr("transform", `translate(${p.x},${p.y})`);
    haloOuter.attr("r", r);
    haloInner.attr("r", r);
  }

  function paintStyles() {
    if (!nodeSel) return;
    const hid = highlightId();
    nodeSel
      .classed("has-heat", (d) => nodeHasHeat(d))
      .attr("data-fill-rest", (d) => paintFill(d))
      .attr("data-fill-sel", (d) => selectionFill(d))
      .attr("data-heat-hold", (d) =>
        d === focus || (d.data.id === hid && !d.children) ? "1" : null
      )
      .attr("fill", (d) => {
        // Never dump selection fill on the outer focus disk — it blacks the whole map.
        if (d === focus) return paintFill(d);
        if (d.data.id === hid && !d.children) return selectionFill(d);
        return paintFill(d);
      })
      .attr("data-base-op", (d) => {
        if (d === focus) return "0.1";
        if (d.children) return "0.34";
        return "0.94";
      })
      .attr("fill-opacity", (d) => {
        if (d === focus) return 0.1;
        if (d.children) return 0.34;
        return 0.94;
      })
      .attr("stroke", (d) => (d === focus ? INK : "rgba(0,0,0,0.28)"))
      .attr("stroke-width", (d) => (d === focus ? 2.25 : 1));
    placeHalo();
    placeFocusChrome();
  }

  function clientToSvg(clientX, clientY) {
    const svgNode = svg.node();
    if (!svgNode) return null;
    const rect = svgNode.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    };
  }

  function smallestAt(clientX, clientY) {
    const loc = clientToSvg(clientX, clientY);
    if (!loc || !focus) return null;
    const nodes = visibleNodes();
    let inside = null;
    let insideR = Infinity;
    let near = null;
    let nearDist = Infinity;
    for (const d of nodes) {
      if (d === focus) continue;
      const p = placed(d);
      const dist = Math.hypot(loc.x - p.x, loc.y - p.y);
      if (dist <= p.r && p.r < insideR) {
        inside = d;
        insideR = p.r;
      }
      const hitR = Math.max(p.r, MIN_HIT);
      if (dist <= hitR && dist < nearDist) {
        near = d;
        nearDist = dist;
      }
    }
    if (inside) return inside;
    if (near) return near;
    const fp = placed(focus);
    const dist = Math.hypot(loc.x - fp.x, loc.y - fp.y);
    if (dist <= fp.r) return focus;
    return null;
  }

  /** Quick tap: only a labeled node (or its labeled ancestor). Unlabeled specs need scrub. */
  function labeledTarget(d) {
    if (!d || !focus) return null;
    if (d === focus) return focus;
    let cur = d;
    while (cur && cur !== focus) {
      if (isLabeled(cur)) return cur;
      cur = cur.parent;
    }
    return null;
  }

  /** Ancestor that is a direct child of focus — first click expands the door, not a nested dept. */
  function focusChildTarget(d) {
    if (!d || !focus) return null;
    if (d === focus) return focus;
    let cur = d;
    while (cur && cur.parent !== focus) cur = cur.parent;
    return cur && cur.parent === focus ? cur : null;
  }

  function hideTip() {
    if (tipEl) tipEl.hidden = true;
  }

  function showTip(data, clientX, clientY, footer, fromTouch) {
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

  function isGhostMouse(event) {
    return (
      (event.pointerType || "mouse") === "mouse" &&
      performance.now() < suppressMouseUntil
    );
  }

  function activate(d) {
    if (!d || transitioning) return;
    hideTip();
    armedId = null;
    scrubId = null;
    if (d === focus) {
      if (focus.parent) goUp();
      else {
        selectedId = d.data.id;
        onSelect?.(d.data, d, { revealRoot: true });
        paintStyles();
      }
      return;
    }
    selectedId = d.data.id;
    onSelect?.(d.data, d);
    if (d.children) zoomToNode(d);
    else paintStyles();
  }

  function previewUnderFinger(clientX, clientY) {
    const node = smallestAt(clientX, clientY);
    // Halo only while scrubbing — restyling the outer disk every move flashes it black.
    scrubId = node && node !== focus ? node.data.id : null;
    placeHalo();
    if (node) {
      showTip(node.data, clientX, clientY, "Slide · lift to arm", true);
      return node;
    }
    hideTip();
    return null;
  }

  function armNode(node, clientX, clientY) {
    if (!node) {
      scrubId = null;
      paintStyles();
      hideTip();
      return;
    }
    scrubId = null;
    armedId = node.data.id;
    selectedId = armedId;
    hapticPulse();
    paintStyles();
    noteScrubSuccess();
    showTip(node.data, clientX, clientY, "Armed · tap for details", true);
  }

  function beginScrub() {
    if (!gesture) return;
    gesture.scrubbing = true;
    hapticPulse();
    el.classList.add("is-scrubbing");
    previewUnderFinger(gesture.x, gesture.y);
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    if (isGhostMouse(event)) return;
    if (transitioning) return;
    clearLongTimer();
    gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      scrubbing: false,
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
    } else {
      const node = smallestAt(event.clientX, event.clientY);
      if (node) showTip(node.data, event.clientX, event.clientY, "Click for details", false);
    }
  }

  function onPointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) {
      if (event.pointerType === "touch") return;
      if (gesture?.scrubbing) return;
      const node = smallestAt(event.clientX, event.clientY);
      if (node && !armedId) {
        showTip(node.data, event.clientX, event.clientY, "Click for details", false);
      } else if (!armedId) hideTip();
      return;
    }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    const dist = Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY);

    if (gesture.scrubbing) {
      previewUnderFinger(gesture.x, gesture.y);
      event.preventDefault();
      return;
    }

    if (gesture.pointerType === "touch" || gesture.pointerType === "pen") {
      if (dist > SLOP) {
        gesture.moved = true;
        clearLongTimer();
      }
    }
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

    const touch = g0.pointerType === "touch" || g0.pointerType === "pen";
    if (touch) suppressMouseUntil = performance.now() + 700;

    if (g0.scrubbing) {
      const node = smallestAt(g0.x, g0.y) || (scrubId && byId.get(scrubId)) || null;
      armNode(node, g0.x, g0.y);
      return;
    }

    if (g0.moved) return;
    if (transitioning) return;

    if (armedId && touch) {
      const armed = byId.get(armedId);
      armedId = null;
      scrubId = null;
      if (armed) activate(armed);
      return;
    }

    const smallest = smallestAt(g0.x, g0.y);
    // Only activate a direct child of the current focus (or go up). Nested
    // hits under Executive / Legislative / Judicial / Agencies expand the
    // door first — same on Mac, phone, and pad.
    const target = focusChildTarget(smallest);
    if (touch) {
      const labeled = labeledTarget(smallest);
      if (labeled) activate(labeled);
      else if (target && target !== focus) activate(target);
      else if (!smallest && focus?.parent) goUp();
      else hideTip();
      return;
    }

    if (target && target !== focus) activate(target);
    else if (target === focus && focus?.parent) goUp();
    else if (!smallest && focus?.parent) goUp();
    else hideTip();
  }

  svg
    .on("pointerdown", onPointerDown)
    .on("pointermove", onPointerMove)
    .on("pointerup", onPointerUp)
    .on("pointercancel", onPointerUp)
    .on("contextmenu", (event) => event.preventDefault());

  function bindVisible() {
    const nodes = visibleNodes();

    nodeSel = nodeG
      .selectAll("circle")
      .data(nodes, (d) => d.data.id)
      .join((enter) => enter.append("circle").attr("class", "map-node"))
      .style("cursor", "pointer")
      .order();

    labelSel = labelG
      .selectAll("text")
      .data(
        nodes.filter((d) => d.parent === focus && packAbbrev(d)),
        (d) => d.data.id
      )
      .join("text")
      .attr("class", "map-label")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .text((d) => packAbbrev(d));

    paintStyles();
    renderFrame(view);
  }

  function zoomTo(v, target, animate = true) {
    const start = view.slice();
    focus = target;
    armedId = null;
    scrubId = null;
    hideTip();
    bindVisible();
    onFocusChange?.(focus);

    if (!animate) {
      view = v;
      renderFrame(view);
      return;
    }

    transitioning = true;
    const i = d3.interpolateZoom(start, v);
    svg
      .transition()
      .duration(380)
      .ease(d3.easeCubicOut)
      .tween("mapzoom", () => (t) => {
        view = i(t);
        renderFrame(view);
      })
      .on("end interrupt", () => {
        view = v;
        renderFrame(view);
        transitioning = false;
      });
  }

  function zoomToNode(d) {
    if (!d) return;
    zoomTo([d.x, d.y, Math.max(d.r * VIEW_PAD, 1)], d, true);
  }

  function layoutTree(data) {
    measure();
    byId.clear();
    treeData = data;
    const hierarchyRoot = d3
      .hierarchy(data)
      .sum((d) => leafLayoutWeight(d))
      .sort(hierarchySort);
    hierarchyRoot.each((d) => byId.set(d.data.id, d));
    const side = Math.min(width, height);
    packRoot = d3
      .pack()
      .size([side, side])
      .padding((d) => (d.depth < 2 ? 7 : 2.5))(hierarchyRoot);
  }

  function build(data) {
    layoutTree(data);
    focus = packRoot;
    view = [focus.x, focus.y, focus.r * VIEW_PAD];

    if (!el.contains(svg.node())) {
      el.replaceChildren();
      el.appendChild(svg.node());
    }

    bindVisible();
    onFocusChange?.(focus);
  }

  function zoomToId(id) {
    const d = byId.get(id);
    if (!d) return null;
    selectedId = id;
    onSelect?.(d.data, d);
    if (d.children) zoomToNode(d);
    else if (d.parent) zoomToNode(d.parent);
    else zoomToNode(d);
    return d;
  }

  function goUp() {
    if (!focus?.parent) return;
    const parent = focus.parent;
    selectedId = parent.data.id;
    zoomToNode(parent);
    onSelect?.(parent.data, parent);
  }

  function setSelected(id) {
    selectedId = id || null;
    paintStyles();
  }

  function pathToFocus() {
    return focus ? focus.ancestors().reverse() : [];
  }

  function resize() {
    if (!treeData) return;
    const rect = el.getBoundingClientRect();
    const w = Math.max(320, rect.width || el.clientWidth || 800);
    const h = Math.max(280, rect.height || el.clientHeight || 600);
    if (Math.abs(w - width) < 1 && Math.abs(h - height) < 1) return;
    const id = focus?.data?.id;
    const sel = selectedId;
    layoutTree(treeData);
    focus = (id && byId.get(id)) || packRoot;
    view = [focus.x, focus.y, Math.max(focus.r * VIEW_PAD, 1)];
    selectedId = sel;
    bindVisible();
    onFocusChange?.(focus);
  }

  function destroy() {
    clearLongTimer();
    hideTip();
    el.classList.remove("is-scrubbing");
    svg.interrupt();
    svg
      .on("pointerdown", null)
      .on("pointermove", null)
      .on("pointerup", null)
      .on("pointercancel", null)
      .on("contextmenu", null);
    svg.remove();
    el.replaceChildren();
  }

  return {
    build,
    zoomToId,
    goUp,
    setSelected,
    pathToFocus,
    resize,
    destroy,
    getFocus: () => focus,
  };
}
