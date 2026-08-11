/**
 * Constitution Sankey — stage 0–1 locked:
 *   thick gray Constitution bar → thin black lines →
 *   4 equal segments (Legislative · Executive · Judicial · Independent)
 * Deeper nodes: fine lines + dots. Hover for labels.
 */
import * as d3 from "./vendor/d3.js";
import { sankey as d3Sankey, sankeyLeft } from "./vendor/d3-sankey.js";

const TREE_URL = "./data/nested/gov-tree-product.json";
const CONST_ID = "constitution";

/** Constitutional order for the three branches; Independent last. */
const DOOR_ORDER = ["Legislative", "Executive", "Judicial", "Independent"];

const BRANCH_COLOR = {
  Legislative: "#4a5f73",
  Executive: "#8f5a52",
  Judicial: "#5a6e62",
  Independent: "#d4b45c",
  default: "#6a737a",
};

const metaEl = document.getElementById("meta");
const tipEl = document.getElementById("tip");
const stage = document.getElementById("stage");
const canvas = document.createElement("canvas");
stage.append(canvas);
const ctx = canvas.getContext("2d", { alpha: false });

let layoutNodes = [];
let stage1Meta = []; // { branch, door, x, y0, y1, midY }
let constGeom = null; // { x, y0, y1 }
let hoverId = null;
let cssSize = { w: 0, h: 0, dpr: 1 };
let graphRef = null;
let doorByBranch = null;

const centerLink = d3
  .linkHorizontal()
  .source((d) => [d.source.x1, d.y0 + d.width / 2])
  .target((d) => [d.target.x0, d.y1 + d.width / 2]);

function leafCount(node) {
  if (!node.children?.length) return 1;
  let n = 0;
  for (const c of node.children) n += leafCount(c);
  return n;
}

function branchKey(door) {
  if (door.short && BRANCH_COLOR[door.short]) return door.short;
  if (door.short === "Agencies") return "Independent";
  if (/Legislative/i.test(door.name)) return "Legislative";
  if (/Executive/i.test(door.name)) return "Executive";
  if (/Judicial/i.test(door.name)) return "Judicial";
  if (/Independent/i.test(door.name)) return "Independent";
  return "default";
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
    // Equal weight Constitution → door (visual equal segments handled in paint)
    links.push({
      source: CONST_ID,
      target: door.id,
      value: 1,
      branch: b,
    });
  }

  return { nodes, links, doors };
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

