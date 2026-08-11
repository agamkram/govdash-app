/**
 * Map-friendly short labels from GSA SFP names.
 *
 * Prefer distinctive office acronyms in the name. Drop Treasury agency tags
 * that make siblings look identical (GSA/GSA/GSA, NASA/NASA, JUDICIARY/…).
 */

export function allAcronyms(name) {
  const s = String(name || "");
  const out = [];
  // Nested wrappers like (PDUSD(AT&L)) — keep the outer office code too.
  for (const m of s.matchAll(
    /\(([A-Z][A-Z0-9]{1,11})\(([A-Z0-9&/.+-]{1,16})\)\)/g
  )) {
    out.push(m[1], m[2]);
  }
  for (const m of s.matchAll(/\(([A-Z0-9][A-Z0-9&/.+-]{0,20})\)/g)) {
    out.push(m[1]);
  }
  return [...new Set(out)].filter((a) => a.length >= 2 && a.length <= 16);
}

export function acronymFromName(name) {
  return allAcronyms(name)[0] || null;
}

function pickDistinctAcronym(name, ancestorShorts) {
  const blocked = new Set(ancestorShorts.filter(Boolean));
  for (const a of allAcronyms(name)) {
    if (!blocked.has(a)) return a;
  }
  return null;
}

function isAgencyLevelKind(kind) {
  return (
    kind === "agency" ||
    kind === "independent" ||
    kind === "department" ||
    kind === "branch" ||
    kind === "sovereign"
  );
}

function nameGroundsShort(name, short) {
  if (!short) return false;
  if (allAcronyms(name).includes(short)) return true;
  // e.g. name ends with "(USDA)" already covered; also "Agency (NASA)" style
  return name.includes(`(${short})`);
}

/**
 * Mutates tree in place. Call after hierarchy is linked (and after curation
 * reshapes), then re-apply any synthetic door shorts you need.
 */
export function refineShorts(node, ancestorShorts = []) {
  if (!node) return;

  const fromName = pickDistinctAcronym(node.name, ancestorShorts);
  if (fromName) {
    node.short = fromName;
  } else if (node.short && ancestorShorts.includes(node.short)) {
    node.short = null;
  } else if (
    node.short &&
    !nameGroundsShort(node.name, node.short) &&
    !isAgencyLevelKind(node.kind)
  ) {
    // Ungrounded bureau/office short is almost always the parent agency's
    // Treasury tag (AGRICULTURE, JUSTICE, JUDICIARY, …).
    node.short = null;
  }

  const nextAncestors = node.short
    ? [...ancestorShorts, node.short]
    : ancestorShorts;

  const kids = node.children || [];
  for (const c of kids) refineShorts(c, nextAncestors);

  // Sibling collisions: identical short ⇒ map can't tell them apart.
  const byShort = new Map();
  for (const c of kids) {
    if (!c.short) continue;
    if (!byShort.has(c.short)) byShort.set(c.short, []);
    byShort.get(c.short).push(c);
  }
  for (const group of byShort.values()) {
    if (group.length < 2) continue;
    for (const c of group) c.short = null;
  }
}

/** Initial short at row→node time (before parent links exist). */
export function shortNameFromRow(row) {
  const name = row["GSA SFP Name"];
  const fromName = acronymFromName(name);
  if (fromName) return fromName;

  const treasury = (row["Treasury Agency Short Name"] || "").trim();
  if (!treasury) return null;
  const entity = row["GSA SFP Entity Type"] || "";
  if (entity === "Agency" || entity === "Ind Agency") return treasury;
  return null;
}
