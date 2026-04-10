# TSMIS Reports — Claude Code Knowledge Base

## Project Overview

**TSMIS Reports** is a static single-page web application used by Caltrans transportation specialists to query and display California highway/ramp data from the TSNR ArcGIS map service. No build process, no framework — pure HTML/CSS/vanilla ES6+.

- **Deployed at:** https://rhansonrizing.github.io/tsmis_reports/index.html
- **Repo:** https://github.com/rhansonrizing/tsmis_reports
- **Run locally:** Serve directory with any static HTTP server (VS Code Live Server on port 5500), update `oauthRedirectUrl` in config.js to match

---

## Tech Stack

- **Vanilla JavaScript (ES6+)** — no framework, no build tool, no npm
- **ArcGIS REST API** — MapServer, FeatureServer, LRServer (linear referencing), VersionManagementServer
- **OAuth 2.0 Implicit Flow** — via ArcGIS Portal (token in URL fragment, 120-min expiry)
- **SheetJS (xlsx 0.20.3)** — CDN, used only for Excel export
- **GitHub Pages** — static deployment

---

## File Structure

```
tsmis_reports/
├── index.html               # Single HTML entry point (261 lines) — all markup
├── config.js                # ArcGIS URLs + OAuth credentials (9 lines)
├── main.js                  # DOMContentLoaded bootstrap (42 lines)
├── shared.js                # Core shared library (1,210 lines) — auth, queries, utils
├── styles.css               # All styling + print styles (972 lines)
├── caltranslogo.png         # Header logo
├── ramp_detail.js           # Report: TSAR Ramp Detail (330 lines)
├── ramp_summary.js          # Report: TSAR Ramp Summary (386 lines)
├── hsl.js                   # Report: Highway Sequence Listing (1,786 lines — largest)
├── highway_log.js           # Report: Highway Log (1,031 lines)
├── intersection_detail.js   # Report: Intersection Detail (839 lines)
└── intersection_summary.js  # Report: Intersection Summary — STUB, not implemented (19 lines)
```

---

## config.js (All URLs & Credentials)

```javascript
const CONFIG = {
  mapServiceUrl:     "https://rhapps-prod.dot.ca.gov/ars/rest/services/TSMIS/lrs_tsmis_prod/MapServer",
  featureServiceUrl: "https://rhapps-prod.dot.ca.gov/ars/rest/services/TSMIS/lrs_tsmis_prod/FeatureServer",
  vmsUrl:            "https://rhapps-prod.dot.ca.gov/ars/rest/services/TSMIS/lrs_tsmis_prod/VersionManagementServer",
  oauthClientId:     "z7jnDQesKUG5xAxv",
  oauthAuthorizeUrl: "https://rhapps-prod.dot.ca.gov/portal/sharing/rest/oauth2/authorize",
  oauthRedirectUrl:  "https://rhansonrizing.github.io/tsmis_reports/index.html"
};
```

For local dev: change `oauthRedirectUrl` to `http://localhost:5500/index.html`.

---

## ArcGIS Layers Used

| Layer | Name | Type | Key Fields | Purpose |
|-------|------|------|-----------|---------|
| 74 | City Code | Range Events | City_Code, FromARMeasure, ToARMeasure | City code by location range |
| 116 | AllRoads (LRS) | Route Geometry | RouteID, FromARMeasure, ToARMeasure, Highway_Group | Route structure |
| 123 | Landmarks (EV_SHS_LANDMARK) | Point Events | Landmarks_Short/Long, ARMeasure, RouteID, PMPrefix/Suffix/Measure, ODMeasure | Highway landmarks & equation points |
| 130 | Population Code | Range Events | Population_Code, FromARMeasure, ToARMeasure | Rural/Urban classification |
| 131 | Ramp Attributes | Feature Table | Ramp_Name, Ramp_Description, Ramp_On_Off_Ind (0/1/2), Ramp_Design, Area4_Ind | Ramp descriptions & classification |
| 132 | Ramp Point Events (EV_SHS_RAMP) | Point Events | Ramp_Name, ARMeasure, ODMeasure, RouteID, PMPrefix/Suffix/Measure, County, District | **Primary ramp data source** |
| 133 | Route Breaks (EV_SHS_ROUTE_BREAK) | Point Events | ARMeasure, RouteID | Route discontinuities |
| 149 | Intersection AOI | Polygons | — | Intersection area-of-interest polygons |
| 151 | Intersection Attributes | Feature Table | County_Code + intersection fields | Intersection details; also used for county domain |
| 157 | AADT | Point Events | AADT_YEAR, AADT, LRSFromDate | Average Annual Daily Traffic |
| 215 | County/District/Route Index | Feature Table | District_Code, County, RouteNum, RouteSuffix | Drives cascading District→County→Route dropdowns |
| 304 | Route Directions | Table | ROUTE, FROM_, TO_ | Human-readable directional labels |
| 1 | Calibration Points | Point Events | RouteId, Measure, NetworkId | Source for equation point detection (NetworkId=2, right-alignment only) |

