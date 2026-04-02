// ── Intersection Detail ───────────────────────────────────────────────────

let _intd_allResults    = [];
let _intd_currentPage   = 0;
let _intd_generatedOn   = '';
let _intd_routeLabel    = '';
let _intd_directionFrom = '';
let _intd_directionTo   = '';

const INTD_ROWS_PER_PAGE = 30;

// ── INTD: Table header ────────────────────────────────────────────────────
//
// Column layout (21 total):
//  1  P prefix          2  Post Mile         3  Location
//  4  Date of Record    5  H/G               6  City Code        7  R/U
//  8  INT Type          9  INT Eff-Date
// 10  Ctrl T           11  Ctrl Type
// 12  Light Eff-Date   13  Light T/Y
// 14  ML1 Eff
// 15  ML2 S/M          16  ML2 L/C           17  ML2 R/C
// 18  ML2 T/F          19  ML2 N/L           20  ML2 Eff         21  ML2 ADT
//
// Row-2 of each record reuses the same 21 cols:
//  1-2  blank   3-6  Description (colspan 4)
// 12  Main Line Lgth   13  Inter Eff-Date
// 14-18  Inter S/L/R/T/N   19  Int St Eff-Date
// 20-24  IntrteAdt/S/Route/Post/Mile   25-26  Xing Rte/S

function intd_buildThead() {
  return `<thead>
    <!-- Rows 1–2: groups and column names for data row A (first line of each record) -->
    <tr>
      <th colspan="7"></th>
      <th colspan="2"  class="hl-th-group">* INT *</th>
      <th colspan="2"  class="hl-th-group">* CONTROL *</th>
      <th colspan="2"  class="hl-th-group">* LIGHTING *</th>
      <th colspan="1"  class="hl-th-group">* MAINLINE *</th>
      <th colspan="7"  class="hl-th-group">* MAINLINE *</th>
    </tr>
    <tr>
      <th>P<br>P</th>
      <th>POST<br>MILE</th>
      <th>LOCATION</th>
      <th>DATE OF<br>RECORD</th>
      <th>H<br>G</th>
      <th>CITY<br>CODE</th>
      <th>R<br>U</th>
      <th>TYPE<br>EFF&#8209;DATE</th><th>T<br>Y</th>
      <th>TYPE<br>EFF&#8209;DATE</th><th>T<br>Y</th>
      <th>EFF&#8209;DATE</th><th>T<br>Y</th>
      <th>EFF&#8209;DATE</th>
      <th>S<br>M</th><th>L<br>C</th><th>R<br>C</th><th>T<br>F</th><th>N<br>L</th>
      <th>EFF&#8209;DATE</th><th>ADT</th>
    </tr>
    <!-- Rows 3–4: groups and column names for data row B (second line of each record) -->
    <tr class="intd-thead-row2">
      <th colspan="6"></th>
      <th colspan="1"  class="hl-th-group">*MAIN*</th>
      <th colspan="6"  class="hl-th-group">* INTERSECTING *</th>
      <th colspan="1"  class="hl-th-group">* INT ST *</th>
      <th colspan="5"  class="hl-th-group">*INTERSECTING ROUTE*</th>
      <th colspan="2"  class="hl-th-group">*XING*</th>
    </tr>
    <tr>
      <th></th><th></th>
      <th colspan="4" class="intd-desc-hdr">DESCRIPTION</th>
      <th>LINE<br>LGTH</th>
      <th>EFF&#8209;DATE</th>
      <th>S<br>M</th><th>L<br>C</th><th>R<br>C</th><th>T<br>F</th><th>N<br>L</th>
      <th>EFF&#8209;DATE</th>
      <th>ADT</th><th colspan="2">ROUTE/<br>NO S</th><th>POST<br>MILE</th><th>P<br>S</th>
      <th>RTE</th><th>S</th>
    </tr>
  </thead>`;
}

// ── INTD: Row renderer ────────────────────────────────────────────────────

