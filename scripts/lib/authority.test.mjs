import assert from "node:assert/strict";
import test from "node:test";
import { authorityLine } from "../../authority.js";

function byId(...nodes) {
  const m = new Map();
  for (const n of nodes) m.set(n.id, n);
  return m;
}

const exec = {
  id: "gsa-41",
  name: "Federal Executive Branch",
  short: "Executive",
  kind: "branch",
  door: "Executive",
  parentId: "usa",
};
const dod = {
  id: "gsa-162",
  name: "US Department of Defense (DOD)",
  short: "DOD",
  kind: "department",
  door: "Executive",
  parentId: "gsa-41",
};
const va = {
  id: "gsa-848",
  name: "US Department of Veterans Affairs (VA)",
  short: "VA",
  kind: "department",
  door: "Executive",
  parentId: "gsa-41",
};
const cbp = {
  id: "gsa-570",
  name: "US Customs and Border Protection (CBP)",
  short: "CBP",
  kind: "bureau",
  door: "Executive",
  parentId: "gsa-561",
};
const dhs = {
  id: "gsa-561",
  name: "US Department of Homeland Security (DHS)",
  short: "DHS",
  kind: "department",
  door: "Executive",
  parentId: "gsa-41",
};
const un = {
  id: "gsa-1194",
  name: "United Nations (UN)",
  short: "UN",
  kind: "igo",
  door: "International",
  parentId: "product-international",
};
const leaf = {
  id: "gsa-9999",
  name: "Some obscure office",
  short: "SOO",
  kind: "office",
  door: "Executive",
  parentId: "gsa-162",
};

const map = byId(exec, dod, va, cbp, dhs, un, leaf);

test("VA is Cabinet + President + 38 U.S.C.", () => {
  const a = authorityLine(va, map);
  assert.match(a.line, /Cabinet department/);
  assert.match(a.line, /President/);
  assert.match(a.line, /38 U\.S\.C\./);
  assert.equal(a.cited, true);
});

test("CBP is under DHS with Homeland Security Act", () => {
  const a = authorityLine(cbp, map);
  assert.match(a.line, /under DHS/);
  assert.match(a.line, /6 U\.S\.C\./);
});

test("UN is an IGO, no fake U.S. statute", () => {
  const a = authorityLine(un, map);
  assert.match(a.line, /International/);
  assert.match(a.line, /not a U\.S\. agency/);
  assert.equal(a.cited, false);
});

test("unknown office still gets kind + nest, no invented cite", () => {
  const a = authorityLine(leaf, map);
  assert.match(a.line, /Office/);
  assert.match(a.line, /under DOD/);
  assert.equal(a.cited, false);
  assert.equal(a.paper, null);
});
