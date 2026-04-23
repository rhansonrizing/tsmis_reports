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
├── shared.js                # Core shared library (~1,727 lines) — auth, queries, utils, HSL queries
├── styles.css               # All styling + print styles
├── caltranslogo.png         # Header logo
├── ramp_detail.js           # Report: TSAR Ramp Detail
├── ramp_summary.js          # Report: TSAR Ramp Summary
├── hsl.js                   # Report: Highway Sequence Listing (~2,975 lines — largest)
├── highway_log.js           # Report: Highway Log
├── intersection_detail.js   # Report: Intersection Detail
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
| 1 | Calibration Points | Point Events | RouteId, Measure, NetworkId | Equation point detection (NetworkId=2, right-alignment only); also used by `hsl_queryEndRecord` for PM endpoint lookup |
| 3 | PM Calibration Routes | Route Geometry (M-aware) | RouteId, PMSuffix, County | PM-network geometry; translate source for PM→AR/OD; `queryIndependentAlignmentBoundaries` reads M-values for L/R alignment extents |
| 74 | City Code | Range Events | City_Code, FromARMeasure, ToARMeasure, BeginPMSuffix/EndPMSuffix | City code by AR range; queried in `queryCityBegins` for HSL and `queryRangeLayer` for all reports |
| 85 | County Code | Range Events | County_Code, FromARMeasure, ToARMeasure, District | County ranges on route; used in `onDistrictChange` (dropdown population), `queryCountyBegins`, `hsl_queryEndRecord`, `hsl_queryBeginRecord`. **Note:** stores 2-char codes without trailing period (e.g. `SJ`, not `SJ.`) — use `countyCodeMatches()` to compare |
| 114 | District Boundary Events | Range Events | District, RouteID, FromARMeasure, ToARMeasure | District extents per route; used by `hsl_queryEndRecord` / `hsl_queryBeginRecord` to find END/BEGIN OF DISTRICT AR measures |
| 116 | AllRoads (LRS) | Route Geometry | RouteID, FromARMeasure, ToARMeasure, Highway_Group | Route structure; `queryRangeLayer(116,'Highway_Group')` — also provides route max AR for END OF ROUTE detection |
| 123 | Landmarks (EV_SHS_LANDMARK) | Point Events | Landmarks_Short/Long, ARMeasure, RouteID, PMPrefix/Suffix/Measure | Highway landmarks; also drives route dropdown in `onCountyChange` |
| 130 | Population Code | Range Events | Population_Code, FromARMeasure, ToARMeasure | Rural/Urban classification |
| 131 | Ramp Attributes | Feature Table | Ramp_Name, Ramp_Description, Ramp_On_Off_Ind (0/1/2), Ramp_Design, Area4_Ind | Ramp descriptions & classification |
| 132 | Ramp Point Events (EV_SHS_RAMP) | Point Events | Ramp_Name, ARMeasure, ODMeasure, RouteID, PMPrefix/Suffix/Measure, County, District | **Primary ramp data source**; paginated (1000/page) |
| 133 | Route Breaks (EV_SHS_ROUTE_BREAK) | Point Events | ARMeasure, RouteID, Route_Break_Type | Route discontinuities (Route Break / Route Resume) |
| 149 | Intersection AOI | Polygons | — | Intersection area-of-interest polygons (legacy path; no longer used) |
| 151 | Intersection Attributes | Feature Table | INTERSECTION_ID, County_Code, District_Code, Main_RouteNum/PMPrefix/PMSuffix/PMMeasure, Cross_* | Intersection details; queried for both main-route and cross-route intersections; also provides county code domain for `loadCountyCodeDomain` |
| 157 | AADT | Point Events | AADT_YEAR, AADT, LRSFromDate | Average Annual Daily Traffic |
| 215 | HSL Crash Data (Route/District/County Index) | Feature Table | routeId, fromMeasure, District_Code, County, RouteNum, hslDescription, Highway_Group, FileType, distToNextLandmark, PMPrefix, PMSuffix, PMMeasure, LRSFromDate | **"Push to Crash"** target: `hsl_exportEdit` deletes existing records in the AR range and writes current HSL results; also drives cascading dropdown data |
| 304 | Route Directions | Table | ROUTE, FROM_, TO_ | Human-readable directional labels |

---

## shared.js — Critical Shared Library