---

## shared.js — Critical Shared Library

### Global State Variables
```javascript
_token, _tokenExpiry, _portalUsername   // Auth state
_allResults, _currentPage, PAGE_SIZE=25 // Pagination
_allRouteIds, _routeDirectionCache, _countyNameToCode  // Caches
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `login()` | Redirect to ArcGIS OAuth authorize endpoint |
| `tokenIsValid()` | Check token presence and expiry |
| `loadCountyCodeDomain()` | Load county code mappings from layer 151 |
| `normalizeCountyCode(county)` | Convert county name/code to 3-char format (e.g., "LA.") |
| `translateSection(routeIdR, routeIdL, measure)` | Call LRServer to convert PM → AR measure |
| `queryAttributeSet(segments, district, county)` | Query layer 132 (ramps) by measure range |
| `queryRangeLayer(pairs, layerNum, fieldName)` | Generic range-based lookup (layers 74, 116, 130) |
| `makePageController(...)` | Returns pagination controller object |
| `printAll()` / `exportToExcel()` | Generic print/export handlers |
| `renderActionBar()` / `buildCoverPage()` | Report header/footer generation |
| `formatDate(ts)`, `padMeasure(val)`, `esc(str)` | String formatting utilities |
| `getDistrictCounty()`, `getOnOffFilter()`, `getDateFilter()` | Filter helpers |
| `onDistrictChange()` → `onCountyChange()` | Cascading dropdown population (layer 215) |
| `runDistrictRouteMode()` / `runTranslate()` | Report dispatch by `reportSelect.value` |

### API Error Handling Pattern
```javascript
if (data.error) {
  const code = data.error.code;
  if (code === 498 || code === 499) { _token = null; login(); return []; }
  console.error(`[func] API error ${code}: ${data.error.message}`);
  return [];
}
```

### All Queries Include Date Filter
```sql
InventoryItemStartDate <= :refDate AND (InventoryItemEndDate IS NULL OR InventoryItemEndDate > :refDate)
```

---

## Data Flow

### District/Route Mode
```
Select District → query layer 215 for counties
Select County → query layer 215 for routes
Select Route → queryAttributeSet() on full range (-0.001 to 999.999)
→ enrich with layers 131, 116, 74, 130, 157
→ sort by ODMeasure → render → paginate
```

### Postmile / Route Measure Mode
```
Enter From/To postmiles
→ translateSection() calls LRServer /translate
→ Returns AR measure ranges for R and L alignments
→ queryAttributeSet(segments)
→ same enrichment pipeline
```

---

## Report Modules

### Report Dispatch Values (`reportSelect.value`)
- `"Ramp_Detail"` → ramp_detail.js
- `"Ramp_Summary"` → ramp_summary.js
- `"highway_sequence"` → hsl.js
- `"highway_log"` → highway_log.js
- `"intersection_detail"` → intersection_detail.js
- `"intersection_summary"` → **STUB — not implemented**

### Report-Specific Prefixes (avoid name collisions)
- HSL functions: `hsl_*` (e.g., `hsl_renderPage`, `hsl_groupByAlignment`)
- Highway Log: `hl_*` (e.g., `hl_renderRow`)
- Intersection Detail: `intd_*` (e.g., `intd_queryIntersections`)
- Ramp Summary: `rs_*` (e.g., `rs_buildSummary`)

### Per-Page Rows
| Report | Rows/Page |
|--------|-----------|
| Ramp Detail | 25 |
| HSL / Highway Log | 34 |
| Intersection Detail | 30 |
| Ramp Summary | N/A (single page) |

---

## Key Data Models

### Ramp Object
```javascript
{
  type: 'ramp',
  name, routeId, arMeasure, odMeasure,
  county,          // 3-char, e.g. "LA."
  routeSuffix,     // '.', 'S', 'U'
  pmPrefix,        // '.', 'C', 'D', 'G'
  pmSuffix,        // '.', 'R', 'L', 'E'
  pmMeasure, district, startDate, endDate,
  // Enriched:
  description, hwyGroup, cityCode, popCode,
  onOff,           // 0=OFF, 1=ON, 2=OTHER
  rampDesign,      // A-Z ramp type
  aadtYear, aadt, area4
}
```

### Landmark Object
```javascript
{
  type: 'landmark'|'equation'|'routebreak'|'citybegin'|'cityend'|'districtbegin'|'districtend',
  name, desc, routeId, arMeasure, odMeasure,
  pmPrefix, pmSuffix, pmMeasure, county, district,
  alignment,       // 'R' or 'L'
  startDate, endDate,
  isSecondEq,      // true = "EQUATES TO" label
  eqPairId         // groups equation pairs
}
```

---

## Naming Conventions

- **Global state vars:** `_camelCase` prefix underscore
- **Report-specific vars:** `_reportPrefix_varName` (e.g., `_intd_allResults`)
- **Constants:** `ALL_CAPS` (e.g., `PAGE_SIZE`, `HL_ROWS_PER_PAGE`)
- **Section headers in code:** `// ── SECTION NAME ──────────────────`
- **DOM IDs:** `kebab-case` (e.g., `report-select`, `from-measure`)
- **CSS classes:** `kebab-case`; BEM-inspired for custom select: `.cs`, `.cs-trigger`, `.cs-option`

