# TSMIS Reports

A single-page web application for querying and displaying Caltrans highway and ramp data from the TSNR ArcGIS map service.

## Reports

### Highway Sequence Listing (HSL)
Displays highway features in sequence along a route, including post mile data, highway groups, feature types, distances, and descriptions. Supports equation points and supplemental alignments.

### TSAR: Ramp Detail
Displays individual ramp records along a route with attributes including highway group, feature type, on/off indicator, ramp design, population group, city code, AADT, and OD measure.

### TSAR: Ramp Summary
Displays aggregate counts of ramps along a route grouped by:
- **Highway Groups** — R, D, U, X, L (PMSuffix L override from layer 132)
- **On/Off Indicator** — On, Off, Other
- **Population Groups** — Rural/Urban × Inside/Outside City
- **Ramp Types** — A through Z design codes

Also reports total ramp count and ramp points without linework (ramps in layer 132 with no corresponding layer 131 record).

## Query Methods

| Method | Description |
|---|---|
| **Route** | All ramps on a selected route |
| **District/Route** | Ramps on a route within a specific district |
| **Route/Measure** | Ramps between two PM locations (with translation) |

An optional **On/Off filter** (All / ON / OFF / OTHER) is available for all three methods. For Ramp Summary, this filter also changes the report title and restricts all summary counts to the selected category.

## Configuration

Edit `config.js` to point to your ArcGIS environment:

```js
const CONFIG = {
  mapServiceUrl:     "https://<host>/arcgis/rest/services/.../MapServer",
  vmsUrl:            "https://<host>/arcgis/rest/services/.../VersionManagementServer",
  oauthClientId:     "<client-id>",
  oauthAuthorizeUrl: "https://<host>/portal/sharing/rest/oauth2/authorize",
  oauthTokenUrl:     "https://<host>/portal/sharing/rest/oauth2/token",
  oauthRedirectUrl:  "http://localhost:5500/index.html"
};
```

Authentication uses OAuth 2.0 implicit flow. The redirect URL must match a registered app in your ArcGIS portal.

## Map Service Layers

| Layer | Contents |
|---|---|
| 74 | City Code |
| 116 | Highway Group |
| 130 | Population Code |
| 131 | Ramp attributes (On/Off, Ramp Design, Description) |
| 132 | Ramp point events (primary source for ramp pairs; fields include RouteNum, Alignment for AADT matching) |
| 157 | AADT — matched to ramps by PM attribution (RouteNum, RouteSuffix, Alignment, County, PMPrefix, PMSuffix, PMMeasure); highest AADT_YEAR selected, AADT_CODE=1 breaks ties |

## HSL Record Suppression Logic

Several record types synthesized or queried for the HSL are conditionally suppressed to avoid duplicate or spurious rows. In all cases, "FT=H record" means any record whose type is not `intersection` and not `ramp` (i.e. landmarks, route breaks, equations, city/county boundaries, and the created begin/end records themselves).

PM key is defined as `pmPrefix | pmMeasure.toFixed(3) | pmSuffix`.

---

### Created BEGIN Record (`hsl_queryBeginRecord`)

Suppressed (not prepended to the list) if **any FT=H record** in `allPairs` has a PM key within **±0.002** of the begin record's PM (same prefix and suffix). If the begin record has no valid PM measure it is always shown.

---

### Created END Record (`hsl_queryEndRecord`)

- Not created at all if the last pair in the sorted list is a `cityend` or `citybegin`.
- Suppressed (not appended) if **any FT=H record** in `allPairs` has the **exact same PM key**.
- If the end record has no valid PM measure it is always shown.

---

### City Begin/End Records (`hsl_filterCityBoundaries`)

Applied before the created begin/end check. Each `citybegin` and `cityend` record is dropped if **any** of the following are true:

1. Its AR measure falls outside the non-city AR extent by more than **0.005**.
2. Its OD measure is **negative**.
3. Its PM measure is **negative** or negative-zero (boundary precedes the start of the queried segment).
4. Its AR measure is within **0.01** of a route break or route resume record.

