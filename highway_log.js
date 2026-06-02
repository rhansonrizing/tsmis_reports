  // ── Highway Log ───────────────────────────────────────────────────────────────

  let _hl_allResults    = [];
  let _hl_currentPage   = 0;
  let _hl_generatedOn   = '';
  let _hl_routeLabel    = '';
  let _hl_directionFrom = '';
  let _hl_directionTo   = '';

  const HL_ROWS_PER_PAGE = 34;

  function hl_formatDateYYMMDD(ts) {
    const d = new Date(ts);
    const yy = String(d.getUTCFullYear()).slice(-2);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }

  // ── HL: Range-layer lookup on the _S (secondary) alignment ───────────────────
  // Like queryRangeLayer but routes _P → _S so Left Roadbed features resolve.

  async function hl_queryRangeLayerS(pairs, layerNum, fieldName) {
    const toS = rid => {
      if (rid.endsWith('._P')) return rid.slice(0, -3) + '._S';
      if (rid.endsWith('_P'))  return rid.slice(0, -2) + '_S';
      return rid;
    };
    const CHUNK = 100;
    // Query both _S and _P routes: left-roadbed data may be stored under _P on
    // standard divided highways (no independent alignment). _S is preferred when
    // non-null; _P is used as fallback.
    const allFeatures = (await Promise.all(chunkArray(pairs, CHUNK).map(async chunk => {
      const orClauses = chunk.map(p => {
        const rid  = p.routeId;
        const ridS = toS(p.routeId);
        const m    = (p.odMeasure !== '' && p.odMeasure != null) ? parseFloat(p.odMeasure) : p.arMeasure;
        const rClause = rid !== ridS ? `(RouteID = '${rid}' OR RouteID = '${ridS}')` : `RouteID = '${rid}'`;
        return `(${rClause} AND FromARMeasure <= ${m} AND ToARMeasure >= ${m})`;
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
      const sId      = toS(p.routeId);
      const pId      = p.routeId;
      const m        = (p.odMeasure !== '' && p.odMeasure != null) ? parseFloat(p.odMeasure) : p.arMeasure;
      const tryMatch = cands => cands.filter(f => {
        const from = f.attributes?.FromARMeasure;
        const to   = f.attributes?.ToARMeasure;
        return from != null && to != null && m >= from && m <= to;
      });
      // Prefer _S result (left roadbed on IA sections); fall back to _P.
      let matches = tryMatch(byRoute.get(sId) ?? []);
      if (matches.length === 0) matches = tryMatch(byRoute.get(pId) ?? []);
      const match = matches.length > 1
        ? matches.reduce((best, f) => f.attributes.FromARMeasure > best.attributes.FromARMeasure ? f : best)
        : matches[0];
      map.set(p.name, match?.attributes?.[fieldName] ?? '');
    }
    return map;
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
      const [{ pairs: landmarkPairs }, direction] = await Promise.all([
        queryLandmarks(segments, routeSuffix, district, county),
        queryRouteDirection(routeNum)
      ]);
      const attrChangePairs = await hl_queryAttributeChangePairs(segments, paddedRoute);
      const basePairs  = [...landmarkPairs];
      const baseOds    = new Set(basePairs.filter(p => p.odMeasure != null && p.odMeasure !== '').map(p => parseFloat(p.odMeasure).toFixed(3)));
      const _normPfx   = p => (!p.pmPrefix || p.pmPrefix === '.') ? '' : p.pmPrefix;
      const _pmKeyOf   = p => isNaN(parseFloat(p.pmMeasure)) ? null : `${_normPfx(p)}|${parseFloat(p.pmMeasure).toFixed(3)}|${p.pmSuffix ?? '.'}`;
      const basePmKeys = new Set(basePairs.map(_pmKeyOf).filter(Boolean));
      const _normalizedCounty = normalizeCountyCode(county);
      const _validCountySet = _normalizedCounty != null
        ? new Set([_normalizedCounty])
        : district != null
          ? new Set(Array.from(document.getElementById('districtCountySelect').querySelectorAll('option')).map(o => normalizeCountyCode(o.value)).filter(Boolean))
          : null;
      const newAttrRaw = attrChangePairs.filter(p => {
        if (p.odMeasure == null || p.odMeasure === '') return false;
        if (baseOds.has(parseFloat(p.odMeasure).toFixed(3))) return false;
        const pk = _pmKeyOf(p);
        if (pk !== null && basePmKeys.has(pk)) return false;
        if (_validCountySet != null && !_validCountySet.has(p.county)) return false;
        return true;
      });
      // When two attrchange boundaries share the same PM key, keep only the highest-AR
      // one — the lower-AR pair probes range lookups before all coincident boundaries
      // have been crossed, producing a spurious intermediate row.
      const _attrPmBest = new Map();
      for (const p of newAttrRaw) {
        const pk = _pmKeyOf(p) ?? p.name;
        if (!_attrPmBest.has(pk) || p.arMeasure > _attrPmBest.get(pk).arMeasure) _attrPmBest.set(pk, p);
      }
      const newAttr       = [..._attrPmBest.values()];
      const unsortedPairs = [...basePairs, ...newAttr];
      const hgPreMap  = await queryRangeLayer(unsortedPairs, 116, 'Highway_Group');
      for (const p of unsortedPairs) p.hgValue = hgPreMap.get(p.name) ?? '';
      const pairs = sortWithIndependentAlignments(unsortedPairs);
      // Fill district/county on attrchange pairs from the preceding record
      let _fwDist = '', _fwCnty = '';
      for (const p of pairs) {
        if (p.type === 'attrchange') {
          if (!p.district) p.district = _fwDist;
          if (!p.county)   p.county   = _fwCnty;
        } else {
          if (p.district) _fwDist = p.district;
          if (p.county)   _fwCnty = p.county;
        }
      }
      _hl_routeLabel    = paddedRoute;
      _hl_directionFrom = direction.from;
      _hl_directionTo   = direction.to;
      _hl_allResults    = await hl_buildResults(pairs);
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
      const [{ pairs: landmarkPairs }, direction] = await Promise.all([
        queryLandmarks(segments, routeSuffix),
        queryRouteDirection(paddedRouteNum)
      ]);
      const attrChangePairs = await hl_queryAttributeChangePairs(segments, paddedRouteNum);
      const basePairs  = [...landmarkPairs];
      const baseOds    = new Set(basePairs.filter(p => p.odMeasure != null && p.odMeasure !== '').map(p => parseFloat(p.odMeasure).toFixed(3)));
      const _normPfx   = p => (!p.pmPrefix || p.pmPrefix === '.') ? '' : p.pmPrefix;
      const _pmKeyOf   = p => isNaN(parseFloat(p.pmMeasure)) ? null : `${_normPfx(p)}|${parseFloat(p.pmMeasure).toFixed(3)}|${p.pmSuffix ?? '.'}`;
      const basePmKeys = new Set(basePairs.map(_pmKeyOf).filter(Boolean));
      const newAttrRaw = attrChangePairs.filter(p => {
        if (p.odMeasure == null || p.odMeasure === '') return false;
        if (baseOds.has(parseFloat(p.odMeasure).toFixed(3))) return false;
        const pk = _pmKeyOf(p);
        if (pk !== null && basePmKeys.has(pk)) return false;
        return true;
      });
      const _attrPmBest = new Map();
      for (const p of newAttrRaw) {
        const pk = _pmKeyOf(p) ?? p.name;
        if (!_attrPmBest.has(pk) || p.arMeasure > _attrPmBest.get(pk).arMeasure) _attrPmBest.set(pk, p);
      }
      const newAttr       = [..._attrPmBest.values()];
      const unsortedPairs = [...basePairs, ...newAttr];
      const hgPreMap  = await queryRangeLayer(unsortedPairs, 116, 'Highway_Group');
      for (const p of unsortedPairs) p.hgValue = hgPreMap.get(p.name) ?? '';
      const pairs = sortWithIndependentAlignments(unsortedPairs);
      // Fill district/county on attrchange pairs from the preceding record
      let _fwDist = '', _fwCnty = '';
      for (const p of pairs) {
        if (p.type === 'attrchange') {
          if (!p.district) p.district = _fwDist;
          if (!p.county)   p.county   = _fwCnty;
        } else {
          if (p.district) _fwDist = p.district;
          if (p.county)   _fwCnty = p.county;
        }
      }
      _hl_routeLabel    = paddedRouteNum;
      _hl_directionFrom = direction.from;
      _hl_directionTo   = direction.to;
      _hl_allResults    = await hl_buildResults(pairs);
      _hl_currentPage   = 0;
      _hl_generatedOn   = new Date().toLocaleString();
      hl_renderPage();
    } finally {
      btn.disabled = false;
      stopThinking(btn);
    }
  }

  // ── HL: Attribute-change pair discovery ──────────────────────────────────────
  // Queries each primary range layer for all segment boundaries in the route's
  // AR extent. Each FromARMeasure is a location where some attribute changed.
  // Returns synthetic 'attrchange' pair objects translated to OD and PM.

  async function hl_queryAttributeChangePairs(segments, routeNumDigits) {
    // Separate segments into P-route (right/shared) and S-route (left roadbed).
    const pRanges = [];
    const sRanges = [];
    for (const { fromBest, toBest } of segments) {
      const rid   = fromBest.routeId;
      const fromM = Math.min(fromBest.measure, toBest.measure);
      const toM   = Math.max(fromBest.measure, toBest.measure);
      if (rid.endsWith('_S')) {
        sRanges.push({ rid, fromM, toM });
      } else {
        pRanges.push({ rid, fromM, toM });
      }
    }

    // Right/shared layers queried on _P routes; Left roadbed layers on _S routes.
    // For standard routes (no IA), sRanges is empty but left-roadbed data may still
    // be under the _S routeId — always scan L_LAYERS on pRanges converted to _S.
    const R_LAYERS = [130, 113, 11, 116, 109, 137, 140, 129, 121, 124, 112, 110];
    const L_LAYERS = [136, 139, 134, 128, 120];
    const toS = rid => {
      if (rid.endsWith('._P')) return rid.slice(0, -3) + '._S';
      if (rid.endsWith('_P'))  return rid.slice(0, -2) + '_S';
      return rid;
    };
    const pRangesS = pRanges.map(r => ({ ...r, rid: toS(r.rid) }));
    const lRanges  = [...pRangesS, ...sRanges];

    const arSet = new Map(); // `${rid}|${ar}` → { rid, layers: Set<number> }

    const queryLayer = async (layerNum, ranges) => {
      const pts = (await Promise.all(ranges.map(async ({ rid, fromM, toM }) => {
        const where = `RouteID = '${rid}' AND FromARMeasure <= ${toM + 0.005} AND ToARMeasure >= ${fromM - 0.005}${getDateFilter()}`;
        const allPts = [];
        let offset = 0;
        while (true) {
          const body = new URLSearchParams({
            where, outFields: 'FromARMeasure', returnGeometry: 'false',
            resultRecordCount: 1000, resultOffset: offset,
            ...versionParam(), f: 'json', token: _token
          });
          try {
            const data = await fetch(`${CONFIG.mapServiceUrl}/${layerNum}/query`, {
              method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
            }).then(r => r.json());
            if (data.error) break;
            const batch = (data.features ?? [])
              .map(f => f.attributes?.FromARMeasure)
              .filter(ar => ar != null && ar >= fromM - 0.001 && ar <= toM + 0.001)
              .map(ar => ({ rid, ar }));
            allPts.push(...batch);
            if (!data.exceededTransferLimit || (data.features ?? []).length === 0) break;
            offset += (data.features ?? []).length;
          } catch { break; }
        }
        return allPts;
      }))).flat();
      for (const { rid, ar } of pts) {
        const key = `${rid}|${ar}`;
        if (!arSet.has(key)) arSet.set(key, { rid, layers: new Set() });
        arSet.get(key).layers.add(layerNum);
      }
    };

    await Promise.all([
      ...R_LAYERS.map(layerNum => queryLayer(layerNum, pRanges)),
      ...L_LAYERS.map(layerNum => queryLayer(layerNum, lRanges))
    ]);

    if (arSet.size === 0) return [];

    const inputs = [...arSet.entries()].map(([key, { rid, layers }]) => ({
      key, routeId: rid, measure: parseFloat(key.split('|')[1]), layers
    }));

    const odMap = new Map(), pmMap = new Map();
    const url  = `${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/4/translate`;
    const hdrs = { 'Content-Type': 'application/x-www-form-urlencoded' };

    await Promise.all(chunkArray(inputs, 100).map(async chunk => {
      const locs   = chunk.map(t => ({ routeId: t.routeId, measure: t.measure }));
      const mkBody = ids => new URLSearchParams({
        locations: JSON.stringify(locs), targetNetworkLayerIds: JSON.stringify(ids),
        ...versionParam(), ...historicMomentParam(), f: 'json', token: _token
      }).toString();
      const [odData, pmData] = await Promise.all([
        fetch(url, { method: 'POST', headers: hdrs, body: mkBody([5]) }).then(r => r.json()).catch(() => ({ locations: [] })),
        fetch(url, { method: 'POST', headers: hdrs, body: mkBody([3]) }).then(r => r.json()).catch(() => ({ locations: [] }))
      ]);
      (odData.locations ?? []).forEach((loc, i) => {
        const xlated = loc.translatedLocations ?? [];
        const res = xlated.find(r => r.measure != null && routeNumDigits && r.routeId?.includes(routeNumDigits))
                 ?? xlated.find(r => r.measure != null) ?? xlated[0];
        if (res?.measure != null) odMap.set(chunk[i].key, String(res.measure));
      });
      (pmData.locations ?? []).forEach((loc, i) => {
        const xlated = loc.translatedLocations ?? [];
        const res = xlated.find(r => r.measure != null && routeNumDigits && r.routeId?.includes(routeNumDigits))
                 ?? xlated.find(r => r.measure != null) ?? xlated[0];
        if (res?.routeId) {
          const rid = res.routeId;
          pmMap.set(chunk[i].key, {
            county:   rid.slice(0, 3),
            pmPrefix: rid.length > 7 ? rid[7] : '',
            pmSuffix: rid.length > 8 ? rid[8] : '.',
            pmMeasure: res.measure != null ? String(res.measure) : ''
          });
        }
      });
    }));

    return inputs
      .filter(t => odMap.has(t.key))
      .map(t => {
        const pm = pmMap.get(t.key) ?? {};
        return {
          type:        'attrchange',
          name:        `atc_${t.routeId}_${t.measure}`,
          desc:        '',
          routeId:     t.routeId,
          arMeasure:   t.measure,
          odMeasure:   odMap.get(t.key),
          county:      pm.county    ?? '',
          routeSuffix: '',
          pmPrefix:    pm.pmPrefix  ?? '',
          pmSuffix:    pm.pmSuffix  ?? '.',
          pmMeasure:   pm.pmMeasure ?? '',
          district:    '',
          startDate:   null,
          endDate:     null,
          sourceLayers: t.layers,
        };
      });
  }

  // ── HL: Build result rows ─────────────────────────────────────────────────────

  async function hl_queryNetworkStartDate(pairs) {
    const routeRanges = new Map();
    for (const p of pairs) {
      if (p.routeId == null || p.arMeasure == null) continue;
      const m = p.arMeasure;
      if (!routeRanges.has(p.routeId)) routeRanges.set(p.routeId, { minAR: m, maxAR: m });
      const e = routeRanges.get(p.routeId);
      if (m < e.minAR) e.minAR = m;
      if (m > e.maxAR) e.maxAR = m;
    }
    const dateFilter = getDateFilter('Network_Start_Date', 'Network_End_Date');
    const allFeatures = (await Promise.all([...routeRanges.entries()].map(async ([rid, { minAR, maxAR }]) => {
      const body = new URLSearchParams({
        where:          `RouteID = '${rid}' AND ToARMeasure >= ${minAR} AND FromARMeasure <= ${maxAR}${dateFilter}`,
        outFields:      'RouteID,FromARMeasure,ToARMeasure,Network_Start_Date',
        returnGeometry: 'false',
        ...versionParam(),
        f:              'json',
        token:          _token
      });
      try {
        const data = await fetch(`${CONFIG.mapServiceUrl}/122/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
        }).then(r => r.json());
        if (data.error) {
          console.error(`[hl_queryNetworkStartDate] API error ${data.error.code}: ${data.error.message}`);
          return [];
        }
        return Array.isArray(data.features) ? data.features : [];
      } catch (e) {
        console.error('[hl_queryNetworkStartDate] error:', e.message);
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
      const m = p.arMeasure;
      const candidates = byRoute.get(p.routeId) ?? [];
      const matches = candidates.filter(f => {
        const from = f.attributes?.FromARMeasure;
        const to   = f.attributes?.ToARMeasure;
        return from != null && to != null && m >= from && m <= to;
      });
      const match = matches.length > 1
        ? matches.reduce((best, f) => f.attributes.FromARMeasure > best.attributes.FromARMeasure ? f : best)
        : matches[0];
      map.set(p.name, match?.attributes?.Network_Start_Date || null);
    }
    return map;
  }

  async function hl_buildResults(pairs) {
    if (pairs.length === 0) return [];

    // attrchange pairs: force AR-based lookup by clearing odMeasure so queryRangeLayer
    // falls back to arMeasure. The OD translation of a layer boundary AR can land just
    // inside the old segment, causing the range lookup to return the pre-change value.
    const lp = pairs.map(p => p.type === 'attrchange' ? { ...p, odMeasure: '' } : p);

    const [
      cityMap, naMap, ruMap, spdMap, terMap,
      hgMap, acMap,
      lbTMap, lbLnsMap, lbFMap, lbTo1Map, lbTr1Map, lbWidMap, lbTo2Map, lbTr2Map,
      medTypeMap, medCurbMap, medBarrMap, medWidMap, medVarMap,
      rbTMap, rbLnsMap, rbFMap, rbTo1Map, rbTr1Map, rbWidMap, rbTo2Map, rbTr2Map,
      netStartMap,
      acDateMap, lbDateMap, rbDateMap, lbTr1DateMap, lbTr2DateMap, rbTr1DateMap, rbTr2DateMap, medDateMap,
    ] = await Promise.all([
      queryRangeLayer(lp, 74,  'City_Code'),
      queryRangeLayer(lp, 125, 'Non_Add_Mileage'),
      queryRangeLayer(lp, 130, 'Population_Code'),
      queryRangeLayer(lp, 113, 'Design_Speed'),
      queryRangeLayer(lp, 11,  'Terrain_Type'),
      queryRangeLayer(lp, 116, 'Highway_Group'),
      queryRangeLayer(lp, 109, 'SHS_Access_Control'),
      hl_queryRangeLayerS(lp, 136, 'Surface_Type_L'),
      hl_queryRangeLayerS(lp, 139, 'Total_Num_Lanes_L'),
      hl_queryRangeLayerS(lp, 134, 'Special_Feature_Type_L'),
      hl_queryRangeLayerS(lp, 128, 'Shld_Width_Total_Out_L'),
      hl_queryRangeLayerS(lp, 128, 'Shld_Width_Treated_Out_L'),
      hl_queryRangeLayerS(lp, 139, 'Travel_Way_Width_L'),
      hl_queryRangeLayerS(lp, 120, 'Shld_Width_Total_In_L'),
      hl_queryRangeLayerS(lp, 120, 'Shld_Width_Treated_In_L'),
      queryRangeLayer(lp, 124, 'Median_Type'),
      queryRangeLayer(lp, 112, 'Curb_Landscape'),
      queryRangeLayer(lp, 110, 'Barrier_Type'),
      queryRangeLayer(lp, 124, 'Median_Width'),
      queryRangeLayer(lp, 124, 'Median_Variance'),
      queryRangeLayer(lp, 137, 'Surface_Type_R'),
      queryRangeLayer(lp, 140, 'Total_Num_Lanes_R'),
      queryRangeLayer(lp, 135, 'Special_Feature_Type_R'),
      queryRangeLayer(lp, 121, 'Shld_Width_Total_In_R'),
      queryRangeLayer(lp, 121, 'Shld_Width_Treated_In_R'),
      queryRangeLayer(lp, 140, 'Travel_Way_Width_R'),
      queryRangeLayer(lp, 129, 'Shld_Width_Total_Out_R'),
      queryRangeLayer(lp, 129, 'Shld_Width_Treated_Out_R'),
      hl_queryNetworkStartDate(lp),
      // InventoryItemStartDate for each significance-triggering layer
      queryRangeLayer(lp, 109, 'InventoryItemStartDate'),
      hl_queryRangeLayerS(lp, 139, 'InventoryItemStartDate'),
      queryRangeLayer(lp, 140, 'InventoryItemStartDate'),
      hl_queryRangeLayerS(lp, 128, 'InventoryItemStartDate'),
      hl_queryRangeLayerS(lp, 120, 'InventoryItemStartDate'),
      queryRangeLayer(lp, 121, 'InventoryItemStartDate'),
      queryRangeLayer(lp, 129, 'InventoryItemStartDate'),
      queryRangeLayer(lp, 124, 'InventoryItemStartDate'),
    ]);

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

    // Pad any bare single-digit number to two digits (e.g. "3" → "03").
    const pad1 = v => /^\d$/.test(v) ? '0' + v : v;
    const n1 = (map, name) => { const v = map.get(name); return v != null ? pad1(String(v)) : ''; };

    const results = pairs.map((p, i) => {
      const prefix = (p.pmPrefix && p.pmPrefix !== '.') ? p.pmPrefix : '';
      const suffix = (p.pmSuffix && p.pmSuffix !== '.') ? p.pmSuffix : '';
      const pmLoc  = prefix + padMeasure(p.pmMeasure) + suffix;
      return {
        location: pmLoc !== '' ? pmLoc : padMeasure(p.odMeasure),
        lengthMi: distances[i]  !== '' ? padMeasure(distances[i])  : '',
        a:        naMap.get(p.name) === 1 ? 'N' : '',
        cntyOdom: countyOdoms[i] !== '' ? padMeasure(countyOdoms[i]) : '',
        city:     (p.type === 'citybegin' || p.type === 'cityend') ? (p.cityCode ?? '') : (cityMap.get(p.name) != null ? String(cityMap.get(p.name)) : ''),
        ru:       n1(ruMap,    p.name),
        spd:      n1(spdMap,   p.name),
        ter:      n1(terMap,   p.name),
        hg:       hgMap.get(p.name)   != null ? String(hgMap.get(p.name))   : '',
        ac:       n1(acMap,    p.name),
        lb_t:     n1(lbTMap,   p.name),
        lb_lns:   n1(lbLnsMap, p.name),
        lb_f:     n1(lbFMap,   p.name),
        lb_to1:   n1(lbTo1Map, p.name),
        lb_tr1:   n1(lbTr1Map, p.name),
        lb_wid:   n1(lbWidMap, p.name),
        lb_to2:   n1(lbTo2Map, p.name),
        lb_tr2:   n1(lbTr2Map, p.name),
        med_tcb:  pad1([medTypeMap.get(p.name), medCurbMap.get(p.name), medBarrMap.get(p.name)]
                    .filter(v => v != null && v !== '').map(String).join('')),
        med_yla:  pad1([medWidMap.get(p.name), medVarMap.get(p.name)]
                    .filter(v => v != null && v !== '').map(String).join('')),
        med_wid_raw: medWidMap.get(p.name) ?? null,
        rb_t:     n1(rbTMap,   p.name),
        rb_lns:   n1(rbLnsMap, p.name),
        rb_f:     n1(rbFMap,   p.name),
        rb_to1:   n1(rbTo1Map, p.name),
        rb_tr1:   n1(rbTr1Map, p.name),
        rb_wid:   n1(rbWidMap, p.name),
        rb_to2:   n1(rbTo2Map, p.name),
        rb_tr2:   n1(rbTr2Map, p.name),
        odMeasure: p.odMeasure ?? '',
        district:  p.district ?? '',
        county:    p.county   ?? '',
        desc:      p.desc,
        type:      p.type     ?? '',
        pmSuffix:  p.pmSuffix ?? '.',
        startDate:    p.type === 'attrchange' ? (netStartMap.get(p.name) || null) : (p.startDate ?? null),
        sigChgDate:   null,
      };
    });

    const ATTR_FIELDS = [
      'a', 'ru', 'spd', 'ter', 'hg', 'ac',
      'lb_t', 'lb_lns', 'lb_f', 'lb_to1', 'lb_tr1', 'lb_wid', 'lb_to2', 'lb_tr2',
      'med_tcb', 'med_yla',
      'rb_t', 'rb_lns', 'rb_f', 'rb_to1', 'rb_tr1', 'rb_wid', 'rb_to2', 'rb_tr2',
    ];
    const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    for (let i = 1; i < results.length; i++) {
      const curr   = results[i];
      const prev   = results[i - 1];
      const pName  = pairs[i].name;
      const isAttr = curr.type === 'attrchange';
      const isLm   = curr.type === 'landmark';
      if (!isAttr && !isLm) continue;
      if (isAttr) {
        const changed = new Set();
        for (const f of ATTR_FIELDS) {
          if (curr[f] !== prev[f]) changed.add(f);
        }
        curr.changedFields = changed;
      }
      const diffAbove = (f, thr) => { const d = parseFloat(curr[f]) - parseFloat(prev[f]); return !isNaN(d) && Math.abs(d) > thr; };
      const _mw = curr.med_wid_raw, _pmw = prev.med_wid_raw;
      let isSig = false;
      const sigDates  = [];
      const sigFields = new Set();
      const addDate = (map, f) => { sigFields.add(f); const d = map.get(pName); if (d != null && d !== '') sigDates.push(Number(d)); };
      if (curr.ac !== prev.ac)          { isSig = true; addDate(acDateMap,    'ac'    ); }
      if (curr.lb_lns !== prev.lb_lns)  { isSig = true; addDate(lbDateMap,   'lb_lns'); }
      if (curr.rb_lns !== prev.rb_lns)  { isSig = true; addDate(rbDateMap,   'rb_lns'); }
      if (diffAbove('lb_tr1', 4))       { isSig = true; addDate(lbTr1DateMap,'lb_tr1'); }
      if (diffAbove('lb_tr2', 4))       { isSig = true; addDate(lbTr2DateMap,'lb_tr2'); }
      if (diffAbove('rb_tr1', 4))       { isSig = true; addDate(rbTr1DateMap,'rb_tr1'); }
      if (diffAbove('rb_tr2', 4))       { isSig = true; addDate(rbTr2DateMap,'rb_tr2'); }
      if (diffAbove('lb_wid', 5))       { isSig = true; addDate(lbDateMap,   'lb_wid'); }
      if (diffAbove('rb_wid', 5))       { isSig = true; addDate(rbDateMap,   'rb_wid'); }
      if (_mw !== _pmw && (_mw === 0 || _pmw === 0)) { isSig = true; addDate(medDateMap, 'med_yla'); }
      if (isSig) {
        curr.sigChgDate = sigDates.length > 0 ? Math.max(...sigDates) : todayUtc;
        curr.sigFields  = sigFields;
      }
    }

    return results.filter(r => r.type !== 'attrchange' || r.changedFields.size > 0);
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

  function hl_getPageBoundaries() {
    const pages = [];
    let s = 0;
    while (s < _hl_allResults.length) {
      let rows = 0, e = s;
      while (e < _hl_allResults.length) {
        const rc = _hl_allResults[e].desc ? 2 : 1;
        if (rows + rc > HL_ROWS_PER_PAGE && rows > 0) break;
        rows += rc;
        e++;
      }
      pages.push({ start: s, end: e });
      s = e;
    }
    return pages;
  }

  function hl_renderPage() {
    const box = document.getElementById('rampResults');
    box.style.display = 'block';
    box.className = 'ramp-results';

    const paginated  = isPaginated();
    const pages      = hl_getPageBoundaries();
    const totalPages = pages.length;
    const page       = paginated ? _hl_currentPage : 0;
    const { start, end } = paginated ? (pages[page] ?? { start: 0, end: _hl_allResults.length }) : { start: 0, end: _hl_allResults.length };
    const slice = _hl_allResults.slice(start, end);

    const prevDis = page === 0              ? 'disabled' : '';
    const nextDis = page === totalPages - 1 ? 'disabled' : '';

    const actionBar    = renderActionBar('California Department of Transportation', 'California State Highway Log', '', 'hl_exportToExcel()', 'hl_printAll()');
    const refVal       = document.getElementById('refDate')?.value || '';
    const refDateHtml  = refVal ? `<span class="hl-ref-date">REF DATE: ${esc(refVal)}</span>` : '';
    const pageInfoHtml = paginated && totalPages > 1 ? `<span class="page-info">Page ${page + 1} of ${totalPages}</span>` : '';
    const metaBar      = (refDateHtml || pageInfoHtml) ? `<div class="hl-meta-bar">${refDateHtml}${pageInfoHtml}</div>` : '';
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
      : `<tr><td colspan="30" class="hl-empty">No results found in this segment.</td></tr>`;

    const table = `<div class="hl-table-wrap">
      <table class="hl-table">
        ${hl_buildThead()}
        <tbody>${tbodyRows}</tbody>
      </table>
    </div>`;

    const shownPagination = paginated ? pagination : '';
    const generatedFooter = `<div class="generated-on">Generated on ${esc(_hl_generatedOn)}</div>`;
    box.innerHTML = `${actionBar}${metaBar}<div class="hl-title-gap"></div>${table}${shownPagination}${generatedFooter}`;
    box.scrollIntoView({ behavior: 'instant', block: 'start' });
  }

  function hl_buildTbodyRows(slice, startIdx) {
    const n = _hl_allResults.length;

    // Fill-forward effective city and county across all results so rows with
    // empty values (intersections, district markers, etc.) inherit their group.
    const effCity   = new Array(n);
    const effCounty = new Array(n);
    let lCity = '', lCounty = '';
    for (let j = 0; j < n; j++) {
      const r = _hl_allResults[j];
      if (r.city) lCity = r.city;
      effCity[j] = lCity;
      if (r.county) lCounty = r.county;
      effCounty[j] = lCounty;
    }

    // Pre-compute mileage (last odMeasure − first odMeasure) for each contiguous group.
    const cityInfo   = new Array(n).fill(null); // { label, dist }
    const countyInfo = new Array(n).fill(null);

    const computeGroups = (eff, info) => {
      let s = 0;
      while (s < n) {
        let e = s;
        while (e + 1 < n && eff[e + 1] === eff[s]) e++;
        let firstOd = null, lastOd = null;
        for (let j = s; j <= e; j++) {
          const od = _hl_allResults[j].odMeasure;
          if (od != null && od !== '') {
            const v = parseFloat(od);
            if (firstOd === null) firstOd = v;
            lastOd = v;
          }
        }
        const dist = firstOd !== null && lastOd !== null
          ? padMeasure((lastOd - firstOd).toFixed(3)) : null;
        for (let j = s; j <= e; j++) info[j] = { label: eff[s], dist };
        s = e + 1;
      }
    };
    computeGroups(effCity,   cityInfo);
    computeGroups(effCounty, countyInfo);

    let prevDistrict = null;
    let prevCounty   = null;

    return slice.map((p, i) => {
      const gi = startIdx + i;
      let html = '';
      if (p.district !== prevDistrict || p.county !== prevCounty) {
        html += hl_renderDcrRow(p.district, p.county, _hl_routeLabel, i === 0);
        prevDistrict = p.district;
        prevCounty   = p.county;
      }
      html += hl_renderRow(p, gi);

      const isLastCity   = gi === n - 1 || effCity[gi + 1]   !== effCity[gi];
      const isLastCounty = gi === n - 1 || effCounty[gi + 1] !== effCounty[gi];
      if (isLastCity   && cityInfo[gi]?.dist   != null && cityInfo[gi].label !== ''
          && _hl_allResults[gi].pmSuffix !== 'R' && _hl_allResults[gi].pmSuffix !== 'L')
        html += hl_renderTotalRow('city',   cityInfo[gi].label,   cityInfo[gi].dist);
      if (isLastCounty && countyInfo[gi]?.dist != null)
        html += hl_renderTotalRow('county', countyInfo[gi].label, countyInfo[gi].dist);

      if (gi === n - 1) {
        let firstOd = null, lastOd = null;
        for (let j = 0; j < n; j++) {
          const od = _hl_allResults[j].odMeasure;
          if (od != null && od !== '') {
            const v = parseFloat(od);
            if (firstOd === null) firstOd = v;
            lastOd = v;
          }
        }
        if (firstOd !== null && lastOd !== null)
          html += hl_renderTotalRow('cumulative', 'CUMULATIVE', padMeasure((lastOd - firstOd).toFixed(3)));
      }

      return html;
    }).join('');
  }

  function hl_renderTotalRow(type, label, dist) {
    const tag       = type === 'cumulative' ? '' : (type === 'city' ? 'CITY TOTALS' : 'COUNTY TOTALS');
    const labelText = tag ? `*** *** ${esc(label)} ${tag}` : `*** *** ${esc(label)}`;
    return `<tr class="hl-total-row hl-total-${type}">
      <td colspan="30"><span class="hl-total-label">${labelText}</span><span class="hl-total-mileage">(MILEAGE)&nbsp;&nbsp;&nbsp;&nbsp;TOTAL&nbsp;&nbsp;&nbsp;&nbsp;${esc(dist)}</span><br>&nbsp;</td>
    </tr>`;
  }

  const _hlPageCtrl = makePageController(
    ()  => _hl_currentPage,
    v   => { _hl_currentPage = v; },
    ()  => hl_getPageBoundaries().length,
    hl_renderPage
  );
  function hl_changePage(delta)  { _hlPageCtrl.changePage(delta); }
  function hl_changePageFirst()  { _hlPageCtrl.changePageFirst(); }
  function hl_changePageLast()   { _hlPageCtrl.changePageLast(); }

  function hl_exportToExcel() {
    if (_hl_allResults.length === 0) return;
    const headers = ['Location', 'MI', 'N/A', 'Cnty Odom', 'City', 'R/U', 'SPD', 'TER', 'H/G', 'A/C',
      'LB T', 'LB Lns', 'LB F', 'LB OT', 'LB TR', 'LB T-W', 'LB IN', 'LB SH',
      'Med TCB', 'Med Wid',
      'RB T', 'RB Lns', 'RB F', 'RB IN', 'RB SH', 'RB T-W', 'RB OT', 'RB SH',
      'Description', 'Date of Rec', 'Sig Chg. Date'];
    const rows = _hl_allResults.map(p => [
      p.location ?? '', p.lengthMi ?? '', p.a ?? '', p.cntyOdom ?? '', p.city ?? '',
      p.ru ?? '', p.spd ?? '', p.ter ?? '', p.hg ?? '', p.ac ?? '',
      p.lb_t ?? '', p.lb_lns ?? '', p.lb_f ?? '', p.lb_to1 ?? '', p.lb_tr1 ?? '',
      p.lb_wid ?? '', p.lb_to2 ?? '', p.lb_tr2 ?? '',
      p.med_tcb ?? '', p.med_yla ?? '',
      p.rb_t ?? '', p.rb_lns ?? '', p.rb_f ?? '', p.rb_to1 ?? '', p.rb_tr1 ?? '',
      p.rb_wid ?? '', p.rb_to2 ?? '', p.rb_tr2 ?? '',
      p.desc ?? '', p.startDate != null ? hl_formatDateYYMMDD(p.startDate) : '', p.sigChgDate != null ? hl_formatDateYYMMDD(p.sigChgDate) : ''
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Highway Log');
    XLSX.writeFile(wb, `highway_log_${esc(_hl_routeLabel)}.xlsx`);
  }

  function hl_buildCoverPage() {
    const refVal = document.getElementById('refDate')?.value || '';
    const year   = refVal ? refVal.slice(0, 4) : String(new Date().getFullYear());
    const route  = _hl_routeLabel ? `Route ${esc(_hl_routeLabel)}` : '';
    return `<div class="hl-cover-page">
      <div class="hl-cover-agency">CALIFORNIA DEPARTMENT OF TRANSPORTATION</div>
      <div class="hl-cover-log-title">California State Highway Log</div>
      <div class="hl-cover-year">${esc(year)}</div>
      <div class="hl-cover-route">${route}</div>
      <div class="hl-cover-legend">
        <div class="hl-cover-legend-head">LEGEND</div>
        <div>NA = Non-Add Mileage</div>
        <div>RU = Rural, Urban, Urbanized</div>
        <div>SPD = Design Speed</div>
        <div>TER = Terrain</div>
        <div>HG = Highway Group</div>
        <div>AC = Access Control</div>
        <div>ST = Surface Type</div>
        <div># Lns = Number of Lanes</div>
        <div>SF = Special Features</div>
        <div>OT-SH = Outside Shoulder</div>
        <div>TO = Total (width shoulder)</div>
        <div>TR = Treated (width shoulder)</div>
        <div>T-W Wid = Traveled Way Width</div>
        <div>IN-SH = Inside Shoulder</div>
        <div>TY = Median Type</div>
        <div>CL = Curb &amp; Landscape</div>
        <div>BA = Median Barrier</div>
        <div>Wid = Median Width</div>
        <div>Var = Median Variance</div>
        <div>Date of Rec = Date of Record</div>
        <div>Sig Chg. Date = Significant Change Date</div>
      </div>
    </div>`;
  }

  function hl_printAll() {
    const box    = document.getElementById('rampResults');
    const saved  = box.innerHTML;
    const refVal = document.getElementById('refDate')?.value || '';
    const refDisplay   = refVal ? `Ref Date: ${esc(refVal)}` : '';
    const routeDisplay = _hl_routeLabel ? `Route ${esc(_hl_routeLabel)}` : '';
    const headerMeta   = [refDisplay, routeDisplay].filter(Boolean).join('&emsp;');

    const pages = hl_getPageBoundaries();
    let html = hl_buildCoverPage();

    pages.forEach((pg, i) => {
      const pageNum = i + 2;
      const slice   = _hl_allResults.slice(pg.start, pg.end);
      const tbody   = hl_buildTbodyRows(slice, pg.start);
      const pageHeader = `<div class="hl-print-page-header">
        <span>${headerMeta}</span>
        <span>Page ${pageNum}</span>
      </div>`;
      const table = `<div class="hl-table-wrap"><table class="hl-table">${hl_buildThead()}<tbody>${tbody}</tbody></table></div>`;
      html += `<div class="hl-print-section${i > 0 ? ' hl-page-break' : ''}">${pageHeader}${table}</div>`;
    });

    html += `<div class="generated-on">Generated on ${esc(_hl_generatedOn)}</div>`;
    box.innerHTML = html;
    window.print();
    box.innerHTML = saved;
  }

  function hl_renderDcrRow(district, county, route, isFirst) {
    const spacer = `<tr class="hl-dcr-spacer"><td colspan="30"></td></tr>`;
    return `${isFirst ? '' : spacer}<tr class="hl-dcr-row${isFirst ? ' hl-dcr-first' : ''}">
      <td colspan="30">${esc(district || '\u2014')} ${esc(county || '\u2014')} ${esc(route || '\u2014')}</td>
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
        <th rowspan="3"  class="hl-th-stacked">DATE OF<br>REC</th>
        <th rowspan="3"  class="hl-th-stacked">SIG CHG<br>DATE</th>
      </tr>
      <!-- Row 2: top label of each stacked column header -->
      <tr>
        <!-- Location and Distance -->
        <th rowspan="2">Location</th>
        <th rowspan="2">LENGTH<br>MI</th>
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
      </tr>
    </thead>`;
  }

  function hl_renderRow(p, idx = 0) {
    const shade = idx % 2 === 0 ? ' hl-shaded' : '';
    const descRow = p.desc
      ? `<tr class="hl-desc-row${shade}"><td colspan="2"></td><td colspan="28"><em>${esc(p.desc)}</em></td></tr>`
      : '';
    const lbFill = p.pmSuffix === 'R' ? '+' : null;
    const rbFill = p.pmSuffix === 'L' ? '+' : null;
    const ch   = p.changedFields;
    const sig  = p.sigFields;
    const bold = (val, f) => {
      if (sig?.has(f)) return `<strong style="color:#c00">${val}</strong>`;
      if (ch?.has(f))  return `<strong>${val}</strong>`;
      return val;
    };
    const lb   = f => lbFill != null ? lbFill : bold(esc(p[f] ?? ''), f);
    const rb   = f => rbFill != null ? rbFill : bold(esc(p[f] ?? ''), f);
    return `<tr class="hl-data-row${shade}">
      <td>${esc(p.location  ?? '')}</td>
      <td>${esc(p.lengthMi  ?? '')}</td>
      <td>${bold(esc(p.a   ?? ''), 'a'  )}</td>
      <td>${esc(p.cntyOdom  ?? '')}</td>
      <td>${esc(p.city      ?? '')}</td>
      <td>${bold(esc(p.ru  ?? ''), 'ru' )}</td>
      <td>${bold(esc(p.spd ?? ''), 'spd')}</td>
      <td>${bold(esc(p.ter ?? ''), 'ter')}</td>
      <td>${bold(esc(p.hg  ?? ''), 'hg' )}</td>
      <td>${bold(esc(p.ac  ?? ''), 'ac' )}</td>
      <td>${lb('lb_t'  )}</td>
      <td>${lb('lb_lns')}</td>
      <td>${lb('lb_f'  )}</td>
      <td>${lb('lb_to1')}</td>
      <td>${lb('lb_tr1')}</td>
      <td>${lb('lb_wid')}</td>
      <td>${lb('lb_to2')}</td>
      <td>${lb('lb_tr2')}</td>
      <td>${bold(esc(p.med_tcb ?? ''), 'med_tcb')}</td>
      <td>${bold(esc(p.med_yla ?? ''), 'med_yla')}</td>
      <td>${rb('rb_t'  )}</td>
      <td>${rb('rb_lns')}</td>
      <td>${rb('rb_f'  )}</td>
      <td>${rb('rb_to1')}</td>
      <td>${rb('rb_tr1')}</td>
      <td>${rb('rb_wid')}</td>
      <td>${rb('rb_to2')}</td>
      <td>${rb('rb_tr2')}</td>
      <td>${p.startDate   != null ? esc(hl_formatDateYYMMDD(p.startDate))   : ''}</td>
      <td>${p.sigChgDate != null ? esc(hl_formatDateYYMMDD(p.sigChgDate)) : ''}</td>
    </tr>${descRow}`;
  }
