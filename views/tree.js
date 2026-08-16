/**
 * Org tree — HTML list under the current focus.
 * Opens at the constitutional branches; expand one level at a time.
 * (Production navigation model — heat marks layered on top.)
 */
import * as d3 from "../vendor/d3.js?v=2463";
import {
  displayName,
  paintFill,
  selectionFill,
  hierarchySort,
  leafLayoutWeight,
  nodeHasHeat,
  nodeHasHeatDeep,
  zoomJumpNode,
} from "../shared.js?v=2493";

export function createTreeView(container, { onSelect, onFocusChange }) {
  const el = typeof container === "string" ? document.querySelector(container) : container;
  let treeData = null;
  let fullRoot = null;
  let focus = null;
  let selectedId = null;
  const byId = new Map();
  const expanded = new Set();

  const wrap = document.createElement("div");
  wrap.className = "org-tree-wrap";
  const list = document.createElement("div");
  list.className = "org-tree";
  wrap.append(list);
  wrap.addEventListener("click", (e) => {
    if (e.target !== wrap && e.target !== list) return;
    if (focus?.parent) goUp();
  });

  function indexTree(node) {
    byId.set(node.data.id, node);
    for (const c of node.children || []) indexTree(c);
  }

  function ensureAncestorsExpanded(node) {
    let cur = node;
    while (cur) {
      expanded.add(cur.data.id);
      cur = cur.parent;
    }
  }

  /** Expand focus (and ancestors) so its children — the next tier — are listed. */
  function expandFocusLevel(node) {
    if (!node) return;
    ensureAncestorsExpanded(node);
    expanded.add(node.data.id);
  }

  function renderNode(node, into, depth) {
    const data = node.data;
    const hasKids = !!(node.children && node.children.length);
    const isOpen = expanded.has(data.id);
    const isFocus = focus && data.id === focus.data.id;
    const isSel = data.id === selectedId;

    const directHeat = nodeHasHeat(data);
    const deepHeat = !directHeat && nodeHasHeatDeep(data);

    const row = document.createElement("div");
    row.className =
      "org-row" +
      (isFocus ? " is-focus" : "") +
      (isSel ? " is-selected" : "") +
      (hasKids ? " has-kids" : "") +
      (directHeat ? " has-heat" : "") +
      (deepHeat ? " has-heat-deep" : "");
    row.style.paddingLeft = `${0.35 + depth * 0.85}rem`;
    row.dataset.id = data.id;

    const rest = paintFill(node);
    const selFill = selectionFill(node);
    row.setAttribute("data-fill-rest", rest);
    row.setAttribute("data-fill-sel", selFill);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "org-toggle";
    toggle.disabled = !hasKids;
    toggle.setAttribute("aria-label", isOpen ? "Collapse" : "Expand");
    toggle.textContent = hasKids ? (isOpen ? "▾" : "▸") : "·";
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!hasKids) return;
      if (expanded.has(data.id)) expanded.delete(data.id);
      else expanded.add(data.id);
      paint();
    });

    // Heat mark: direct heat, or heat deeper in this branch.
    const bracket = document.createElement("span");
    bracket.className = "org-heat-bracket";
    bracket.setAttribute("aria-hidden", "true");
    if (directHeat || deepHeat) bracket.style.background = rest;

    const swatch = document.createElement("span");
    swatch.className = "org-swatch";
    swatch.style.background = isSel ? selFill : rest;

    const label = document.createElement("button");
    label.type = "button";
    label.className = "org-label";
    label.textContent = displayName(node);
    label.title =
      isFocus && node.parent
        ? `${data.name} · tap to go up`
        : data.name;
    if (isFocus && node.parent) {
      label.setAttribute("aria-label", `${displayName(node)}, tap to go up`);
    }

    function activateRow(e) {
      if (toggle.contains(e.target)) return;
      e.stopPropagation();
      // Current top row = Circles outer ring: tap to go up. ▾ still expands.
      if (isFocus && node.parent) {
        goUp();
        return;
      }
      selectedId = data.id;
      onSelect?.(data, node, {
        revealRoot: node === fullRoot && node === focus,
      });
      if (hasKids && node !== focus) {
        focus = node;
        ensureAncestorsExpanded(focus);
        expandFocusLevel(focus);
        onFocusChange?.(focus);
      }
      paint();
    }
    label.addEventListener("click", activateRow);
    row.addEventListener("click", activateRow);

    const meta = document.createElement("span");
    meta.className = "org-meta";
    meta.textContent = hasKids ? `${node.children.length}` : "";

    row.append(toggle, bracket, swatch, label, meta);
    into.append(row);

    if (hasKids && isOpen) {
      const childBox = document.createElement("div");
      childBox.className = "org-children";
      for (const c of node.children) renderNode(c, childBox, depth + 1);
      into.append(childBox);
    }
  }

  function paint() {
    list.replaceChildren();
    if (!focus) return;
    // Show from focus downward. Tap the current top row to go up one level
    // (Circles outer ring). Breadcrumbs still skip. ▾ expands in place.
    ensureAncestorsExpanded(focus);
    renderNode(focus, list, 0);
  }

  function build(data) {
    treeData = data;
    byId.clear();
    expanded.clear();
    fullRoot = d3
      .hierarchy(data)
      .sum((d) => leafLayoutWeight(d))
      .sort(hierarchySort);
    indexTree(fullRoot);
    focus = fullRoot;
    selectedId = fullRoot.data.id;
    expandFocusLevel(focus);
    el.replaceChildren(wrap);
    paint();
    onFocusChange?.(focus);
  }

  function zoomToId(id) {
    const d = byId.get(id);
    if (!d) return null;
    selectedId = id;
    onSelect?.(d.data, d);
    focus = zoomJumpNode(d);
    ensureAncestorsExpanded(d);
    expandFocusLevel(focus);
    onFocusChange?.(focus);
    paint();
    const row = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return d;
  }

  function goUp() {
    if (!focus?.parent) return;
    focus = focus.parent;
    selectedId = null;
    onSelect?.(focus.data, focus);
    expandFocusLevel(focus);
    onFocusChange?.(focus);
    paint();
  }

  function setSelected(id) {
    selectedId = id || null;
    paint();
  }

  function pathToFocus() {
    return focus ? focus.ancestors().reverse() : [];
  }

  function resize() {
    if (treeData) paint();
  }

  function destroy() {
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