---

## Incomplete / Known Issues

| Issue | Location | Notes |
|-------|----------|-------|
| **Intersection Summary not implemented** | intersection_summary.js | 19-line stub, returns error message |
| **Highway Log missing postmile mode** | highway_log.js | District/route only |
| **hsl_computeLengths called twice** | hsl.js:1764 | Redundant on print/export; optimization opportunity |
| **OAuth credentials in config.js** | config.js | Production client ID committed to public repo |
| **No tests** | — | Zero test coverage |
| **Transfer limit warnings** | shared.js | ArcGIS default 1000-feature limit may truncate results |

---

## Chunking Pattern (for ArcGIS Transfer Limits)
```javascript
const CHUNK = 100;
const chunks = chunkArray(pairs, CHUNK);
const results = (await Promise.all(chunks.map(async chunk => {
  // query each chunk
}))).flat();
```

---

## Equation Point Detection (`queryEquationPointsFromNetwork`)

**Location:** `hsl.js`
**Replaces:** Former table-based approach using layer 305 which required manual upkeep.

Equation points are detected on the fly from calibration point data (layer 1):

1. **Query layer 1** for `NetworkId = 2` calibration points scoped to the route and county using a PM RouteId prefix (e.g. `HUM254`). Only right-alignment records (`RouteId.endsWith('R')`) are kept — left-alignment points translate to the same AR values and would create false self-pairs.

2. **Translate** all calibration points from the PM network (layer 3 translate endpoint) to AllRoads AR (layer 4) and OD (layer 5) in a single parallel call.

3. **Filter** translated points to the segment AR range, then sort by AR.

4. **Pair** adjacent points within 0.001 AR of each other. Within each pair, the lower PM value is eq1 and the higher is eq2 (the "EQUATES TO" side). Each point is used in at most one pair.