City begin/end records are always displayed even when another H record shares the same PM key.

When a city spans multiple non-contiguous route segments, all intermediate `citybegin`/`cityend` records are kept as-is.

City begin/end records on an **L independent alignment** (`EndPMSuffix === 'L'` or `BeginPMSuffix === 'L'`) are suppressed at source — the city boundary was already crossed on the main alignment before the split.

#### Compact pass (four sub-passes, applied after the per-record filters above)

Removes structural noise that arises from overlapping or adjacent layer 74 features. Operates on city records only; all non-city records pass through unchanged.

| Pass | Rule |
|------|------|
| 1 | Drop duplicate same-type same-city records within **0.01 AR** of each other (keep first). |
| 2 | Cancel a same-city `cityend`+`citybegin` pair within **0.01 AR** (zero-width gap in city coverage). |
| 3 | For consecutive same-type same-city runs: keep the **first** begin and the **last** end. |
| 4 | Drop a leading `cityend` when a `citybegin` exists at the same AR (≤ 0.01). A report should not open with a city-end for a city that was never begun. |

#### City code column assignment

City codes shown in the city column for non-boundary records (landmarks, ramps, intersections) are derived by scanning the **pre-suppression** city begin/end records in AR order — not from a separate `queryRangeLayer` call. This ensures the city column is exactly consistent with the CITY BEGIN/END rows visible in the report, and avoids phantom assignments from out-of-district or overlapping layer 74 features that `queryCityBegins` correctly excludes.

---

### BEGIN/END REALIGNMENT Landmarks (`hsl_filterRealignmentLandmarks`)

Applied to `type === 'landmark'` records whose `desc` is `'BEGIN REALIGNMENT'` or `'END REALIGNMENT'`. A realignment landmark is dropped if **any** of the following are true:

1. Its `alignment` field is not `'R'` (hard guard — only R-alignment realignment markers are valid).
2. It is an `END REALIGNMENT` and a `BEGIN REALIGNMENT` exists at the **same AR measure** (within 0.001) — this means the route transitions directly into an independent alignment section rather than terminating the realignment.
3. Its PM key matches **any FT=H record** (excludes intersections, ramps, and other realignment landmarks from the comparison set).

If the realignment record has no valid PM measure it passes all three checks and is always shown.

---

### BEGIN/END TEMPORARY CONNECTION/CONNECTOR Landmarks (`hsl_filterRealignmentLandmarks`)

`BEGIN TEMPORARY CONNECTION`, `END TEMPORARY CONNECTION`, `BEGIN TEMPORARY CONNECTOR`, and `END TEMPORARY CONNECTOR` landmarks are suppressed when a natural `INDEP ALIGN` landmark from layer 123 exists at the **same AR** (within **0.01**). This avoids redundant rows when both records appear at the same location — the independent alignment description conveys the structural transition more precisely.

If no coincident INDEP ALIGN landmark exists, the TEMPORARY CONNECTION/CONNECTOR landmark is always shown in **green** (`hsl-item-cb` row class).

---

### Route Break / Route Resume Records (`hsl_applyRouteBreakEquations`)

Route Break and Route Resume pairs are linked by their `Route_Break_ID`. When a matching landmark exists at the same PM prefix + measure as a route break or resume:

- If **exactly one** landmark shares the same PM prefix and measure (within 0.001), its description is appended to the route break/resume desc (e.g., `ROUTE RESUME N JCT ST FAI 680`), and the standalone landmark row is **suppressed**.
- If **zero or more than one** landmark matches, standard text (`ROUTE BREAK` / `ROUTE RESUME`) is used with no appended description.

Route Break and Route Resume are always kept on **consecutive lines** — any records sorted between them (e.g., a co-located landmark before absorption) are moved to just after the Route Resume.

In the report, the words `ROUTE BREAK` or `ROUTE RESUME` are displayed in **bold**, with any appended landmark description in normal weight.

---

---

## Equation Point Logic (`queryEquationPointsFromNetwork`)