function paint(graph, cssW, cssH, dpr) {
  const width = cssW;
  const height = cssH;
  const padY = 28;
  const constW = 20;
  const blackW = 2.5;
  const doorW = 10;
  const constX = 28;
  // Three verticals flush: gray | black | 4-seg (centers so edges touch)
  const blackX = constX + constW / 2 + blackW / 2;
  const doorX = blackX + blackW / 2 + doorW / 2;
  const deepLeft = doorX + 90;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#e6e8eb";
  ctx.fillRect(0, 0, width, height);

  // --- Stage 0: Constitution (thick gray) ---
  const cy0 = padY;
  const cy1 = height - padY;
  constGeom = { x: constX, y0: cy0, y1: cy1 };
  ctx.strokeStyle = "#8a9399";
  ctx.lineWidth = constW;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(constX, cy0);
  ctx.lineTo(constX, cy1);
  ctx.stroke();

  // Thin black vertical — flush against Constitution
  ctx.strokeStyle = "#2a3035";
  ctx.lineWidth = blackW;
  ctx.beginPath();
  ctx.moveTo(blackX, cy0);
  ctx.lineTo(blackX, cy1);
  ctx.stroke();

  // --- Stage 1: 4 equal segments (constitutional order), flush against black ---
  const span = cy1 - cy0;
  const segH = span / 4;
  stage1Meta = [];
  DOOR_ORDER.forEach((branch, i) => {
    const y0 = cy0 + i * segH;
    const y1 = cy0 + (i + 1) * segH;
    const midY = (y0 + y1) / 2;
    const door = graph.doors[branch];
    stage1Meta.push({ branch, door, x: doorX, y0, y1, midY });

    ctx.strokeStyle = colorFor(branch);
    ctx.lineWidth = doorW;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(doorX, y0);
    ctx.lineTo(doorX, y1);
    ctx.stroke();

    ctx.font = "600 13px 'IBM Plex Sans', system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#2a3035";
    ctx.fillText(branch, doorX + doorW / 2 + 8, midY);
  });

  // Constitution label — black, nested inside the gray bar
  ctx.save();
  ctx.translate(constX, (cy0 + cy1) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "400 0.78rem 'IBM Plex Sans', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#2a3035";
  ctx.fillText("The Constitution", 0, 0);
  ctx.restore();

  // --- Deeper hierarchy: sankey to the right of stage 1 ---
  // Exclude Constitution; keep doors + descendants. Re-root links from doors.
  const deepNodes = graph.nodes.filter((n) => n.id !== CONST_ID);
  const deepLinks = graph.links.filter((l) => l.source !== CONST_ID);

  const layout = d3Sankey()
    .nodeId((d) => d.id)
    .nodeWidth(1)
    .nodePadding(0.7)
    .nodeAlign(sankeyLeft)
    .extent([
      [deepLeft, padY],
      [width - 16, height - padY],
    ])
    .iterations(40);

  const { nodes, links } = layout({
    nodes: deepNodes.map((d) => ({ ...d })),
    links: deepLinks.map((d) => ({ ...d })),
  });

  // Snap each door node’s vertical band toward its equal segment (visual continuity)
  const doorIdToSeg = new Map();
  for (const s of stage1Meta) {
    if (s.door) doorIdToSeg.set(s.door.id, s);
  }
  for (const n of nodes) {
    const seg = doorIdToSeg.get(n.id);
    if (!seg) continue;
    // Keep layout x; override y to the equal segment
    n.y0 = seg.y0;
    n.y1 = seg.y1;
  }
  // After moving doors, d3 link geometry is stale for door→child — rebuild child links
  // from door segment midpoints manually for first hop; rest use sankey centers.

  layoutNodes = nodes;

  links.sort((a, b) => b.value - a.value);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const L of links) {
    const branch = L.branch || L.source.branch || L.target.branch;
    const col = colorFor(branch);
    const srcIsDoor = doorIdToSeg.has(L.source.id);
    let pathStr;
    if (srcIsDoor) {
      const seg = doorIdToSeg.get(L.source.id);
      const sy = seg.midY;
      const tx = L.target.x0;
      const ty = (L.target.y0 + L.target.y1) / 2;
      // line from segment into sankey region
      const mx = (doorX + deepLeft) / 2;
      pathStr = `M${doorX},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
    } else {
      pathStr = centerLink(L);
    }
    const active =
      hoverId && (L.source.id === hoverId || L.target.id === hoverId);
    ctx.strokeStyle = hexAlpha(col, active ? 0.95 : 0.4);
    ctx.lineWidth = active ? 1.5 : 0.6;
    ctx.stroke(new Path2D(pathStr));
  }

  // Deep fan-out uses colored fine lines only (no extra black horizontals)
  for (const n of nodes) {
    if (doorIdToSeg.has(n.id)) continue; // drawn as equal segments already
    const x = (n.x0 + n.x1) / 2;
    const y = (n.y0 + n.y1) / 2;
    const active = n.id === hoverId;
    ctx.beginPath();
    ctx.arc(x, y, active ? 3 : 1.15, 0, Math.PI * 2);
    ctx.fillStyle = colorFor(n.branch);
    ctx.fill();
    if (active) {
      ctx.strokeStyle = "#2a3035";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  return { nodes, links };
}

function hitTest(mx, my) {
  // Constitution bar
  if (constGeom && Math.abs(mx - constGeom.x) <= 12 && my >= constGeom.y0 && my <= constGeom.y1) {
    return {
      id: CONST_ID,
      name: "The Constitution",
      kind: "constitution",
      branch: null,
    };
  }

  // Equal door segments
  for (const s of stage1Meta) {
    if (Math.abs(mx - s.x) <= 12 && my >= s.y0 && my <= s.y1) {
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
    if (d <= 7 && d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

function showTip(node, clientX, clientY) {
  if (!node) {
    tipEl.hidden = true;
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
  `;
  tipEl.hidden = false;
  const pad = 14;
  let left = clientX + pad;
  let top = clientY + pad;
  tipEl.style.left = `0px`;
  tipEl.style.top = `0px`;
  const rect = tipEl.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - pad;
  if (top + rect.height > window.innerHeight - 8) top = clientY - rect.height - pad;
  tipEl.style.left = `${Math.max(8, left)}px`;
  tipEl.style.top = `${Math.max(8, top)}px`;
}

function redraw() {
  if (!graphRef) return;
  paint(graphRef, cssSize.w, cssSize.h, cssSize.dpr);
}

async function main() {
  metaEl.textContent = "Loading product tree…";
  const res = await fetch(TREE_URL);
  if (!res.ok) throw new Error(`Failed to load ${TREE_URL}`);
  const data = await res.json();
  graphRef = buildGraph(data.tree);
  doorByBranch = graphRef.doors;

  function render() {
    cssSize.w = Math.max(320, stage.clientWidth || window.innerWidth);
    cssSize.h = Math.max(320, stage.clientHeight || window.innerHeight);
    cssSize.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.floor(cssSize.w * cssSize.dpr);
    canvas.height = Math.floor(cssSize.h * cssSize.dpr);
    canvas.style.width = `${cssSize.w}px`;
    canvas.style.height = `${cssSize.h}px`;
    paint(graphRef, cssSize.w, cssSize.h, cssSize.dpr);
    metaEl.textContent = [
      "Leg · Exec · Jud · Ind",
      `${graphRef.nodes.length.toLocaleString()} nodes`,
      "hover for labels",
    ].join(" · ");
  }

  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * cssSize.w;
    const my = ((e.clientY - rect.top) / rect.height) * cssSize.h;
    const hit = hitTest(mx, my);
    const nextId = hit?.id || null;
    if (nextId !== hoverId) {
      hoverId = nextId;
      redraw();
    }
    showTip(hit, e.clientX, e.clientY);
    canvas.style.cursor = hit ? "pointer" : "default";
  });

  canvas.addEventListener("pointerleave", () => {
    if (hoverId) {
      hoverId = null;
      redraw();
    }
    showTip(null);
    canvas.style.cursor = "default";
  });

  render();
  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(render, 80);
  });
}

main().catch((err) => {
  console.error(err);
  metaEl.textContent = String(err.message || err);
});
