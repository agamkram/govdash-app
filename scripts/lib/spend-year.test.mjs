import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSpendYearController } from "../../spend-year.js";

function tree() {
  return {
    id: "usa",
    name: "USA",
    children: [
      {
        id: "dhs",
        name: "DHS",
        spending: {
          obligatedAmount: 100,
          grain: "toptier",
          rolledUp: false,
          asOf: "FY2026",
          toptierCode: "070",
        },
        children: [
          {
            id: "cbp",
            name: "CBP",
            spending: {
              obligatedAmount: 30,
              grain: "subtier",
              rolledUp: false,
              asOf: "FY2026",
              toptierCode: "070",
            },
          },
          { id: "blank", name: "Blank office" },
        ],
      },
      {
        id: "branch",
        name: "Branch",
        children: [
          {
            id: "leaf",
            name: "Leaf",
            spending: {
              obligatedAmount: 5,
              grain: "toptier",
              rolledUp: false,
              asOf: "FY2026",
              toptierCode: "001",
            },
          },
        ],
      },
    ],
  };
}

const pack = {
  meta: {
    years: [2018, 2026],
    defaultYear: 2026,
    asOf: { 2018: "FY18", 2026: "FY26 Q3" },
  },
  nodes: {
    dhs: {
      grain: "toptier",
      toptierCode: "070",
      y: { 2018: { o: 80, u: 70 }, 2026: { o: 100, u: 90 } },
    },
    cbp: {
      grain: "subtier",
      toptierCode: "070",
      y: { 2026: { o: 30, u: null } },
    },
    leaf: {
      grain: "toptier",
      toptierCode: "001",
      y: { 2018: { o: 4, u: null }, 2026: { o: 5, u: null } },
    },
  },
};

describe("spend-year overlay", () => {
  it("defaults to pack default year and rolls up blanks", () => {
    const root = tree();
    const ctl = createSpendYearController(root);
    ctl.load(pack);
    assert.equal(ctl.currentYear(), 2026);
    assert.equal(root.children[0].spending.obligatedAmount, 100);
    assert.equal(root.children[0].children[0].spending.obligatedAmount, 30);
    // branch has only leaf → rollup
    assert.equal(root.children[1].spending.rolledUp, true);
    assert.equal(root.children[1].spending.obligatedAmount, 5);
  });

  it("blanks subtier when year has no match; keeps toptier history", () => {
    const root = tree();
    const ctl = createSpendYearController(root);
    ctl.load(pack);
    ctl.apply(2018);
    assert.equal(ctl.asOfFor(2018), "FY18");
    assert.equal(ctl.asOfFor(2026), "FY26 Q3");
    assert.equal(root.children[0].spending.obligatedAmount, 80);
    assert.equal(root.children[0].children[0].spending, undefined);
    assert.equal(root.children[1].children[0].spending.obligatedAmount, 4);
    assert.equal(root.children[1].spending.obligatedAmount, 4);
  });

  it("restores base snapshot when pack missing", () => {
    const root = tree();
    const before = root.children[0].spending.obligatedAmount;
    const ctl = createSpendYearController(root);
    ctl.restoreBase();
    assert.equal(root.children[0].spending.obligatedAmount, before);
  });
});