function intd_renderRow(p, idx = 0) {
  const shade = idx % 2 === 0 ? ' hl-shaded' : '';
  const e = v => esc(v ?? '');

  const rowA = `<tr class="intd-row-a${shade}">
    <td>${e(p.pmPrefix)}</td>
    <td>${e(p.pmMeasure)}</td>
    <td class="intd-td-left">${e(p.location)}</td>
    <td>${e(p.dateOfRecord)}</td>
    <td>${e(p.hg)}</td>
    <td>${e(p.city)}</td>
    <td>${e(p.ru)}</td>
    <td>${e(p.intType)}</td>
    <td>${e(p.intEff)}</td>
    <td>${e(p.ctrlT)}</td>
    <td>${e(p.ctrlType)}</td>
    <td>${e(p.lightT)}</td>
    <td>${e(p.lightY)}</td>
    <td>${e(p.ml1Eff)}</td>
    <td>${e(p.ml2SM)}</td>
    <td>${e(p.ml2LC)}</td>
    <td>${e(p.ml2RC)}</td>
    <td>${e(p.ml2TP)}</td>
    <td>${e(p.ml2NL)}</td>
    <td>${e(p.ml2Eff)}</td>
    <td>${e(p.ml2Adt)}</td>
  </tr>`;

  const rowB = `<tr class="intd-row-b${shade}">
    <td></td>
    <td></td>
    <td colspan="4" class="intd-td-left">${e(p.desc)}</td>
    <td>${e(p.mainLgth)}</td>
    <td>${e(p.interEff)}</td>
    <td>${e(p.interS)}</td>
    <td>${e(p.interL)}</td>
    <td>${e(p.interR)}</td>
    <td>${e(p.interT)}</td>
    <td>${e(p.interN)}</td>
    <td>${e(p.intStEff)}</td>
    <td>${e(p.intrteAdt)}</td>
    <td>${e(p.intrteRoute)}</td>
    <td>${e(p.intrteS)}</td>
    <td>${e(p.intrtePost)}</td>
    <td>${e(p.inrteMile)}</td>
    <td>${e(p.xingRte)}</td>
    <td>${e(p.xingS)}</td>
  </tr>`;

  return rowA + rowB;
}

// ── INTD: tbody builder ───────────────────────────────────────────────────

function intd_buildTbodyRows(slice, startIdx) {
  return slice.map((p, i) => intd_renderRow(p, startIdx + i)).join('');
}

// ── INTD: Page renderer ───────────────────────────────────────────────────

function intd_renderPage() {
  const box = document.getElementById('rampResults');
  box.style.display = 'block';
  box.className = 'ramp-results';

  const n          = _intd_allResults.length;
  const totalPages = Math.ceil(n / INTD_ROWS_PER_PAGE);
  const page       = _intd_currentPage;
  const start      = page * INTD_ROWS_PER_PAGE;
  const slice      = _intd_allResults.slice(start, start + INTD_ROWS_PER_PAGE);

  const prevDis = page === 0              ? 'disabled' : '';
  const nextDis = page === totalPages - 1 ? 'disabled' : '';

  const routeLine3 = _intd_routeLabel
    ? `Route: ${esc(_intd_routeLabel)}&emsp;&emsp;&emsp;Direction: ${esc(_intd_directionFrom)} &ndash; ${esc(_intd_directionTo)}`
    : '';

  const actionBar = renderActionBar(
    'TASAS Selective Record Retrieval',
    'TSAR - Intersection Detail',
    routeLine3,
    'intd_exportToExcel()',
    'intd_printAll()'
  );

  const pagination = `<div class="ramp-pagination">
    <div class="pagination-left"><div style="display:flex;">
      <button class="page-arrow" ${prevDis} onclick="intd_changePageFirst()">&#9664;&#9664;</button>
      <button class="page-arrow" ${prevDis} onclick="intd_changePage(-1)">&#9664;</button>
    </div></div>
    <div class="pagination-right"><div style="display:flex;">
      <button class="page-arrow" ${nextDis} onclick="intd_changePage(1)">&#9654;</button>
      <button class="page-arrow" ${nextDis} onclick="intd_changePageLast()">&#9654;&#9654;</button>
    </div></div>
  </div>`;

  const tbodyRows = slice.length
    ? intd_buildTbodyRows(slice, start)
    : `<tr><td colspan="26" class="hl-empty">No results found.</td></tr>`;

  const table = `<div class="hl-table-wrap">
    <table class="hl-table intd-table">
      ${intd_buildThead()}
      <tbody>${tbodyRows}</tbody>
    </table>
  </div>`;

  const pageFooter = totalPages > 1
    ? `<div class="page-info">Page ${page + 1} of ${totalPages}</div>`
    : '';

  const generatedFooter = `<div class="generated-on">Generated on ${esc(_intd_generatedOn)}</div>`;

  box.innerHTML = `${actionBar}<div class="hl-title-gap"></div>${table}${pageFooter}${pagination}${generatedFooter}`;
  box.scrollIntoView({ behavior: 'instant', block: 'start' });
}

// ── INTD: Pagination ──────────────────────────────────────────────────────

function intd_changePage(delta) {
  const totalPages = Math.ceil(_intd_allResults.length / INTD_ROWS_PER_PAGE);
  const next = _intd_currentPage + delta;
  if (next < 0 || next >= totalPages) return;
  _intd_currentPage = next;
  intd_renderPage();
}

function intd_changePageFirst() {
  if (_intd_currentPage === 0) return;
  _intd_currentPage = 0;
  intd_renderPage();
}

function intd_changePageLast() {
  const last = Math.ceil(_intd_allResults.length / INTD_ROWS_PER_PAGE) - 1;
  if (_intd_currentPage === last) return;
  _intd_currentPage = last;
  intd_renderPage();
}

// ── INTD: Print ───────────────────────────────────────────────────────────

