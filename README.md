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
| 132 | Ramp point events (primary source for ramp pairs, PMSuffix) |
| 157 | AADT |

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

1. Its AR measure falls outside the non-city AR extent by more than **0.005** (removes out-of-district city records that leak through because layer 74 has no district field).
2. Its OD measure is **negative**.
3. Its PM measure is **negative** or negative-zero (boundary precedes the start of the queried segment).

City begin/end records are always displayed even when another H record shares the same PM key.

When a city spans multiple non-contiguous route segments, all intermediate `citybegin`/`cityend` records are kept as-is.

City begin/end records on an **L independent alignment** (`EndPMSuffix === 'L'` or `BeginPMSuffix === 'L'`) are suppressed at source — the city boundary was already crossed on the main alignment before the split.

---

### BEGIN/END REALIGNMENT Landmarks (`hsl_filterRealignmentLandmarks`)

Applied to `type === 'landmark'` records whose `desc` is `'BEGIN REALIGNMENT'` or `'END REALIGNMENT'`. A realignment landmark is dropped if **any** of the following are true:

1. Its `alignment` field is not `'R'` (hard guard — only R-alignment realignment markers are valid).
2. It is an `END REALIGNMENT` and a `BEGIN REALIGNMENT` exists at the **same AR measure** (within 0.001) — this means the route transitions directly into an independent alignment section rather than terminating the realignment.
3. Its PM key matches **any FT=H record** (excludes intersections, ramps, and other realignment landmarks from the comparison set).

If the realignment record has no valid PM measure it passes all three checks and is always shown.

---

### BEGIN/END Independent Alignment Boundaries (`queryIndependentAlignmentBoundaries` → `hsl_filterRealignmentLandmarks`)

Synthetic `BEGIN LEFT/RIGHT INDEPENDENT ALIGNMENT` and `END LEFT/RIGHT INDEPENDENT ALIGNMENT` records are constructed from layer 3 (PM network polyline features). Each feature's M values are the PM measures; the global min/max per PMSuffix (`L` or `R`) give the begin and end PM. Those PM measures are translated to AR and OD via `networkLayers/3/translate` (targets [4] AR and [5] OD).

PM key for suppression is defined as `pmPrefix | pmMeasure.toFixed(3)` (suffix excluded, same as realignment landmarks; prefix `'.'` and `''` are both treated as no-prefix).

An IA boundary record is suppressed (not added to the report) if any of the following are true:

1. Its PM measure is **negative** or negative-zero (alignment boundary precedes the start of the queried segment).
2. **Any FT=H record** has the **exact same PM key**.
3. **Any FT=H record** has the **same AR measure** (within 0.001). This catches cases where the layer 123 stored `PMMeasure` and the layer 3 geometry M value disagree slightly despite resolving to the same AR.

If the record has no valid PM measure it is always shown.

IA boundary records are excluded from distance calculations.

---

---

## Equation Point Logic (`queryEquationPointsFromNetwork`)

Equation points mark locations where one PM numbering system ends and another begins (e.g., at county lines where PM resets to 0). Each equation point is rendered as a pair of rows: an **EQUATES TO** row (eq1) showing the departing PM, and a second row (eq2) showing the arriving PM with `E` in the suffix column.

### Data Source

Layer 1 (PM network calibration points, `NetworkId=2`). Queried using `RouteId LIKE '${county}${route}%'` (e.g., `TUO108%`). Each calibration point carries its PM measure and a `RouteId` that encodes:

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
- AR < 0.0005 AND PM difference < threshold (0.01 for L-suffix pairs, 0.5 otherwise) — near-identical duplicates
- PM pair key already used (prevents double-pairing)

Each point pairs with at most one other.

### Pair structure

| Field | eq1 (`isSecondEq=false`) | eq2 (`isSecondEq=true`) |
|---|---|---|
| `desc` | `'PM EQUATION'` | `''` |
| `arMeasure` | lower AR | higher AR |
| `pmSuffix` | from RouteId | `'E'` (rendering marker), or `'L'` if both points are L-suffix |
| Rendered label | `EQUATES TO` spanning columns | normal PM row with `E` in suffix column |