### Global State Variables
```javascript
_token, _tokenExpiry, _portalUsername              // Auth state
_allResults, _currentPage, PAGE_SIZE=25            // Pagination (ramp detail / ramp summary)
_unresolvedIntersections                           // Intersections that failed PM→OD translate
_routeLabel, _directionFrom, _directionTo          // Active route display fields
_generatedOn                                       // Timestamp string for footer
_allRouteIds                                       // Set<string>: pre-fetched RouteIDs from layer 116
_routeDirectionCache                               // Map<cacheKey, {from,to}>: route direction cache
_countyNameToCode                                  // Map<name|code, 3-char code>: from loadCountyCodeDomain()
_hslLengths                                        // null | array: cached hsl_computeLengths result
_hslPageStarts                                     // null | array: cached hsl_computePageStarts result
```

### Key Functions

**Auth & initialization**

| Function | Purpose |
|----------|---------|
| `login()` | Redirect to ArcGIS OAuth authorize endpoint |
| `tokenIsValid()` | Check token presence and expiry |
| `initAuth()` | Parse hash fragment for OAuth token, call `setAuthUI` |
| `loadCountyCodeDomain()` | Load county name→code map from layer 151 |
| `loadRouteList()` | Pre-fetch all RouteIDs from layer 116 into `_allRouteIds` |
| `loadVersions()` | Populate version select from VMS; DEFAULT sorts first |

**Dropdowns & UI**

| Function | Purpose |
|----------|---------|
| `onDistrictChange()` | Query layer 85 for counties in selected district |
| `onCountyChange()` | Query layer 123 for routes in selected district+county |
| `selectMode(mode)` | Switch between 'routeMeasure' and 'districtRoute' UI modes |
| `populateCounties()` | Populate static `COUNTY_CODES` into from/to county dropdowns |
| `setupValidation()` | Input validation/mirroring for PM form fields |

**Query dispatch**

| Function | Purpose |
|----------|---------|
| `runDistrictRouteMode()` | Dispatch to report module's `*_runDistrictRouteMode()` |
| `runTranslate()` | Dispatch to report module's `*_runTranslate()` |
| `isPaginated()` | Returns `paginatedCheck.checked` |

**Versioning & date**

| Function | Purpose |
|----------|---------|
| `getVersion()` | Returns `versionSelect.value` ('' = Default) |
| `versionParam()` | Returns `{ gdbVersion: v }` or `{}` for Default — spread into all fetch bodies |
| `historicMomentParam()` | Returns `{ historicMoment: ms }` when `refDate` is set, else `{}` — spread into translate calls |
| `getDateFilter(startField?, endField?)` | Returns SQL fragment for reference-date filtering |

**Coordinate translation**

| Function | Purpose |
|----------|---------|
| `translateSection(routeIdR, routeIdL, measure)` | PM→AR translate via LRServer layer 3; returns `{ bestR, bestL }` |
| `makeSegment(fromPrimary, fromAlt, toPrimary, toAlt)` | Build segment descriptor widened by alt L-pmSuffix results |

**Core queries (shared.js)**

| Function | Purpose |
|----------|---------|
| `queryAttributeSet(segments, district?, county?)` | Paginate layer 132 (ramps); translate AR→OD for all results |
| `queryRouteDirection(routeNum)` | Layer 304; cached per route+version |

**Core queries (shared.js — used by all reports)**

| Function | Purpose |
|----------|---------|
| `queryRangeLayer(pairs, layerNum, fieldName, fromField?, toField?)` | Generic AR-range lookup; builds one query per unique routeId; returns `Map<name, value>` |
| `translateToOD(allPairs)` | Returns `Map<name, odMeasure>` from pre-populated `p.odMeasure` fields |

**Utilities**

| Function | Purpose |
|----------|---------|
| `normalizeCountyCode(county)` | Convert any county name/code → 3-char (e.g., "LA.") |
| `countyCodeMatches(storedCode, normalizedCode)` | Tolerant match for layer 85's trailing-period omission |
| `buildRouteId(s, alignment)` | Construct PM RouteId string from form section `{county, routeNum, routeSuffix, pmPrefix, pmSuffix}` and alignment char |
| `readSection(prefix)` | Read from/to form fields into a section descriptor object |
| `buildHslSegments(routeNum)` | Build P/S AR segments for HSL, filtered by `_allRouteIds` |
| `chunkArray(arr, size)` | Split array into chunks |
| `formatDate(ts)`, `padMeasure(val)`, `esc(str)` | String formatting |
| `getDistrictCounty()`, `getOnOffFilter()` | Filter helpers |
| `showConfirm(message)` | Returns `Promise<bool>` from modal confirm dialog |