function intd_printAll() {
  const box   = document.getElementById('rampResults');
  const saved = box.innerHTML;
  const actionBar = renderActionBar(
    'TASAS Selective Record Retrieval', 'TSAR - Intersection Detail', '', null, null
  );
  const tbody = intd_buildTbodyRows(_intd_allResults, 0);
  const table = `<div class="hl-table-wrap"><table class="hl-table intd-table">${intd_buildThead()}<tbody>${tbody}</tbody></table></div>`;
  const generatedFooter = `<div class="generated-on">Generated on ${esc(_intd_generatedOn)}</div>`;
  box.innerHTML = `${actionBar}<div class="hl-title-gap"></div>${table}${generatedFooter}`;
  window.print();
  box.innerHTML = saved;
}

// ── INTD: Export ──────────────────────────────────────────────────────────

function intd_exportToExcel() {
  if (_intd_allResults.length === 0) return;
  const headers = [
    'P', 'Post Mile', 'Location', 'Date of Record', 'H/G', 'City Code', 'R/U',
    'INT Type', 'INT Eff-Date',
    'Ctrl T', 'Ctrl Type',
    'Light Eff-Date', 'Light T/Y',
    'ML Eff-Date',
    'ML S/M', 'ML L/C', 'ML R/C', 'ML T/P', 'ML N/L', 'ML Eff-Date', 'ML ADT',
    'Description', 'Main Line Lgth',
    'Inter Eff-Date', 'Inter S', 'Inter L', 'Inter R', 'Inter T', 'Inter N',
    'Int St Eff-Date',
    'Intrte ADT No', 'Intrte S', 'Intrte Route', 'Intrte Post', 'Intrte Mile',
    'Xing Rte', 'Xing S'
  ];
  const rows = _intd_allResults.map(p => [
    p.pmPrefix     ?? '', p.pmMeasure    ?? '', p.location     ?? '', p.dateOfRecord ?? '',
    p.hg           ?? '', p.city         ?? '', p.ru           ?? '',
    p.intType      ?? '', p.intEff       ?? '',
    p.ctrlT        ?? '', p.ctrlType     ?? '',
    p.lightT       ?? '', p.lightY       ?? '',
    p.ml1Eff       ?? '',
    p.ml2SM        ?? '', p.ml2LC        ?? '', p.ml2RC        ?? '',
    p.ml2TP        ?? '', p.ml2NL        ?? '', p.ml2Eff       ?? '', p.ml2Adt       ?? '',
    p.desc         ?? '', p.mainLgth     ?? '',
    p.interEff     ?? '', p.interS       ?? '', p.interL       ?? '',
    p.interR       ?? '', p.interT       ?? '', p.interN       ?? '',
    p.intStEff     ?? '',
    p.intrteAdt    ?? '', p.intrteS      ?? '', p.intrteRoute  ?? '',
    p.intrtePost   ?? '', p.inrteMile    ?? '',
    p.xingRte      ?? '', p.xingS        ?? ''
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Intersection Detail');
  XLSX.writeFile(wb, `intersection_detail_${esc(_intd_routeLabel)}.xlsx`);
}

// ── INTD: Query ───────────────────────────────────────────────────────────

async function intd_queryIntersections(segments, routeNum, district = null, county = null) {
  const rnMatch        = String(routeNum).match(/^(\d+)([A-Z]?)$/);
  const routeNumDigits = rnMatch ? rnMatch[1].padStart(3, '0') : String(routeNum).padStart(3, '0');
  const routeSuffix    = rnMatch ? rnMatch[2] : '';
  const dateFilter     = getDateFilter('Int_Geometry_Begin_Date', 'Int_Geometry_End_Date');
  const segRouteIds    = new Set(segments.map(s => s.fromBest.routeId));
  const INT_CHUNK      = 200;

  const outFields151 = 'INTERSECTION_ID,Intersection_Name,County_Code,District_Code,' +
    'Main_RouteNum,Main_RouteSuffix,Main_PMPrefix,Main_PMSuffix,Main_PMMeasure,Main_Alignment,' +
    'Cross_RouteNum,Cross_RouteSuffix,Cross_PMPrefix,Cross_PMSuffix,Cross_PMMeasure,Cross_Alignment,' +
    'InventoryItemStartDate,' +
    'Int_Geometry_Begin_Date,Intersection_Geometry,Int_Control_Begin_Date,Intersection_Control,' +
    'Int_Lighted_Ind_Begin_Date,Intersection_Lighted_Ind,' +
    'Cross_AADT_YEAR,Cross_AADT';

  const districtClause = district != null ? `District_Code = '${String(parseInt(district, 10))}'` : null;
  const countyCode     = normalizeCountyCode(county);
  const countyClause   = countyCode ? `County_Code = '${countyCode}'` : null;
  const baseFilter     = [...[districtClause, countyClause, `LRS_DATE_RETIRE IS NULL`].filter(Boolean)].join(' AND ') + dateFilter;

  const fetch151 = async (where) => {
    const body = new URLSearchParams({
      where,
      outFields:      outFields151,
      returnGeometry: 'false',
      ...versionParam(),
      f:     'json',
      token: _token
    });
    const data = await fetch(`${CONFIG.mapServiceUrl}/151/query`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
    ).then(r => r.json()).catch(() => ({}));
    if (data.error) {
      console.error('[intd_queryIntersections] layer 151 error:', data.error.code, data.error.message);
      return [];
    }
    return data.features ?? [];
  };

  const [mainResults, crossResults] = await Promise.all([
    fetch151(`${baseFilter} AND Main_RouteNum = '${routeNumDigits}'`),
    fetch151(`${baseFilter} AND Cross_RouteNum = '${routeNumDigits}'`)
  ]);

  const fmtDate = (epoch) => {
    if (epoch == null) return '';
    const d  = new Date(epoch);
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };

  const detailMap = new Map();
  for (const f of mainResults) {
    const a = f.attributes ?? {};
    if (a.INTERSECTION_ID == null) continue;
    if ((a.Main_RouteSuffix ?? '') !== routeSuffix) continue;
    const routePadded = String(a.Main_RouteNum ?? '').padStart(3, '0');
    const district2   = a.District_Code ? String(a.District_Code).padStart(2, '0') : '';
    detailMap.set(a.INTERSECTION_ID, {
      intersectionName: a.Intersection_Name ?? '',
      location:         `${district2} ${a.County_Code ?? ''} ${routePadded}`,
      pmPrefix:         a.Main_PMPrefix  ?? '',
      pmSuffix:         a.Main_PMSuffix  ?? '',
      pmMeasure:        a.Main_PMMeasure != null ? parseFloat(a.Main_PMMeasure).toFixed(3) + (a.Main_PMSuffix ? ' ' + a.Main_PMSuffix : '') : '',
      dateOfRecord:     fmtDate(a.InventoryItemStartDate),
      intType:          fmtDate(a.Int_Geometry_Begin_Date),
      intEff:           a.Intersection_Geometry    ?? '',
      ctrlT:            fmtDate(a.Int_Control_Begin_Date),
      ctrlType:         a.Intersection_Control     ?? '',
      lightT:           fmtDate(a.Int_Lighted_Ind_Begin_Date),
      lightY:           a.Intersection_Lighted_Ind != null ? String(a.Intersection_Lighted_Ind) : '',
      intStEff:         a.Cross_AADT_YEAR != null ? String(a.Cross_AADT_YEAR) : '',
      intrteAdt:        a.Cross_AADT      != null ? String(a.Cross_AADT)      : ''
    });
  }
  for (const f of crossResults) {
    const a = f.attributes ?? {};
    if (a.INTERSECTION_ID == null || detailMap.has(a.INTERSECTION_ID)) continue;
    if ((a.Cross_RouteSuffix ?? '') !== routeSuffix) continue;
    const routePadded = String(a.Main_RouteNum ?? '').padStart(3, '0');
    const district2   = a.District_Code ? String(a.District_Code).padStart(2, '0') : '';
    detailMap.set(a.INTERSECTION_ID, {
      intersectionName: a.Intersection_Name ?? '',
      location:         `${district2} ${a.County_Code ?? ''} ${routePadded}`,
      pmPrefix:         a.Cross_PMPrefix  ?? '',
      pmSuffix:         a.Cross_PMSuffix  ?? '',
      pmMeasure:        a.Cross_PMMeasure != null ? parseFloat(a.Cross_PMMeasure).toFixed(3) + (a.Cross_PMSuffix ? ' ' + a.Cross_PMSuffix : '') : '',
      dateOfRecord:     fmtDate(a.InventoryItemStartDate),
      intType:          fmtDate(a.Int_Geometry_Begin_Date),
      intEff:           a.Intersection_Geometry    ?? '',
      ctrlT:            fmtDate(a.Int_Control_Begin_Date),
      ctrlType:         a.Intersection_Control     ?? '',
      lightT:           fmtDate(a.Int_Lighted_Ind_Begin_Date),
      lightY:           a.Intersection_Lighted_Ind != null ? String(a.Intersection_Lighted_Ind) : '',
      intStEff:         a.Cross_AADT_YEAR != null ? String(a.Cross_AADT_YEAR) : '',
      intrteAdt:        a.Cross_AADT      != null ? String(a.Cross_AADT)      : ''
    });
  }

  if (detailMap.size === 0) return [];

  // Query layer 0 for geometry (used for sort order via g2m)
  const idList   = Array.from(detailMap.keys());
  const idChunks = chunkArray(idList, INT_CHUNK);
  const geometryMap = new Map();
  await Promise.all(idChunks.map(async chunk => {
    const chunkList = chunk.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
    const qBody = new URLSearchParams({
      where:          `INTERSECTION_ID IN (${chunkList})`,
      outFields:      'INTERSECTION_ID',
      returnGeometry: 'true',
      ...versionParam(),
      f:     'json',
      token: _token
    });
    const qData = await fetch(`${CONFIG.mapServiceUrl}/0/query`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qBody.toString() }
    ).then(r => r.json()).catch(() => ({}));
    for (const feat of qData.features ?? []) {
      const id = feat.attributes?.INTERSECTION_ID;
      if (id != null && feat.geometry && !geometryMap.has(id)) geometryMap.set(id, feat.geometry);
    }
  }));

  // g2m to get measure for sort order
  const measuredIds = Array.from(geometryMap.keys());
  const G2M_CHUNK   = 200;
  const g2mChunks   = chunkArray(measuredIds, G2M_CHUNK);
  const idToMeasure = new Map();
  for (const g2mChunk of g2mChunks) {
    const chunkGeoms = g2mChunk.map(id => geometryMap.get(id));
    const g2mBody = new URLSearchParams({
      locations:  JSON.stringify(chunkGeoms.map(g => ({ geometry: g }))),
      tolerance:  '50',
      ...versionParam(),
      f:     'json',
      token: _token
    });
    const g2mData = await fetch(
      `${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/4/geometryToMeasure`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: g2mBody.toString() }
    ).then(r => r.json()).catch(() => ({ locations: [] }));
    (g2mData.locations ?? []).forEach((loc, idx) => {
      const id      = g2mChunk[idx];
      const results = loc.results ?? [];
      const result  = results.find(r => segRouteIds.has(r.routeId) && r.distance === 0)
                   ?? results.find(r => segRouteIds.has(r.routeId))
                   ?? results[0];
      if (result?.measure != null) idToMeasure.set(id, { routeId: result.routeId, arMeasure: result.measure });
    });
  }

  // Build display records
  const records = [];
  for (const id of measuredIds) {
    const detail = detailMap.get(id);
    if (!detail) continue;
    const g2m = idToMeasure.get(id);
    records.push({
      _name:        String(id),
      _measure:     g2m?.arMeasure ?? Infinity,
      _routeId:     g2m?.routeId   ?? '',
      _arMeasure:   g2m?.arMeasure ?? Infinity,
      _pmSuffix:    detail.pmSuffix,
      pmPrefix:     detail.pmPrefix,
      pmMeasure:    detail.pmMeasure,
      location:     detail.location,
      dateOfRecord: detail.dateOfRecord,
      hg:           '',
      city:         '',
      ru:           '',
      intType:      detail.intType,
      intEff:       detail.intEff,
      ctrlT:        detail.ctrlT,
      ctrlType:     detail.ctrlType,
      lightT:       detail.lightT,
      lightY:       detail.lightY,
      ml1Eff:       '',
      ml2SM:        '',
      ml2LC:        '',
      ml2RC:        '',
      ml2TP:        '',
      ml2NL:        '',
      ml2Eff:       '',
      ml2Adt:       '',
      desc:         detail.intersectionName,
      mainLgth:     '',
      interEff:     '',
      interS:       '',
      interL:       '',
      interR:       '',
      interT:       '',
      interN:       '',
      intStEff:     detail.intStEff  ?? '',
      intrteAdt:    detail.intrteAdt ?? '',
      intrteS:      '',
      intrteRoute:  '',
      intrtePost:   '',
      inrteMile:    '',
      xingRte:      '',
      xingS:        ''
    });
  }
  // Enrich records with range-layer attributes (HG, city, population)
  if (records.length > 0) {
    const rlPairs = records.map(r => ({
      name:      r._name,
      routeId:   r._routeId,
      arMeasure: r._arMeasure,
      odMeasure: ''
    }));
    const [hgMap, cityMap, popMap] = await Promise.all([
      queryRangeLayer(rlPairs, 116, 'Highway_Group'),
      queryRangeLayer(rlPairs, 74,  'City_Code'),
      queryRangeLayer(rlPairs, 130, 'Population_Code')
    ]);
    for (const r of records) {
      r.hg   = hgMap.get(r._name)   ?? '';
      r.city = cityMap.get(r._name) ?? '';
      r.ru   = popMap.get(r._name)  ?? '';
    }
  }

  // Query layer 146 → 150 for ML1 Eff-Date (mainline leg InventoryItemStartDate)
  if (records.length > 0) {
    const approachMap  = new Map(); // String(INTERSECTION_ID) → lowest APPROACH_ID
    const idChunks146  = chunkArray(records.map(r => r._name), INT_CHUNK);
    await Promise.all(idChunks146.map(async chunk => {
      const chunkList = chunk.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
      const body = new URLSearchParams({
        where:          `INTERSECTION_ID IN (${chunkList}) AND LEG_TYPE = 'Major' AND LEG_TRAVEL_DIR = 'Increasing'`,
        outFields:      'INTERSECTION_ID,APPROACH_ID',
        returnGeometry: 'false',
        ...versionParam(),
        f:     'json',
        token: _token
      });
      const data = await fetch(`${CONFIG.mapServiceUrl}/146/query`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
      ).then(r => r.json()).catch(() => ({}));
      for (const feat of data.features ?? []) {
        const a = feat.attributes ?? {};
        if (a.INTERSECTION_ID == null || a.APPROACH_ID == null) continue;
        const key      = String(a.INTERSECTION_ID);
        const existing = approachMap.get(key);
        if (existing == null || a.APPROACH_ID < existing) approachMap.set(key, a.APPROACH_ID);
      }
    }));

    if (approachMap.size > 0) {
      const approachIds = Array.from(new Set(approachMap.values()));
      const idChunks150 = chunkArray(approachIds, INT_CHUNK);
      const approachEff = new Map(); // APPROACH_ID → formatted date
      await Promise.all(idChunks150.map(async chunk => {
        const body = new URLSearchParams({
          where:          `APPROACH_ID IN (${chunk.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',')})`,
          outFields:      'APPROACH_ID,InventoryItemStartDate,Signal_Arm_Ind,Left_Channel,Right_Channel_Ind,FlowCode,Number_Thru_Lanes,N_Distance',
          returnGeometry: 'false',
          ...versionParam(),
          f:     'json',
          token: _token
        });
        const data = await fetch(`${CONFIG.mapServiceUrl}/150/query`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
        ).then(r => r.json()).catch(() => ({}));
        for (const feat of data.features ?? []) {
          const a = feat.attributes ?? {};
          if (a.APPROACH_ID != null && !approachEff.has(a.APPROACH_ID))
            approachEff.set(a.APPROACH_ID, {
              eff:    fmtDate(a.InventoryItemStartDate),
              sm:     a.Signal_Arm_Ind    != null ? String(a.Signal_Arm_Ind)    : '',
              lc:     a.Left_Channel      != null ? String(a.Left_Channel)      : '',
              rc:     a.Right_Channel_Ind != null ? String(a.Right_Channel_Ind) : '',
              tf:     a.FlowCode          != null ? String(a.FlowCode)          : '',
              nl:     a.Number_Thru_Lanes != null ? String(a.Number_Thru_Lanes) : '',
              nDist:  a.N_Distance        != null ? String(a.N_Distance)        : ''
            });
        }
      }));

      for (const r of records) {
        const approachId = approachMap.get(r._name);
        if (approachId != null) {
          const ap = approachEff.get(approachId);
          if (ap) {
            r.ml1Eff   = ap.eff;
            r.ml2SM    = ap.sm;
            r.ml2LC    = ap.lc;
            r.ml2RC    = ap.rc;
            r.ml2TP    = ap.tf;
            r.ml2NL    = ap.nl;
            r.mainLgth = ap.nDist;
          }
        }
      }

    }
  }

  // Query layer 146 (Minor leg) → 150 for Intersecting S/M, L/C, R/C, T/F, N/L
  if (records.length > 0) {
    const minorApproachMap = new Map(); // String(INTERSECTION_ID) → lowest APPROACH_ID
    const idChunks146m = chunkArray(records.map(r => r._name), INT_CHUNK);
    await Promise.all(idChunks146m.map(async chunk => {
      const chunkList = chunk.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
      const body = new URLSearchParams({
        where:          `INTERSECTION_ID IN (${chunkList}) AND LEG_TYPE = 'Minor' AND LEG_TRAVEL_DIR = 'Increasing'`,
        outFields:      'INTERSECTION_ID,APPROACH_ID',
        returnGeometry: 'false',
        ...versionParam(),
        f:     'json',
        token: _token
      });
      const data = await fetch(`${CONFIG.mapServiceUrl}/146/query`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
      ).then(r => r.json()).catch(() => ({}));
      for (const feat of data.features ?? []) {
        const a = feat.attributes ?? {};
        if (a.INTERSECTION_ID == null || a.APPROACH_ID == null) continue;
        const key      = String(a.INTERSECTION_ID);
        const existing = minorApproachMap.get(key);
        if (existing == null || a.APPROACH_ID < existing) minorApproachMap.set(key, a.APPROACH_ID);
      }
    }));

    if (minorApproachMap.size > 0) {
      const minorIds      = Array.from(new Set(minorApproachMap.values()));
      const idChunks150m  = chunkArray(minorIds, INT_CHUNK);
      const minorLegMap   = new Map(); // APPROACH_ID → { sm, lc, rc, tf, nl }
      await Promise.all(idChunks150m.map(async chunk => {
        const body = new URLSearchParams({
          where:          `APPROACH_ID IN (${chunk.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',')})`,
          outFields:      'APPROACH_ID,InventoryItemStartDate,Signal_Arm_Ind,Left_Channel,Right_Channel_Ind,FlowCode,Number_Thru_Lanes',
          returnGeometry: 'false',
          ...versionParam(),
          f:     'json',
          token: _token
        });
        const data = await fetch(`${CONFIG.mapServiceUrl}/150/query`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
        ).then(r => r.json()).catch(() => ({}));
        for (const feat of data.features ?? []) {
          const a = feat.attributes ?? {};
          if (a.APPROACH_ID != null && !minorLegMap.has(a.APPROACH_ID))
            minorLegMap.set(a.APPROACH_ID, {
              eff: fmtDate(a.InventoryItemStartDate),
              sm:  a.Signal_Arm_Ind    != null ? String(a.Signal_Arm_Ind)    : '',
              lc:  a.Left_Channel      != null ? String(a.Left_Channel)      : '',
              rc:  a.Right_Channel_Ind != null ? String(a.Right_Channel_Ind) : '',
              tf:  a.FlowCode          != null ? String(a.FlowCode)          : '',
              nl:  a.Number_Thru_Lanes != null ? String(a.Number_Thru_Lanes) : ''
            });
        }
      }));

      for (const r of records) {
        const approachId = minorApproachMap.get(r._name);
        if (approachId != null) {
          const ml = minorLegMap.get(approachId);
          if (ml) {
            r.interEff = ml.eff;
            r.interS   = ml.sm;
            r.interL   = ml.lc;
            r.interR   = ml.rc;
            r.interT   = ml.tf;
            r.interN   = ml.nl;
          }
        }
      }
    }
  }

  // Query layer 153 for ML2 Eff-Date (AADT_YEAR) and ML2 ADT (AADT) — attribute query by RouteID + measure
  if (records.length > 0) {
    // Build per-record route+measure from idToMeasure
    const recordMeasures = new Map(); // _name → { routeId, arMeasure }
    for (const r of records) {
      const m = idToMeasure.get(Number(r._name)) ?? idToMeasure.get(r._name);
      if (m) recordMeasures.set(r._name, m);
    }
    const uniqueRouteIds = [...new Set([...recordMeasures.values()].map(m => m.routeId))];
    const CHUNK153 = 10;
    const allFeats153 = (await Promise.all(
      chunkArray(uniqueRouteIds, CHUNK153).map(async chunk => {
        const inList = chunk.map(r => `'${r}'`).join(',');
        const body = new URLSearchParams({
          where:          `RouteID IN (${inList})`,
          outFields:      'RouteID,FromARMeasure,ToARMeasure,AADT_YEAR,AADT',
          returnGeometry: 'false',
          ...versionParam(),
          f:     'json',
          token: _token
        });
        const data = await fetch(`${CONFIG.mapServiceUrl}/153/query`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
        ).then(r => r.json()).catch(() => ({}));
        if (data.error) console.error('[intd layer 153]', data.error.code, data.error.message);
        return data.features ?? [];
      })
    )).flat();

    // Group by RouteID for fast lookup
    const byRoute153 = new Map();
    for (const f of allFeats153) {
      const rid = f.attributes?.RouteID;
      if (rid == null) continue;
      if (!byRoute153.has(rid)) byRoute153.set(rid, []);
      byRoute153.get(rid).push(f.attributes);
    }

    const aadtMap = new Map(); // _name → best attributes
    for (const r of records) {
      const m = recordMeasures.get(r._name);
      if (!m) continue;
      const feats = byRoute153.get(m.routeId) ?? [];
      let best = null;
      for (const a of feats) {
        const from = a.FromARMeasure ?? -Infinity;
        const to   = a.ToARMeasure   ??  Infinity;
        if (m.arMeasure < from || m.arMeasure > to) continue;
        if (a.AADT_YEAR == null) continue;
        if (best == null || a.AADT_YEAR > best.AADT_YEAR) best = a;
      }
      if (best) aadtMap.set(r._name, best);
    }

    for (const r of records) {
      const ad = aadtMap.get(r._name);
      if (ad) {
        r.ml2Eff = ad.AADT_YEAR != null ? String(ad.AADT_YEAR) : '';
        r.ml2Adt = ad.AADT      != null ? String(ad.AADT)      : '';
      }
    }
  }

  // Sort by measure; at same position R before L (mirrors HSL sortWithIndependentAlignments)
  records.sort((a, b) => {
    const diff = a._measure - b._measure;
    if (Math.abs(diff) > 0.001) return diff;
    if (a._pmSuffix === 'R' && b._pmSuffix === 'L') return -1;
    if (a._pmSuffix === 'L' && b._pmSuffix === 'R') return  1;
    return 0;
  });

  // Group consecutive R/L sections so R records precede L records (same measure band)
  const grouped = [];
  let i = 0;
  while (i < records.length) {
    if (records[i]._pmSuffix === 'R' || records[i]._pmSuffix === 'L') {
      const j = i;
      while (i < records.length && (records[i]._pmSuffix === 'R' || records[i]._pmSuffix === 'L')) i++;
      const section = records.slice(j, i);
      grouped.push(...section.filter(r => r._pmSuffix === 'R'));
      grouped.push(...section.filter(r => r._pmSuffix === 'L'));
    } else {
      grouped.push(records[i++]);
    }
  }
  return grouped;
}

