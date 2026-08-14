import assert from "node:assert/strict";
import test from "node:test";
import { bestMatch, jaccard, norm } from "./spend-match.mjs";

function node(id, name, short, kind = "bureau") {
  return { id, name, short, kind };
}

const VA = {
  agency_name: "Department of Veterans Affairs",
  abbreviation: "VA",
  agency_slug: "department-of-veterans-affairs",
};
const ED = {
  agency_name: "Department of Education",
  abbreviation: "ED",
  agency_slug: "department-of-education",
};
const OPM = {
  agency_name: "Office of Personnel Management",
  abbreviation: "OPM",
  agency_slug: "office-of-personnel-management",
};
const USDA = {
  agency_name: "Department of Agriculture",
  abbreviation: "USDA",
  agency_slug: "department-of-agriculture",
};
const NRC = {
  agency_name: "Nuclear Regulatory Commission",
  abbreviation: "NRC",
  agency_slug: "nuclear-regulatory-commission",
};
const EAC = {
  agency_name: "Election Assistance Commission",
  abbreviation: "EAC",
  agency_slug: "election-assistance-commission",
};
const EOP = {
  agency_name: "Executive Office of the President",
  abbreviation: "EOP",
  agency_slug: "executive-office-of-the-president",
};
const ARC = {
  agency_name: "Appalachian Regional Commission",
  abbreviation: "ARC",
  agency_slug: "appalachian-regional-commission",
};
const OPIC = {
  agency_name: "Overseas Private Investment Corporation",
  abbreviation: "OPIC",
  agency_slug: "overseas-private-investment-corporation",
};
const DFC = {
  agency_name: "U.S. International Development Finance Corporation",
  abbreviation: "DFC",
  agency_slug: "us-international-development-finance-corporation",
};

const fakes = [
  node("gsa-1221", "Hague Conference on Private International Law (HCCH)", "HCCH", "igo"),
  node("gsa-1194", "United Nations (UN)", "UN", "igo"),
  node("gsa-1169", "Asian Development Bank (ADB)", "ADB", "igo"),
  node("gsa-1727", "USDA Organization of Professional Employees (OPEDA)", "OPEDA", "nonprofit"),
  node("gsa-1055", "Neighborhood Reinvestment Corporation (NRC) (NeighborWorks America)", "NRC", "nonprofit"),
  node("gsa-1126", "US Institute of Peace (USIP)", "USIP", "nonprofit"),
  node("gsa-1241", "International Union of Geodesy and Geophysics (IUGG)", "IUGG", "igo"),
  node("gsa-1212", "International Agency for Research on Cancer (IARC)", "IARC", "igo"),
  node("gsa-1155", "Inter-American Tropical Tuna Commission (IATTC)", "IATC", "igo"),
  node("gsa-1175", "International Finance Corporation (IFC)", "IFC", "igo"),
];

const reals = [
  node("gsa-va", "US Department of Veterans Affairs (VA)", "VA", "department"),
  node("gsa-ed", "US Department of Education (ED)", "ED", "department"),
  node("gsa-opm", "US Office of Personnel Management (OPM)", "OPM", "independent"),
  node("gsa-usda", "US Department of Agriculture (USDA)", "USDA", "department"),
  node("gsa-nrc", "US Nuclear Regulatory Commission (NRC)", "NRC", "independent"),
  node("gsa-cbp", "US Customs and Border Protection (CBP)", "CBP", "bureau"),
  node("gsa-usn", "US Department of the Navy (USN)", "USN", "department"),
  node("gsa-usa", "US Department of the Army (USA)", "USA", "department"),
];

test("norm lines up Department of X with US Department of X (VA)", () => {
  assert.equal(norm("Department of Veterans Affairs"), norm("US Department of Veterans Affairs (VA)"));
});

test("real Cabinet / independent names still match", () => {
  const pool = [...reals, ...fakes];
  assert.equal(bestMatch(VA, pool).node.id, "gsa-va");
  assert.equal(bestMatch(ED, pool).node.id, "gsa-ed");
  assert.equal(bestMatch(OPM, pool).node.id, "gsa-opm");
  assert.equal(bestMatch(USDA, pool).node.id, "gsa-usda");
  assert.equal(bestMatch(NRC, pool).node.id, "gsa-nrc");
});

test("VA is not inside PRIVATE (Hague)", () => {
  assert.equal(bestMatch(VA, fakes), null);
});

test("ED is not inside UNITED NATIONS", () => {
  assert.equal(bestMatch(ED, fakes), null);
});

test("OPM is not inside DEVELOPMENT (ADB)", () => {
  assert.equal(bestMatch(OPM, fakes), null);
});

test("USDA staff union is not the Department of Agriculture", () => {
  assert.equal(bestMatch(USDA, fakes), null);
});

test("NeighborWorks NRC is not Nuclear Regulatory Commission", () => {
  assert.equal(bestMatch(NRC, fakes), null);
});

test("EAC is not inside PEACE (USIP)", () => {
  assert.equal(bestMatch(EAC, fakes), null);
});

test("EOP is not inside GEOPHYSICS (IUGG)", () => {
  assert.equal(bestMatch(EOP, fakes), null);
});

test("ARC is not inside RESEARCH (IARC)", () => {
  assert.equal(bestMatch(ARC, fakes), null);
});

test("OPIC is not inside TROPICAL (IATTC)", () => {
  assert.equal(bestMatch(OPIC, fakes), null);
});

test("DFC is not IFC", () => {
  assert.equal(bestMatch(DFC, fakes), null);
  assert.ok(jaccard(DFC.agency_name, "International Finance Corporation (IFC)") < 0.78);
});

test("subtier CBP / Navy names match the citizen boxes", () => {
  assert.equal(
    bestMatch({ name: "U.S. Customs and Border Protection", abbreviation: "CBP" }, reals).node
      .id,
    "gsa-cbp"
  );
  assert.equal(
    bestMatch({ name: "Department of the Navy", abbreviation: "USN" }, reals).node.id,
    "gsa-usn"
  );
  assert.equal(
    bestMatch({ name: "Department of the Army", abbreviation: "USA" }, reals).node.id,
    "gsa-usa"
  );
});

test("used slug is not reused", () => {
  const usedSlugs = new Set(["department-of-veterans-affairs"]);
  assert.equal(bestMatch(VA, reals, { usedSlugs }), null);
});
