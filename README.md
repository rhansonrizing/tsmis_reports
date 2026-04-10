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

Additionally, when a city spans multiple non-contiguous route segments, `hsl_deduplicateCitySegments` retains only the **first** `citybegin` (lowest AR) and the **last** `cityend` (highest AR) for each city code, dropping all intermediate segment endpoints.

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
