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

/** Constitutional door colors (Sankey + any branch chrome). */
export const BRANCH_COLOR = {
  Legislative: "#4a5f73",
  Executive: "#8f5a52",
  Judicial: "#5a6e62",
  Independent: "#d4b45c",
  Chartered: "#7a6e72",
  International: "#4d6b7a",
  default: "#6a737a",
};

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

export const CONSTITUTION_FILL = "#8a9399";
export const INK = "#2a3035";
export const MAP_FIELD = "#c8cbd0";

/** Stamp each data node with its constitutional door (Legislative / Executive / …). */
export function stampDoorColors(root) {
  function walk(node, door) {
    if (!node) return;
    const here = branchOrderKey(node) || door || null;
    if (here) node.door = here;
    for (const c of node.children || []) walk(c, here);
  }
  walk(root, null);
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

export function paintFill(nodeOrData) {
  const base = kindFill(nodeOrData);
  const depth = nodeOrData?.depth;
  if (!(depth > 1)) return base;
  const t = Math.min(0.48, (depth - 1) * 0.16);
  return mixHex(base, MAP_FIELD, t);
}

/** Clicked-org fill — deepen the segment color (no outline box). */
export function selectionFill(nodeOrData) {
  return mixHex(paintFill(nodeOrData), "#2a3035", 0.42);
}

export function cellFill(nodeOrData, selected) {
  return selected ? selectionFill(nodeOrData) : paintFill(nodeOrData);
}

function mixHex(a, b, t) {
  const pa = hexRgb(a);
  const pb = hexRgb(b);
  if (!pa || !pb) return a;
  const m = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

function hexRgb(hex) {
  const h = String(hex).replace("#", "");
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function formatMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${Math.round(n).toLocaleString()}`;
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
    door: node.door,
    children: kids,
  };
}