5. **Build pair objects** in the same `eq1`/`eq2` structure as all other equation points — `isSecondEq: false` on eq1 (desc: `'PM EQUATION'`), `isSecondEq: true` and `pmSuffix: 'E'` on eq2 — so all existing sort tiebreak and render logic works unchanged.

**Requires county:** The function returns `[]` if no county is resolved, since a county-scoped PM RouteId prefix is needed to avoid querying the entire network.

---

## Independent Alignment Sort Logic (`sortWithIndependentAlignments`)

**Location:** `shared.js:571`
**Called by:** `hsl.js:959`, `hsl.js:1043`, `hsl.js:1538` — always as the innermost step of the pipeline:
```javascript
const allPairs = hsl_filterRealignmentLandmarks(
  hsl_filterCityBoundaries(
    sortWithIndependentAlignments(unsortedPairs)
  )
);
```

### Why It Exists

California highways can have **independent alignments** — sections where the R (right/primary) and L (left/secondary) roadbeds diverge and have their own postmile sequences. Without special handling, naively sorting all features by ODMeasure interleaves R and L records, which breaks the printed report (features zigzag between alignments instead of running R-first then L-first within each independent section).

### What `pmSuffix` Values Mean

| pmSuffix | Meaning |
|----------|---------|
| `.` | Normal (main alignment) |
| `R` | Independent alignment — Right roadbed |
| `L` | Independent alignment — Left roadbed |
| `E` | End of independent alignment section |

### Step-by-Step Algorithm

#### Step 1 — Separate equation point pairs
```javascript
const eq1ById = new Map();
const main = pairs.filter(p => {
  if (p.type === 'equation' && !p.isSecondEq) {
    eq1ById.set(p.eqPairId, p);
    return false;   // pull eq1 out; re-insert later beside its eq2
  }
  return true;
});
```
Equation points come in pairs (source measure → "EQUATES TO" measure). The first of each pair (`isSecondEq = false`) is removed from the main array and stored by `eqPairId`. It will be re-inserted immediately before its partner in Step 4.

#### Step 2 — Sort remaining records by ODMeasure
```javascript
main.sort((a, b) => {
  const aVal = isNaN(parseFloat(a.odMeasure)) ? Infinity : parseFloat(a.odMeasure);
  const bVal = isNaN(parseFloat(b.odMeasure)) ? Infinity : parseFloat(b.odMeasure);
  const diff = aVal - bVal;
  if (Math.abs(diff) > 0.001) return diff;
  // Tiebreak at same OD position:
  // routebreaks sort FIRST (they mark the position cleanly)
  // E-suffix records sort LAST (end-of-alignment markers)
  if (a.type === 'routebreak' && b.type !== 'routebreak') return -1;
  if (a.type !== 'routebreak' && b.type === 'routebreak') return 1;
  if (a.pmSuffix === 'E' && b.pmSuffix !== 'E') return 1;
  if (a.pmSuffix !== 'E' && b.pmSuffix === 'E') return -1;
  return 0;
});
```
NaN ODMeasures are treated as `Infinity` — this prevents comparator inconsistency that corrupts TimSort and scrambles nearby records.

#### Step 3 — Group independent alignment sections (R before L)
```javascript
const grouped = [];
let i = 0;
while (i < main.length) {
  if (main[i].pmSuffix === 'R' || main[i].pmSuffix === 'L') {
    const j = i;
    // Consume the entire independent section:
    //   - R and L suffix records
    //   - E suffix records (end-of-alignment markers)
    //   - dot-suffix records whose hgValue is 'R' or 'L'
    //     (END INDEP ALIGN landmarks often carry pmSuffix='.' but hgValue='R')
    while (i < main.length) {
      const cur = main[i];
      if (cur.pmSuffix === 'R' || cur.pmSuffix === 'L' || cur.pmSuffix === 'E') { i++; }
      else if (cur.hgValue === 'R' || cur.hgValue === 'L') { i++; }
      else { break; }
    }
    const section = main.slice(j, i);

    // Output R group first, then L group, then E markers
    grouped.push(...section.filter(p =>
      p.pmSuffix === 'R' || (p.pmSuffix !== 'L' && p.pmSuffix !== 'E' && p.hgValue === 'R')
    ));
    grouped.push(...section.filter(p =>
      p.pmSuffix === 'L' || (p.pmSuffix !== 'R' && p.pmSuffix !== 'E' && p.hgValue === 'L')
    ));
    grouped.push(...section.filter(p => p.pmSuffix === 'E'));
  } else {
    grouped.push(main[i++]);   // normal record — pass through unchanged
  }
}
```

