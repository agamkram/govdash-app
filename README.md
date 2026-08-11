# GovDash

Citizen map of the **U.S. federal government** — cascading / pinch-to-zoom hierarchy from official data, with heat and engagement panels.

## Quick start

```bash
cd govdash-app
npm run build:tree    # or full: npm run build
npm run serve         # or existing preview on :8799
```

Open the printed URL. **Tap circles to drill in**, **Up** / breadcrumbs to ascend, toggle **Heat**, search to fly to a node.

## Pipeline

| Step | Command / path |
|------|----------------|
| Fetch Crosswalk | `npm run fetch` → `data/raw/` |
| Nest Parent list | `npm run build:tree` → `data/nested/gov-tree.json` (full) |
| Fetch SAM depts | `npm run fetch:sam` → `data/raw/sam/` (uses API quota) |
| Enrich with SAM | `npm run enrich:sam` → attaches `sources.sam` |
| Fetch Manual | `npm run fetch:usgm` → `data/raw/usgm/` |
| Enrich Manual | `npm run enrich:usgm` → attaches `sources.usgm` |
| Fetch heat | `npm run fetch:heat` → `data/raw/heat/` |
| Enrich heat | `npm run enrich:heat` → `node.heat` scores |
| Curate map tree | `npm run curate` → `gov-tree-full.json` + `gov-tree-product.json` |
| Map UI | `index.html` + `app.js` + `views/*` (Icicle / Tree / Size) |
| Schema | `docs/data-model.md` |

## Data sources (priority)

1. GSA FederalHierarchy-Crosswalk — structural skeleton  
2. SAM.gov Federal Hierarchy Public API — live status / codes  
3. U.S. Government Manual (govinfo XML) — mission / leadership  
4. USAspending + Federal Register — heat signals  

Roadmap on Desktop: `GovDash-roadmap.txt`
