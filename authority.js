/**
 * One-line authority for the detail pane.
 * Kind + nest from the tree (honest). Statute only from the table (by id).
 * Blank cite beats a guess. Enrich — same word as SAM / Manual / spending.
 */

/** Organic / organic-ish cites. Keyed by GSA / product id only. */
export const AUTHORITY_CITES = {
  usa: { paper: "U.S. Constitution (1788)", nest: null, role: "Supreme law" },
  "gsa-1": { paper: "U.S. Constitution, Article I", role: "Legislative branch" },
  "gsa-41": { paper: "U.S. Constitution, Article II", role: "Executive branch" },
  "gsa-23": { paper: "U.S. Constitution, Article III", role: "Judicial branch" },
  "gsa-3": { paper: "U.S. Constitution, Article I, § 3", role: "Senate" },
  "gsa-4": { paper: "U.S. Constitution, Article I, § 2", role: "House of Representatives" },

  "gsa-728": { paper: "Act of July 27, 1789 · 22 U.S.C. § 2651", role: "Cabinet department", nest: "under the President" },
  "gsa-831": { paper: "Act of Sept. 2, 1789 · 31 U.S.C. § 301", role: "Cabinet department", nest: "under the President" },
  "gsa-162": { paper: "National Security Act of 1947 · 10 U.S.C. § 111", role: "Cabinet department", nest: "under the President" },
  "gsa-653": { paper: "Act of June 22, 1870 · 28 U.S.C. § 501", role: "Cabinet department", nest: "under the President" },
  "gsa-618": { paper: "Act of Mar. 3, 1849 · 43 U.S.C. § 1451", role: "Cabinet department", nest: "under the President" },
  "gsa-62": { paper: "Act of May 15, 1862 · 7 U.S.C. § 2201", role: "Cabinet department", nest: "under the President" },
  "gsa-120": { paper: "Act of Feb. 14, 1903 · 15 U.S.C. § 1501", role: "Cabinet department", nest: "under the President" },
  "gsa-696": { paper: "Act of Mar. 4, 1913 · 29 U.S.C. § 551", role: "Cabinet department", nest: "under the President" },
  "gsa-531": { paper: "Department of Education Organization Act of 1979 · 42 U.S.C. § 3501", role: "Cabinet department", nest: "under the President" },
  "gsa-579": { paper: "HUD Act of 1965 · 42 U.S.C. § 3532", role: "Cabinet department", nest: "under the President" },
  "gsa-798": { paper: "Department of Transportation Act of 1966 · 49 U.S.C. § 102", role: "Cabinet department", nest: "under the President" },
  "gsa-448": { paper: "Department of Energy Organization Act of 1977 · 42 U.S.C. § 7131", role: "Cabinet department", nest: "under the President" },
  "gsa-397": { paper: "Department of Education Organization Act of 1979 · 20 U.S.C. § 3411", role: "Cabinet department", nest: "under the President" },
  "gsa-848": { paper: "Department of Veterans Affairs Act of 1988 · 38 U.S.C. § 301", role: "Cabinet department", nest: "under the President" },
  "gsa-561": { paper: "Homeland Security Act of 2002 · 6 U.S.C. § 111", role: "Cabinet department", nest: "under the President" },
  "gsa-295": { paper: "10 U.S.C. § 7011", role: "Military department", nest: "under DOD" },
  "gsa-366": { paper: "10 U.S.C. § 8011", role: "Military department", nest: "under DOD" },
  "gsa-202": { paper: "10 U.S.C. § 9011", role: "Military department", nest: "under DOD" },

  "gsa-1018": { paper: "National Aeronautics and Space Act of 1958 · 51 U.S.C. § 20111" },
  "gsa-1052": { paper: "National Science Foundation Act of 1950 · 42 U.S.C. § 1861" },
  "gsa-930": { paper: "Reorganization Plan No. 3 of 1970" },
  "gsa-985": { paper: "Federal Property and Administrative Services Act of 1949 · 40 U.S.C. § 301" },
  "gsa-1061": { paper: "Civil Service Reform Act of 1978 · 5 U.S.C. § 1101" },
  "gsa-1100": { paper: "Small Business Act of 1953 · 15 U.S.C. § 633" },
  "gsa-1107": { paper: "Social Security Act · 42 U.S.C. § 901" },
  "gsa-1056": { paper: "Energy Reorganization Act of 1974 · 42 U.S.C. § 5841" },
  "gsa-911": { paper: "National Security Act of 1947 · 50 U.S.C. § 3035" },
  "gsa-686": { paper: "28 U.S.C. § 531", nest: "under DOJ" },
  "gsa-844": { paper: "26 U.S.C. § 7801", nest: "under Treasury" },
  "gsa-551": { paper: "21 U.S.C. § 393", nest: "under HHS" },
  "gsa-550": { paper: "Public Health Service Act", nest: "under HHS" },
  "gsa-557": { paper: "42 U.S.C. § 1317", nest: "under HHS" },
  "gsa-570": { paper: "Homeland Security Act · 6 U.S.C. § 211", nest: "under DHS" },
  "gsa-572": { paper: "Homeland Security Act · 6 U.S.C. § 313", nest: "under DHS" },
  "gsa-568": { paper: "Homeland Security Act · 6 U.S.C. § 251", nest: "under DHS" },
  "gsa-567": { paper: "18 U.S.C. § 3056", nest: "under DHS" },
  "gsa-566": { paper: "14 U.S.C. § 101", nest: "under DHS" },
  "gsa-564": { paper: "Homeland Security Act · 6 U.S.C. § 271", nest: "under DHS" },
  "gsa-180": { paper: "National Security Agency Act of 1959 · 50 U.S.C. § 3601" },
  "gsa-970": { paper: "Communications Act of 1934 · 47 U.S.C. § 151" },
  "gsa-984": { paper: "Federal Trade Commission Act of 1914 · 15 U.S.C. § 41" },
  "gsa-1097": { paper: "Securities Exchange Act of 1934 · 15 U.S.C. § 78d" },
  "gsa-1050": { paper: "National Labor Relations Act of 1935 · 29 U.S.C. § 153" },
  "gsa-960": { paper: "Civil Rights Act of 1964 · 42 U.S.C. § 2000e-4" },
  "gsa-1378": { paper: "Dodd-Frank Act of 2010 · 12 U.S.C. § 5491" },
  "gsa-981": { paper: "Federal Reserve Act of 1913 · 12 U.S.C. § 221" },
  "gsa-1130": { paper: "Postal Reorganization Act of 1970 · 39 U.S.C. § 201" },
  "gsa-1121": { paper: "Tennessee Valley Authority Act of 1933 · 16 U.S.C. § 831" },
  "gsa-971": { paper: "Federal Deposit Insurance Act · 12 U.S.C. § 1811" },

  "product-independent": {
    role: "Independent and regulatory agencies",
    paper: "Created by statute — not Cabinet",
  },
  "product-chartered": {
    role: "Federally chartered bodies",
    paper: "Not Cabinet or independent agencies",
  },
  "product-international": {
    role: "International organizations",
    nest: null,
    paper: "Tables the United States sits at — not U.S. agencies",
  },
};