// ── INTD: Run functions ───────────────────────────────────────────────────

async function intd_runDistrictRouteMode() {
  if (!tokenIsValid()) { login(); return; }
  const district = document.getElementById('districtSelect').value || null;
  const routeNum = document.getElementById('districtRouteSelect').value;
  const county   = getDistrictCounty();
  if (!routeNum) { showRampResults('error', 'Please select a route.'); return; }
  const paddedRoute = String(routeNum).padStart(3, '0');
  const { segments } = buildHslSegments(paddedRoute);
  const btn = document.getElementById('districtRouteBtn');
  btn.disabled = true;
  startThinking(btn);
  clearResults();
  try {
    const [records, direction] = await Promise.all([
      intd_queryIntersections(segments, routeNum, district, county),
      queryRouteDirection(routeNum)
    ]);
    _intd_allResults    = records;
    _intd_currentPage   = 0;
    _intd_generatedOn   = new Date().toLocaleString();
    _intd_routeLabel    = paddedRoute;
    _intd_directionFrom = direction.from;
    _intd_directionTo   = direction.to;
    intd_renderPage();
  } catch (err) {
    showRampResults('error', err.message || 'An error occurred.');
  } finally {
    btn.disabled = false;
    stopThinking(btn);
  }
}

async function intd_runTranslate() {
  if (!tokenIsValid()) { login(); return; }
  const from = readSection('from');
  const to   = readSection('to');
  const fromMeasure = parseFloat(from.measureRaw);
  if (isNaN(fromMeasure)) { showRampResults('error', 'From measure must be a number.'); return; }
  const toMeasure = parseFloat(to.measureRaw);
  if (isNaN(toMeasure)) { showRampResults('error', 'To measure must be a number.'); return; }
  setFieldError('from', '');
  setFieldError('to',   '');
  const fromRouteIdR = buildRouteId(from, 'R');
  const fromRouteIdL = buildRouteId(from, 'L');
  const toRouteIdR   = buildRouteId(to,   'R');
  const toRouteIdL   = buildRouteId(to,   'L');
  const needsLAlt    = from.pmSuffix !== 'L';
  const fromL        = { ...from, pmSuffix: 'L' };
  const toL          = { ...to,   pmSuffix: 'L' };
  const btn = document.getElementById('translateBtn');
  btn.disabled = true;
  startThinking(btn);
  clearResults();
  try {
    const [fromResult, toResult, fromAltResult, toAltResult] = await Promise.allSettled([
      translateSection(fromRouteIdR, fromRouteIdL, fromMeasure),
      translateSection(toRouteIdR,   toRouteIdL,   toMeasure),
      needsLAlt ? translateSection(buildRouteId(fromL, 'R'), buildRouteId(fromL, 'L'), fromMeasure) : Promise.resolve(null),
      needsLAlt ? translateSection(buildRouteId(toL,   'R'), buildRouteId(toL,   'L'), toMeasure)   : Promise.resolve(null)
    ]);
    let hasError = false;
    if (fromResult.status === 'rejected' || (!fromResult.value?.bestR && !fromResult.value?.bestL)) {
      setFieldError('from', 'INVALID LOCATION'); hasError = true;
    }
    if (toResult.status === 'rejected' || (!toResult.value?.bestR && !toResult.value?.bestL)) {
      setFieldError('to', 'INVALID LOCATION'); hasError = true;
    }
    if (hasError) return;
    const { bestR: fromBestR, bestL: fromBestL } = fromResult.value;
    const { bestR: toBestR,   bestL: toBestL   } = toResult.value;
    const fromAltV = fromAltResult.status === 'fulfilled' ? fromAltResult.value : null;
    const toAltV   = toAltResult.status   === 'fulfilled' ? toAltResult.value   : null;
    const segments = [
      makeSegment(fromBestR, fromAltV?.bestR, toBestR, toAltV?.bestR),
      makeSegment(fromBestL, fromAltV?.bestL, toBestL, toAltV?.bestL)
    ].filter(Boolean);
    if (segments.length === 0) { showRampResults('error', 'Translation failed for both R and L alignments.'); return; }
    const paddedRouteNum = from.routeNum.padStart(3, '0');
    const [records, direction] = await Promise.all([
      intd_queryIntersections(segments, from.routeNum),
      queryRouteDirection(paddedRouteNum)
    ]);
    _intd_allResults    = records;
    _intd_currentPage   = 0;
    _intd_generatedOn   = new Date().toLocaleString();
    _intd_routeLabel    = paddedRouteNum;
    _intd_directionFrom = direction.from;
    _intd_directionTo   = direction.to;
    intd_renderPage();
  } catch (err) {
    showRampResults('error', err.message || 'An error occurred.');
  } finally {
    btn.disabled = false;
    stopThinking(btn);
  }
}