Equation points mark locations where one PM numbering system ends and another begins (e.g., at county lines where PM resets to 0). Each equation point is rendered as a pair of rows: an **EQUATES TO** row (eq1) showing the departing PM, and a second row (eq2) showing the arriving PM with `E` in the suffix column.

### Data Source

Layer 1 (PM network calibration points, `NetworkId=2`). When a county is specified, queried using `RouteId LIKE '${county}${route}%'` (e.g., `TUO108%`). When county=All, layer 85 is queried first to discover all counties on the route; OR'd `LIKE` clauses cover all counties. Each calibration point carries its PM measure and a `RouteId` that encodes:

| Position | Field | Example |
|---|---|---|
| 0–2 | County code | `TUO` |
| 3–5 | Route number | `108` |
| 6 | Route suffix | `.` |
| 7 | PM prefix | `R`, `T`, `.` |
| 8 | PM suffix | `.`, `L` |
| 9 | Alignment | `R`, `L`, `.` |

Each point is translated to AR (layer 4) and OD (layer 5) simultaneously. Points outside the queried segment's AR range are discarded.

### Pairing (two passes)

**Pass 1 — OD-based:** Points are grouped by OD measure (3dp). A group of exactly 2 distinct PM values at the same OD forms a valid equation pair. Groups are skipped if:
- More than 2 distinct PMs are present at the same OD
- The two points have mismatched `pmSuffix='L'` (one is L-suffix, the other is not)

Points paired in Pass 1 are excluded from Pass 2.

**Pass 2 — AR fallback:** For unpaired points, any two points within AR ≤ 0.005 of each other are paired. A candidate pair is skipped if:
- PMs are equal to 3dp (duplicate RouteId variants of the same calibration point)
- AR < 0.0005 AND PM difference < threshold (0.01 for L-suffix pairs, 0.001 otherwise) — near-identical duplicates
- PM pair key already used (prevents double-pairing)
- Same PM prefix AND same county — consecutive calibration marks within one PM system, never an equation boundary
- j's prefix matches a **twin prefix** — a different-prefix point at i's location with the same PM to 3dp (within 0.005 AR). The twin already represents that prefix system at this point; pairing i with another point of the same prefix would create a spurious equation from residual calibration data left in the layer after a prefix transition handled elsewhere

OD matching is **not** required — at genuine equation points the OD network has a discontinuity, so both sides intentionally produce different OD values.

Each point pairs with at most one other.

### Pair structure

| Field | eq1 (`isSecondEq=false`) | eq2 (`isSecondEq=true`) |
|---|---|---|
| `desc` | `'PM EQUATION'` | `''` |
| `arMeasure` | lower AR | higher AR |
| `pmSuffix` | from RouteId | `'E'` (rendering marker), or `'L'` if both points are L-suffix |
| Rendered label | `EQUATES TO` spanning columns | normal PM row with `E` in suffix column |

### Landmark Enrichment

If one or more landmarks share the same PM prefix + measure (within 0.001) as eq1 or eq2, that landmark's description is absorbed into the equation row and the standalone landmark row(s) are suppressed.

- **eq1 row**: "EQUATES TO" becomes `EQUATES TO landmark desc` (keyword in bold)
- **eq2 row**: landmark desc appears in the description column

When multiple matching landmarks all share the **same description** (e.g. duplicates from P- and S-route storage in layer 123), the one closest by AR to the equation row is used and all are suppressed. If the descriptions differ, enrichment is skipped (ambiguous case).

**INDEP ALIGN fallback:** When the primary check finds no unambiguous match and the equation pair has a known alignment ('R' or 'L'), a second pass searches INDEP ALIGN landmarks at the same PM using description direction keywords as the discriminator:
- R eq pair → absorbs landmarks with no `LT` in the description (RT-only or generic)
- L eq pair → absorbs landmarks with `LT` in the description, or generic (no `RT` either)

This handles locations where two INDEP ALIGN landmarks share the same PM but differ in description (e.g. "END INDEP ALGN,RT; PM R" and "END INDEP ALIGN LT & RT"). The layer 123 `Alignment` field is not used because bilateral records are often stored with `alignment='R'` regardless. Absorbed INDEP ALIGN landmarks render in green.

