/**
 * Citizen-facing enrichment context: own SAM/Manual first, then kind
 * templates, then nearest enriched ancestor (bleed — clearly attributed).
 */

export function indexById(root, map = new Map()) {
  if (!root) return map;
  map.set(root.id, root);
  for (const c of root.children || []) indexById(c, map);
  return map;
}

export function ancestorChain(node, byId) {
  const out = [];
  let cur = node;
  const seen = new Set();
  while (cur?.parentId && byId) {
    if (seen.has(cur.parentId)) break;
    seen.add(cur.parentId);
    const p = byId.get(cur.parentId);
    if (!p) break;
    out.push(p);
    cur = p;
  }
  return out;
}

function displayLabel(n) {
  return n.short || n.name || "parent agency";
}

/** Families Crosswalk has but Manual rarely covers. */
export function kindTemplate(node) {
  const name = node?.name || "";
  if (/Federal Executive Board|\(FEB\)/i.test(name)) {
    return {
      id: "feb",
      mission: [
        "Federal Executive Boards (FEBs) bring together the heads of federal field offices in major metro areas. They share information, run interagency training, and coordinate local federal responses under policy direction from the Office of Personnel Management (OPM).",
      ],
      web: "https://www.opm.gov/",
      webLabel: "OPM — Federal Executive Boards",
      webDetail: "FEBs are an OPM-coordinated network (not a standalone Cabinet agency)",
    };
  }
  if (/Offices of the Regional Administrators/i.test(name)) {
    return {
      id: "regional-admins",
      mission: [
        "Regional administrator offices carry an agency’s programs into the field — the local face of a national organization.",
      ],
    };
  }
  return null;
}

/**
 * @returns {{
 *   mission: string[] | null,
 *   missionNote: string | null,
 *   leadership: object[] | null,
 *   web: string | null,
 *   webDetail: string | null,
 *   phone: string | null,
 *   phoneDetail: string | null,
 *   template: object | null,
 *   ancestorUsgm: object | null,
 *   ancestorSam: object | null,
 * }}
 */
export function enrichmentContext(node, byId) {
  const ownUsgm = node?.sources?.usgm || null;
  const ownSam = node?.sources?.sam || null;
  const ancestors = ancestorChain(node, byId);
  const usgmAnc = ownUsgm ? null : ancestors.find((a) => a.sources?.usgm);
  const samAnc = ownSam ? null : ancestors.find((a) => a.sources?.sam);
  const template = kindTemplate(node);

  let mission = null;
  let missionNote = null;
  if (ownUsgm?.mission?.length) {
    mission = ownUsgm.mission;
  } else if (template?.mission?.length) {
    mission = template.mission;
    missionNote = "Context for this type of organization";
  } else if (usgmAnc?.sources?.usgm?.mission?.length) {
    const parentName = displayLabel(usgmAnc);
    mission = usgmAnc.sources.usgm.mission.slice(0, 2);
    missionNote = `From parent agency (${parentName}) — this office has no separate Manual entry`;
  }

  // Live overlay (refreshed .gov pages) beats the annual Manual.
  // Never bleed leadership from a parent — wrong people on the wrong org.
  const liveLeaders = node?.sources?.leadership?.people?.length
    ? node.sources.leadership.people
    : null;
  const leadership = liveLeaders || (ownUsgm?.leadership?.length ? ownUsgm.leadership : null);
  const leadershipMeta =
    node?.sources?.leadership ||
    (ownUsgm?.leadership?.length
      ? {
          asOf: ownUsgm.edition || null,
          sourceName: "U.S. Government Manual (may be out of date)",
          sourceUrl: ownUsgm.govinfoUrl || null,
        }
      : null);

  let web = null;
  let webDetail = null;
  if (ownUsgm?.web && /^https?:\/\//i.test(ownUsgm.web)) {
    web = ownUsgm.web;
    webDetail = "Agency site from the U.S. Government Manual";
  } else if (template?.web) {
    web = template.web;
    webDetail = template.webDetail || "Official .gov overview for this organization type";
  } else if (usgmAnc?.sources?.usgm?.web && /^https?:\/\//i.test(usgmAnc.sources.usgm.web)) {
    web = usgmAnc.sources.usgm.web;
    webDetail = `Parent agency site (${displayLabel(usgmAnc)})`;
  }

  let phone = null;
  let phoneDetail = null;
  if (ownUsgm?.phone && /\d/.test(ownUsgm.phone)) {
    phone = ownUsgm.phone.replace(/\s+/g, " ").trim();
    phoneDetail = "Public number listed in the Government Manual";
  } else if (usgmAnc?.sources?.usgm?.phone && /\d/.test(usgmAnc.sources.usgm.phone)) {
    phone = usgmAnc.sources.usgm.phone.replace(/\s+/g, " ").trim();
    phoneDetail = `Parent agency switchboard (${displayLabel(usgmAnc)})`;
  }

  return {
    mission,
    missionNote,
    leadership,
    leadershipMeta,
    web,
    webDetail,
    phone,
    phoneDetail,
    template,
    ancestorUsgm: usgmAnc || null,
    ancestorSam: samAnc || null,
    ownUsgm,
    ownSam,
  };
}