**Key edge case:** `pmPrefix` is unreliable for identifying END INDEP ALIGN landmarks — some carry `pmPrefix='.'` instead of `'R'`. The code uses `hgValue` (Highway Group value from layer 116) exclusively as the fallback classifier.

#### Step 4 — Re-insert eq1 immediately before its eq2 partner
```javascript
const result = [];
for (const p of grouped) {
  if (p.type === 'equation' && p.isSecondEq) {
    const eq1 = eq1ById.get(p.eqPairId);
    if (eq1) result.push(eq1);   // inject source measure row first
  }
  result.push(p);                // then the "EQUATES TO" row
}
return result;
```
This ensures equation point pairs always appear adjacently in the final output, regardless of where grouping placed the eq2 record.

### Full Pipeline After Sort

```
sortWithIndependentAlignments(unsortedPairs)
  ↓
hsl_filterCityBoundaries(sorted)
  Removes citybegin/cityend records whose pmKey (prefix|measure.3dp|suffix)
  already exists in the non-city record set — prevents duplicate rows where
  a city boundary coincides with a ramp or landmark.
  Also drops any city boundary with ODMeasure < 0.
  ↓
hsl_filterRealignmentLandmarks(filtered)
  Removes BEGIN/END REALIGNMENT landmarks whose pmKey matches any other record.
  Only keeps alignment='R' realignment landmarks (L duplicates are always dropped).
  Keeps realignment landmarks with blank/null pmMeasure (no pmKey to match against).
  ↓
allPairs — final ordered list passed to hsl_renderPage()
```

### pmKey Definition (used by both filter functions)
```javascript
const pmKey = p => `${p.pmPrefix}|${parseFloat(p.pmMeasure).toFixed(3)}|${p.pmSuffix}`;
// e.g., ".|10.500|R"  or  "C|0.000|."
```

### Visual Result

Before sort (interleaved):
```
OD 10.1  Ramp A  (pmSuffix=R)
OD 10.2  Ramp B  (pmSuffix=L)
OD 10.3  Ramp C  (pmSuffix=R)
OD 10.4  Ramp D  (pmSuffix=L)
OD 10.5  End     (pmSuffix=E)
```

After sort (grouped R then L):
```
OD 10.1  Ramp A  (pmSuffix=R)
OD 10.3  Ramp C  (pmSuffix=R)
OD 10.2  Ramp B  (pmSuffix=L)
OD 10.4  Ramp D  (pmSuffix=L)
OD 10.5  End     (pmSuffix=E)
```

---

## Running Locally
1. Open folder in VS Code → Go Live (port 5500)
2. In config.js, set `oauthRedirectUrl: "http://localhost:5500/index.html"`
3. Navigate to `http://localhost:5500/index.html`
4. Click "Sign In with ArcGIS" — authenticates against production Caltrans portal
5. Select a report and query method, generate results

---

## Architecture Summary

```
index.html (entry point / all markup)
    ↓ loads scripts in order:
config.js → shared.js → report modules (ramp_detail, ramp_summary, hsl, highway_log, intersection_detail) → main.js
    ↓ on DOMContentLoaded:
main.js bootstraps auth, dropdowns, report selection
    ↓ on user action:
shared.js dispatches to report module
    ↓ all modules call:
ArcGIS REST (MapServer + FeatureServer + LRServer) via fetch()
    ↓ results:
Paginated HTML table in #rampResults → Export to .xlsx or Print
```