**Report rendering**

| Function | Purpose |
|----------|---------|
| `renderActionBar(line1, line2, line3, onExport, onPrint)` | Three-column action bar HTML |
| `buildCoverPage({coverTitle, reportTitle, refDate, district, county, route})` | Shared print cover page HTML |
| `makePageController(getPage, setPage, getTotalPages, render)` | Pagination controller factory |
| `printAll()` / `exportToExcel()` | Dispatch to report module's print/export |
| `clearResults()` | Reset `_allResults`, `_hslLengths`, `_hslPageStarts`, UI |

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

### Versioning & Reference Date

Every query that touches the geodatabase includes:
- `gdbVersion` — from `versionParam()`. Default version omits the param entirely.
- `historicMoment` — from `historicMomentParam()`. Only translate calls use this; point/range queries use the SQL date filter instead.

The "Push to Crash" button (`hsl_exportEdit`) only appears when **both** a non-default version is selected AND the ref date equals today's date. It writes to layer 215 FeatureServer via `applyEdits`.

---

## Data Flow

### Ramp Detail / Ramp Summary District/Route Mode
```
Select District → query layer 85 for counties
Select County → query layer 123 for routes
Select Route → queryAttributeSet() on full range (-0.001 to 999.999)
→ enrich with queryRangeLayer(116,74,130), translateToOD, layer 131, layer 157
→ sort by ODMeasure → render → paginate
```

### Ramp Detail Postmile Mode
```
Enter From/To postmiles → translateSection() PM→AR (4 parallel: R/L × from/to)
→ makeSegment() to widen range across alt results
→ queryAttributeSet(segments) → same enrichment pipeline
```

### HSL District/Route Mode (hsl_runDistrictRouteMode)
```
Select District + County + Route
→ buildHslSegments() — P/S segments filtered by _allRouteIds

Phase 1: 9 parallel queries
  queryAttributeSet(segments, district, county)         → rampPairs
  queryLandmarks(segments, routeSuffix, district, county) → landmarkPairs (layer 123; AR→OD translated)
  queryRouteBreaks(segments, routeSuffix, district, county) → routeBreakPairs (layer 133; AR→OD translated)
  queryIntersections(segments, routeNum, district, county)  → {intersectionPairs, unresolved} (layer 151; PM→AR+OD translated)
  queryEquationPointsFromNetwork(segments, routeNum, d, c)  → equationPairs (layer 1→translate)
  queryCityBegins(segments, routeNum, district, county)     → cityBeginPairs (layer 74; AR→OD+PM translated)
  queryCountyBegins(segments, routeNum, district, county)   → countyBeginPairs (layer 85; AR→OD+PM translated)
  queryIndependentAlignmentBoundaries(segments, routeNum, county) → iaBoundaryPairs (layer 3 geometry; begin/end translated)
  queryRouteDirection(routeNum)                              → direction (layer 304)

Phase 2: HG pre-fetch
  queryRangeLayer(unsortedPairs, 116, 'Highway_Group') → hgMap
  Assign p.hgValue = hgMap.get(p.name) for all pairs

Phase 3: Sort pipeline
  hsl_fixCountyLineLandmarks(unsortedPairs)   ← runs before sort so county fields are correct at sort time
  sortWithIndependentAlignments(unsortedPairs)
  → hsl_filterCityBoundaries(sorted)
  → hsl_filterRealignmentLandmarks(filtered)
  → fixEqPairOrder(allPairs)

Phase 4: Terminal records
  hsl_queryEndRecord(segments, district, county, routeNum)
    → layers 114 (district) / 85 (county) / 116 (route) → AR→OD+PM translated
    → layer 1 for calibration PM endpoint
  hsl_queryBeginRecord(segments, district, county, routeNum)
    → same layer sequence for begin AR

Phase 5: Synthetic suppression
  hsl_applySyntheticHierarchy(allPairs)
    → tier-based suppression: hsl_end/begin_* > ia_bdry_* > city* > county*

Phase 6: Render pipeline
  hsl_queryRampDescriptions(allPairs, unresolvedIntersections, hgMap)
    → layer 131 (ramp descriptions) + queryRangeLayer(74,'City_Code') + translateToOD
    → hsl_showRampResults('success', null, results, unresolved)
    → _hslLengths = hsl_computeLengths(results)
    → _hslPageStarts = hsl_computePageStarts(results)
    → hsl_renderPage()
```