const KIND_ROLE = {
  department: "Department",
  independent: "Independent agency",
  agency: "Agency",
  bureau: "Bureau",
  office: "Office",
  court: "Federal court",
  chamber: "Chamber of Congress",
  branch: "Branch",
  gse: "Government corporation",
  igo: "International organization",
  nonprofit: "Federally chartered body",
  carrier: "Carrier",
  military: "Military organization",
  command: "Command",
  bucket: "Grouping",
  sovereign: "United States Government",
  unknown: "Organization",
};

const DOOR_IN = {
  Legislative: "in the Legislative Branch",
  Executive: "in the Executive Branch",
  Judicial: "in the Judicial Branch",
  Independent: "among independent agencies",
  Chartered: "federally chartered — not Cabinet",
  International: "not a U.S. agency",
};

function parentOf(node, byId) {
  if (!node?.parentId || !byId) return null;
  return byId.get(node.parentId) || null;
}

function parentLabel(p) {
  if (!p) return null;
  if (p.id === "usa" || p.kind === "sovereign") return null;
  if (p.short === "Agencies" || p.id === "product-independent") {
    return "among independent agencies";
  }
  if (p.short && p.short.length <= 12) return `under ${p.short}`;
  const name = (p.name || "")
    .replace(/^US\s+/i, "")
    .replace(/^United States\s+/i, "")
    .replace(/^Federal\s+/i, "");
  if (name.length <= 36) return `under ${name}`;
  return `under ${name.slice(0, 32)}…`;
}

function roleOf(node, cite) {
  if (cite?.role) return cite.role;
  if (node.kind === "department" && node.door === "Executive") {
    if (/Army|Navy|Air Force/i.test(node.name || "") || /^(USN|USAF|USA)$/.test(node.short || "")) {
      return "Military department";
    }
    return "Cabinet department";
  }
  if (node.door === "International" || node.kind === "igo") {
    return "International organization";
  }
  if (node.door === "Chartered" || node.kind === "nonprofit" || node.kind === "gse") {
    return KIND_ROLE[node.kind] || "Federally chartered body";
  }
  return KIND_ROLE[node.kind] || KIND_ROLE.unknown;
}

function nestOf(node, cite, byId) {
  if (cite && Object.prototype.hasOwnProperty.call(cite, "nest")) return cite.nest;
  if (node.kind === "department" && node.door === "Executive") {
    if (/Army|Navy|Air Force/i.test(node.name || "") || /^(USN|USAF)$/.test(node.short || "")) {
      return "under DOD";
    }
    return "under the President";
  }
  if (node.door === "International" || node.kind === "igo") {
    return "table the United States sits at — not a U.S. agency";
  }
  const p = parentOf(node, byId);
  const fromParent = parentLabel(p);
  if (fromParent) return fromParent;
  if (node.door && DOOR_IN[node.door] && node.kind !== "branch") return DOOR_IN[node.door];
  return null;
}

/**
 * @returns {{ line: string, role: string, nest: string|null, paper: string|null, cited: boolean } | null}
 */
export function authorityLine(node, byId) {
  if (!node || node.id === "beyond") return null;
  const cite = AUTHORITY_CITES[node.id] || null;
  const role = roleOf(node, cite);
  const nest = nestOf(node, cite, byId);
  const paper = cite?.paper || null;
  const parts = [role, nest, paper].filter(Boolean);
  if (!parts.length) return null;
  // Don't repeat the same phrase twice
  const uniq = [];
  for (const p of parts) {
    if (!uniq.includes(p)) uniq.push(p);
  }
  return {
    line: uniq.join(" · "),
    role,
    nest,
    paper,
    cited: !!paper,
  };
}

export function countAuthority(root, byId) {
  let withLine = 0;
  let withCite = 0;
  function walk(n) {
    const a = authorityLine(n, byId);
    if (a?.line) withLine++;
    if (a?.cited) withCite++;
    for (const c of n.children || []) walk(c);
  }
  if (root) walk(root);
  return { withLine, withCite, tableSize: Object.keys(AUTHORITY_CITES).length };
}
