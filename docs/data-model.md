# GovDash data model

## Goal

A nested hierarchy of the U.S. federal government, refreshable from official sources, with room to attach live status, descriptions, heat, and citizen-action fields without changing the tree shape.

## Node shape

Every org unit is one object:

```json
{
  "id": "gsa-100000000",
  "name": "US Department of Defense (DOD)",
  "short": "DOD",
  "kind": "department",
  "parentId": "gsa-41",
  "sources": {
    "crosswalk": { "...raw identity & codes..." },
    "sam": null,
    "usgm": null
  },
  "heat": null,
  "children": []
}
```

| Field | Role |
|-------|------|
| `id` | Stable key for the UI (`gsa-{GSA SFP Key}` today). |
| `name` / `short` | Display labels. |
| `kind` | Coarse type for styling (`branch`, `department`, `agency`, `bureau`, …). |
| `parentId` | Parent node id (null on synthetic USA root). |
| `sources.crosswalk` | Raw Crosswalk fields (codes, entity type, parent name). |
| `sources.sam` | Placeholder for SAM.gov Federal Hierarchy API. |
| `sources.usgm` | Placeholder for U.S. Government Manual content. |
| `heat` | Activity overlay `{ score, period, signals }` from spending / FR / size. |
| `children` | Nested child nodes (D3 hierarchy / collapsible tree). |

Synthetic root: `id: "usa"` — Crosswalk has no single USA node; branches use `Parent: "[Branch]"`.

## Build pipeline

```bash
npm run fetch        # download Crosswalk JSON + CSV → data/raw/
npm run build:tree   # nest → data/nested/gov-tree.json + samples/
npm run curate       # full nest → gov-tree-full.json + gov-tree-product.json (map UI)
npm run pipeline     # fetch + nest + enrich + curate (local; Vercel serves committed trees)
npm run serve        # local HTTPS preview
```

Samples always written:

- `data/nested/samples/legislative.json` — Federal Legislative Branch subtree
- `data/nested/samples/defense.json` — US Department of Defense (DOD) subtree

## SAM.gov Federal Hierarchy Public API (in use for departments)

```bash
npm run fetch:sam     # cache active Department/Ind. Agency list (~2 API calls)
npm run enrich:sam    # rebuild Crosswalk tree + attach sources.sam
```

Raw cache: `data/raw/sam/departments-active.json`  
Key: `.env` → `SAM_API_KEY` (gitignored). Non-federal ≈ **10 requests/day**.

**Match rule (v1):** one SAM department → one Crosswalk node (never paint every CGAC child).

1. **Pass A — name:** exact normalized name, then Jaccard ≥ 0.72  
   (handles `STATE, DEPARTMENT OF` ↔ `Department of State`)  
2. **Pass B — CGAC:** only for leftovers, among Agency / Ind Agency / department,  
   with name similarity tie-break (so IBWC ≠ State even when both CGAC 019)  

**Stored under `sources.sam`:** `fhorgid`, `fhorgname`, `status`, `fhorgtype`, `agencycode`, `cgaclist`, `lastupdateddate`, `matchedHow`.

**Conflict rule:** Crosswalk still owns tree edges. SAM is overlay status/identity only.

**Not yet:** Sub-Tier pages (would burn the daily quota). Fetch later with cache + pagination.

API docs: https://open.gsa.gov/api/fh-public-api/

## Later merge: U.S. Government Manual (govinfo bulk XML) — in use

```bash
npm run fetch:usgm    # latest GOVMAN zip from govinfo bulkdata
npm run parse:usgm    # XML → data/raw/usgm/entities.json
npm run enrich:usgm   # attach sources.usgm (preserves sources.sam)
```

Edition: see `data/raw/usgm/manifest.json` (currently 2025).

**Stored under `sources.usgm`:** mission paragraphs, leadership name/title rows, web, phone, edition id.

**Match:** alias map for common renames + normalized name + Jaccard ≥ 0.75.  
One Manual entity → one tree node.

UI shows mission + leadership in the detail panel; brown dot in the tree marks nodes with Manual text.

## Citizen engagement (Step 9)

`engagement.js` builds **How you can engage** links from node `kind` + Manual web/phone.

Examples:

- Official site / phone (from `sources.usgm`)
- Find your members of Congress (legislative)
- Comment on rules (Regulations.gov)
- FOIA (foia.gov)
- Agency lookup (USA.gov)
- Related spending search (USAspending)

These are **generated**, not scraped per agency. Later heat/time can add “what’s active now” actions.

## Heat (Step 10 — in use)

```bash
npm run fetch:heat    # cache USAspending + FR counts
npm run enrich:heat   # write node.heat { score, signals, period }
```

**Score (v1):** weighted mix of

1. USAspending obligated amount (log-normalized)
2. Federal Register document count since 2025-01-01 (where matched)
3. Org footprint (descendant count)

Parents get a **roll-up** = max(own, 0.92 × hottest child) so branches show activity at high zoom.

UI: amber intensity + inline meter; detail panel breaks down signals. Toggle **Heat** in the toolbar.

## Time (FY scrub — spending only)

Same shipped Crosswalk boxes. Mission, OPM, edges do **not** move with the year.

```bash
npm run fetch:spend-history   # multi-year USAspending → data/raw/heat/usaspending-history.json
npm run enrich:spend-years    # → data/nested/spend-by-year.json (node id → amounts by FY)
```

Years: **FY2018–FY2026** (DATA Act quality is thin before FY2018). Toptier from `budgetary_resources`; subtier from `sub_agency?fiscal_year=`. Runtime `spend-year.js` swaps `node.spending` and re-rolls parents. Honest blanks when a year has no match.

## Design principle

**One node schema forever.** New sources only fill `sources.*` and `heat`. The cascading map always walks `children`.