### HSL Postmile Mode (hsl_runTranslate)
Same as HSL district/route mode except Phase 1 starts with translate to get segments; no district/county filters on sub-queries.

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

All pair objects share these base fields:
`type, name, routeId, arMeasure, odMeasure, county, routeSuffix, pmPrefix, pmSuffix, pmMeasure, district, startDate, endDate`

### Ramp Object
```javascript
{
  type: 'ramp',
  name,              // Ramp_Name from layer 132
  hgValue,           // from queryRangeLayer(116) pre-fetch
  x, y,              // geometry coords from layer 132
  // After hsl_queryRampDescriptions:
  featureType,       // 'R'
  desc,              // from layer 131 Ramp_Description (uppercased)
  hwyGroup, cityCode
}
```

### Landmark / Route Break Object
```javascript
{
  type: 'landmark'|'routebreak',
  name,              // composite: "Landmarks_Short|ARMeasure" for landmarks; "rb_routeId_arMeasure" for route breaks
  desc,              // display text; for realignments: "BEGIN R REALIGNMENT" (prefix embedded)
  alignment,         // 'R' or 'L' (from layer 123 Alignment field)
  hgValue,           // from queryRangeLayer(116) pre-fetch
  // After hsl_queryRampDescriptions:
  featureType,       // 'H'
  hwyGroup, cityCode
}
```

### Equation Object (from queryEquationPointsFromNetwork)
```javascript
{
  type: 'equation',
  name,              // "eq1_net_routeId_pmMeasure" or "eq2_net_..."
  desc,              // 'PM EQUATION' (eq1) or '' (eq2)
  eqPairId,          // shared key: "eqnet_routeNum_odKey"
  isSecondEq,        // false = source measure row; true = "EQUATES TO" row
  pmSuffix,          // '.' or 'L' (for IA-alignment equations); eq2 uses 'E' as marker
  // After hsl_queryRampDescriptions:
  featureType        // 'H'
}
```

### Intersection Object
```javascript
{
  type: 'intersection',
  name,              // String(INTERSECTION_ID)
  desc,              // Intersection_Name; if crossPmMeasure: appended "[crossRouteLabel PM]"
  county, district,
  pmPrefix, pmSuffix, pmMeasure,
  pmRouteId,         // PM-network RouteId used for translate
  isCross,           // true if queried route is the Cross_RouteNum (not Main_RouteNum)
  crossRouteFormatted, // true if cross route num < main route num → display "*desc*"
  hasCrossRoute,     // true if crossRouteFormatted OR crossPmMeasure != null
  crossPmMeasure,    // other route's PM at intersection, or null
  crossRouteLabel,   // formatted cross-route RouteId string
  // After translate:
  arMeasure, odMeasure,
  // After hsl_queryRampDescriptions:
  featureType        // 'I'
}
```

### City / County Boundary Objects
```javascript
// type: 'citybegin'|'cityend'
{
  type, name,        // "cb_routeId_arMeasure" or "ce_..." 
  desc,              // "CITY BEGIN: cityCode" etc.
  cityCode,          // read directly in rendering (not from cityMap)
  // county/district come from PM translation result
}

// type: 'countybegin'|'countyend'
{
  type, name,        // "kb_routeId_arMeasure" or "ke_..."
  desc,              // "COUNTY BEGIN: countyCode" etc.
  county,            // from County_Code field (layer 85)
}
```

### Synthetic Terminal / IA Boundary Objects
```javascript
// hsl_queryEndRecord / hsl_queryBeginRecord
{
  type: 'landmark',
  name: 'hsl_end_routeId_arMeasure' | 'hsl_begin_routeId_arMeasure',
  desc: 'END OF ROUTE NNN' | 'END OF DISTRICT' | 'END OF COUNTY' | 'BEGIN ROUTE',
  hgValue: '',
}

// queryIndependentAlignmentBoundaries
{
  type: 'landmark',
  name: 'ia_bdry_L|R_0_begin|end_pmMeasureX1000',
  desc: 'BEGIN/END LEFT/RIGHT INDEPENDENT ALIGNMENT',
  pmSuffix: 'L' | 'R',
  alignment: 'L' | 'R',
}
```

