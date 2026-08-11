/**
 * Citizen engagement actions derived from node kind + enrichment context.
 * Prefer official .gov destinations; inherit parent contacts when attributed.
 */

import { enrichmentContext, kindTemplate } from "./context.js";

function encodeQuery(s) {
  return encodeURIComponent(String(s || "").trim());
}

function usaGovSearch(name) {
  return `https://www.usa.gov/search?query=${encodeQuery(name)}`;
}

function foiaSearch(name) {
  return `https://www.foia.gov/search.html?q=${encodeQuery(name)}`;
}

/**
 * @param {object} node
 * @param {{ byId?: Map } | Map} [optsOrById]
 * @returns {{ id: string, label: string, detail?: string, href?: string, tel?: string }[]}
 */
export function engagementActions(node, optsOrById) {
  const byId =
    optsOrById instanceof Map ? optsOrById : optsOrById?.byId || null;
  const ctx = enrichmentContext(node, byId);
  const kind = node.kind || "unknown";
  const name = node.name || "this organization";
  const web = ctx.web;
  const phone = ctx.phone;
  const actions = [];

  const add = (action) => {
    if (!action?.label) return;
    if (action.href || action.tel || action.detail) actions.push(action);
  };

  if (web) {
    add({
      id: "visit-site",
      label: ctx.template?.webLabel || "Visit the official website",
      detail: ctx.webDetail || undefined,
      href: web.startsWith("http") ? web : `https://${web}`,
    });
  }

  if (phone) {
    add({
      id: "call",
      label: `Call ${phone}`,
      detail: ctx.phoneDetail || undefined,
      tel: phone.replace(/[^\d+]/g, ""),
    });
  }

  // FEB network — curated family actions
  if (ctx.template?.id === "feb" || kindTemplate(node)?.id === "feb") {
    add({
      id: "feb-report",
      label: "Read the FEB national network report",
      detail: "OPM — Federal Executive Board Annual Report (PDF)",
      href: "https://www.opm.gov/chcoc/transmittals/2024/attachments/Federal%20Executive%20Boards%20Fiscal%20Year%202023%20Annual%20Report.pdf",
    });
  }

  // Constitution / sovereign root (not the ∞ Beyond map)
  if (
    node.id !== "beyond" &&
    (kind === "sovereign" || node.id === "usa" || node.id === "constitution")
  ) {
    add({
      id: "read-constitution",
      label: "Read the U.S. Constitution",
      detail: "Constitution Annotated — Congress.gov / Library of Congress",
      href: "https://constitution.congress.gov/constitution/",
    });
    add({
      id: "constitution-annotated",
      label: "Browse the Constitution Annotated",
      detail: "Article-by-article analysis — constitution.congress.gov",
      href: "https://constitution.congress.gov/",
    });
    add({
      id: "archives-constitution",
      label: "See the original at the National Archives",
      detail: "Founding documents — archives.gov",
      href: "https://www.archives.gov/founding-docs/constitution",
    });
    add({
      id: "archives-transcript",
      label: "Read the official transcript",
      detail: "National Archives — Constitution of the United States",
      href: "https://www.archives.gov/founding-docs/constitution-transcript",
    });
    add({
      id: "bill-of-rights",
      label: "Read the Bill of Rights",
      detail: "First ten amendments — archives.gov",
      href: "https://www.archives.gov/founding-docs/bill-of-rights",
    });
    add({
      id: "usa-constitution",
      label: "Plain-language Constitution guide",
      detail: "USA.gov — how the Constitution works",
      href: "https://www.usa.gov/constitution",
    });
    add({
      id: "usa-gov",
      label: "Start at USA.gov",
      detail: "Official guide to government services and agencies",
      href: "https://www.usa.gov/",
    });
  }

  // Branch — civic orientation
  if (kind === "branch") {
    add({
      id: "usa-gov",
      label: "Start at USA.gov",
      detail: "Official guide to government services and agencies",
      href: "https://www.usa.gov/",
    });
    if (/legislative/i.test(name)) {
      add({
        id: "find-reps",
        label: "Find your members of Congress",
        detail: "House + Senate by address",
        href: "https://www.congress.gov/members/find-your-member",
      });
      add({
        id: "congress-gov",
        label: "Track bills and votes",
        href: "https://www.congress.gov/",
      });
    }
    if (/judicial/i.test(name)) {
      add({
        id: "court-listener-hint",
        label: "Learn how federal courts work",
        detail: "Plain-language overview from USA.gov",
        href: "https://www.usa.gov/federal-courts",
      });
    }
    if (/executive/i.test(name)) {
      add({
        id: "whitehouse",
        label: "See the White House",
        href: "https://www.whitehouse.gov/",
      });
      add({
        id: "regs",
        label: "Comment on proposed federal rules",
        detail: "Regulations.gov — public notice-and-comment",
        href: "https://www.regulations.gov/",
      });
    }
  }

  // Chambers / Congress-ish
  if (/senate|house of representatives|congress/i.test(name) || kind === "chamber") {
    add({
      id: "find-reps",
      label: "Find and contact your legislators",
      href: "https://www.congress.gov/members/find-your-member",
    });
    if (/senate/i.test(name)) {
      add({
        id: "senate",
        label: "U.S. Senate home",
        href: web || "https://www.senate.gov/",
      });
    }
    if (/house/i.test(name)) {
      add({
        id: "house",
        label: "U.S. House home",
        href: web || "https://www.house.gov/",
      });
    }
  }

  // Departments, agencies, independents, bureaus — operational engagement
  const operational = [
    "department",
    "agency",
    "independent",
    "bureau",
    "office",
    "institute",
    "military",
    "command",
    "court",
  ].includes(kind);

  if (operational) {
    add({
      id: "learn-usa",
      label: "Look up this agency on USA.gov",
      detail: "Services, contacts, and plain-language explainers",
      href: usaGovSearch(name),
    });
    add({
      id: "foia",
      label: "Request records (FOIA)",
      detail: "Freedom of Information Act — foia.gov",
      href: foiaSearch(name),
    });
    add({
      id: "regs-agency",
      label: "Find and comment on this agency’s rules",
      detail: "Search Regulations.gov",
      href: `https://www.regulations.gov/search?filter=${encodeQuery(name)}`,
    });
    add({
      id: "spending",
      label: "See related federal spending",
      detail: "USAspending.gov (search by name)",
      href: `https://www.usaspending.gov/search/?hash=false&query=${encodeQuery(name)}`,
    });
  }

  // Courts
  if (kind === "court" || /court|judicial/i.test(name)) {
    add({
      id: "court-info",
      label: "Federal court basics",
      href: "https://www.usa.gov/federal-courts",
    });
  }

  if (!actions.length) {
    add({
      id: "usa-fallback",
      label: "Explore government services on USA.gov",
      href: "https://www.usa.gov/",
    });
  }

  const seen = new Set();
  return actions.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}
