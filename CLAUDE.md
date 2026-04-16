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
  type: 'landmark'|'equation'|'routebreak'|'citybegin'|'cityend'|'citybreak'|'cityresume'|'districtbegin'|'districtend',
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

### Full Pipeline After Sort

```
sortWithIndependentAlignments(unsortedPairs)
  ↓
hsl_filterCityBoundaries(sorted)
  Drops citybegin/cityend/citybreak/cityresume records whose AR falls outside
  the non-city AR extent, whose ODMeasure < 0, or whose pmMeasure < 0.
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

## City Segment Deduplication (`hsl_deduplicateCitySegments`)

When a city code appears in multiple non-contiguous segments on the same route, intermediate endpoints are converted (not dropped):

| Position | Original type | New type | New desc |
|----------|--------------|----------|---------|
| First record (lowest AR) | `citybegin` | `citybegin` | unchanged |
| Intermediate exit | `cityend` | `citybreak` | `CITY BREAK: <code>` |
| Intermediate re-entry | `citybegin` | `cityresume` | `CITY RESUME: <code>` |
| Last record (highest AR) | `cityend` | `cityend` | unchanged |

Single-segment cities pass through unchanged. All four types (`citybegin`, `cityend`, `citybreak`, `cityresume`) are treated identically by `hsl_filterCityBoundaries` (AR extent / OD / PM range checks) and by the render pipeline (`featureType='H'`, `hsl-item-cb` row class, `cityCode` read directly from the record).

City begin/end records on an L independent alignment are suppressed at source in `hsl_queryCityBoundaries` (`BeginPMSuffix === 'L'` or `EndPMSuffix === 'L'`) — the city boundary was already crossed on the main alignment before the split.

---

## Debug Helper (`hsl_logEqNeighbors`)

```javascript
hsl_logEqNeighbors(allPairs, label)
```

Called automatically after `fixEqPairOrder` in both district/route and postmile modes. Prints each equation pair with 3 records of context on each side:

```
[eqLog district/route] eq pair @ index N  pairId:<id>
  [N-3]  [landmark  pfx:R  pm:...  ...]
  ...
► eq1   [equation(eq1)  pfx:  pm:...  ...]
► eq2   [equation(eq2)  pfx:R  pm:...  ...]
  [N+2]  [landmark  pfx:R  pm:...  ...]
```

Useful for diagnosing sort order, prefix-swap decisions, and alignment grouping issues.

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