### Synthetic Record Name Prefixes (for `name.startsWith()` checks)
| Prefix | Source | CSS Class |
|--------|--------|-----------|
| `hsl_end_` | `hsl_queryEndRecord` | `hsl-item-cb` / `hsl-row-cb` |
| `hsl_begin_` | `hsl_queryBeginRecord` | `hsl-item-cb` / `hsl-row-cb` |
| `ia_bdry_` | `queryIndependentAlignmentBoundaries` | `hsl-item-cb` / `hsl-row-cb` |
| `rb_` | `queryRouteBreaks` | `hsl-item-rb` / `hsl-row-rb` |
| `cb_` / `ce_` | `queryCityBegins` (begin/end) | `hsl-item-cb` / `hsl-row-cb` |
| `kb_` / `ke_` | `queryCountyBegins` (begin/end) | `hsl-item-cb` / `hsl-row-cb` |
| `eq1_net_` / `eq2_net_` | `queryEquationPointsFromNetwork` | `hsl-item-eq` / `hsl-row-eq` |

---

## Naming Conventions

- **Global state vars:** `_camelCase` prefix underscore
- **Report-specific vars:** `_reportPrefix_varName` (e.g., `_intd_allResults`)
- **Constants:** `ALL_CAPS` (e.g., `PAGE_SIZE`, `HL_ROWS_PER_PAGE`)
- **Section headers in code:** `// ── SECTION NAME ──────────────────`
- **DOM IDs:** `kebab-case` (e.g., `report-select`, `from-measure`)
- **CSS classes:** `kebab-case`; BEM-inspired for custom select: `.cs`, `.cs-trigger`, `.cs-option`

---

## HSL Rendering & Output

### hsl_computePageStarts
Pages split when `PAGE_SIZE` (25) rows are reached **or** when the district field changes (non-empty change). Equation pair protection: if a size-based break would put eq2 at the top of a new page, the break is pulled back by 1 to keep eq1/eq2 together.

### hsl_computeLengths
Produces an array parallel to `results`. Each entry is `(nextOD - curOD).toFixed(3)` or `''`.
- Skips eq1 (`!p.isSecondEq`) and Route Break records — no length shown.
- pmSuffix-aware: R-suffix records look for next-H that isn't L-suffix; L-suffix looks for next-H that isn't R-suffix; dot-suffix skips R/L-suffix H records.
- Terminal records (`hsl_end_*`, `END * REALIGNMENT`, `END TEMPORARY CONNECTION`) get `'0.000'` when no next entry exists.

### hsl_renderItem / hsl_renderItemAsRow
Screen vs. print row renderers. Key display rules:
- **eq1 rows**: span columns 6–9 with "EQUATES TO" text; no length or desc cell.
- **HG column**: `pmSuffix=L` → shows `L`; `isSecondEq && pmSuffix=L` → shows `E`; otherwise shows `hwyGroup`.
- **Length column**: `crossRouteFormatted` → `------->` ; `hasCrossRoute` → `*P*` ; else distance if H-type.
- **Row colors**: `hsl-item-eq` (equation), `hsl-item-rb` (route breaks), `hsl-item-cb` (city/county/hsl_end/begin/realignment/IA boundary), `hsl-item-ia-r` (R alignment), `hsl-item-ia-l` (L alignment).
- **Intersection desc**: if `crossPmMeasure` → appends `[crossRouteLabel PM]`.

### hsl_printAll
- Renders cover page + legend page + paginated `<table>` sections (one per `_hslPageStarts` entry).
- Each page section has its own district/route header.
- Uses `_hslLengths` (cached) for distance column.

### hsl_buildLegendPage
Renders full legend: HG codes (R/L/D/U/X), File Type codes (H/I/R), Route Suffix codes (S/U), PM Prefix codes (C/D/G/H/L/M/N/R/S/T), PM Suffix codes (E), font color key, and length notation (*P* meaning).

### hsl_exportToExcel
SheetJS export. Columns: County, City, [PM prefix], PM, [E suffix], HG, FT, Distance To Next Point, Description.
Uses `_hslLengths ?? hsl_computeLengths(_allResults)`.

### hsl_exportEdit ("Push to Crash")
Writes the current HSL screen results to **layer 215 FeatureServer** in the selected `gdbVersion`.
1. Resolves point geometry via `LRServer/networkLayers/4/measureToGeometry` (100 at a time).
2. Queries existing records in the AR range → deletes them via `applyEdits` (500 OIDs at a time).
3. Inserts new records via `applyEdits` (50 at a time).
4. Verifies final count with a count-only query.
5. Button only visible when `getVersion() !== ''` AND `refDate === today`.

