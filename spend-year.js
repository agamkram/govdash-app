/**
 * FY scrub: overlay USAspending dollars onto the shipped tree without
 * changing structure (edges, mission, OPM). Honest blanks when a year
 * has no match.
 */

function walk(node, out = []) {
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

function cloneSpending(s) {
  if (!s) return null;
  return { ...s };
}

function rollUp(node) {
  for (const c of node.children || []) rollUp(c);
  if (node.spending && !node.spending.rolledUp) {
    return {
      obligated: node.spending.obligatedAmount,
      outlay: node.spending.outlayAmount,
      asOf: node.spending.asOf,
    };
  }

  let obligated = 0;
  let outlay = 0;
  let anyO = false;
  let anyU = false;
  let missingU = false;
  let asOf = null;
  for (const c of node.children || []) {
    if (c.spending?.obligatedAmount == null && c.spending?.outlayAmount == null) {
      continue;
    }
    if (c.spending.obligatedAmount != null) {
      anyO = true;
      obligated += c.spending.obligatedAmount;
    }
    if (c.spending.outlayAmount != null) {
      anyU = true;
      outlay += c.spending.outlayAmount;
    } else {
      missingU = true;
    }
    asOf = asOf || c.spending.asOf;
  }
  if (!anyO && !anyU) {
    if (node.spending?.rolledUp) delete node.spending;
    return null;
  }

  node.spending = {
    obligatedAmount: anyO ? obligated : null,
    /* Partial outlay next to full obligated would lie — blank if any child lacks it. */
    outlayAmount: anyU && !missingU ? outlay : null,
    budgetAuthorityAmount: null,
    fiscalYear: null,
    fiscalQuarter: null,
    asOf,
    source: "USAspending.gov (rolled up)",
    grain: "rollup",
    agencyName: null,
    agencySlug: null,
    toptierCode: null,
    abbreviation: null,
    matchedHow: "sum-children",
    rolledUp: true,
  };
  return {
    obligated: anyO ? obligated : null,
    outlay: anyU && !missingU ? outlay : null,
    asOf,
  };
}

/**
 * @param {object} root — merged map root (mutated in place for spending only)
 */
export function createSpendYearController(root) {
  const base = new Map();
  for (const n of walk(root)) {
    base.set(n.id, cloneSpending(n.spending));
  }

  let pack = null;
  let year = null;

  function years() {
    return pack?.meta?.years ? [...pack.meta.years] : [];
  }

  function defaultYear() {
    return pack?.meta?.defaultYear ?? null;
  }

  function currentYear() {
    return year;
  }

  /** FY2026 → FY26, FY2026 Q3 → FY26 Q3 */
  function shortAsOf(label, y) {
    if (label != null && label !== "") {
      return String(label).replace(/FY(\d{4})\b/g, (_, full) => `FY${full.slice(-2)}`);
    }
    const n = Number(y);
    if (!Number.isFinite(n)) return null;
    return `FY${String(n).slice(-2)}`;
  }

  function asOfFor(y) {
    const raw = pack?.meta?.asOf?.[y] ?? pack?.meta?.asOf?.[String(y)] ?? null;
    return shortAsOf(raw, y);
  }

  function restoreBase() {
    for (const n of walk(root)) {
      const s = base.get(n.id);
      if (s) n.spending = cloneSpending(s);
      else delete n.spending;
    }
  }

  function apply(y) {
    const fy = Number(y);
    if (!pack || !Number.isFinite(fy)) {
      restoreBase();
      year = null;
      return { year: null, direct: 0 };
    }

    year = fy;
    const asOf = asOfFor(fy);
    const nodes = pack.nodes || {};
    let direct = 0;
    const byId = new Map();
    for (const n of walk(root)) {
      delete n.spending;
      byId.set(n.id, n);
    }

    for (const [id, entry] of Object.entries(nodes)) {
      const cell = entry.y?.[fy] ?? entry.y?.[String(fy)];
      if (!cell || (cell.o == null && cell.u == null)) continue;
      const n = byId.get(id);
      if (!n) continue;
      n.spending = {
        obligatedAmount: cell.o ?? null,
        outlayAmount: cell.u ?? null,
        budgetAuthorityAmount: null,
        fiscalYear: fy,
        fiscalQuarter: null,
        asOf,
        source:
          entry.grain === "subtier"
            ? "USAspending.gov (sub-agency)"
            : "USAspending.gov (toptier agencies)",
        grain: entry.grain,
        agencyName: entry.agencyName || null,
        agencySlug: entry.agencySlug || null,
        toptierCode: entry.toptierCode || null,
        abbreviation: entry.abbreviation || null,
        matchedHow: entry.matchedHow || "year-overlay",
        rolledUp: false,
      };
      direct++;
    }

    rollUp(root);
    return { year: fy, direct, asOf };
  }

  function load(payload) {
    pack = payload;
    const y = defaultYear();
    if (y != null) apply(y);
    else {
      restoreBase();
      year = null;
    }
    return {
      years: years(),
      defaultYear: y,
      currentYear: year,
    };
  }

  function hasPack() {
    return !!pack?.nodes && Object.keys(pack.nodes).length > 0;
  }

  function hasNode(id) {
    return !!(id && pack?.nodes && pack.nodes[id]);
  }

  return {
    load,
    apply,
    years,
    defaultYear,
    currentYear,
    asOfFor,
    hasPack,
    hasNode,
    restoreBase,
  };
}
