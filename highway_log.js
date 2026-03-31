  // ── Highway Log ───────────────────────────────────────────────────────────────

  let _hl_allResults    = [];
  let _hl_currentPage   = 0;
  let _hl_generatedOn   = '';
  let _hl_routeLabel    = '';
  let _hl_directionFrom = '';
  let _hl_directionTo   = '';

  const HL_PAGE_SIZE = 25;

  // ── HL: Range-layer lookup on the _S (secondary) alignment ───────────────────
  // Like queryRangeLayer but routes _P → _S so Left Roadbed features resolve.

  async function hl_queryRangeLayerS(pairs, layerNum, fieldName) {
    const toS = rid => {
      if (rid.endsWith('._P')) return rid.slice(0, -3) + '._S';
      if (rid.endsWith('_P'))  return rid.slice(0, -2) + '_S';
      return rid;
    };
    const CHUNK = 100;
    const allFeatures = (await Promise.all(chunkArray(pairs, CHUNK).map(async chunk => {
      const orClauses = chunk.map(p => {
        const rid = toS(p.routeId);
        const m   = (p.odMeasure !== '' && p.odMeasure != null) ? parseFloat(p.odMeasure) : p.arMeasure;
        return `(RouteID = '${rid}' AND FromARMeasure <= ${m} AND ToARMeasure >= ${m})`;
      }).join(' OR ');
      const body = new URLSearchParams({
        where:          `(${orClauses})${getDateFilter()}`,
        outFields:      `RouteID,FromARMeasure,ToARMeasure,${fieldName}`,
        returnGeometry: 'false',
        ...versionParam(),
        f:              'json',
        token:          _token
      });
      try {
        const resp = await fetch(`${CONFIG.mapServiceUrl}/${layerNum}/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
        });
        const data = await resp.json();
        if (data.error) {
          const code = data.error.code;
          if (code === 498 || code === 499) { _token = null; login(); }
          console.error(`[hl_queryRangeLayerS/${layerNum}] API error ${code}: ${data.error.message}`);
          return [];
        }
        return Array.isArray(data.features) ? data.features : [];
      } catch (e) {
        console.error(`[hl_queryRangeLayerS/${layerNum}] error:`, e.message);
        return [];
      }
    }))).flat();

    const byRoute = new Map();
    for (const f of allFeatures) {
      const rid = f.attributes?.RouteID;
      if (rid == null) continue;
      if (!byRoute.has(rid)) byRoute.set(rid, []);
      byRoute.get(rid).push(f);
    }
    const map = new Map();
    for (const p of pairs) {
      const lookupId   = toS(p.routeId);
      const m          = (p.odMeasure !== '' && p.odMeasure != null) ? parseFloat(p.odMeasure) : p.arMeasure;
      const candidates = byRoute.get(lookupId) ?? [];
      const matches    = candidates.filter(f => {
        const from = f.attributes?.FromARMeasure;
        const to   = f.attributes?.ToARMeasure;
        return from != null && to != null && m >= from && m <= to;
      });
      const match = matches.length > 1
        ? matches.reduce((best, f) => f.attributes.FromARMeasure > best.attributes.FromARMeasure ? f : best)
        : matches[0];
      map.set(p.name, match?.attributes?.[fieldName] ?? '');
    }
    return map;
  }

  // ── HL: District begin/end records (layer 114) ───────────────────────────────

  async function hl_queryDistrictBegins(segments, routeNumDigits) {
    const segClauses = segments.map(({ fromBest, toBest }) => {
      const rid   = fromBest.routeId.endsWith('_S') ? fromBest.routeId.slice(0, -2) + '_P' : fromBest.routeId;
      const fromM = Math.min(fromBest.measure, toBest.measure) - 0.005;
      const toM   = Math.max(fromBest.measure, toBest.measure) + 0.005;
      return `(RouteID = '${rid}' AND FromARMeasure <= ${toM} AND ToARMeasure >= ${fromM})`;
    });
    const dateFilter = getDateFilter();
    const where = segClauses.length === 1
      ? segClauses[0].slice(1, -1) + dateFilter
      : `(${segClauses.join(' OR ')})${dateFilter}`;
    const body = new URLSearchParams({
      where,
      outFields:      'RouteID,FromARMeasure,ToARMeasure,District,BeginPMPrefix,BeginPMMeasure,BeginCounty,EndPMPrefix,EndPMMeasure,EndCounty',
      returnGeometry: 'false',
      ...versionParam(),
      f:              'json',
      token:          _token
    });
    let data;
    try {
      const resp = await fetch(`${CONFIG.mapServiceUrl}/114/query`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
      });
      data = await resp.json();
    } catch (e) {
      console.error('[hl_queryDistrictBegins] error:', e.message);
      return [];
    }
    if (data.error) {
      const code = data.error.code;
      if (code === 498 || code === 499) { _token = null; login(); return []; }
      console.error(`[hl_queryDistrictBegins] API error ${code}: ${data.error.message}`);
      return [];
    }
    const seen = new Set();
    const features = (data.features ?? []).filter(f => {
      const a   = f.attributes ?? {};
      const key = `${a.RouteID}|${a.FromARMeasure}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (features.length === 0) return [];

    const fmtDistrict = v => v != null ? String(v).padStart(2, '0') : '';
    const pairs = features.flatMap(f => {
      const a        = f.attributes ?? {};
      const district = fmtDistrict(a.District);
      return [
        {
          type:        'districtbegin',
          name:        `db_${a.RouteID}_${a.FromARMeasure}`,
          desc:        '',
          routeId:     a.RouteID,
          arMeasure:   a.FromARMeasure,
          county:      a.BeginCounty   ?? '',
          routeSuffix: '',
          pmPrefix:    a.BeginPMPrefix ?? '',
          pmSuffix:    '.',
          pmMeasure:   a.BeginPMMeasure != null ? String(a.BeginPMMeasure) : '',
          odMeasure:   '',
          district,
          districtCode: district,
          startDate:   null,
          endDate:     null
        },
        {
          type:        'districtend',
          name:        `de_${a.RouteID}_${a.ToARMeasure}`,
          desc:        '',
          routeId:     a.RouteID,
          arMeasure:   a.ToARMeasure,
          county:      a.EndCounty   ?? '',
          routeSuffix: '',
          pmPrefix:    a.EndPMPrefix ?? '',
          pmSuffix:    '.',
          pmMeasure:   a.EndPMMeasure != null ? String(a.EndPMMeasure) : '',
          odMeasure:   '',
          district,
          districtCode: district,
          startDate:   null,
          endDate:     null
        }
      ];
    });

    const CHUNK = 200;
    const chunks = [];
    for (let i = 0; i < pairs.length; i += CHUNK) chunks.push(pairs.slice(i, i + CHUNK));
    await Promise.all(chunks.map(async chunk => {
      const locs = chunk.map(p => ({ routeId: p.routeId, measure: p.arMeasure }));
      const xlateBody = new URLSearchParams({
        locations:             JSON.stringify(locs),
        targetNetworkLayerIds: JSON.stringify([5]),
        ...versionParam(),
        ...historicMomentParam(),
        f:     'json',
        token: _token
      });
      const xlateData = await fetch(
        `${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/4/translate`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: xlateBody.toString() }
      ).then(r => r.json()).catch(() => ({ locations: [] }));
      (xlateData.locations ?? []).forEach((loc, idx) => {
        const xlated = loc.translatedLocations ?? [];
        const result = xlated.find(r => r.measure != null && routeNumDigits && r.routeId?.includes(routeNumDigits))
                    ?? xlated.find(r => r.measure != null)
                    ?? xlated[0];
        if (result?.measure != null) chunk[idx].odMeasure = String(result.measure);
      });
    }));

    return pairs;
  }

  // ── HL: ADT lookup (layer 153, filtered to AADT_YEAR = currentYear - 2) ──────

  async function hl_queryADT(pairs) {
    const toP = rid => {
      if (rid.endsWith('._S')) return rid.slice(0, -3) + '._P';
      if (rid.endsWith('_S'))  return rid.slice(0, -2) + '_P';
      return rid;
    };
    const adtYear = new Date().getFullYear() - 2;
    // Query by unique RouteIDs + AADT_YEAR only, then match measures in JS
    const uniqueRouteIds = [...new Set(pairs.map(p => toP(p.routeId)))];
    const CHUNK = 10;
    const allFeatures = (await Promise.all(chunkArray(uniqueRouteIds, CHUNK).map(async chunk => {
      const inList = chunk.map(r => `'${r}'`).join(',');
      const where  = `RouteID IN (${inList}) AND AADT_YEAR = '${adtYear}'${getDateFilter()}`;
      const body = new URLSearchParams({
        where:          where,
        outFields:      'RouteID,FromARMeasure,ToARMeasure,AADT_BACK,AADT_CODE,AADT_AHEAD',
        returnGeometry: 'false',
        ...versionParam(),
        f:              'json',
        token:          _token
      });
      try {
        const resp = await fetch(`${CONFIG.mapServiceUrl}/153/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
        });
        const data = await resp.json();
        if (data.error) {
          const code = data.error.code;
          if (code === 498 || code === 499) { _token = null; login(); }
          console.error(`[hl_queryADT] API error ${code}: ${data.error.message}`);
          return [];
        }
        return Array.isArray(data.features) ? data.features : [];
      } catch (e) {
        console.error('[hl_queryADT] error:', e.message);
        return [];
      }
    }))).flat();

    const byRoute = new Map();
    for (const f of allFeatures) {
      const rid = f.attributes?.RouteID;
      if (rid == null) continue;
      if (!byRoute.has(rid)) byRoute.set(rid, []);
      byRoute.get(rid).push(f);
    }
    const backMap = new Map(), codeMap = new Map(), aheadMap = new Map();
    for (const p of pairs) {
      const lookupId   = toP(p.routeId);
      const m          = (p.odMeasure !== '' && p.odMeasure != null) ? parseFloat(p.odMeasure) : p.arMeasure;
      const candidates = byRoute.get(lookupId) ?? [];
      const matches    = candidates.filter(f => {
        const from = f.attributes?.FromARMeasure;
        const to   = f.attributes?.ToARMeasure;
        return from != null && to != null && m >= from && m <= to;
      });
      const match = matches.length > 1
        ? matches.reduce((best, f) => f.attributes.FromARMeasure > best.attributes.FromARMeasure ? f : best)
        : matches[0];
      backMap.set(p.name,  match?.attributes?.AADT_BACK  ?? '');
      codeMap.set(p.name,  match?.attributes?.AADT_CODE  ?? '');
      aheadMap.set(p.name, match?.attributes?.AADT_AHEAD ?? '');
    }
    return [backMap, codeMap, aheadMap];
  }

  // ── HL: Run functions ─────────────────────────────────────────────────────────

  async function hl_runDistrictRouteMode() {
    if (!tokenIsValid()) { login(); return; }
    const district = document.getElementById('districtSelect').value || null;
    const routeNum = document.getElementById('districtRouteSelect').value;
    if (!routeNum) { hl_showResults('error', 'Please select a route.'); return; }
    const paddedRoute = String(routeNum).padStart(3, '0');
    const { segments, routeSuffix } = buildHslSegments(paddedRoute);
    const county = getDistrictCounty();
    const btn = document.getElementById('districtRouteBtn');
    btn.disabled = true;
    startThinking(btn);
    clearResults();
    try {
      const [landmarkPairs, { pairs: intersectionPairs }, cityBeginPairs, districtBeginPairs, direction] = await Promise.all([
        queryLandmarks(segments, routeSuffix, district, county),
        queryIntersections(segments, routeNum, district, county),
        queryCityBegins(segments, paddedRoute, district, county),
        hl_queryDistrictBegins(segments, paddedRoute),
        queryRouteDirection(routeNum)
      ]);
      for (const p of intersectionPairs)   p.desc = '';
      for (const p of cityBeginPairs)      p.desc = '';
      const measureOf = p => parseFloat(p.odMeasure !== '' && p.odMeasure != null ? p.odMeasure : p.arMeasure);
      const allPairs = [...landmarkPairs, ...intersectionPairs, ...cityBeginPairs, ...districtBeginPairs].sort((a, b) => measureOf(a) - measureOf(b));
      _hl_routeLabel    = paddedRoute;
      _hl_directionFrom = direction.from;
      _hl_directionTo   = direction.to;
      _hl_allResults    = await hl_buildResults(allPairs);
      _hl_currentPage   = 0;
      _hl_generatedOn   = new Date().toLocaleString();
      hl_renderPage();
    } catch (err) {
      hl_showResults('error', err.message || 'An error occurred.');
    } finally {
      btn.disabled = false;
      stopThinking(btn);
    }
  }

  async function hl_runTranslate() {
    if (!tokenIsValid()) { login(); return; }
    const from = readSection('from');
    const to   = readSection('to');
    const fromMeasure = parseFloat(from.measureRaw);
    if (isNaN(fromMeasure)) { hl_showResults('error', 'From measure must be a number.'); return; }
    const toMeasure = parseFloat(to.measureRaw);
    if (isNaN(toMeasure)) { hl_showResults('error', 'To measure must be a number.'); return; }
    const btn = document.getElementById('translateBtn');
    btn.disabled = true;
    startThinking(btn);
    clearResults();
    try {
      const [fromResult, toResult] = await Promise.allSettled([
        translateSection(buildRouteId(from, 'R'), buildRouteId(from, 'L'), fromMeasure),
        translateSection(buildRouteId(to,   'R'), buildRouteId(to,   'L'), toMeasure)
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
      const segments = [
        makeSegment(fromBestR, null, toBestR, null),
        makeSegment(fromBestL, null, toBestL, null)
      ].filter(Boolean);
      if (segments.length === 0) { hl_showResults('error', 'Translation failed.'); return; }
      const paddedRouteNum = from.routeNum.padStart(3, '0');
      const routeSuffix    = from.routeSuffix === '.' ? '' : from.routeSuffix;
      const [landmarkPairs, { pairs: intersectionPairs }, cityBeginPairs, districtBeginPairs, direction] = await Promise.all([
        queryLandmarks(segments, routeSuffix),
        queryIntersections(segments, from.routeNum),
        queryCityBegins(segments, paddedRouteNum),
        hl_queryDistrictBegins(segments, paddedRouteNum),
        queryRouteDirection(paddedRouteNum)
      ]);
      for (const p of intersectionPairs)   p.desc = '';
      for (const p of cityBeginPairs)      p.desc = '';
      const measureOf = p => parseFloat(p.odMeasure !== '' && p.odMeasure != null ? p.odMeasure : p.arMeasure);
      const allPairs = [...landmarkPairs, ...intersectionPairs, ...cityBeginPairs, ...districtBeginPairs].sort((a, b) => measureOf(a) - measureOf(b));
      _hl_routeLabel    = paddedRouteNum;
      _hl_directionFrom = direction.from;
      _hl_directionTo   = direction.to;
      _hl_allResults    = await hl_buildResults(allPairs);
      _hl_currentPage   = 0;
      _hl_generatedOn   = new Date().toLocaleString();
      hl_renderPage();
    } finally {
      btn.disabled = false;
      stopThinking(btn);
    }
  }

  // ── HL: Build result rows ─────────────────────────────────────────────────────

  async function hl_buildResults(pairs) {
    if (pairs.length === 0) return [];

    const [
      cityMap, naMap, ruMap, spdMap, terMap,
      hgMap, acMap,
      lbTMap, lbLnsMap, lbFMap, lbTo1Map, lbTr1Map, lbWidMap, lbTo2Map, lbTr2Map,
      medTypeMap, medCurbMap, medBarrMap, medWidMap, medVarMap,
      rbTMap, rbLnsMap, rbFMap, rbTo1Map, rbTr1Map, rbWidMap, rbTo2Map, rbTr2Map,
      adtMaps
    ] = await Promise.all([
      queryRangeLayer(pairs, 74,  'City_Code'),
      queryRangeLayer(pairs, 125, 'Non_Add_Mileage'),
      queryRangeLayer(pairs, 130, 'Population_Code'),
      queryRangeLayer(pairs, 113, 'Design_Speed'),
      queryRangeLayer(pairs, 11,  'Terrain_Type'),
      queryRangeLayer(pairs, 116, 'Highway_Group'),
      queryRangeLayer(pairs, 109, 'SHS_Access_Control'),
      hl_queryRangeLayerS(pairs, 136, 'Surface_Type_L'),
      hl_queryRangeLayerS(pairs, 139, 'Thru_Num_Lanes_L'),
      hl_queryRangeLayerS(pairs, 134, 'Special_Feature_Type_L'),
      hl_queryRangeLayerS(pairs, 128, 'Shld_Width_Total_Out_L'),
      hl_queryRangeLayerS(pairs, 128, 'Shld_Width_Treated_Out_L'),
      hl_queryRangeLayerS(pairs, 139, 'Travel_Way_Width_L'),
      hl_queryRangeLayerS(pairs, 120, 'Shld_Width_Total_In_L'),
      hl_queryRangeLayerS(pairs, 120, 'Shld_Width_Treated_In_L'),
      queryRangeLayer(pairs, 124, 'Median_Type'),
      queryRangeLayer(pairs, 112, 'Curb_Landscape'),
      queryRangeLayer(pairs, 110, 'Barrier_Type'),
      queryRangeLayer(pairs, 124, 'Median_Width'),
      queryRangeLayer(pairs, 124, 'Median_Variance'),
      queryRangeLayer(pairs, 137, 'Surface_Type_R'),
      queryRangeLayer(pairs, 140, 'Thru_Num_Lanes_R'),
      queryRangeLayer(pairs, 135, 'Special_Feature_Type_R'),
      queryRangeLayer(pairs, 121, 'Shld_Width_Total_In_R'),
      queryRangeLayer(pairs, 121, 'Shld_Width_Treated_In_R'),
      queryRangeLayer(pairs, 140, 'Travel_Way_Width_R'),
      queryRangeLayer(pairs, 129, 'Shld_Width_Total_Out_R'),
      queryRangeLayer(pairs, 129, 'Shld_Width_Treated_Out_R'),
      hl_queryADT(pairs)
    ]);
    const [adtBackMap, adtCodeMap, adtAheadMap] = adtMaps;

    // MI: distance to next landmark (OD measure difference)
    const distances = pairs.map((p, i) => {
      if (p.odMeasure == null || p.odMeasure === '') return '';
      const next = pairs.slice(i + 1).find(r => r.odMeasure != null && r.odMeasure !== '');
      if (!next) return '';
      return (parseFloat(next.odMeasure) - parseFloat(p.odMeasure)).toFixed(3);
    });

    // Cnty Odom: cumulative distance within county, resets on county change
    let countyStart   = null;
    let currentCounty = null;
    const countyOdoms = pairs.map(p => {
      if (p.odMeasure == null || p.odMeasure === '') return '';
      if (p.county !== currentCounty) {
        currentCounty = p.county;
        countyStart   = parseFloat(p.odMeasure);
      }
      return (parseFloat(p.odMeasure) - countyStart).toFixed(3);
    });

    return pairs.map((p, i) => {
      const prefix = (p.pmPrefix && p.pmPrefix !== '.') ? p.pmPrefix : '';
      const suffix = (p.pmSuffix && p.pmSuffix !== '.') ? p.pmSuffix : '';
      return {
        location: prefix + padMeasure(p.pmMeasure) + suffix,
        lengthMi: distances[i]  !== '' ? padMeasure(distances[i])  : '',
        a:        naMap.get(p.name) === 1 ? 'N' : '',
        cntyOdom: countyOdoms[i] !== '' ? padMeasure(countyOdoms[i]) : '',
        city:     (p.type === 'citybegin' || p.type === 'cityend') ? (p.cityCode ?? '') : (cityMap.get(p.name) != null ? String(cityMap.get(p.name)) : ''),
        ru:       ruMap.get(p.name)   != null ? String(ruMap.get(p.name))   : '',
        spd:      spdMap.get(p.name)  != null ? String(spdMap.get(p.name))  : '',
        ter:      terMap.get(p.name)  != null ? String(terMap.get(p.name))  : '',
        hg:       hgMap.get(p.name)   != null ? String(hgMap.get(p.name))   : '',
        ac:       acMap.get(p.name)   != null ? String(acMap.get(p.name))   : '',
        lb_t:     lbTMap.get(p.name)  != null ? String(lbTMap.get(p.name))  : '',
        lb_lns:   lbLnsMap.get(p.name)!= null ? String(lbLnsMap.get(p.name)): '',
        lb_f:     lbFMap.get(p.name)  != null ? String(lbFMap.get(p.name))  : '',
        lb_to1:   lbTo1Map.get(p.name)!= null ? String(lbTo1Map.get(p.name)): '',
        lb_tr1:   lbTr1Map.get(p.name)!= null ? String(lbTr1Map.get(p.name)): '',
        lb_wid:   lbWidMap.get(p.name)!= null ? String(lbWidMap.get(p.name)): '',
        lb_to2:   lbTo2Map.get(p.name)!= null ? String(lbTo2Map.get(p.name)): '',
        lb_tr2:   lbTr2Map.get(p.name)!= null ? String(lbTr2Map.get(p.name)): '',
        med_tcb:  [medTypeMap.get(p.name), medCurbMap.get(p.name), medBarrMap.get(p.name)]
                    .filter(v => v != null && v !== '').map(String).join(''),
        med_yla:  [medWidMap.get(p.name), medVarMap.get(p.name)]
                    .filter(v => v != null && v !== '').map(String).join(''),
        rb_t:     rbTMap.get(p.name)   != null ? String(rbTMap.get(p.name))   : '',
        rb_lns:   rbLnsMap.get(p.name) != null ? String(rbLnsMap.get(p.name)) : '',
        rb_f:     rbFMap.get(p.name)   != null ? String(rbFMap.get(p.name))   : '',
        rb_to1:   rbTo1Map.get(p.name) != null ? String(rbTo1Map.get(p.name)) : '',
        rb_tr1:   rbTr1Map.get(p.name) != null ? String(rbTr1Map.get(p.name)) : '',
        rb_wid:   rbWidMap.get(p.name) != null ? String(rbWidMap.get(p.name)) : '',
        rb_to2:   rbTo2Map.get(p.name)   != null ? String(rbTo2Map.get(p.name))   : '',
        rb_tr2:   rbTr2Map.get(p.name)   != null ? String(rbTr2Map.get(p.name))   : '',
        adt_back: adtBackMap.get(p.name)  != null ? String(adtBackMap.get(p.name))  : '',
        adt_p:    adtCodeMap.get(p.name)  != null ? String(adtCodeMap.get(p.name))  : '',
        adt_ahead:adtAheadMap.get(p.name) != null ? String(adtAheadMap.get(p.name)) : '',
        district: p.district ?? '',
        county:   p.county   ?? '',
        desc:     p.desc,
      };
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function hl_showResults(type, message, results) {
    const box = document.getElementById('rampResults');
    box.style.display = 'block';
    if (type === 'error') {
      box.className = 'ramp-results error';
      box.innerHTML = esc(message);
    } else if (type === 'none') {
      box.className = 'ramp-results';
      box.innerHTML = `<span class="ramp-empty">No results found in this segment.</span>`;
    } else {
      _hl_allResults  = results;
      _hl_currentPage = 0;
      _hl_generatedOn = new Date().toLocaleString();
      hl_renderPage();
    }
  }

  function hl_renderPage() {
    const box = document.getElementById('rampResults');
    box.style.display = 'block';
    box.className = 'ramp-results';

    const totalPages = Math.ceil(_hl_allResults.length / HL_PAGE_SIZE);
    const page  = _hl_currentPage;
    const start = page * HL_PAGE_SIZE;
    const slice = _hl_allResults.slice(start, start + HL_PAGE_SIZE);

    const prevDis = page === 0              ? 'disabled' : '';
    const nextDis = page === totalPages - 1 ? 'disabled' : '';

    const actionBar = renderActionBar('California Department of Transportation', 'California State Highway Log', '', 'hl_exportToExcel()', 'hl_printAll()');
    const pagination = `<div class="ramp-pagination">
       <div class="pagination-left">
         <div style="display:flex;">
           <button class="page-arrow" ${prevDis} onclick="hl_changePageFirst()">&#9664;&#9664;</button>
           <button class="page-arrow" ${prevDis} onclick="hl_changePage(-1)">&#9664;</button>
         </div>
       </div>
       <div class="pagination-right">
         <div style="display:flex;">
           <button class="page-arrow" ${nextDis} onclick="hl_changePage(1)">&#9654;</button>
           <button class="page-arrow" ${nextDis} onclick="hl_changePageLast()">&#9654;&#9654;</button>
         </div>
       </div>
     </div>`;

    const tbodyRows = slice.length
      ? hl_buildTbodyRows(slice, start)
      : `<tr><td colspan="33" class="hl-empty">No results found in this segment.</td></tr>`;

    const table = `<div class="hl-table-wrap">
      <table class="hl-table">
        ${hl_buildThead()}
        <tbody>${tbodyRows}</tbody>
      </table>
    </div>`;

    const pageFooter = totalPages > 1
      ? `<div class="page-info">Page ${page + 1} of ${totalPages}</div>`
      : '';
    const generatedFooter = `<div class="generated-on">Generated on ${esc(_hl_generatedOn)}</div>`;
    box.innerHTML = `${actionBar}<div class="hl-title-gap"></div>${pagination}${table}${pageFooter}${generatedFooter}`;
  }

  function hl_buildTbodyRows(slice, startIdx) {
    let prevDistrict = startIdx === 0 ? null : (_hl_allResults[startIdx - 1]?.district ?? null);
    let prevCounty   = startIdx === 0 ? null : (_hl_allResults[startIdx - 1]?.county   ?? null);
    return slice.map((p, i) => {
      let header = '';
      if (p.district !== prevDistrict || p.county !== prevCounty) {
        header = hl_renderDcrRow(p.district, p.county, _hl_routeLabel, startIdx === 0 && i === 0);
        prevDistrict = p.district;
        prevCounty   = p.county;
      }
      return header + hl_renderRow(p, startIdx + i);
    }).join('');
  }

  function hl_changePage(delta) {
    const totalPages = Math.ceil(_hl_allResults.length / HL_PAGE_SIZE);
    const next = _hl_currentPage + delta;
    if (next < 0 || next >= totalPages) return;
    _hl_currentPage = next;
    hl_renderPage();
  }

  function hl_changePageFirst() {
    if (_hl_currentPage === 0) return;
    _hl_currentPage = 0;
    hl_renderPage();
  }

  function hl_changePageLast() {
    const last = Math.ceil(_hl_allResults.length / HL_PAGE_SIZE) - 1;
    if (_hl_currentPage === last) return;
    _hl_currentPage = last;
    hl_renderPage();
  }

  function hl_exportToExcel() {
    if (_hl_allResults.length === 0) return;
    const headers = ['Location', 'MI', 'N/A', 'Cnty Odom', 'City', 'R/U', 'SPD', 'TER', 'H/G', 'A/C',
      'LB T', 'LB Lns', 'LB F', 'LB OT', 'LB TR', 'LB T-W', 'LB IN', 'LB SH',
      'Med TCB', 'Med Wid',
      'RB T', 'RB Lns', 'RB F', 'RB IN', 'RB SH', 'RB T-W', 'RB OT', 'RB SH',
      'ADT Back', 'ADT P', 'ADT Ahead', 'Description'];
    const rows = _hl_allResults.map(p => [
      p.location ?? '', p.lengthMi ?? '', p.a ?? '', p.cntyOdom ?? '', p.city ?? '',
      p.ru ?? '', p.spd ?? '', p.ter ?? '', p.hg ?? '', p.ac ?? '',
      p.lb_t ?? '', p.lb_lns ?? '', p.lb_f ?? '', p.lb_to1 ?? '', p.lb_tr1 ?? '',
      p.lb_wid ?? '', p.lb_to2 ?? '', p.lb_tr2 ?? '',
      p.med_tcb ?? '', p.med_yla ?? '',
      p.rb_t ?? '', p.rb_lns ?? '', p.rb_f ?? '', p.rb_to1 ?? '', p.rb_tr1 ?? '',
      p.rb_wid ?? '', p.rb_to2 ?? '', p.rb_tr2 ?? '',
      p.adt_back ?? '', p.adt_p ?? '', p.adt_ahead ?? '',
      p.desc ?? ''
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Highway Log');
    XLSX.writeFile(wb, `highway_log_${esc(_hl_routeLabel)}.xlsx`);
  }

  function hl_printAll() {
    const box   = document.getElementById('rampResults');
    const saved = box.innerHTML;
    const actionBar = renderActionBar('California Department of Transportation', 'California State Highway Log', '', null, null);
    const tbody = hl_buildTbodyRows(_hl_allResults, 0);
    const table = `<div class="hl-table-wrap"><table class="hl-table">${hl_buildThead()}<tbody>${tbody}</tbody></table></div>`;
    const generatedFooter = `<div class="generated-on">Generated on ${esc(_hl_generatedOn)}</div>`;
    box.innerHTML = `${actionBar}<div class="hl-title-gap"></div>${table}${generatedFooter}`;
    window.print();
    box.innerHTML = saved;
  }

  function hl_renderDcrRow(district, county, route, isFirst) {
    const spacer = `<tr class="hl-dcr-spacer"><td colspan="31"></td></tr>`;
    return `${isFirst ? '' : spacer}<tr class="hl-dcr-row${isFirst ? ' hl-dcr-first' : ''}">
      <td colspan="31">${esc(district || '\u2014')} ${esc(county || '\u2014')} ${esc(route || '\u2014')}</td>
    </tr>${spacer}`;
  }

  function hl_buildThead() {
    return `<thead>
      <!-- Row 1: section group headers only -->
      <tr>
        <th colspan="5"  class="hl-th-group">Location and Distance</th>
        <th rowspan="3"  class="hl-th-stacked">R<br>U</th>
        <th rowspan="3"  class="hl-th-stacked">S<br>P<br>D</th>
        <th rowspan="3"  class="hl-th-stacked">T<br>E<br>R</th>
        <th rowspan="3"  class="hl-th-stacked">H<br>G</th>
        <th rowspan="3"  class="hl-th-stacked">A<br>C</th>
        <th colspan="8"  class="hl-th-group">Left Roadbed</th>
        <th colspan="2"  class="hl-th-group">Median</th>
        <th colspan="8"  class="hl-th-group">Right Roadbed</th>
        <th colspan="3"  class="hl-th-group">ADT Info</th>
      </tr>
      <!-- Row 2: top label of each stacked column header -->
      <tr>
        <!-- Location and Distance -->
        <th rowspan="2">Location</th>
        <th rowspan="2">MI</th>
        <th>N</th>
        <th rowspan="2">Cnty<br>Odom</th>
        <th rowspan="2">City</th>
        <!-- R/U · S/P/D · T/E/R: rowspan=3 from row 1, no cells here -->
        <!-- Left Roadbed: top labels -->
        <th>S</th><th>#</th>
        <th>S</th><th>OT</th><th>SH</th>
        <th>T&#8209;W</th><th>IN</th><th>SH</th>
        <!-- Median: top labels -->
        <th>TCB</th>
        <th>Wid</th>
        <!-- Right Roadbed: top labels -->
        <th>S</th><th>#</th>
        <th>S</th><th>IN</th><th>SH</th>
        <th>T&#8209;W</th><th>OT</th><th>SH</th>
        <!-- ADT: top labels -->
        <th>Look</th>
        <th>P</th>
        <th>Look</th>
      </tr>
      <!-- Row 3: bottom label of each stacked column header -->
      <tr>
        <!-- Location: rowspan · MI: rowspan · N/A: -->
        <th>A</th>
        <!-- Cnty/Odom: rowspan · City: rowspan -->
        <!-- R/U · S/P/D · T/E/R: rowspan=3 from row 1 -->
        <!-- Left Roadbed: bottom labels -->
        <th>T</th><th>Lns</th>
        <th>F</th><th>TO</th><th>TR</th>
        <th>Wid</th><th>TO</th><th>TR</th>
        <!-- Median: bottom labels -->
        <th>YLA</th>
        <th>Var</th>
        <!-- Right Roadbed: bottom labels -->
        <th>T</th><th>Lns</th>
        <th>F</th><th>TO</th><th>TR</th>
        <th>Wid</th><th>TO</th><th>TR</th>
        <!-- ADT: bottom labels -->
        <th>Back</th>
        <th>P</th>
        <th>Ahead</th>
      </tr>
    </thead>`;
  }

  function hl_renderRow(p, idx = 0) {
    const shade = idx % 2 === 0 ? ' hl-shaded' : '';
    const descRow = p.desc
      ? `<tr class="hl-desc-row${shade}"><td colspan="2"></td><td colspan="29"><em>${esc(p.desc)}</em></td></tr>`
      : '';
    return `<tr class="hl-data-row${shade}">
      <td>${esc(p.location  ?? '')}</td>
      <td>${esc(p.lengthMi  ?? '')}</td>
      <td>${esc(p.a         ?? '')}</td>
      <td>${esc(p.cntyOdom  ?? '')}</td>
      <td>${esc(p.city      ?? '')}</td>
      <td>${esc(p.ru        ?? '')}</td>
      <td>${esc(p.spd       ?? '')}</td>
      <td>${esc(p.ter       ?? '')}</td>
      <td>${esc(p.hg        ?? '')}</td>
      <td>${esc(p.ac        ?? '')}</td>
      <td>${esc(p.lb_t      ?? '')}</td>
      <td>${esc(p.lb_lns    ?? '')}</td>
      <td>${esc(p.lb_f      ?? '')}</td>
      <td>${esc(p.lb_to1    ?? '')}</td>
      <td>${esc(p.lb_tr1    ?? '')}</td>
      <td>${esc(p.lb_wid    ?? '')}</td>
      <td>${esc(p.lb_to2    ?? '')}</td>
      <td>${esc(p.lb_tr2    ?? '')}</td>
      <td>${esc(p.med_tcb   ?? '')}</td>
      <td>${esc(p.med_yla   ?? '')}</td>
      <td>${esc(p.rb_t      ?? '')}</td>
      <td>${esc(p.rb_lns    ?? '')}</td>
      <td>${esc(p.rb_f      ?? '')}</td>
      <td>${esc(p.rb_to1    ?? '')}</td>
      <td>${esc(p.rb_tr1    ?? '')}</td>
      <td>${esc(p.rb_wid    ?? '')}</td>
      <td>${esc(p.rb_to2    ?? '')}</td>
      <td>${esc(p.rb_tr2    ?? '')}</td>
      <td>${esc(p.adt_back  ?? '')}</td>
      <td>${esc(p.adt_p     ?? '')}</td>
      <td>${esc(p.adt_ahead ?? '')}</td>
    </tr>${descRow}`;
  }