### hsl_applySyntheticHierarchy
Post-pipeline suppression pass applied **after** begin/end records have been inserted.
Suppression tiers (lower tiers hidden when higher tier exists at same AR ± 0.001):
1. `hsl_end_*` / `hsl_begin_*` — always shown
2. `ia_bdry_*` — suppressed if tier 1 at same AR
3. `citybegin|cityend` — suppressed if tier 1 or 2 at same AR
4. `countybegin|countyend` — suppressed if tier 1, 2, or 3 at same AR

---

## HSL Sub-Query Details

### queryLandmarks (layer 123)
- Queries by RouteNum+ARMeasure range (not RouteID) so both P and S routes are captured in one clause.
- Uses composite key `"Landmarks_Short|ARMeasure"` as `pair.name` to allow multiple identical names at different ARs.
- BEGIN/END REALIGNMENT landmarks get the pmPrefix embedded in desc (e.g., `"BEGIN R REALIGNMENT"`).
- **County filter applied** — `AND County = '<code>'` included in WHERE when county is selected. Note: landmarks stored under the adjacent county at a county boundary (e.g. TRONA RD stored as `county=INY` at the SBD/INY line) will be excluded by this filter in county-scoped reports — accepted as a known data-quality limitation.
- All results AR→OD translated (network 4→5).

### queryRouteBreaks (layer 133)
- Route_Break_Type → `desc` ('Route Break' or 'Route Resume').
- Name format: `rb_routeId_arMeasure`.
- All results AR→OD translated.

### queryEquationPointsFromNetwork (layer 1)
Two-pass pairing strategy:
1. **Pass 1 (OD-based):** Group calibration points by OD measure (3dp). Groups of exactly 2 distinct PMs = one equation pair. Lower AR = eq1, higher AR = eq2.
2. **Pass 2 (AR fallback):** For unpaired points, pair by AR proximity (≤ 0.005). Guards: same indL/indR classification; not duplicate (same PM); AR threshold to avoid false pairs from RouteId variants.

County is required — `queryEquationPointsFromNetwork` returns `[]` if county unresolved.

### queryCityBegins (layer 74)
- Queries both _P and _S RouteIDs (city ranges on L alignments stored under _S).
- `BeginPMSuffix === 'L'` or `EndPMSuffix === 'L'` records are suppressed (city boundary already crossed on main alignment).
- AR→PM (network 4→3) and AR→OD (network 4→5) translated. PM translation sets county from PM routeId.
- County filter applied **post-translation** (not in WHERE, since a city range can span county boundary).
- When a city code appears in multiple non-contiguous segments, all intermediate `citybegin`/`cityend` records are kept as-is (no break/resume conversion).

### queryCountyBegins (layer 85)
- _P routes only; county boundaries on L alignments excluded.
- AR→PM and AR→OD translated; county-prefixed result selection for PM.
- Collapses multiple non-contiguous segments per county to min/max outer bounds (no BREAK/RESUME for counties).

### queryIndependentAlignmentBoundaries (layer 3)
- Queries all L/R PMSuffix routes for the route number; filters by county post-query.
- Extracts M-values from polyline geometry (M-aware coordinates: `[x, y, z?, m]`).
- Produces synthetic `BEGIN/END LEFT/RIGHT INDEPENDENT ALIGNMENT` landmark pairs at PM min/max.
- Names: `ia_bdry_L|R_0_begin|end_pmMeasureX1000`.
- AR selection prefers `SHS_` + routeNum + non-`_S` routes to avoid merge/concurrent route contamination.

### queryIntersections → queryIntersectionsByDistrict (layers 151)
- Queries layer 151 twice in parallel: once as Main_RouteNum, once as Cross_RouteNum.
- Main results take priority for an intersection ID; cross results fill in missing IDs.
- `crossRouteFormatted`: cross route num < main route num → shows `*desc*` in screen.
- `crossPmMeasure`: appended to desc as `[crossRouteLabel PM_value]`.
- Unresolved = any intersection whose PM→OD translate returned null → collected in `_unresolvedIntersections`.

### hsl_queryEndRecord / hsl_queryBeginRecord
Priority for AR measure source:
- End: district? → layer 114 ToARMeasure; county? → layer 85 ToARMeasure; else → layer 116 ToARMeasure.
  - When district+county: county layer 85 overrides district layer 114.
  - When district/county boundary coincides with route end (layer 116 ±0.005): label → `END OF ROUTE NNN`.
- Begin: same layers for FromARMeasure; district+county: max of both.
- Translate at `lookupMeasure` (end: `floor(AR*1000)/1000 - 0.001`; begin: `AR + 0.0001`) to land inside the boundary.
- PM endpoint refined by querying layer 1 for max calibration Measure on that PM routeId.
- Suppressed by `hsl_runDistrictRouteMode` if last allPair is already a city/county boundary at that AR.
- Pruned: realignment/temporary-connection landmarks at same PM are removed in favor of the terminal record.

