/**
 * Honest USAspending ↔ tree matching.
 *
 * No substring bonus (VA ⊂ PRIVATE). Exact short === abbreviation is not
 * enough (NRC NeighborWorks ≠ Nuclear Regulatory Commission). Prefer a
 * blank over a Cabinet glued to an IGO.
 */

export function norm(s) {
  let t = String(s || "").toUpperCase();
  t = t.replace(
    /^(.+?),\s*(DEPARTMENT|DEPT|AGENCY)\s+OF\s*$/i,
    (_, name, kind) => `${kind} OF ${name}`
  );
  return t
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bU\.?S\.?\b/g, " ")
    .replace(/\bUNITED STATES\b/g, " ")
    .replace(/\bDEPARTMENT OF THE\b/g, " DEPT ")
    .replace(/\bDEPARTMENT OF\b/g, " DEPT ")
    .replace(/\bDEPT(?:ARTMENT)? OF THE\b/g, " DEPT ")
    .replace(/\bDEPT(?:ARTMENT)? OF\b/g, " DEPT ")
    .replace(/\bNATIONAL AERONAUTICS AND SPACE ADMINISTRATION\b/g, " NASA ")
    .replace(/\bENVIRONMENTAL PROTECTION AGENCY\b/g, " EPA ")
    .replace(/\bSOCIAL SECURITY ADMINISTRATION\b/g, " SSA ")
    .replace(/\bGENERAL SERVICES ADMINISTRATION\b/g, " GSA ")
    .replace(/\bTHE\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "OF",
  "AND",
  "FOR",
  "THE",
  "DEPT",
  "DEPARTMENT",
  "AGENCY",
  "OFFICE",
  "BUREAU",
  "US",
]);

export function tokens(s) {
  return new Set(
    norm(s)
      .split(" ")
      .filter((t) => t.length > 1 && !STOP.has(t))
  );
}

export function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function tokenOverlap(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  let n = 0;
  let longHit = false;
  for (const t of A) {
    if (!B.has(t)) continue;
    n++;
    if (t.length >= 6) longHit = true;
  }
  return { n, longHit };
}

function isDepartmentish(agency) {
  const name = String(agency?.agency_name || agency?.name || "");
  return /\bDepartment of\b/i.test(name) || /\bDEPT\b/.test(norm(name));
}

export function kindAllows(agency, node) {
  const kind = node?.kind;
  if (kind === "igo" && isDepartmentish(agency)) return false;
  if (
    (kind === "nonprofit" || kind === "gse" || kind === "carrier") &&
    isDepartmentish(agency) &&
    jaccard(agency.agency_name || agency.name, node.name) < 0.85
  ) {
    return false;
  }
  return true;
}

export function scoreNode(n) {
  let s = 0;
  if (n.kind === "department") s += 50;
  if (n.kind === "independent") s += 40;
  if (n.kind === "agency") s += 30;
  if (n.kind === "branch") s += 10;
  if (n.kind === "bureau") s += 15;
  if (n.short) s += 5;
  return s;
}

function namesOf(agency) {
  return [agency.agency_name || agency.name, agency.abbreviation]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
}

/**
 * @param {object} agency  { agency_name|name, abbreviation, agency_slug? }
 * @param {object[]} nodes
 * @param {{ usedNodeIds?: Set, usedSlugs?: Set, minJ?: number }} [opts]
 */
export function bestMatch(agency, nodes, opts = {}) {
  const usedNodeIds = opts.usedNodeIds || new Set();
  const usedSlugs = opts.usedSlugs || new Set();
  const minJ = opts.minJ ?? 0.78;
  const slug = (agency.agency_slug || "").toLowerCase();
  if (slug && usedSlugs.has(slug)) return null;

  const labels = namesOf(agency);
  const fullName = agency.agency_name || agency.name || "";

  const free = nodes.filter(
    (n) => n && n.id && !usedNodeIds.has(n.id) && kindAllows(agency, n)
  );

  // 1. Exact normalized full name (never abbreviation-only).
  const exactName = free.filter((n) =>
    labels.some(
      (label) => label.length > 4 && norm(n.name) === norm(label)
    )
  );
  if (exactName.length) {
    exactName.sort((a, b) => scoreNode(b) - scoreNode(a));
    return { node: exactName[0], how: "name", j: 1 };
  }

  // 2. Exact short === abbreviation only if the long names also overlap.
  const abbr = agency.abbreviation;
  if (abbr && String(abbr).length >= 2) {
    const shortHits = free.filter((n) => n.short && norm(n.short) === norm(abbr));
    const sane = shortHits.filter((n) => {
      const { n: overlap, longHit } = tokenOverlap(fullName, n.name);
      return overlap >= 2 || longHit || jaccard(fullName, n.name) >= 0.45;
    });
    if (sane.length) {
      sane.sort((a, b) => scoreNode(b) - scoreNode(a));
      return { node: sane[0], how: "name", j: 1 };
    }
  }

  // 3. Token Jaccard on the long name only — no substring bonus.
  const scored = free
    .map((n) => {
      const j = jaccard(fullName, n.name);
      const { n: overlap, longHit } = tokenOverlap(fullName, n.name);
      const ok = j >= minJ && (overlap >= 2 || longHit);
      return { n, j, ok };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.j - a.j || scoreNode(b.n) - scoreNode(a.n));

  if (!scored.length) return null;
  return {
    node: scored[0].n,
    how: scored[0].j >= 0.99 ? "name" : `jaccard-${scored[0].j.toFixed(2)}`,
    j: scored[0].j,
  };
}