### Sorting

`sortWithIndependentAlignments` handles equation records specially:

1. eq1 records are **removed** from the sort array before sorting, stored in a map by `eqPairId`.
2. **Alignment-start AR fixup** — before sorting, eq2 records with a non-empty `pmPrefix` and `pmMeasure ≈ 0` (marking the start of an R/L alignment) have their `arMeasure` clamped to just below the minimum AR of all non-IA-boundary records sharing the same `pmPrefix` (`Math.min(eq2.arMeasure, minPfxAr - 0.0005)`). This handles both undershoot and overshoot from calibration translation, ensuring the outer grouping loop never reaches an alignment record before eq2.
3. eq2 records sort **before all other types** at the same rounded AR position. City boundary records sort before intersections/ramps when their AR differs slightly but their PM key matches (layer 74 AR values don't always align exactly with translated intersection ARs). `pmPrefix` `'.'` and `''` are normalized to the same key.
4. The grouping loop that separates R and L sections has two guards to prevent equation records from being misclassified: (a) equation records are excluded from `hgValue`-based section consumption (their `hgValue` reflects the alignment at their calibration AR, not their logical position); (b) eq2 records are excluded from the E-suffix end-marker group. BEGIN/END INDEPENDENT ALIGNMENT boundary landmarks are also excluded from triggering section grouping and pass through individually.
5. After sorting, each eq1 is **re-inserted** immediately before its eq2 partner.
6. When a non-equation record shares OD/AR with an eq2, it is placed before the pair if its PM matches eq1, or after if its PM matches eq2.

### `fixEqPairOrder`

When eq1 and eq2 share the same AR to 3dp, the lower-AR sort tiebreak may not correctly determine which PM belongs on the departing side vs. the arriving side. This pass corrects the order by reading prefix context from surrounding records.

**Algorithm:**
1. For each consecutive eq1/eq2 pair that share the same AR to 3dp and have different PM prefixes:
2. Scan backward past ramp and intersection records to find the nearest preceding **H-type** record (landmark, route break, city boundary). Scan forward similarly for the nearest following H-type record.
3. **Primary signal:** if eq2's prefix matches the preceding H context and eq1's does not → swap.
4. **Secondary signal** (no preceding H record found): if eq1's prefix matches the following H context and eq2's does not → swap.
5. Swaps only PM-data fields (`pmPrefix`, `pmSuffix`, `pmMeasure`, `routeId`, `arMeasure`, `odMeasure`, `county`, `name`). Structural fields (`desc`, `isSecondEq`, `eqPairId`, `type`) stay in place so rendering labels are unaffected.

**Prefix normalization:** `'.'` and `''` are treated as equivalent (no prefix) before all comparisons. Equation records store "no prefix" as `''`; landmark and other records store it as `'.'`.

**Why H-type only:** Ramp and intersection records can carry a PM prefix belonging to the *arriving* PM system, which would give the wrong signal if used as context. Only landmark-class records reliably reflect the established PM system at that location.

---

## Debug Helpers

`hsl_logEqNeighbors(allPairs, label)` — called automatically after `fixEqPairOrder` in both district/route and postmile modes. Prints each equation pair to the console with 3 records of context on each side. Useful for diagnosing sort order and prefix-swap decisions. Output is grouped under `[eqLog <label>] eq pair @ index N  pairId:<id>`.

---

## Running Locally

Serve the project root with any static file server. The OAuth redirect URL in `config.js` must match. Example using VS Code Live Server:

1. Open the folder in VS Code
2. Click **Go Live** (default port 5500)
3. Navigate to `http://localhost:5500/index.html`

## Files

| File | Description |
|---|---|
| `index.html` | Entire application — HTML, CSS, and JavaScript |
| `config.js` | Environment-specific configuration (not committed with credentials) |
| `caltranslogo.png` | Caltrans logo displayed in the header |