---

## Incomplete / Known Issues

| Issue | Location | Notes |
|-------|----------|-------|
| **Intersection Summary not implemented** | intersection_summary.js | 19-line stub, returns error message |
| **Highway Log missing postmile mode** | highway_log.js | District/route only |
| **OAuth credentials in config.js** | config.js | Production client ID committed to public repo |
| **No tests** | — | Zero test coverage |
| **Layer 132 transfer limit** | shared.js queryAttributeSet | Paginated (resultOffset loop, 1000/page); other point/range layers still have 1000-record ceiling |

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

4. **Pair** adjacent points within 0.005 AR of each other. Since the array is sorted by AR, `points[i]` (lower AR) is always eq1 and `points[j]` (higher AR) is always eq2. Each point is used in at most one pair.

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

#### Step 1.5 — Alignment-start AR fixup (pre-sort)

Before sorting, eq2 records with a non-empty `pmPrefix` and `pmMeasure ≈ 0` (marking the start of an R/L alignment) have their `arMeasure` clamped:

```javascript
p.arMeasure = Math.min(p.arMeasure, minPfxAr - 0.0005);
```

where `minPfxAr` is the minimum AR of all non-IA-boundary records sharing the same `pmPrefix`. This handles both undershoot and overshoot from calibration translation — without it the outer grouping loop could reach an R/L record before eq2 and start a premature section.

#### Step 2 — Sort remaining records by ARMeasure

Records are sorted by AR rounded to 3dp. Tiebreaks (in order):
- If `diff !== 0` but one record is a city boundary (`citybegin`/`cityend`) and the other is an intersection or ramp with the **same normalized PM key**: city boundary sorts first. Handles cases where layer 74 AR values don't exactly match translated intersection ARs.
- `pmPrefix` `'.'` and `''` are normalized to `''` in all PM key comparisons.
- Equation records sort before all others at the same rounded AR.
- E-suffix records sort last at the same AR (except eq2, which uses `pmSuffix='E'` as a rendering marker and must not be treated as an end-marker).
- Within the same PM key: H (landmarks/equations/route breaks/city records) before I (intersections) before R (ramps). Within H, HG=H records sort before others.

NaN AR values are treated as `Infinity`.

#### Step 3 — Group independent alignment sections (R before L)

`isIABoundaryRec` identifies BEGIN/END INDEPENDENT ALIGNMENT landmark records using a pattern match:
```javascript
const isIABoundaryRec = p => p.type === 'landmark' && p.desc && /INDEP/i.test(p.desc);
```
This catches all abbreviations used in the data ("BEG INDEP ALIGN", "END INDEP ALIGN LT & RT", "BEGIN INDEP ALIGN - LT", etc.). REALIGNMENT records ("BEGIN REALIGNMENT", "END REALIGNMENT") are intentionally **not** matched here — they still trigger sections via the outer loop like any other sfx:R/L record.

The outer loop triggers a section when it sees an R or L pmSuffix record **that is not an IA boundary landmark**. Those boundary landmarks pass through the `else` branch individually at their natural AR position.

```javascript
if ((main[i].pmSuffix === 'R' || main[i].pmSuffix === 'L') && !isIABoundaryRec(main[i])) {
  // section grouping ...
} else {
  grouped.push(main[i++]);
}
```

The inner loop that consumes the section has these critical guards:
1. **Equation records are never consumed by `hgValue`** — their HG reflects the alignment at their calibration-derived AR, not their logical position. Consuming them via `hgValue` would pull eq2 into the section and reorder it after the L group.
2. **eq2 records with `pmSuffix='E'` break the inner loop** — eq2 uses `sfx:E` as a rendering marker, not as an alignment boundary.
3. **County guard on sfx/hg consume path** — if a record's county differs from the section-trigger county (`sectionCounty`), the loop breaks. Prevents cross-county bundling (e.g. MNO records being consumed into an INY section).
4. **IA boundary records break the dot-else path** — when the inner loop reaches an `isIABoundaryRec` record on the neutral dot path, it breaks immediately rather than consuming it.
5. **Dot-else lookahead stops at IA boundaries and sfx:R BEGIN REALIGNMENT** — the forward scan that decides whether to consume a neutral dot record stops if it sees an `isIABoundaryRec` record (no R/L remaining in this span) or a sfx:R "BEGIN REALIGNMENT" landmark (that record is the next section trigger, not a continuation). Note: sfx:L "BEGIN REALIGNMENT" does NOT stop the lookahead — L realignment markers can legitimately appear inside sections.