This is independent of the route-break landmark enrichment. Equation pairs already handled by the route-break equation logic are excluded from this pass.

---

### Sorting

`sortWithIndependentAlignments` handles equation records specially:

1. eq1 records are **removed** from the sort array before sorting, stored in a map by `eqPairId`.
2. **Alignment-start AR fixup** — before sorting, eq2 records with a non-empty `pmPrefix` and `pmMeasure ≈ 0` (marking the start of an R/L alignment) have their `arMeasure` clamped to just below the minimum AR of all non-IA-boundary records sharing the same `pmPrefix` (`Math.min(eq2.arMeasure, minPfxAr - 0.0005)`). This handles both undershoot and overshoot from calibration translation, ensuring the outer grouping loop never reaches an alignment record before eq2.
3. eq2 records sort **before all other types** at the same rounded AR position. City boundary records sort before intersections/ramps when their AR differs slightly but their PM key matches (layer 74 AR values don't always align exactly with translated intersection ARs). `pmPrefix` `'.'` and `''` are normalized to the same key.
4. The grouping loop that separates R and L sections has two guards to prevent equation records from being misclassified: (a) equation records are excluded from `hgValue`-based section consumption (their `hgValue` reflects the alignment at their calibration AR, not their logical position); (b) eq2 records are excluded from the E-suffix end-marker group. BEGIN/END INDEPENDENT ALIGNMENT boundary landmarks are also excluded from triggering section grouping and pass through individually.
5. After sorting, each eq1 is **re-inserted** immediately before its eq2 partner.
6. When a non-equation record shares OD/AR with an eq2, it is placed before the pair if its PM matches eq1, or after if its PM matches eq2.

### `fixEqPairOrder`

When eq1 and eq2 share the same AR to 3dp, the lower-AR sort tiebreak may not correctly determine which PM belongs on the departing side vs. the arriving side. This pass corrects the order by reading context from surrounding records.

**Algorithm:**
1. For each consecutive eq1/eq2 pair sharing the same AR to 3dp:
2. Scan outward in both directions for the nearest context record. Any non-equation record qualifies **except** those whose PMMeasure is within 0.001 of either eq point's PM (co-located records carry the arriving-system PM and give a wrong signal).
3. **If prefixes differ** — primary signal: preceding record should share prefix with eq1 (departing side); if eq2 matches instead → swap. Secondary (no preceding): following record should match eq2; if eq1 matches instead → swap.
4. **If prefixes are the same** (e.g. county-line PM reset, both sides have no prefix) — apply the same primary/secondary logic using **county** instead of prefix.
5. If both prefix and county are ambiguous or no context is found, leave the order as-is.
6. Swaps only PM-data fields (`pmPrefix`, `pmSuffix`, `pmMeasure`, `routeId`, `arMeasure`, `odMeasure`, `county`, `name`). Structural fields (`desc`, `isSecondEq`, `eqPairId`, `type`) stay in place so rendering labels are unaffected.

**Prefix normalization:** `'.'` and `''` are treated as equivalent (no prefix) before all comparisons.

## Running Locally

Serve the project root with any static file server. The OAuth redirect URL in `config.js` must match. Example using VS Code Live Server:

1. Open the folder in VS Code
2. Click **Go Live** (default port 5500)
3. Navigate to `http://localhost:5500/index.html`

## Files

| File | Description |
|---|---|
| `index.html` | Single HTML entry point — all markup |
| `config.js` | ArcGIS URLs and OAuth credentials |
| `shared.js` | Core library — auth, queries, sort pipeline, utilities |
| `main.js` | DOMContentLoaded bootstrap |
| `hsl.js` | Report: Highway Sequence Listing |
| `ramp_detail.js` | Report: TSAR Ramp Detail |
| `ramp_summary.js` | Report: TSAR Ramp Summary |
| `highway_log.js` | Report: Highway Log |
| `intersection_detail.js` | Report: Intersection Detail |
| `styles.css` | All styles including print |
| `caltranslogo.png` | Caltrans logo displayed in the header |
