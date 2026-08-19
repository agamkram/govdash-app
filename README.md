# GovDash

A citizen map of the U.S. federal hierarchy — how it’s organized, what’s nested under what.

**Live:** GitHub → Vercel → [markmaga.com](https://markmaga.com) (GovDash). Layouts: Icicle, Tree, Circles, Sankey. How-to and glossary live in the in-app About page (`i`).

Each visit opens on Icicle. Nothing is remembered (not chart, depth, zoom, ZIP, theme, or Heat).

## Data (baked into the shipped tree)

Vercel serves committed JSON. Crosswalk owns the edges; other sources overlay fields and must not rewire parents.

| Source | Role |
|--------|------|
| GSA Federal Hierarchy Crosswalk | Skeleton of orgs and parent links |
| SAM.gov Federal Hierarchy API | Status / identity overlay on matched departments |
| U.S. Government Manual | Mission, leadership, web, phone |
| OPM Federal Workforce Data (EHRI) | Civilian employee counts when matched |
| Senate.gov, Clerk of the House, Federal Register | Heat events (floor / session / public inspection) — a snapshot in the map files, not a live browse-time feed |
| USAspending.gov | Committed (obligated) and paid (outlay) on matched agencies; FY overlay 2018–2026 |
| Treasury Fiscal Data | Public debt, interest, receipts/outlays on the `$` page (live at browse time) |

Blanks are honest: no match, not a hidden number. OPM is civilian only. Child offices often have committed dollars without paid. Heat and spending are separate.

## Refresh the tree

`npm run pipeline` fetches, nests, enriches, and curates. Vercel deploys whatever is committed (`gov-tree-product.json`, `gov-tree-beyond.json`, `spend-by-year.json`).

| Step | Command |
|------|---------|
| Crosswalk | `npm run fetch` → `npm run build:tree` |
| SAM / Manual | `npm run fetch:sam` / `enrich:sam`, `fetch:usgm` / `parse:usgm` / `enrich:usgm` |
| Workforce | `npm run fetch:workforce` → `enrich:workforce` |
| Spend | `npm run fetch:heat` (USAspending cache), `fetch:subtier`, `enrich:spending`, `fetch:spend-history`, `enrich:spend-years` |
| Heat events | `npm run fetch:heat-events` → `enrich:heat` |
| Curate + About counts | `npm run curate`, `stats:about` |

Map UI: `index.html`, `app.js`, `views/` (Icicle / Tree / Circles / Sankey). Schema: `docs/data-model.md`.