Section output order:
1. R group: `pmSuffix === 'R'` records confirmed by `hgValue === 'R'` or `alignment === 'R'`
2. L group: `pmSuffix === 'L'` records
3. E-suffix end markers: `pmSuffix === 'E' && type !== 'equation'`
4. Trailing dot-suffix records (END INDEP ALIGN via `hgValue`), then unconfirmed R-suffix records

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

### Post-Sort: `fixEqPairOrder`

**Location:** `shared.js`
**Called by:** both `hsl_runDistrictRouteMode` and `hsl_runTranslate` after the sort pipeline.

When two equation-pair records have the same AR to 3dp, the AR-based sort may put them in the wrong order relative to surrounding context. `fixEqPairOrder` scans for adjacent eq1/eq2 pairs at the same 3dp AR, checks the nearest preceding and following H-type record prefixes, and swaps the PM-related fields (`pmPrefix, pmSuffix, pmMeasure, routeId, arMeasure, odMeasure, county, name`) if eq2's prefix better matches the preceding context than eq1's does.

- Only swaps PM-related fields; structural fields (`desc, isSecondEq, eqPairId, type`) stay in place so rendering labels are unaffected.
- Uses H-type context records only (landmarks, route breaks, city boundaries) — ramps and intersections can have stale pmPrefix values.
- Primary signal: the preceding H record should share its prefix with eq1. Secondary (no prev H): eq2 should match the following context.

### Full Pipeline After Sort

```
hsl_fixCountyLineLandmarks(unsortedPairs)
  Runs BEFORE sort so county fields are authoritative at sort time.
  Reassigns county/PM of landmarks stored with the wrong county in layer 123
  (e.g. TRONA RD stored as INY at the SBD/INY line → reassigned to SBD/14.778).
  Guard: if a countybegin at the same AR has the same county as the landmark,
  the landmark is correctly stored as the new county's beginning marker
  (e.g. "BEGIN OF COUNTY" stored as COL/0.000) — skip reassignment.
  ↓
sortWithIndependentAlignments(unsortedPairs)
  County-end vs landmark tiebreak (same AR):
    Same county  → landmark sorts first (physical location in ending county, e.g. TRONA RD)
    Diff county  → countyend sorts first (landmark is incoming county marker, e.g. "BEGIN OF COUNTY")
  ↓
hsl_filterCityBoundaries(sorted)
  Drops citybegin/cityend records whose AR falls outside
  the non-city AR extent, whose ODMeasure < 0, or whose pmMeasure < 0.
  Also suppresses countybegin records when a natural H landmark exists at the same PM.
  ↓
hsl_filterRealignmentLandmarks(filtered)
  Removes BEGIN/END REALIGNMENT landmarks whose pmKey matches any other record.
  Only keeps alignment='R' realignment landmarks (L duplicates are always dropped).
  Keeps realignment landmarks with blank/null pmMeasure (no pmKey to match against).
  ↓
allPairs — final ordered list passed to hsl_renderPage()
```

### pmKey Definitions

**`sortWithIndependentAlignments` / `hsl_filterCityBoundaries`** (suffix included, no county):
```javascript
const normPfx = p => (p.pmPrefix === '.' ? '' : (p.pmPrefix ?? ''));
const pmKey = p => `${normPfx(p)}|${parseFloat(p.pmMeasure).toFixed(3)}|${p.pmSuffix}`;
// e.g., "R|0.000|R"  or  "C|0.000|."
```

**`hsl_filterRealignmentLandmarks`** (county included, suffix excluded):
```javascript
const normPfx = p => (p.pmPrefix === '.' ? '' : (p.pmPrefix ?? ''));
const pmKey = p => `${p.county ?? ''}|${normPfx(p)}|${parseFloat(p.pmMeasure).toFixed(3)}`;
// e.g., "MNO|R|0.000"  or  "INY||3.049"
// County is included to prevent a natural H record in one county (e.g. KERN/INYO CO LINE
// at pfx:R pm:0 in INY) from suppressing a realignment in a different county
// (e.g. MNO BEGIN REALIGNMENT at pfx:R pm:0). Suffix is excluded because equation
// points carry pmSuffix 'E' while co-located realignment landmarks carry '.'.
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
