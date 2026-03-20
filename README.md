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
