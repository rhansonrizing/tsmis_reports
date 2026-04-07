  // ── HSL: Shared helpers ───────────────────────────────────────────────────

  // Builds P/S segments for a route, filtering by which routeIds exist in _allRouteIds.
  // Returns { segments, routeSuffix } or { segments: [], routeSuffix } if none found.
  function buildHslSegments(routeNum) {
    const isSupplemental = /[A-Z]$/.test(routeNum);
    const routeSuffix    = isSupplemental ? routeNum.slice(-1) : '.';
    const primaryId      = isSupplemental ? `SHS_${routeNum}_P`  : `SHS_${routeNum}._P`;
    const secondaryId    = isSupplemental ? `SHS_${routeNum}_S`  : `SHS_${routeNum}._S`;
    const segments = [];
    if (_allRouteIds.has(primaryId))   segments.push({ fromBest: { routeId: primaryId,   measure: -0.001 }, toBest: { routeId: primaryId,   measure: 999.999 } });
    if (_allRouteIds.has(secondaryId)) segments.push({ fromBest: { routeId: secondaryId, measure: -0.001 }, toBest: { routeId: secondaryId, measure: 999.999 } });
    return { segments, routeSuffix };
  }

  // Removes BEGIN/END REALIGNMENT landmarks whose PM key (prefix+measure+suffix)
  // matches any other record already in the report.
  function hsl_filterRealignmentLandmarks(pairs) {
    const isRealignment = p => p.type === 'landmark' &&
      (p.desc === 'END REALIGNMENT' || p.desc === 'BEGIN REALIGNMENT');
    const pmKey = p => `${p.pmPrefix}|${parseFloat(p.pmMeasure).toFixed(3)}|${p.pmSuffix}`;
    const naturalPmKeys = new Set(
      pairs
        .filter(p => !isRealignment(p) && p.pmMeasure !== '' && p.pmMeasure != null && !isNaN(parseFloat(p.pmMeasure)))
        .map(pmKey)
    );
    return pairs.filter(p => {
      if (!isRealignment(p)) return true;
      if (p.alignment !== 'R') return false;
      if (p.pmMeasure === '' || p.pmMeasure == null || isNaN(parseFloat(p.pmMeasure))) return true;
      return !naturalPmKeys.has(pmKey(p));
    });
  }

  // Removes city begin/end records whose PM key (prefix+measure+suffix)
  // matches any other record already in the report — avoids duplicate rows at boundaries.
  function hsl_filterCityBoundaries(pairs) {
    const pmKey = p => `${p.pmPrefix}|${parseFloat(p.pmMeasure).toFixed(3)}|${p.pmSuffix}`;
    const naturalPmKeys = new Set(
      pairs
        .filter(p => p.type !== 'citybegin' && p.type !== 'cityend' && p.pmMeasure !== '' && p.pmMeasure != null && !isNaN(parseFloat(p.pmMeasure)))
        .map(pmKey)
    );
    return pairs.filter(p => {
      if (p.type !== 'citybegin' && p.type !== 'cityend') return true;
      if (p.odMeasure !== '' && p.odMeasure != null && parseFloat(p.odMeasure) < 0) {
        if (p.desc && p.desc.includes('BRE')) console.log('[BRE cityend] REMOVED by OD<0, od=' + p.odMeasure);
        return false;
      }
      // Drop city begin/end records with a negative or negative-zero PM — the city
      // boundary falls before this route segment starts, not a genuine crossing.
      const pmVal = parseFloat(p.pmMeasure);
      if (!isNaN(pmVal) && (pmVal < 0 || Object.is(pmVal, -0))) return false;
      if (p.type === 'cityend') return true;
      if (p.pmMeasure === '' || p.pmMeasure == null || isNaN(pmVal)) return true;
      return !naturalPmKeys.has(pmKey(p));
    });
  }

  function renderUnresolvedSection(list) {
    if (!list.length) return '';
    return `<div class="unresolved-section">
         <div class="unresolved-heading">Unresolved Intersections (translate failed)</div>
         <ul class="unresolved-list">${list.map(u =>
           `<li><strong>${esc(u.id)}</strong> &mdash; ${esc(u.desc)} &mdash; PMRouteID: ${esc(u.pmRouteId)}, PMMeasure: ${esc(String(u.pmMeasure))}</li>`
         ).join('')}</ul>
       </div>`;
  }

  // ── HSL: Highway Sequence Listing — Query functions ──────────────────────


  // ── HSL: Query landmarks (layer 123) ─────────────────────────────────────

  /** Queries landmark point events from layer 123 for the given measure segments. */
  async function queryLandmarks(segments, routeSuffix, district = null, county = null) {
    const segClauses = segments.map(({ fromBest, toBest }) => {
      const fromM    = Math.min(fromBest.measure, toBest.measure) - 0.005;
      const toM      = Math.max(fromBest.measure, toBest.measure) + 0.005;
      const routeNum = fromBest.routeId.match(/\d{3}/)?.[0] ?? null;
      return routeNum
        ? `(RouteNum = '${routeNum}' AND ARMeasure >= ${fromM} AND ARMeasure <= ${toM})`
        : `(RouteID = '${fromBest.routeId}' AND ARMeasure >= ${fromM} AND ARMeasure <= ${toM})`;
    });
    const uniqueClauses = [...new Set(segClauses)];
    const safeSuffix   = ['.', 'S', 'U', 'R', 'L'].includes(routeSuffix) ? routeSuffix : '.';
    const isSuffix     = safeSuffix !== '.';
    const suffixFilter = isSuffix
      ? ` AND RouteSuffix = '${safeSuffix}'`
      : ` AND (RouteSuffix IS NULL OR RouteSuffix <> 'S')`;
    const dateFilter     = getDateFilter();
    const districtFilter = district != null ? ` AND District = ${parseInt(district, 10)}` : '';
    const resolvedCounty = normalizeCountyCode(county);
    const countyFilter    = resolvedCounty != null ? ` AND County = '${resolvedCounty.replace(/'/g, "''")}'` : '';
    const where = uniqueClauses.length === 1
      ? uniqueClauses[0].slice(1, -1) + suffixFilter + districtFilter + countyFilter + ' AND LRSToDate IS NULL' + dateFilter
      : `(${uniqueClauses.join(' OR ')})${suffixFilter}${districtFilter}${countyFilter} AND LRSToDate IS NULL${dateFilter}`;
    const body = new URLSearchParams({
      where,
      outFields:      'Landmarks_Short,Landmarks_Long,RouteID,ARMeasure,County,RouteSuffix,PMPrefix,PMSuffix,PMMeasure,ODMeasure,District,Alignment,InventoryItemStartDate,InventoryItemEndDate',
      orderByFields:  'ARMeasure ASC',
      returnGeometry: 'false',
      ...versionParam(),
      f:              'json',
      token:          _token
    });
    let resp, data;
    try {
      resp = await fetch(`${CONFIG.mapServiceUrl}/123/query`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString()
      });
      data = await resp.json();
    } catch (e) {
      console.error('[queryLandmarks] error:', e.message);
      return [];
    }
    if (data.error) {
      const code = data.error.code;
      if (code === 498 || code === 499) { _token = null; login(); return []; }
      console.error(`[queryLandmarks] API error ${code}: ${data.error.message}`);
      return [];
    }
    const features = data.features;
    if (!Array.isArray(features)) return [];
    if (data.exceededTransferLimit) console.warn('[queryLandmarks] exceededTransferLimit — results truncated.');
    const nameMap = new Map();
    for (const f of features) {
      const a = f.attributes ?? {};
      const name = a.Landmarks_Short;
      if (name == null || name === '') continue;
      const desc = name;
      // Use a composite key as pair.name so that downstream pipeline lookups
      // (queryRangeLayer, translateToOD, hsl_queryRampDescriptions) each get a
      // unique slot per landmark even when Landmarks_Short repeats at different
      // physical positions. Display text is driven by pair.desc, not pair.name.
      const key = `${name}|${a.ODMeasure ?? ''}`;
      const pair = {
        type:        'landmark',
        name:        key,
        desc,
        routeId:     a.RouteID,
        arMeasure:   a.ARMeasure,
        county:      a.County      ?? '',
        routeSuffix: a.RouteSuffix ?? '',
        pmPrefix:    a.PMPrefix    ?? '',
        pmSuffix:    a.PMSuffix    ?? '.',
        pmMeasure:   a.PMMeasure   ?? '',
        odMeasure:   a.ODMeasure != null ? String(a.ODMeasure) : '',
        district:    a.District != null ? String(a.District).padStart(2, '0') : '',
        alignment:   a.Alignment ?? '',
        startDate:   a.InventoryItemStartDate ?? null,
        endDate:     a.InventoryItemEndDate   ?? null
      };
      const existing = nameMap.get(key);
      if (!existing || (pair.county !== '' && existing.county === '')) {
        nameMap.set(key, pair);
      }
    }
    const pairs = Array.from(nameMap.values());

    // Translate AR → OD for all landmarks so sort position reflects the
    // reference-date network state rather than the stale stored ODMeasure.
    const routeNumDigits = segments[0]?.fromBest.routeId.match(/\d{3}/)?.[0] ?? null;
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

  // ── HSL: Query route breaks (layer 133) ───────────────────────────────────

  /** Queries route break point events from layer 133 for the given measure segments. */
  async function queryRouteBreaks(segments, routeSuffix, district = null, county = null) {
    const segClauses = segments.map(({ fromBest, toBest }) => {
      const fromM    = Math.min(fromBest.measure, toBest.measure) - 0.005;
      const toM      = Math.max(fromBest.measure, toBest.measure) + 0.005;
      const routeNum = fromBest.routeId.match(/\d{3}/)?.[0] ?? null;
      return routeNum
        ? `(RouteNum = '${routeNum}' AND ARMeasure >= ${fromM} AND ARMeasure <= ${toM})`
        : `(RouteID = '${fromBest.routeId}' AND ARMeasure >= ${fromM} AND ARMeasure <= ${toM})`;
    });
    const uniqueClauses = [...new Set(segClauses)];
    const safeSuffix   = ['.', 'S', 'U', 'R', 'L'].includes(routeSuffix) ? routeSuffix : '.';
    const isSuffix     = safeSuffix !== '.';
    const suffixFilter = isSuffix
      ? ` AND RouteSuffix = '${safeSuffix}'`
      : ` AND (RouteSuffix IS NULL OR RouteSuffix <> 'S')`;
    const dateFilter     = getDateFilter();
    const districtFilter = district != null ? ` AND District = ${parseInt(district, 10)}` : '';
    const resolvedCounty = normalizeCountyCode(county);
    const countyFilter    = resolvedCounty != null ? ` AND County = '${resolvedCounty.replace(/'/g, "''")}'` : '';
    const where = uniqueClauses.length === 1
      ? uniqueClauses[0].slice(1, -1) + suffixFilter + districtFilter + countyFilter + ' AND LRSToDate IS NULL' + dateFilter
      : `(${uniqueClauses.join(' OR ')})${suffixFilter}${districtFilter}${countyFilter} AND LRSToDate IS NULL${dateFilter}`;
    const body = new URLSearchParams({
      where,
      outFields:      'Route_Break_Type,RouteID,ARMeasure,County,RouteSuffix,PMPrefix,PMSuffix,PMMeasure,ODMeasure,District,InventoryItemStartDate,InventoryItemEndDate',
      orderByFields:  'ARMeasure ASC',
      returnGeometry: 'false',
      ...versionParam(),
      f:              'json',
      token:          _token
    });
    let resp, data;
    try {
      resp = await fetch(`${CONFIG.mapServiceUrl}/133/query`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString()
      });
      data = await resp.json();
    } catch (e) {
      console.error('[queryRouteBreaks] error:', e.message);
      return [];
    }
    if (data.error) {
      const code = data.error.code;
      if (code === 498 || code === 499) { _token = null; login(); return []; }
      console.error(`[queryRouteBreaks] API error ${code}: ${data.error.message}`);
      return [];
    }
    const features = data.features;
    if (!Array.isArray(features)) return [];
    if (data.exceededTransferLimit) console.warn('[queryRouteBreaks] exceededTransferLimit — results truncated.');
    const pairs = features.map(f => {
      const a = f.attributes ?? {};
      return {
        type:        'routebreak',
        name:        `rb_${a.RouteID}_${a.ARMeasure}`,
        desc:        a.Route_Break_Type ?? '',
        routeId:     a.RouteID,
        arMeasure:   a.ARMeasure,
        county:      a.County      ?? '',
        routeSuffix: a.RouteSuffix ?? '',
        pmPrefix:    a.PMPrefix    ?? '',
        pmSuffix:    a.PMSuffix    ?? '.',
        pmMeasure:   a.PMMeasure   ?? '',
        odMeasure:   a.ODMeasure != null ? String(a.ODMeasure) : '',
        district:    a.District != null ? String(a.District).padStart(2, '0') : '',
        startDate:   a.InventoryItemStartDate ?? null,
        endDate:     a.InventoryItemEndDate   ?? null
      };
    });

    // For any route break missing an OD measure, translate AR → OD to fill it in.
    const missing = pairs.filter(p => p.odMeasure === '' && p.routeId && p.arMeasure != null);
    if (missing.length > 0) {
      const CHUNK = 200;
      const chunks = [];
      for (let i = 0; i < missing.length; i += CHUNK) chunks.push(missing.slice(i, i + CHUNK));
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
          const xlated     = loc.translatedLocations ?? [];
          const rbRouteNum = chunk[idx].routeId?.match(/\d{3}/)?.[0];
          const result = xlated.find(r => r.measure != null && rbRouteNum && r.routeId?.includes(rbRouteNum))
                      ?? xlated.find(r => r.measure != null)
                      ?? xlated[0];
          if (result?.measure != null) chunk[idx].odMeasure = String(result.measure);
        });
      }));
    }

    return pairs;
  }

  // ── HSL: Query equation points (layer 305) ────────────────────────────────

  /** Queries PM equation points from layer 305. Note: layer 305 uses 2-char county codes (e.g. 'LA'), not 3-char. */
  async function queryEquationPoints(segments, district = null, county = null) {
    const segClauses = segments.map(({ fromBest, toBest }) => {
      const fromM = Math.min(fromBest.measure, toBest.measure) - 0.005;
      const toM   = Math.max(fromBest.measure, toBest.measure) + 0.005;
      return `(routeId = '${fromBest.routeId}' AND fromMeasure >= ${fromM} AND fromMeasure <= ${toM})`;
    });
    const uniqueClauses   = [...new Set(segClauses)];
    const districtFilter  = district != null ? ` AND District_Code = ${district}` : '';
    const resolvedCountyE = county ? (_countyNameToCode.get(county) ?? county) : null;
    const countyFilter    = resolvedCountyE != null ? ` AND County = '${resolvedCountyE.replace(/'/g, "''")}'` : '';
    const where = uniqueClauses.length === 1
      ? uniqueClauses[0].slice(1, -1) + ' AND hslDescription IS NOT NULL AND LRSToDate IS NULL' + districtFilter + countyFilter
      : `(${uniqueClauses.join(' OR ')}) AND hslDescription IS NOT NULL AND LRSToDate IS NULL${districtFilter}${countyFilter}`;
    const body = new URLSearchParams({
      where,
      outFields:      'OBJECTID,routeId,fromMeasure,District_Code,hslDescription,PMMeasure,PMPrefix,PMSuffix,ODMeasure,County',
      orderByFields:  'fromMeasure ASC',
      returnGeometry: 'false',
      ...versionParam(),
      f:              'json',
      token:          _token
    });
    let resp, data;
    try {
      resp = await fetch(`${CONFIG.mapServiceUrl}/305/query`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
      });
      data = await resp.json();
    } catch (e) {
      console.error('[queryEquationPoints] error:', e.message);
      return [];
    }
    if (data.error) {
      const code = data.error.code;
      if (code === 498 || code === 499) { _token = null; login(); return []; }
      console.error(`[queryEquationPoints] API error ${code}: ${data.error.message}`);
      return [];
    }
    const features = data.features;
    if (!Array.isArray(features)) return [];
    const groups = new Map();
    for (const f of features) {
      const a = f.attributes ?? {};
      const routeNum = (a.routeId ?? '').match(/\d{3}/)?.[0] ?? a.routeId ?? '';
      const key = `${routeNum}_${Math.round((a.fromMeasure ?? 0) * 1000)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    const pairs = [];
    for (const [key, group] of groups.entries()) {
      group.sort((a, b) => (a.fromMeasure ?? 0) - (b.fromMeasure ?? 0));
      const first  = group[0];
      const second = group[1] ?? null;
      pairs.push({
        type:        'equation',
        eqPairId:    key,
        name:        `eq1_${first.routeId}_${first.fromMeasure}`,
        desc:        first.hslDescription ?? '',
        routeId:     first.routeId,
        arMeasure:   first.fromMeasure,
        county:      first.County      ?? '',
        pmPrefix:    first.PMPrefix    ?? '',
        pmSuffix:    first.PMSuffix    ?? '.',
        pmMeasure:   first.PMMeasure   ?? '',
        odMeasure:   first.ODMeasure   != null ? String(first.ODMeasure) : '',
        district:    first.District_Code != null ? String(first.District_Code).padStart(2, '0') : '',
        isSecondEq:  false
      });
      if (second) {
        pairs.push({
          type:        'equation',
          eqPairId:    key,
          name:        `eq2_${second.routeId}_${second.fromMeasure}`,
          desc:        '',
          routeId:     second.routeId,
          arMeasure:   second.fromMeasure,
          county:      second.County      ?? '',
          pmPrefix:    second.PMPrefix    ?? '',
          pmSuffix:    'E',
          pmMeasure:   second.PMMeasure   ?? '',
          odMeasure:   second.ODMeasure   != null ? String(second.ODMeasure) : '',
          district:    second.District_Code != null ? String(second.District_Code).padStart(2, '0') : '',
          isSecondEq:  true
        });
      }
    }
    return pairs;
  }

  // ── HSL: Query city begin records (layer 74) ─────────────────────────────

  /** Returns a synthetic "BEGIN <cityCode>" record at the start of each city
   *  range on the route. OD is obtained by translating FromARMeasure AR → OD. */
  async function queryCityBegins(segments, routeNumDigits, district = null, county = null) {
    // Include both _P and _S RouteIDs — city records on L independent alignments
    // are stored against the _S route and would be missed if only _P is queried.
    const segClauses = segments.flatMap(({ fromBest, toBest }) => {
      const rid   = fromBest.routeId.endsWith('_S') ? fromBest.routeId.slice(0, -2) + '_P' : fromBest.routeId;
      const ridS  = rid.slice(0, -1) + 'S';
      const fromM = Math.min(fromBest.measure, toBest.measure) - 0.005;
      const toM   = Math.max(fromBest.measure, toBest.measure) + 0.005;
      return [
        `(RouteID = '${rid}' AND FromARMeasure <= ${toM} AND ToARMeasure >= ${fromM})`,
        `(RouteID = '${ridS}' AND FromARMeasure <= ${toM} AND ToARMeasure >= ${fromM})`
      ];
    });
    const uniqueSegClauses = [...new Set(segClauses)];
    // Layer 74 is filtered by RouteID + measure range only. Although it has BeginCounty/
    // EndCounty fields, a city range can span a county boundary so we cannot filter by county
    // in the WHERE clause — the county filter is applied post-translation below.
    const dateFilter = getDateFilter();
    const where = uniqueSegClauses.length === 1
      ? uniqueSegClauses[0].slice(1, -1) + dateFilter
      : `(${uniqueSegClauses.join(' OR ')})${dateFilter}`;
    const body = new URLSearchParams({
      where,
      outFields:      'RouteID,FromARMeasure,ToARMeasure,City_Code,BeginPMPrefix,BeginPMSuffix,BeginPMMeasure,BeginODMeasure,BeginCounty,EndPMPrefix,EndPMSuffix,EndPMMeasure,EndODMeasure,EndCounty,District',
      returnGeometry: 'false',
      ...versionParam(),
      f:              'json',
      token:          _token
    });
    let data;
    try {
      const resp = await fetch(`${CONFIG.mapServiceUrl}/74/query`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
      });
      data = await resp.json();
    } catch (e) {
      console.error('[queryCityBegins] error:', e.message);
      return [];
    }
    if (data.error) {
      const code = data.error.code;
      if (code === 498 || code === 499) { _token = null; login(); return []; }
      console.error(`[queryCityBegins] API error ${code}: ${data.error.message}`);
      return [];
    }
    // Deduplicate features by RouteID + FromARMeasure (overlapping segment clauses can repeat)
    const seen = new Set();
    const features = (data.features ?? []).filter(f => {
      const a   = f.attributes ?? {};
      const key = `${a.RouteID}|${a.FromARMeasure}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (features.length === 0) return [];

    const fmtDistrict = a => a.District != null ? String(a.District).padStart(2, '0') : '';
    const pairs = features.flatMap(f => {
      const a        = f.attributes ?? {};
      const cityCode = a.City_Code ?? '';
      // Skip city begin when the begin falls on an L independent alignment —
      // the city was already entered on the main alignment before the split.
      const beginSuffix = a.BeginPMSuffix ?? '.';
      const records = [];
      if (beginSuffix !== 'L') records.push({
          type:        'citybegin',
          name:        `cb_${a.RouteID}_${a.FromARMeasure}`,
          desc:        cityCode ? `CITY BEGIN: ${cityCode}` : 'CITY BEGIN',
          routeId:     a.RouteID,
          arMeasure:   a.FromARMeasure,
          county:      a.BeginCounty    ?? '',
          routeSuffix: '',
          pmPrefix:    a.BeginPMPrefix  ?? '',
          pmSuffix:    a.BeginPMSuffix  ?? '.',
          pmMeasure:   a.BeginPMMeasure != null ? String(a.BeginPMMeasure) : '',
          odMeasure:   a.BeginODMeasure != null ? String(a.BeginODMeasure) : '',
          district:    fmtDistrict(a),
          cityCode,
          startDate:   null,
          endDate:     null
        });
      records.push({
          type:        'cityend',
          name:        `ce_${a.RouteID}_${a.ToARMeasure}`,
          desc:        cityCode ? `CITY END: ${cityCode}` : 'CITY END',
          routeId:     a.RouteID,
          arMeasure:   a.ToARMeasure,
          county:      a.EndCounty    ?? '',
          routeSuffix: '',
          pmPrefix:    a.EndPMPrefix  ?? '',
          pmSuffix:    a.EndPMSuffix  ?? '.',
          pmMeasure:   a.EndPMMeasure != null ? String(a.EndPMMeasure) : '',
          odMeasure:   a.EndODMeasure != null ? String(a.EndODMeasure) : '',
          district:    fmtDistrict(a),
          cityCode,
          startDate:   null,
          endDate:     null
        });
      return records;
    });

    // Translate AR → PM (layer 3) and OD (layer 5) to get sort position and PM attribution.
    const CHUNK = 200;
    const chunks = [];
    for (let i = 0; i < pairs.length; i += CHUNK) chunks.push(pairs.slice(i, i + CHUNK));
    await Promise.all(chunks.map(async chunk => {
      const locs = chunk.map(p => ({ routeId: p.routeId, measure: p.arMeasure }));
      const makeBody = targetIds => new URLSearchParams({
        locations:             JSON.stringify(locs),
        targetNetworkLayerIds: JSON.stringify(targetIds),
        ...versionParam(),
        ...historicMomentParam(),
        f:     'json',
        token: _token
      }).toString();
      const url = `${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/4/translate`;
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      const [odData, pmData] = await Promise.all([
        fetch(url, { method: 'POST', headers, body: makeBody([5]) }).then(r => r.json()).catch(() => ({ locations: [] })),
        fetch(url, { method: 'POST', headers, body: makeBody([3]) }).then(r => r.json()).catch(() => ({ locations: [] }))
      ]);
      // Apply OD measures (used for sort order)
      (odData.locations ?? []).forEach((loc, idx) => {
        const xlated = loc.translatedLocations ?? [];
        const result = xlated.find(r => r.measure != null && routeNumDigits && r.routeId?.includes(routeNumDigits))
                    ?? xlated.find(r => r.measure != null)
                    ?? xlated[0];
        if (result?.measure != null) chunk[idx].odMeasure = String(result.measure);
      });
      // Apply PM attributes — routeId format: county(3)+routeNum(3)+suffix(1)+pmPrefix(1)+pmSuffix(1)+align(1)
      (pmData.locations ?? []).forEach((loc, idx) => {
        const xlated = loc.translatedLocations ?? [];
        const result = xlated.find(r => r.measure != null && routeNumDigits && r.routeId?.includes(routeNumDigits))
                    ?? xlated.find(r => r.measure != null)
                    ?? xlated[0];
        if (result?.routeId) {
          const rid = result.routeId;
          chunk[idx].county    = rid.slice(0, 3);
          chunk[idx].pmPrefix  = rid.length > 7 ? rid[7] : '';
          chunk[idx].pmSuffix  = rid.length > 8 ? rid[8] : '.';
          chunk[idx].pmMeasure = result.measure != null ? String(result.measure) : '';
        }
      });
    }));

    // Debug: trace BRE city end record
    pairs.forEach(p => {
      if (p.desc && p.desc.includes('BRE') && p.type === 'cityend') {
        console.log('[BRE cityend debug]', { type: p.type, pmSuffix: p.pmSuffix, pmMeasure: p.pmMeasure, odMeasure: p.odMeasure, county: p.county, arMeasure: p.arMeasure });
      }
    });

    // Layer 74 has no county column usable in the WHERE clause, so filter here
    // after translation has set p.county from the PM routeId (rid.slice(0,3)).
    if (county != null) {
      const normalizedCounty = normalizeCountyCode(county);
      if (normalizedCounty) {
        const filtered = pairs.filter(p => !p.county || p.county === normalizedCounty);
        pairs.forEach(p => {
          if (p.desc && p.desc.includes('BRE') && p.type === 'cityend' && !filtered.includes(p)) {
            console.log('[BRE cityend] REMOVED by county filter, p.county=' + p.county + ' normalizedCounty=' + normalizedCounty);
          }
        });
        return filtered;
      }
    }

    return pairs;
  }

  // ── HSL: Query intersections (layers 0, 151, g2m, translate) ────────────

  /**
   * Queries intersections by delegating to queryIntersectionsByDistrict, which
   * queries layer 151 directly via SQL (RouteNum + optional District_Code/County_Code).
   *
   * The former geometry-based path (measureToGeometry → layer 0 spatial → layer 149 AOI)
   * was removed because it hit layer 0's record-count ceiling on long routes, causing
   * intersections near the far end of the route (e.g. VEN county on route 001) to be
   * silently dropped. The layer 151 SQL path is both faster and complete.
   */
  async function queryIntersections(segments, routeNum, district = null, county = null) {
    return await queryIntersectionsByDistrict(segments, routeNum, district, county);
  }

  /** @deprecated — geometry-based intersection path, kept for reference only (do not call).
   * Converts measure segments to route polyline geometry (measureToGeometry),
   * spatially queries layer 0 for intersection points, filters by layer 149 AOI,
   * then looks up intersection attributes in layer 151.
   * Replaced by queryIntersectionsByDistrict due to layer 0 record-count truncation. */
  async function _queryIntersections_geometryPath(segments, routeNum) {
    // Path 1: no spatial filter — cast a geometry net over the whole route
    try {
      const rnMatch        = String(routeNum).match(/^(\d+)([A-Z]?)$/);
      const routeNumDigits = rnMatch ? rnMatch[1].padStart(3, '0') : String(routeNum).padStart(3, '0');
      const routeSuffix    = rnMatch ? rnMatch[2] : '';
      const geoLocations = segments.map(({ fromBest, toBest }) => ({
        routeId:     fromBest.routeId,
        fromMeasure: Math.min(fromBest.measure, toBest.measure) - 0.005,
        toMeasure:   Math.max(fromBest.measure, toBest.measure) + 0.005
      }));
      const m2gBody = new URLSearchParams({
        locations: JSON.stringify(geoLocations),
        ...versionParam(),
        f:     'json',
        token: _token
      });
      const m2gResp = await fetch(
        `${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/4/measureToGeometry`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: m2gBody.toString() }
      );
      const m2gData = await m2gResp.json();
      const segmentGeometries = (m2gData.locations ?? [])
        .filter(l => l.geometries?.length > 0 || l.geometry)
        .map(l => l.geometry ?? l.geometries?.[0])
        .filter(Boolean);
      if (segmentGeometries.length === 0) return { pairs: [], unresolved: [] };
      const layer0Results = await Promise.all(segmentGeometries.map(geom => {
        const qBody = new URLSearchParams({
          where:          '1=1',
          geometry:       JSON.stringify(geom),
          geometryType:   'esriGeometryPolyline',
          spatialRel:     'esriSpatialRelIntersects',
          outFields:      'INTERSECTION_ID',
          returnGeometry: 'true',
          ...versionParam(),
          f:     'json',
          token: _token
        });
        return fetch(`${CONFIG.mapServiceUrl}/0/query`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qBody.toString() }
        ).then(r => r.json());
      }));
      const intersectionMap = new Map();
      for (const qData of layer0Results) {
        for (const f of qData.features ?? []) {
          const id = f.attributes?.INTERSECTION_ID;
          if (id != null && !intersectionMap.has(id)) intersectionMap.set(id, f.geometry);
        }
      }
      if (intersectionMap.size === 0) return { pairs: [], unresolved: [] };
      const INT_CHUNK = 200;
      const idList   = Array.from(intersectionMap.keys());
      const allGeoms = Array.from(intersectionMap.values());
      const g2mBody = new URLSearchParams({
        locations:  JSON.stringify(allGeoms.map(g => ({ geometry: g }))),
        tolerance:  '50',
        ...versionParam(),
        f:     'json',
        token: _token
      });
      const idChunks = chunkArray(idList, INT_CHUNK);
      const dateFilter = getDateFilter('Int_Geometry_Begin_Date', 'Int_Geometry_End_Date');
      const [aoiFeatures, g2mData] = await Promise.all([
        Promise.all(idChunks.map(chunk => {
          const chunkList = chunk.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
          const aoiBody = new URLSearchParams({
            where:          `INTERSECTION_ID IN (${chunkList})`,
            outFields:      'INTERSECTION_ID',
            returnGeometry: 'false',
            ...versionParam(),
            f:     'json',
            token: _token
          });
          return fetch(`${CONFIG.mapServiceUrl}/149/query`,
            { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: aoiBody.toString() }
          ).then(r => r.json()).then(d => d.features ?? []).catch(() => []);
        })).then(chunks => chunks.flat()),
        fetch(`${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/4/geometryToMeasure`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: g2mBody.toString() }
        ).then(r => r.json())
      ]);
      const validIds = new Set(
        aoiFeatures.map(f => f.attributes?.INTERSECTION_ID).filter(id => id != null)
      );
      if (validIds.size === 0) return { pairs: [], unresolved: [] };
      const segRouteIds = new Set(geoLocations.map(g => g.routeId));
      const idToMeasure = new Map();
      (g2mData.locations ?? []).forEach((loc, idx) => {
        const id = idList[idx];
        if (!validIds.has(id)) return;
        const results = loc.results ?? [];
        const result  = results.find(r => segRouteIds.has(r.routeId) && r.distance === 0)
                     ?? results.find(r => segRouteIds.has(r.routeId))
                     ?? results[0];
        if (result?.routeId && result.measure != null) {
          idToMeasure.set(id, { routeId: result.routeId, arMeasure: result.measure });
        }
      });
      if (idToMeasure.size === 0) return { pairs: [], unresolved: [] };
      const measuredIds  = Array.from(idToMeasure.keys());
      const detailChunks = chunkArray(measuredIds, INT_CHUNK);
      const outFields151 = 'INTERSECTION_ID,Intersection_Name,County_Code,District_Code,Main_RouteNum,Main_RouteSuffix,Main_PMPrefix,Main_PMSuffix,Main_PMMeasure,Main_Alignment,Cross_RouteNum,Cross_RouteSuffix,Cross_PMPrefix,Cross_PMSuffix,Cross_PMMeasure,Cross_Alignment';
      const allDetailFeatures = (await Promise.all(detailChunks.map(async chunk => {
        const chunkList151 = chunk.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
        const detailWhere  = `INTERSECTION_ID IN (${chunkList151}) AND LRS_DATE_RETIRE IS NULL${dateFilter}`;
        const detailBody   = new URLSearchParams({
          where:          detailWhere,
          outFields:      outFields151,
          returnGeometry: 'false',
          ...versionParam(),
          f:     'json',
          token: _token
        });
        const detailData = await fetch(
          `${CONFIG.mapServiceUrl}/151/query`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: detailBody.toString() }
        ).then(r => r.json()).catch(() => ({}));
        if (detailData.error) {
          console.error('[queryIntersections] layer 151 API error:', detailData.error.code, detailData.error.message);
          return [];
        }
        return detailData.features ?? [];
      }))).flat();
      const detailMap = new Map();
      for (const f of allDetailFeatures) {
        const a = f.attributes ?? {};
        if (a.INTERSECTION_ID == null || detailMap.has(a.INTERSECTION_ID)) continue;
        const mainNum    = String(a.Main_RouteNum  ?? '').padStart(3, '0');
        const crossNum   = String(a.Cross_RouteNum ?? '').padStart(3, '0');
        const mainSuffix = a.Main_RouteSuffix  ?? '';
        const crossSuffix= a.Cross_RouteSuffix ?? '';
        let pmPrefix, pmSuffix, pmMeasureVal, pmRouteId, isCross;
        if (mainNum === routeNumDigits && mainSuffix === routeSuffix) {
          isCross      = false;
          pmPrefix     = a.Main_PMPrefix  ?? '';
          pmSuffix     = a.Main_PMSuffix  ?? '.';
          pmMeasureVal = a.Main_PMMeasure ?? '';
          pmRouteId    = (a.County_Code ?? '.') + mainNum + (a.Main_RouteSuffix ?? '.') + (a.Main_PMPrefix ?? '.') + (a.Main_PMSuffix ?? '.') + (a.Main_PMSuffix === 'L' ? 'L' : (a.Main_Alignment ?? '.'));
        } else if (crossNum === routeNumDigits && crossSuffix === routeSuffix) {
          isCross      = true;
          pmPrefix     = a.Cross_PMPrefix  ?? '';
          pmSuffix     = a.Cross_PMSuffix  ?? '.';
          pmMeasureVal = a.Cross_PMMeasure ?? '';
          pmRouteId    = (a.County_Code ?? '.') + crossNum + (a.Cross_RouteSuffix ?? '.') + (a.Cross_PMPrefix ?? '.') + (a.Cross_PMSuffix ?? '.') + (a.Cross_PMSuffix === 'L' ? 'L' : (a.Cross_Alignment ?? '.'));
        } else {
          continue;
        }
        detailMap.set(a.INTERSECTION_ID, {
          desc:      a.Intersection_Name ?? '',
          county:    a.County_Code       ?? '',
          district:  a.District_Code ? String(a.District_Code).padStart(2, '0') : '',
          pmPrefix, pmSuffix, pmMeasure: pmMeasureVal, pmRouteId, isCross
        });
      }
      if (detailMap.size === 0) return { pairs: [], unresolved: [] };
      const matchedIds  = Array.from(detailMap.keys());
      const XLATE_CHUNK = 100;
      const xlateChunks = chunkArray(matchedIds, XLATE_CHUNK);
      const idToOdMeasure = new Map();
      await Promise.all(xlateChunks.map(async chunk => {
        const locs = chunk.map(id => {
          const d = detailMap.get(id);
          return { routeId: d.pmRouteId, measure: parseFloat(d.pmMeasure) };
        });
        const body = new URLSearchParams({
          locations:             JSON.stringify(locs),
          targetNetworkLayerIds: JSON.stringify([5]),
          ...versionParam(),
          ...historicMomentParam(),
          f:     'json',
          token: _token
        });
        const data = await fetch(
          `${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/3/translate`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
        ).then(r => r.json()).catch(() => ({ locations: [] }));
        (data.locations ?? []).forEach((loc, idx) => {
          const id     = chunk[idx];
          const xlated = loc.translatedLocations ?? [];
          const result = xlated.find(r => r.measure != null && r.routeId?.includes(routeNumDigits))
                      ?? xlated.find(r => r.measure != null)
                      ?? xlated[0];
          if (result?.measure != null) idToOdMeasure.set(id, String(result.measure));
        });
      }));
      const pairs      = [];
      const unresolved = [];
      for (const id of matchedIds) {
        const detail    = detailMap.get(id);
        const measure   = idToMeasure.get(id);
        const odMeasure = idToOdMeasure.get(id);
        if (odMeasure == null) {
          unresolved.push({ id: String(id), desc: detail.desc, pmRouteId: detail.pmRouteId, pmMeasure: detail.pmMeasure });
          continue;
        }
        pairs.push({
          type:        'intersection',
          name:        String(id),
          desc:        detail.desc,
          routeId:     measure?.routeId ?? '',
          arMeasure:   measure?.arMeasure ?? 0,
          odMeasure,
          county:      detail.county,
          district:    detail.district,
          routeSuffix: '',
          pmPrefix:    detail.pmPrefix,
          pmSuffix:    detail.pmSuffix,
          pmMeasure:   detail.pmMeasure,
          isCross:     detail.isCross,
          startDate:   null,
          endDate:     null
        });
      }
      return { pairs, unresolved };
    } catch (e) {
      console.error('[_queryIntersections_geometryPath] error:', e.message);
      return { pairs: [], unresolved: [] };
    }
  }

  /** Queries intersections from layer 151 directly using SQL filters (district/county/route), then resolves geometry via layer 0. */
  async function queryIntersectionsByDistrict(segments, routeNum, district = null, county = null) {
    try {
      const rnMatch        = String(routeNum).match(/^(\d+)([A-Z]?)$/);
      const routeNumDigits = rnMatch ? rnMatch[1].padStart(3, '0') : String(routeNum).padStart(3, '0');
      const routeSuffix    = rnMatch ? rnMatch[2] : '';
      const dateFilter   = getDateFilter('Int_Geometry_Begin_Date', 'Int_Geometry_End_Date');
      const INT_CHUNK    = 200;
      const outFields151 = 'INTERSECTION_ID,Intersection_Name,County_Code,District_Code,Main_RouteNum,Main_RouteSuffix,Main_PMPrefix,Main_PMSuffix,Main_PMMeasure,Main_Alignment,Cross_RouteNum,Cross_RouteSuffix,Cross_PMPrefix,Cross_PMSuffix,Cross_PMMeasure,Cross_Alignment';
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
          console.error('[queryIntersectionsByDistrict] layer 151 error:', data.error.code, data.error.message);
          return [];
        }
        return data.features ?? [];
      };
      const [mainResults, crossResults] = await Promise.all([
        fetch151(`${baseFilter} AND Main_RouteNum = '${routeNumDigits}'`),
        fetch151(`${baseFilter} AND Cross_RouteNum = '${routeNumDigits}'`)
      ]);
      const detailMap = new Map();
      const buildCrossLabel = (countyCode, num, sfx, pmPfx, pmSfx, align) => {
        const n = String(num ?? '').padStart(3, '0') || '000';
        return (countyCode || '.') + n + (sfx || '.') + (pmPfx || '.') + (pmSfx || '.') + (align || '.');
      };
      for (const f of mainResults) {
        const a = f.attributes ?? {};
        if (a.INTERSECTION_ID == null) continue;
        if ((a.Main_RouteSuffix ?? '') !== routeSuffix) continue;
        const pmPrefix     = a.Main_PMPrefix  ?? '';
        const pmSuffix     = a.Main_PMSuffix  ?? '.';
        const pmMeasureVal = a.Main_PMMeasure ?? '';
        const pmRouteId    = (a.County_Code ?? '.') + routeNumDigits + (routeSuffix || '.') + (a.Main_PMPrefix ?? '.') + (a.Main_PMSuffix ?? '.') + (a.Main_PMSuffix === 'L' ? 'L' : (a.Main_Alignment ?? '.'));
        detailMap.set(a.INTERSECTION_ID, {
          desc:           a.Intersection_Name ?? '',
          county:         a.County_Code       ?? '',
          district:       a.District_Code ? String(a.District_Code).padStart(2, '0') : '',
          crossPmMeasure: a.Cross_PMMeasure ?? null,
          crossRouteLabel: buildCrossLabel(a.County_Code, a.Cross_RouteNum, a.Cross_RouteSuffix, a.Cross_PMPrefix, a.Cross_PMSuffix, a.Cross_Alignment),
          pmPrefix, pmSuffix, pmMeasure: pmMeasureVal, pmRouteId, isCross: false
        });
      }
      for (const f of crossResults) {
        const a = f.attributes ?? {};
        if (a.INTERSECTION_ID == null || detailMap.has(a.INTERSECTION_ID)) continue;
        if ((a.Cross_RouteSuffix ?? '') !== routeSuffix) continue;
        const pmPrefix     = a.Cross_PMPrefix  ?? '';
        const pmSuffix     = a.Cross_PMSuffix  ?? '.';
        const pmMeasureVal = a.Cross_PMMeasure ?? '';
        const pmRouteId    = (a.County_Code ?? '.') + routeNumDigits + (routeSuffix || '.') + (a.Cross_PMPrefix ?? '.') + (a.Cross_PMSuffix ?? '.') + (a.Cross_PMSuffix === 'L' ? 'L' : (a.Cross_Alignment ?? '.'));
        detailMap.set(a.INTERSECTION_ID, {
          desc:           a.Intersection_Name ?? '',
          county:         a.County_Code       ?? '',
          district:       a.District_Code ? String(a.District_Code).padStart(2, '0') : '',
          crossPmMeasure: a.Main_PMMeasure ?? null,
          crossRouteLabel: buildCrossLabel(a.County_Code, a.Main_RouteNum, a.Main_RouteSuffix, a.Main_PMPrefix, a.Main_PMSuffix, a.Main_Alignment),
          pmPrefix, pmSuffix, pmMeasure: pmMeasureVal, pmRouteId, isCross: true
        });
      }
      if (detailMap.size === 0) return { pairs: [], unresolved: [] };

      // Compute the expected OD range from the query segments so we can discard
      // intersections that fall outside the queried section of route.
      const allSegMeasures = segments.flatMap(s => [s.fromBest.measure, s.toBest.measure]);
      const minMeasure     = Math.min(...allSegMeasures);
      const maxMeasure     = Math.max(...allSegMeasures);

      // Translate each intersection's PM location (PM network 3) to both
      // OD (network 5) for sort position and AR (network 4) so that
      // queryRangeLayer (layers 116, 74) can look up HG and city code via AR routeId.
      const idList        = Array.from(detailMap.keys());
      const XLATE_CHUNK   = 100;
      const xlateChunks   = chunkArray(idList, XLATE_CHUNK);
      const idToOdMeasure = new Map();
      const idToAr        = new Map(); // { routeId, arMeasure }
      await Promise.all(xlateChunks.map(async chunk => {
        const locs = chunk.map(id => {
          const d = detailMap.get(id);
          return { routeId: d.pmRouteId, measure: parseFloat(d.pmMeasure) };
        });
        const url     = `${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/3/translate`;
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        const makeBody = targetIds => new URLSearchParams({
          locations:             JSON.stringify(locs),
          targetNetworkLayerIds: JSON.stringify(targetIds),
          ...versionParam(),
          ...historicMomentParam(),
          f:     'json',
          token: _token
        }).toString();
        const [odData, arData] = await Promise.all([
          fetch(url, { method: 'POST', headers, body: makeBody([5]) }).then(r => r.json()).catch(() => ({ locations: [] })),
          fetch(url, { method: 'POST', headers, body: makeBody([4]) }).then(r => r.json()).catch(() => ({ locations: [] }))
        ]);
        (odData.locations ?? []).forEach((loc, idx) => {
          const id     = chunk[idx];
          const xlated = loc.translatedLocations ?? [];
          const result = xlated.find(r => r.measure != null && r.routeId?.includes(routeNumDigits))
                      ?? xlated.find(r => r.measure != null)
                      ?? xlated[0];
          if (result?.measure != null) idToOdMeasure.set(id, String(result.measure));
        });
        (arData.locations ?? []).forEach((loc, idx) => {
          const id     = chunk[idx];
          const xlated = loc.translatedLocations ?? [];
          const result = xlated.find(r => r.measure != null && r.routeId?.includes(routeNumDigits))
                      ?? xlated.find(r => r.measure != null)
                      ?? xlated[0];
          if (result?.routeId && result.measure != null) {
            idToAr.set(id, { routeId: result.routeId, arMeasure: result.measure });
          }
        });
      }));
      const pairs      = [];
      const unresolved = [];
      for (const id of idList) {
        const detail    = detailMap.get(id);
        const odMeasure = idToOdMeasure.get(id);
        if (odMeasure == null) {
          unresolved.push({ id: String(id), desc: detail.desc, pmRouteId: detail.pmRouteId, pmMeasure: detail.pmMeasure });
          continue;
        }
        const od = parseFloat(odMeasure);
        if (!isNaN(od) && (od < minMeasure - 0.1 || od > maxMeasure + 0.1)) continue;
        const ar = idToAr.get(id);
        pairs.push({
          type:            'intersection',
          name:            String(id),
          desc:            detail.desc,
          crossPmMeasure:  detail.crossPmMeasure,
          crossRouteLabel: detail.crossRouteLabel,
          routeId:         ar?.routeId   ?? '',
          arMeasure:      ar?.arMeasure ?? null,
          odMeasure,
          county:         detail.county,
          district:       detail.district,
          routeSuffix:    '',
          pmPrefix:       detail.pmPrefix,
          pmSuffix:       detail.pmSuffix,
          pmMeasure:      detail.pmMeasure,
          isCross:        detail.isCross,
          startDate:      null,
          endDate:        null
        });
      }
      return { pairs, unresolved };
    } catch (e) {
      console.error('[queryIntersectionsByDistrict] error:', e.message);
      return { pairs: [], unresolved: [] };
    }
  }

  // ── HSL: End record query (layers 114 / 85 / 116) ────────────────────────

  /**
   * Builds a synthetic END OF DISTRICT / COUNTY / ROUTE record placed after all
   * sorted results.  Priority: district > county > route.
   * Returns a raw pair ready to be appended to allPairs, or null on failure.
   */
  async function hsl_queryEndRecord(segments, district, county, routeNumDigits) {
    if (!segments.length) return null;
    const primaryRouteId = segments[0].fromBest.routeId.endsWith('_S')
      ? segments[0].fromBest.routeId.slice(0, -2) + '_P'
      : segments[0].fromBest.routeId;
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    let endArMeasure = null;
    let endDesc = '';

    if (district != null && county == null) {
      // ── Layer 114: district boundary events (no county filter) ────────────
      endDesc = 'END OF DISTRICT';
      const segClauses = segments.map(({ fromBest, toBest }) => {
        const rid   = fromBest.routeId.endsWith('_S') ? fromBest.routeId.slice(0, -2) + '_P' : fromBest.routeId;
        const fromM = Math.min(fromBest.measure, toBest.measure) - 0.005;
        const toM   = Math.max(fromBest.measure, toBest.measure) + 0.005;
        return `(RouteID = '${rid}' AND FromARMeasure <= ${toM} AND ToARMeasure >= ${fromM})`;
      });
      const districtNum = parseInt(district, 10);
      const where = `(${segClauses.join(' OR ')}) AND District = ${districtNum}${getDateFilter()}`;
      const body = new URLSearchParams({
        where,
        outFields:         'RouteID,ToARMeasure',
        returnGeometry:    'false',
        orderByFields:     'ToARMeasure DESC',
        resultRecordCount: '1',
        ...versionParam(),
        f: 'json', token: _token
      });
      try {
        const data = await fetch(`${CONFIG.mapServiceUrl}/114/query`, {
          method: 'POST', headers, body: body.toString()
        }).then(r => r.json()).catch(() => ({}));
        if (!data.error) {
          const feat = (data.features ?? [])[0];
          if (feat?.attributes?.ToARMeasure != null) endArMeasure = feat.attributes.ToARMeasure;
        } else {
          console.error(`[hsl_queryEndRecord] layer 114 error ${data.error.code}: ${data.error.message}`);
        }
      } catch (e) {
        console.error('[hsl_queryEndRecord] layer 114 error:', e.message);
      }

    } else if (county != null) {
      // ── Layer 85: county boundary events (also used when district+county both set) ──
      endDesc = district != null ? 'END OF DISTRICT' : 'END OF COUNTY';
      const countyCode = normalizeCountyCode(county);
      const segClauses = segments.map(({ fromBest, toBest }) => {
        const rid   = fromBest.routeId.endsWith('_S') ? fromBest.routeId.slice(0, -2) + '_P' : fromBest.routeId;
        const fromM = Math.min(fromBest.measure, toBest.measure) - 0.005;
        const toM   = Math.max(fromBest.measure, toBest.measure) + 0.005;
        return `(RouteID = '${rid}' AND FromARMeasure <= ${toM} AND ToARMeasure >= ${fromM})`;
      });
      const where = segClauses.length === 1
        ? segClauses[0].slice(1, -1)
        : `(${segClauses.join(' OR ')})`;
      const where85 = where + getDateFilter();
      const body = new URLSearchParams({
        where:          where85,
        outFields:      'RouteID,ToARMeasure,County_Code',
        returnGeometry: 'false',
        ...versionParam(),
        f: 'json', token: _token
      });
      try {
        const data = await fetch(`${CONFIG.mapServiceUrl}/85/query`, {
          method: 'POST', headers, body: body.toString()
        }).then(r => r.json()).catch(() => ({}));
        if (!data.error) {
          const features = data.features ?? [];
          const alaFeatures = features.filter(f => (f.attributes?.County_Code ?? '').trim() === countyCode);
          const chosen = alaFeatures.length > 0
            ? alaFeatures.reduce((best, f) =>
                (f.attributes?.ToARMeasure ?? -Infinity) > (best.attributes?.ToARMeasure ?? -Infinity) ? f : best)
            : features.reduce((best, f) =>
                (f.attributes?.ToARMeasure ?? -Infinity) > (best?.attributes?.ToARMeasure ?? -Infinity) ? f : best, null);
          if (chosen?.attributes?.ToARMeasure != null) endArMeasure = chosen.attributes.ToARMeasure;
        } else {
          console.error(`[hsl_queryEndRecord] layer 85 error ${data.error.code}: ${data.error.message}`);
        }
      } catch (e) {
        console.error('[hsl_queryEndRecord] layer 85 error:', e.message);
      }

    } else {
      // ── Layer 116: route max AR measure ───────────────────────────────────
      endDesc = 'END OF ROUTE';
      const ridClauses = [...new Set(segments.map(({ fromBest }) => {
        const rid = fromBest.routeId.endsWith('_S') ? fromBest.routeId.slice(0, -2) + '_P' : fromBest.routeId;
        return `RouteID = '${rid}'`;
      }))];
      const body = new URLSearchParams({
        where:             `(${ridClauses.join(' OR ')})${getDateFilter()}`,
        outFields:         'RouteID,ToARMeasure',
        returnGeometry:    'false',
        orderByFields:     'ToARMeasure DESC',
        resultRecordCount: '1',
        ...versionParam(),
        f: 'json', token: _token
      });
      try {
        const data = await fetch(`${CONFIG.mapServiceUrl}/116/query`, {
          method: 'POST', headers, body: body.toString()
        }).then(r => r.json()).catch(() => ({}));
        if (!data.error) {
          const feat = (data.features ?? [])[0];
          if (feat?.attributes?.ToARMeasure != null) endArMeasure = feat.attributes.ToARMeasure;
        } else {
          console.error(`[hsl_queryEndRecord] layer 116 error ${data.error.code}: ${data.error.message}`);
        }
      } catch (e) {
        console.error('[hsl_queryEndRecord] layer 116 error:', e.message);
      }
    }

    if (endArMeasure == null) return null;

    // Step slightly inside the boundary for all lookups so they land in the
    // current district/county rather than the adjacent one.
    const lookupMeasure = endArMeasure - 0.001;

    // If district wasn't supplied (county/route cases), look it up from layer 114
    let resolvedDistrict = district != null ? String(district).padStart(2, '0') : '';
    if (!resolvedDistrict) {
      try {
        const body114 = new URLSearchParams({
          where:             `RouteID = '${primaryRouteId}' AND FromARMeasure <= ${lookupMeasure} AND ToARMeasure >= ${lookupMeasure}${getDateFilter()}`,
          outFields:         'District',
          returnGeometry:    'false',
          resultRecordCount: '1',
          ...versionParam(),
          f: 'json', token: _token
        });
        const d114 = await fetch(`${CONFIG.mapServiceUrl}/114/query`, { method: 'POST', headers, body: body114 }).then(r => r.json()).catch(() => ({}));
        const d114feat = (d114.features ?? [])[0];
        if (d114feat?.attributes?.District != null) resolvedDistrict = String(d114feat.attributes.District).padStart(2, '0');
      } catch (_) { /* leave blank */ }
    }

    // Translate AR → OD (4→5) and AR → PM (4→3) using lookupMeasure so results
    // land inside the current district/county rather than the adjacent one.
    const loc = { routeId: primaryRouteId, measure: lookupMeasure };
    const makeXlateBody = targetIds => new URLSearchParams({
      locations:             JSON.stringify([loc]),
      targetNetworkLayerIds: JSON.stringify(targetIds),
      ...versionParam(),
      ...historicMomentParam(),
      f: 'json', token: _token
    }).toString();
    const xlateUrl = `${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/4/translate`;
    const [odData, pmData] = await Promise.all([
      fetch(xlateUrl, { method: 'POST', headers, body: makeXlateBody([5]) }).then(r => r.json()).catch(() => ({ locations: [] })),
      fetch(xlateUrl, { method: 'POST', headers, body: makeXlateBody([3]) }).then(r => r.json()).catch(() => ({ locations: [] }))
    ]);

    const odLoc    = (odData.locations ?? [])[0];
    const odResult = (odLoc?.translatedLocations ?? []).find(r => r.measure != null && routeNumDigits && r.routeId?.includes(routeNumDigits))
                  ?? (odLoc?.translatedLocations ?? []).find(r => r.measure != null);
    const odMeasure = odResult?.measure != null ? String(odResult.measure) : '';

    const pmLoc    = (pmData.locations ?? [])[0];
    const pmResult = (pmLoc?.translatedLocations ?? []).find(r => r.measure != null && routeNumDigits && r.routeId?.includes(routeNumDigits))
                  ?? (pmLoc?.translatedLocations ?? []).find(r => r.measure != null);
    let pmPrefix = '', pmSuffix = '.', pmMeasure = '', countyFromPm = '';
    if (pmResult?.routeId) {
      const rid  = pmResult.routeId;
      countyFromPm = rid.slice(0, 3);
      pmPrefix  = rid.length > 7 ? rid[7] : '';
      pmSuffix  = rid.length > 8 ? rid[8] : '.';
      pmMeasure = pmResult.measure != null ? String(pmResult.measure) : '';
    }

    return {
      type:        'landmark',
      name:        `hsl_end_${primaryRouteId}_${endArMeasure}`,
      desc:        endDesc,
      routeId:     primaryRouteId,
      arMeasure:   endArMeasure,
      county:      countyFromPm,
      routeSuffix: '',
      pmPrefix,
      pmSuffix,
      pmMeasure,
      odMeasure,
      district:    resolvedDistrict,
      hgValue:     '',
      startDate:   null,
      endDate:     null
    };
  }

  // ── HSL: Run functions ────────────────────────────────────────────────────

  async function hsl_runDistrictRouteMode() {
    if (!tokenIsValid()) { login(); return; }
    const district = document.getElementById('districtSelect').value || null; // null = ALL
    const routeNum = document.getElementById('districtRouteSelect').value;
    const county   = getDistrictCounty();
    if (!routeNum) { hsl_showRampResults('error', 'Please select a route.');    return; }
    const paddedRoute = String(routeNum).padStart(3, '0');
    const { segments, routeSuffix } = buildHslSegments(paddedRoute);
    const btn = document.getElementById('districtRouteBtn');
    btn.disabled = true;
    startThinking(btn);
    clearResults();
    try {
      const [rampPairs, landmarkPairs, routeBreakPairs, { pairs: intersectionPairs, unresolved: unresolvedIntersections }, equationPairs, cityBeginPairs, direction] = await Promise.all([
        queryAttributeSet(segments, district, county),
        queryLandmarks(segments, routeSuffix, district, county),
        queryRouteBreaks(segments, routeSuffix, district, county),
        queryIntersections(segments, routeNum, district, county),
        queryEquationPoints(segments, district, county),
        queryCityBegins(segments, paddedRoute, district, county),
        queryRouteDirection(routeNum)
      ]);
      _routeLabel    = paddedRoute;
      _directionFrom = direction.from;
      _directionTo   = direction.to;
      const unsortedPairs = [...rampPairs, ...landmarkPairs, ...routeBreakPairs, ...intersectionPairs, ...equationPairs, ...cityBeginPairs];
      const hgMap = await queryRangeLayer(unsortedPairs, 116, 'Highway_Group');
      for (const p of unsortedPairs) p.hgValue = hgMap.get(p.name) ?? '';
      const allPairs = hsl_filterRealignmentLandmarks(hsl_filterCityBoundaries(sortWithIndependentAlignments(unsortedPairs)));
      if (allPairs.length === 0) { hsl_showRampResults('none'); return; }


      const lastPair = allPairs[allPairs.length - 1];
      const endPair = (lastPair?.type === 'cityend' || lastPair?.type === 'citybegin') ? null : await hsl_queryEndRecord(segments, district, county, paddedRoute);
      if (endPair) {
        const endHgMap = await queryRangeLayer([endPair], 116, 'Highway_Group');
        endHgMap.forEach((v, k) => hgMap.set(k, v));
        allPairs.push(endPair);
      }
      await hsl_queryRampDescriptions(allPairs, unresolvedIntersections, hgMap);
    } catch (err) {
      hsl_showRampResults('error', err.message || 'An error occurred.');
    } finally {
      btn.disabled = false;
      stopThinking(btn);
    }
  }

  async function hsl_runTranslate() {
    if (!tokenIsValid()) { login(); return; }
    const from = readSection('from');
    const to   = readSection('to');
    const fromMeasure = parseFloat(from.measureRaw);
    if (isNaN(fromMeasure)) { hsl_showRampResults('error', 'From measure must be a number.'); return; }
    const toMeasure = parseFloat(to.measureRaw);
    if (isNaN(toMeasure)) { hsl_showRampResults('error', 'To measure must be a number.'); return; }
    setFieldError('from', '');
    setFieldError('to',   '');
    const fromRouteIdR = buildRouteId(from, 'R');
    const fromRouteIdL = buildRouteId(from, 'L');
    const toRouteIdR   = buildRouteId(to,   'R');
    const toRouteIdL   = buildRouteId(to,   'L');
    const needsLAlt  = from.pmSuffix !== 'L';
    const fromL      = { ...from, pmSuffix: 'L' };
    const toL        = { ...to,   pmSuffix: 'L' };
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
      if (fromResult.status === 'rejected') {
        if (fromResult.reason?.message !== 'auth') setFieldError('from', 'INVALID LOCATION');
        hasError = true;
      } else if (!fromResult.value.bestR && !fromResult.value.bestL) {
        setFieldError('from', 'INVALID LOCATION');
        hasError = true;
      }
      if (toResult.status === 'rejected') {
        if (toResult.reason?.message !== 'auth') setFieldError('to', 'INVALID LOCATION');
        hasError = true;
      } else if (!toResult.value.bestR && !toResult.value.bestL) {
        setFieldError('to', 'INVALID LOCATION');
        hasError = true;
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
      if (segments.length === 0) {
        hsl_showRampResults('error', 'Translation failed for both R and L alignments.');
        return;
      }
      const routeSuffix = from.routeSuffix === '.' ? '' : from.routeSuffix;
      const paddedRouteNum = from.routeNum.padStart(3, '0');
      const [rampPairs, landmarkPairs, routeBreakPairs, { pairs: intersectionPairs, unresolved: unresolvedIntersections }, equationPairs, cityBeginPairs, direction] = await Promise.all([
        queryAttributeSet(segments),
        queryLandmarks(segments, from.routeSuffix),
        queryRouteBreaks(segments, from.routeSuffix),
        queryIntersections(segments, from.routeNum),
        queryEquationPoints(segments),
        queryCityBegins(segments, paddedRouteNum),
        queryRouteDirection(paddedRouteNum)
      ]);
      _routeLabel    = paddedRouteNum;
      _directionFrom = direction.from;
      _directionTo   = direction.to;
      const unsortedPairs = [...rampPairs, ...landmarkPairs, ...routeBreakPairs, ...intersectionPairs, ...equationPairs, ...cityBeginPairs];
      const hgMap = await queryRangeLayer(unsortedPairs, 116, 'Highway_Group');
      for (const p of unsortedPairs) p.hgValue = hgMap.get(p.name) ?? '';
      const allPairs = hsl_filterRealignmentLandmarks(hsl_filterCityBoundaries(sortWithIndependentAlignments(unsortedPairs)));
      if (allPairs.length === 0) { hsl_showRampResults('none'); return; }
      const lastPair = allPairs[allPairs.length - 1];
      const endPair = (lastPair?.type === 'cityend' || lastPair?.type === 'citybegin') ? null : await hsl_queryEndRecord(segments, null, null, paddedRouteNum);
      if (endPair) {
        const endHgMap = await queryRangeLayer([endPair], 116, 'Highway_Group');
        endHgMap.forEach((v, k) => hgMap.set(k, v));
        allPairs.push(endPair);
      }
      await hsl_queryRampDescriptions(allPairs, unresolvedIntersections, hgMap);
    } finally {
      btn.disabled = false;
      stopThinking(btn);
    }
  }

  // ── HSL: Result pipeline ──────────────────────────────────────────────────

  async function hsl_queryRampDescriptions(allPairs, unresolvedIntersections = [], precomputedHgMap = null) {
    const rampsOnly = allPairs.filter(p => p.type === 'ramp');
    const fetchDescriptions = async () => {
      const descMap = new Map();
      if (rampsOnly.length === 0) return descMap;
      const CHUNK = 100;
      const chunks = chunkArray(rampsOnly, CHUNK);
      const allDescFeatures = (await Promise.all(chunks.map(async chunk => {
        const inList = chunk.map(p => `'${p.name.replace(/'/g, "''")}'`).join(', ');
        const body = new URLSearchParams({
          where:          `Ramp_Name IN (${inList})${getDateFilter()}`,
          outFields:      'Ramp_Name,Ramp_Description',
          returnGeometry: 'false',
          ...versionParam(),
          f:              'json',
          token:          _token
        });
        try {
          const resp = await fetch(`${CONFIG.mapServiceUrl}/131/query`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
          });
          const data = await resp.json();
          if (data.error) {
            const code = data.error.code;
            if (code === 498 || code === 499) { _token = null; login(); return []; }
            console.error(`[hsl_queryRampDesc] API error ${code}: ${data.error.message}`);
            return [];
          }
          return Array.isArray(data.features) ? data.features : [];
        } catch (e) {
          console.error('[hsl_queryRampDesc] error:', e.message);
          return [];
        }
      }))).flat();
      for (const f of allDescFeatures) {
        const n = f.attributes?.Ramp_Name;
        const d = f.attributes?.Ramp_Description;
        if (n != null && !descMap.has(n)) descMap.set(n, d ?? '');
      }
      return descMap;
    };
    const [descMap, hwyMap, cityMap] = precomputedHgMap
      ? await Promise.all([fetchDescriptions(), Promise.resolve(precomputedHgMap), queryRangeLayer(allPairs, 74, 'City_Code')])
      : await Promise.all([fetchDescriptions(), queryRangeLayer(allPairs, 116, 'Highway_Group'), queryRangeLayer(allPairs, 74, 'City_Code')]);
    const odMap = translateToOD(allPairs);
    const results = allPairs.map((p, i) => {
      let hwyGroup = hwyMap.get(p.name) ?? '';
      let cityCode  = (p.type === 'citybegin' || p.type === 'cityend') ? (p.cityCode ?? '') : (cityMap.get(p.name) ?? '');
      if (p.type === 'routebreak' && p.desc === 'Route Break' && (!hwyGroup || !cityCode)) {
        const resume = allPairs.slice(i + 1).find(r => r.type === 'routebreak' && r.desc === 'Route Resume');
        if (resume) {
          if (!hwyGroup) hwyGroup = hwyMap.get(resume.name) ?? '';
          if (!cityCode)  cityCode  = cityMap.get(resume.name) ?? '';
        }
      }
      return {
        name:        p.name,
        type:        p.type,
        featureType: p.type === 'equation' ? 'H' : p.type === 'landmark' ? 'H' : p.type === 'routebreak' ? 'H' : p.type === 'citybegin' ? 'H' : p.type === 'cityend' ? 'H' : p.type === 'intersection' ? 'I' : 'R',
        isCross:     p.isCross ?? false,
        isSecondEq:  p.isSecondEq ?? false,
        desc:        (() => {
          const base = p.type === 'ramp' ? (descMap.get(p.name) ?? '') : p.desc;
          if (p.type === 'intersection' && p.crossPmMeasure != null) {
            const pm = parseFloat(p.crossPmMeasure);
            return isNaN(pm) ? base : `${base} (${p.crossRouteLabel ?? 'PM'} ${pm.toFixed(3)})`;
          }
          return base;
        })(),
        hwyGroup,
        cityCode,
        county:      p.county,
        district:    p.district ?? '',
        routeSuffix: p.routeSuffix,
        pmPrefix:    p.pmPrefix ?? '',
        pmSuffix:    p.pmSuffix ?? '.',
        pmMeasure:   p.pmMeasure,
        odMeasure:   odMap.get(p.name) ?? '',
        startDate:   p.startDate,
        endDate:     p.endDate
      };
    });
    hsl_showRampResults('success', null, results, unresolvedIntersections);
  }

  function hsl_showRampResults(type, message, names, unresolvedIntersections = []) {
    const box = document.getElementById('rampResults');
    box.style.display = 'block';
    if (type === 'error') {
      box.className = 'ramp-results error';
      box.innerHTML = esc(message);
    } else if (type === 'none') {
      box.className = 'ramp-results';
      box.innerHTML = `<span class="ramp-empty">No results found in this segment.</span>`;
    } else {
      _allResults              = names;
      _unresolvedIntersections = unresolvedIntersections;
      _currentPage             = 0;
      _generatedOn             = new Date().toLocaleString();
      _hslLengths              = hsl_computeLengths(names);
      _hslPageStarts           = hsl_computePageStarts(names);
      hsl_renderPage();
    }
  }

  // Returns an array of result indices where each screen/print page begins.
  // A new page starts when the district changes (non-empty change) or when
  // PAGE_SIZE rows have been accumulated on the current page.
  function hsl_computePageStarts(results) {
    if (results.length === 0) return [];
    const starts = [0];
    let rowCount     = 1;
    let pageDistrict = results[0].district || '';
    for (let i = 1; i < results.length; i++) {
      const d = results[i].district || '';
      if (rowCount >= PAGE_SIZE || (d !== '' && d !== pageDistrict)) {
        starts.push(i);
        rowCount = 1;
        if (d !== '') pageDistrict = d;
      } else {
        rowCount++;
        if (d !== '') pageDistrict = d;
      }
    }
    return starts;
  }

  function hsl_computeLengths(results) {
    return results.map((p, i) => {
      if (p.type === 'equation' && !p.isSecondEq) return '';
      if (p.type === 'routebreak' && p.desc === 'Route Break') return '';
      const curOd = parseFloat(p.odMeasure);
      const isExcluded = r =>
        (r.type === 'equation' && !r.isSecondEq) ||
        (r.type === 'routebreak' && r.desc === 'Route Break');
      const rem = results.slice(i + 1).filter(r => !isExcluded(r));
      let nextEntry;
      if (p.pmSuffix === 'R') {
        nextEntry = rem.find(r => r.featureType !== 'R' && r.featureType !== 'I' && r.pmSuffix !== 'L');
      } else if (p.pmSuffix === 'L') {
        nextEntry = rem.find(r => r.featureType !== 'R' && r.featureType !== 'I' && r.pmSuffix !== 'R');
      } else {
        const firstNR = rem.find(r => r.featureType !== 'R' && r.featureType !== 'I');
        nextEntry = (firstNR?.pmSuffix === 'R' || firstNR?.pmSuffix === 'L')
          ? rem.find(r => r.featureType !== 'R' && r.featureType !== 'I' && r.pmSuffix !== 'R' && r.pmSuffix !== 'L')
          : firstNR;
      }
      const nextOd = nextEntry ? parseFloat(nextEntry.odMeasure) : NaN;
      return (!isNaN(curOd) && !isNaN(nextOd)) ? (nextOd - curOd).toFixed(3) : '';
    });
  }

  function hsl_renderItem(p, idx, lengths) {
    const length  = lengths[idx];
    const isEq1   = p.type === 'equation' && !p.isSecondEq;
    const displayedHg = p.pmSuffix === 'L' ? 'L' : (p.hwyGroup || '');
    const hgColor  = displayedHg === 'R' ? '#1d4ed8' : displayedHg === 'L' ? '#7c3aed' : '';
    const hgFStyle = hgColor ? ` style="color:${hgColor}; font-weight:bold;"` : '';
    const ftStyle  = hgColor ? ` style="padding-left:3ch; color:${hgColor}; font-weight:bold;"` : ' style="padding-left:3ch"';
    const hgAndF  = isEq1
      ? `<span style="grid-column: 7 / -1;">EQUATES TO</span>`
      : `<span${hgFStyle}>${p.pmSuffix === 'L' ? 'L' : p.hwyGroup ? esc(p.hwyGroup) : ''}</span>
         <span${ftStyle}>${p.featureType}</span>`;
    const isRealignment = p.type === 'landmark' && (p.desc === 'END REALIGNMENT' || p.desc === 'BEGIN REALIGNMENT');
    const rowClass = p.type === 'equation'              ? 'hsl-item-eq'
                   : p.type === 'routebreak'            ? 'hsl-item-rb'
                   : p.type === 'citybegin' ||
                     p.type === 'cityend' ||
                     isRealignment                      ? 'hsl-item-cb'
                   : p.hwyGroup === 'R'                 ? 'hsl-item-ia-r'
                   : p.hwyGroup === 'L'                 ? 'hsl-item-ia-l'
                   : '';
    const hasPmPrefix  = p.pmPrefix && p.pmPrefix !== '.';
    const pmPrefixStyle = hasPmPrefix ? ' color:#991b1b; font-weight:bold;' : '';
    const eqBlack = (p.type === 'equation' || p.type === 'citybegin' || p.type === 'cityend' || isRealignment) ? ' style="color:#000;"' : '';
    return `<li class="ramp-item hsl-ramp-col-template${rowClass ? ' ' + rowClass : ''}">
         <span${eqBlack}>${p.county      ? esc(String(p.county)) : ''}</span>
         <span${eqBlack}>${p.cityCode    ? esc(p.cityCode)        : ''}</span>
         <span style="text-align:right;${pmPrefixStyle}">${hasPmPrefix ? esc(p.pmPrefix) : ''}</span>
         <span style="text-align:center;">${esc(padMeasure(p.pmMeasure))}</span>
         <span style="justify-self:start;">${p.pmSuffix === 'E' ? 'E' : ''}</span>
         ${hgAndF}
         ${isEq1 ? '' : `<span style="display:block;text-align:center;">${p.isCross ? '*P*' : p.featureType !== 'R' && p.featureType !== 'I' && length !== '' ? padMeasure(length) : ''}</span>`}
         ${isEq1 ? '' : `<span style="text-align:left;">${p.desc ? esc(p.desc) : ''}</span>`}
         <span style="color:#6b7280;font-size:0.75em;text-align:right;">${p.odMeasure !== '' && p.odMeasure != null ? parseFloat(p.odMeasure).toFixed(3) : ''}</span>
       </li>`;
  }

  function hsl_renderItemAsRow(p, idx, lengths) {
    const length = lengths[idx];
    const isEq1  = p.type === 'equation' && !p.isSecondEq;
    const distToNext = p.isCross ? '*P*'
      : p.featureType !== 'R' && p.featureType !== 'I' && length !== '' ? padMeasure(length) : '';
    const isRealignment = p.type === 'landmark' && (p.desc === 'END REALIGNMENT' || p.desc === 'BEGIN REALIGNMENT');
    const rowClass = p.type === 'equation'              ? 'hsl-row-eq'
                   : p.type === 'routebreak'            ? 'hsl-row-rb'
                   : p.type === 'citybegin' ||
                     p.type === 'cityend' ||
                     isRealignment                      ? 'hsl-row-cb'
                   : p.hwyGroup === 'R'                 ? 'hsl-row-ia-r'
                   : p.hwyGroup === 'L'                 ? 'hsl-row-ia-l'
                   : '';
    const hasPmPrefix   = p.pmPrefix && p.pmPrefix !== '.';
    const pmPrefixStyle = hasPmPrefix ? ' color:#991b1b; font-weight:bold;' : '';
    const displayedHg   = p.pmSuffix === 'L' ? 'L' : (p.hwyGroup || '');
    const hgColor       = displayedHg === 'R' ? '#1d4ed8' : displayedHg === 'L' ? '#7c3aed' : '';
    const hgFStyle      = hgColor ? ` style="color:${hgColor};"` : '';
    const ftStyle       = hgColor ? ` style="padding-left:3ch; color:${hgColor};"` : ' style="padding-left:3ch"';
    const eqBlack       = (p.type === 'equation' || p.type === 'citybegin' || p.type === 'cityend' || isRealignment) ? ' style="color:#000;"' : '';
    return `<tr${rowClass ? ` class="${rowClass}"` : ''}>
      <td${eqBlack}>${p.county    ? esc(String(p.county))   : ''}</td>
      <td${eqBlack}>${p.cityCode  ? esc(p.cityCode)         : ''}</td>
      <td style="text-align:right;${pmPrefixStyle}">${hasPmPrefix ? esc(p.pmPrefix) : ''}</td>
      <td style="text-align:center">${esc(padMeasure(p.pmMeasure))}</td>
      <td>${p.pmSuffix === 'E' ? 'E' : ''}</td>
      ${isEq1
        ? `<td colspan="4" style="text-align:center">EQUATES TO</td>`
        : `<td${hgFStyle}>${p.pmSuffix === 'L' ? 'L' : p.hwyGroup ? esc(p.hwyGroup) : ''}</td>
           <td${ftStyle}>${p.featureType ? esc(p.featureType) : ''}</td>
           <td style="text-align:center">${distToNext}</td>
           <td style="text-align:left">${p.desc ? esc(p.desc) : ''}</td>`
      }
    </tr>`;
  }

  function hsl_renderPage() {
    const box = document.getElementById('rampResults');
    box.style.display = 'block';
    box.className     = 'ramp-results';
    const paginated  = isPaginated();
    const pageStarts = paginated && _hslPageStarts?.length ? _hslPageStarts : [0];
    const totalPages = pageStarts.length;
    const page       = paginated ? _currentPage : 0;
    const start      = paginated ? (pageStarts[page] ?? 0) : 0;
    const end        = paginated ? (pageStarts[page + 1] ?? _allResults.length) : _allResults.length;
    const pageSlice  = _allResults.slice(start, end);
    const prevDis = page === 0              ? 'disabled' : '';
    const nextDis = page === totalPages - 1 ? 'disabled' : '';
    const pageDistrict = _allResults[start]?.district || '';
    const routeLine3 = _routeLabel
      ? `${pageDistrict ? `District: ${esc(pageDistrict)}&emsp;&emsp;&emsp;` : ''}Route: ${esc(_routeLabel)}&emsp;&emsp;&emsp;Direction: ${esc(_directionFrom)} &ndash; ${esc(_directionTo)}`
      : '';
    const actionBar      = renderActionBar('California Department of Transportation', 'Highway Locations', routeLine3, 'exportToExcel()', 'printAll()');
    const paginationBtns = `<div class="ramp-pagination">
         <div class="pagination-left">
           <div style="display:flex;">
             <button class="page-arrow" ${prevDis} onclick="changePageFirst()">&#9664;&#9664;</button>
             <button class="page-arrow" ${prevDis} onclick="changePage(-1)">&#9664;</button>
           </div>
         </div>
         <div class="pagination-right">
           <div style="display:flex;">
             <button class="page-arrow" ${nextDis} onclick="changePage(1)">&#9654;</button>
             <button class="page-arrow" ${nextDis} onclick="changePageLast()">&#9654;&#9654;</button>
           </div>
         </div>
       </div>`;
    const header =
      `<div class="ramp-list-header hsl-ramp-col-template">
         <span>County</span>
         <span>City</span>
         <span></span>
         <span>PM</span>
         <span></span>
         <span style="padding-left:2ch">HG</span>
         <span style="padding-left:3ch">FT</span>
         <span style="padding-left:5ch">DISTANCE TO<br>NEXT POINT</span>
         <span style="padding-left:5ch">Description</span>
         <span style="color:#6b7280;">OD</span>
       </div>`;
    const lengths = _hslLengths ?? hsl_computeLengths(_allResults);
    const items = pageSlice.map((p, i) => hsl_renderItem(p, start + i, lengths)).join('');
    const pageFooter = paginated && totalPages > 1
      ? `<div class="page-info">Page ${page + 1} of ${totalPages}</div>`
      : '';
    const shownPaginationBtns = paginated ? paginationBtns : '';
    const generatedFooter = `<div class="generated-on">Generated on ${esc(_generatedOn)}</div>`;
    const unresolvedSection = renderUnresolvedSection(_unresolvedIntersections);
    const today = new Date().toISOString().slice(0, 10);
    const refDate = document.getElementById('refDate').value;
    const pushToCrashBtn = getVersion() !== '' && refDate === today
      ? `<div style="text-align:center;padding:1rem 0;">
           <button class="ptc-btn" id="hslExportEditBtn" onclick="hsl_exportEdit()">
             <span class="ptc-label">PUSH TO CRASH</span>
             <span class="ptc-arrow">&#10095;</span>
           </button>
         </div>`
      : '';
    box.innerHTML = `${actionBar}${header}<ul class="ramp-list">${items}</ul>${pageFooter}${shownPaginationBtns}${generatedFooter}${unresolvedSection}${pushToCrashBtn}`;
    box.scrollIntoView({ behavior: 'instant', block: 'start' });
  }

  function hsl_buildCoverPage() {
    const refIso  = document.getElementById('refDate').value;
    const fmtDate = (iso) => {
      if (!iso) return '';
      const [y, m, d] = iso.split('-');
      return `${Number(m)}/${Number(d)}/${y}`;
    };
    const n = new Date();
    const reportDate = `${Number(n.getMonth()+1)}/${Number(n.getDate())}/${n.getFullYear()}`;
    const district = document.getElementById('districtSelect').value || 'ALL';
    const county   = getDistrictCounty() || 'ALL';
    const route    = _routeLabel || 'ALL';
    const cpRow    = (name, val) =>
      `<tr><td class="cp-name">${esc(name)}</td><td class="cp-sep">:</td><td>${esc(val)}</td></tr>`;

    return `<div class="rs-cover">
      <div class="hsl-cover-agency">California Department of Transportation</div>
      <div class="hsl-cover-report-title">Highway Sequence Listing</div>
      <div class="rs-cover-section">
        <div class="rs-cover-section-label">REPORT PARAMETERS:</div>
        <table class="rs-cover-table">
          ${cpRow('REPORT DATE',    reportDate)}
          ${cpRow('REFERENCE DATE', fmtDate(refIso))}
          ${cpRow('DISTRICT',       district)}
          ${cpRow('COUNTY',         county)}
          ${cpRow('ROUTE',          route)}
        </table>
      </div>
      <div class="hsl-cover-note">
        <div class="hsl-cover-note-header">* * *  N O T E  * * *</div>
        <p>The landmark descriptions found in the TSMIS Sequence Listings are not correct at the
        Route Breaks, Equates, and possibly not correct at the County and District Boundaries.
        The problem seems to be intrinsic to TSMIS&#8217;s architecture and will take some time to
        remedy. Thank you for your patience.</p>
      </div>
      <div class="hsl-cover-policy">
        <p>Policy controlling the use of Traffic Accident Surveillance and Analysis System (TASAS) &#8211;
        Traffic Safety and Mobility Information System (TSMIS) Reports</p>
        <p>1. TASAS &#8211; TSMIS has officially replaced the TASAS &#8211; TSN database.</p>
        <p>2. Reports from TSMIS are to be used and interpreted by the California Department of
        Transportation (Caltrans) officials or authorized representative.</p>
        <p>3. Electronic versions of these reports may be emailed between Caltrans&#8217; employees only
        using the State computer system.</p>
        <p>4. The contents of these reports shall be considered confidential and may be privileged
        pursuant to 23 U.S.C. Section 409, and are for the sole use of the intended recipient(s).
        Any unauthorized review, use, disclosure or distribution is prohibited. If you are not the
        intended recipient, please contact the sender by reply e-mail and destroy all copies of the
        original message. Do not print, copy or forward.</p>
      </div>
    </div>`;
  }

  function hsl_buildLegendPage() {
    const row = (code, dash, desc) =>
      `<tr><td>${code}</td><td>${dash}</td><td>${desc}</td></tr>`;
    return `<div class="hsl-legend-page">
      <div class="hsl-legend-title">Legend</div>

      <table class="hsl-legend-hg-table"><tbody>
        <tr>
          <td style="vertical-align:middle; padding-right:0.5rem; line-height:1.8;">
            G<br>R &nbsp;= Highway<br>P &nbsp;&nbsp;&nbsp;&nbsp; Group
          </td>
          <td class="hsl-legend-hg-brace" style="width:0; padding:0;"></td>
          <td style="padding-left:0.6rem;">
            <table style="border-collapse:collapse;"><tbody>
              ${row('R','-','Right Independent Alignment')}
              ${row('L','-','Left Independent Alignment')}
              ${row('D','-','Divided Highway')}
              ${row('U','-','Undivided Highway')}
              ${row('X','-','Unconstructed Highway')}
            </tbody></table>
          </td>
        </tr>
        <tr><td style="height:0.6rem;"></td></tr>
        <tr>
          <td style="vertical-align:middle; padding-right:0.5rem; line-height:1.8;">
            F &nbsp;= File<br>T &nbsp;&nbsp;&nbsp;&nbsp; Type
          </td>
          <td class="hsl-legend-hg-brace" style="width:0; padding:0;"></td>
          <td style="padding-left:0.6rem;">
            <table style="border-collapse:collapse;"><tbody>
              ${row('H','-','Highway')}
              ${row('I','-','Intersection')}
              ${row('R','-','Ramp')}
            </tbody></table>
          </td>
        </tr>
      </tbody></table>

      <div class="hsl-legend-section-title">Route Suffix Codes</div>
      <table class="hsl-legend-codes"><tbody>
        ${row('S','&nbsp;-','Supplemental Route')}
        ${row('U','&nbsp;-','Unrelinquished Route')}
      </tbody></table>

      <div class="hsl-legend-section-title">Post Mile Prefix Codes</div>
      <table class="hsl-legend-codes"><tbody>
        ${row('C','&nbsp;-','Commercial lanes')}
        ${row('D','&nbsp;-','Duplicate post mile at meandering county line')}
        ${row('G','&nbsp;-','Reposting of duplicate post mile at the end of a route')}
        ${row('H','&nbsp;-','Realignment of D mileage')}
        ${row('L','&nbsp;-','Overlap post mile')}
        ${row('M','&nbsp;-','Realignment of R mileage')}
        ${row('N','&nbsp;-','Realignment of M mileage')}
        ${row('R','&nbsp;-','First realignment')}
        ${row('S','&nbsp;-','Spur')}
        ${row('T','&nbsp;-','Temporary connection')}
      </tbody></table>

      <div class="hsl-legend-section-title">Post Mile Suffix Codes</div>
      <table class="hsl-legend-codes"><tbody>
        ${row('E','&nbsp;-','Equation')}
      </tbody></table>

      <div class="hsl-legend-section-title">Font Color</div>
      <table class="hsl-legend-color-tbl"><tbody>
        <tr>
          <td class="lc-label">Red</td>
          <td>&nbsp;-</td>
          <td><span class="hsl-legend-eq">Equation</span></td>
        </tr>
        <tr>
          <td class="lc-label">Green</td>
          <td>&nbsp;-</td>
          <td><span class="hsl-legend-rb">End of District, County, Route, Independent Alignment, State Line or Route Break</span></td>
        </tr>
        <tr>
          <td class="lc-label">Blue</td>
          <td>&nbsp;-</td>
          <td><span class="hsl-legend-ia-r">Right Independent Alignment</span></td>
        </tr>
        <tr>
          <td class="lc-label">Purple</td>
          <td>&nbsp;-</td>
          <td><span class="hsl-legend-ia-l">Left Independent Alignment</span></td>
        </tr>
        <tr>
          <td class="lc-label">Bold Dark Red</td>
          <td>&nbsp;-</td>
          <td><span class="hsl-legend-pm-prefix">Post Mile Prefix (C,D,H,L,M,N,R,S and T)</span></td>
        </tr>
      </tbody></table>

      <table class="hsl-legend-bottom" style="margin-top:0.6rem;"><tbody>
        <tr><td>Length</td><td>&nbsp;-</td><td>The mileage to the next highway point</td></tr>
        <tr><td>&nbsp;&nbsp;*P*</td><td>&nbsp;-</td><td>At valid postmile on intersecting lower route</td></tr>
      </tbody></table>
    </div>`;
  }

  function hsl_printAll() {
    const box   = document.getElementById('rampResults');
    const saved = box.innerHTML;
    const lengths = _hslLengths ?? hsl_computeLengths(_allResults);

    const colgroup =
      `<colgroup>
         <col style="width:6%">
         <col style="width:8%">
         <col style="width:4%">
         <col style="width:7%">
         <col style="width:4%">
         <col style="width:2%">
         <col style="width:4%">
         <col style="width:13%">
         <col style="width:52%">
       </colgroup>`;
    const thead =
      `<thead>
         <tr>
           <th>County</th>
           <th>City</th>
           <th></th>
           <th>PM</th>
           <th></th>
           <th>HG</th>
           <th>FT</th>
           <th>Distance to<br>Next Point</th>
           <th>Description</th>
         </tr>
       </thead>`;

    const pageStarts = _hslPageStarts?.length ? _hslPageStarts : [0];
    const sections = pageStarts.map((start, idx) => {
      const end          = pageStarts[idx + 1] ?? _allResults.length;
      const pageSlice    = _allResults.slice(start, end);
      const pageDistrict = _allResults[start]?.district || '';
      const line3        = _routeLabel
        ? `${pageDistrict ? `District: ${esc(pageDistrict)}&emsp;&emsp;&emsp;` : ''}Route: ${esc(_routeLabel)}&emsp;&emsp;&emsp;Direction: ${esc(_directionFrom)} &ndash; ${esc(_directionTo)}`
        : '';
      const pageBreak = idx > 0 ? `<div style="break-before:page;"></div>` : '';
      const header =
        `<div class="hsl-print-header">
           <div class="hsl-print-header-line1">California Department of Transportation</div>
           <div class="hsl-print-header-line2">Highway Locations</div>
           ${line3 ? `<div class="hsl-print-header-line3">${line3}</div>` : ''}
         </div>`;
      const rows  = pageSlice.map((p, j) => hsl_renderItemAsRow(p, start + j, lengths)).join('');
      const table = `<table class="hsl-print-table">${colgroup}${thead}<tbody>${rows}</tbody></table>`;
      return `${pageBreak}${header}${table}`;
    }).join('');

    const generatedFooter = `<div class="generated-on">Generated on ${esc(_generatedOn)}</div>`;
    const unresolvedSection = renderUnresolvedSection(_unresolvedIntersections);
    const coverPage  = hsl_buildCoverPage();
    const legendPage = hsl_buildLegendPage();
    box.innerHTML = `${coverPage}${legendPage}${sections}${generatedFooter}${unresolvedSection}`;
    window.addEventListener('afterprint', () => { box.innerHTML = saved; }, { once: true });
    window.print();
  }

  async function hsl_exportEdit() {
    if (!tokenIsValid()) { login(); return; }
    if (!_routeLabel) return;
    const confirmed = await showConfirm(`Confirm update to route ${_routeLabel} in Crash Coding Module`);
    if (!confirmed) return;
    const btn = document.getElementById('hslExportEditBtn');
    btn.disabled = true;
    btn.querySelector('.ptc-label').textContent = 'PUSHING...';

    // Suspend reference date for this query
    const refDateEl = document.getElementById('refDate');
    const savedDate = refDateEl.value;
    refDateEl.value = '';

    try {
      const routeNum = _routeLabel;
      const { segments, routeSuffix } = buildHslSegments(routeNum);
      if (segments.length === 0) return;

      const [rampPairs, landmarkPairs, routeBreakPairs, { pairs: intersectionPairs }, equationPairs, cityBeginPairs] = await Promise.all([
        queryAttributeSet(segments),
        queryLandmarks(segments, routeSuffix),
        queryRouteBreaks(segments, routeSuffix),
        queryIntersections(segments, routeNum),
        queryEquationPoints(segments),
        queryCityBegins(segments, routeNum)
      ]);

      const unsortedPairs = [...rampPairs, ...landmarkPairs, ...routeBreakPairs, ...intersectionPairs, ...equationPairs, ...cityBeginPairs];
      const hgMapPre = await queryRangeLayer(unsortedPairs, 116, 'Highway_Group');
      for (const p of unsortedPairs) p.hgValue = hgMapPre.get(p.name) ?? '';
      const allPairs = hsl_filterRealignmentLandmarks(hsl_filterCityBoundaries(sortWithIndependentAlignments(unsortedPairs)));
      if (allPairs.length === 0) return;

      // Capture routeId/arMeasure before any merging; default to null so missing entries fail visibly
      const routeIdMap   = new Map(allPairs.map(p => [p.name, p.routeId   ?? null]));
      const arMeasureMap = new Map(allPairs.map(p => [p.name, p.arMeasure ?? null]));

      // Fetch ramp descriptions (no date filter — refDate already cleared)
      const rampsOnly = allPairs.filter(p => p.type === 'ramp');
      const descMap = new Map();
      if (rampsOnly.length > 0) {
        const CHUNK = 100;
        const chunks = chunkArray(rampsOnly, CHUNK);
        const allDescFeatures = (await Promise.all(chunks.map(async chunk => {
          const inList = chunk.map(p => `'${p.name.replace(/'/g, "''")}'`).join(', ');
          const body = new URLSearchParams({
            where:          `Ramp_Name IN (${inList})`,
            outFields:      'Ramp_Name,Ramp_Description',
            returnGeometry: 'false',
            f:              'json',
            token:          _token
          });
          try {
            const resp = await fetch(`${CONFIG.mapServiceUrl}/131/query`, {
              method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
            });
            const data = await resp.json();
            return Array.isArray(data.features) ? data.features : [];
          } catch { return []; }
        }))).flat();
        for (const f of allDescFeatures) {
          const n = f.attributes?.Ramp_Name;
          if (n != null && !descMap.has(n)) descMap.set(n, f.attributes?.Ramp_Description ?? '');
        }
      }

      const [hwyMap, cityMap] = await Promise.all([
        Promise.resolve(hgMapPre),
        queryRangeLayer(allPairs, 74,  'City_Code')
      ]);
      const odMap = translateToOD(allPairs);

      const results = allPairs.map((p, i) => {
        let hwyGroup = hwyMap.get(p.name) ?? '';
        let cityCode  = (p.type === 'citybegin' || p.type === 'cityend') ? (p.cityCode ?? '') : (cityMap.get(p.name) ?? '');
        if (p.type === 'routebreak' && p.desc === 'Route Break' && (!hwyGroup || !cityCode)) {
          const resume = allPairs.slice(i + 1).find(r => r.type === 'routebreak' && r.desc === 'Route Resume');
          if (resume) {
            if (!hwyGroup) hwyGroup = hwyMap.get(resume.name) ?? '';
            if (!cityCode)  cityCode  = cityMap.get(resume.name) ?? '';
          }
        }
        return {
          routeId:     routeIdMap.get(p.name)   ?? null,
          arMeasure:   arMeasureMap.get(p.name) ?? null,
          name:        p.name,
          type:        p.type,
          featureType: p.type === 'equation' ? 'H' : p.type === 'landmark' ? 'H' : p.type === 'routebreak' ? 'H' : p.type === 'citybegin' ? 'H' : p.type === 'cityend' ? 'H' : p.type === 'intersection' ? 'I' : 'R',
          isCross:     p.isCross    ?? false,
          isSecondEq:  p.isSecondEq ?? false,
          desc:        (() => {
            const base = p.type === 'ramp' ? (descMap.get(p.name) ?? '') : (p.desc ?? '');
            if (p.type === 'intersection' && p.crossPmMeasure != null) {
              const pm = parseFloat(p.crossPmMeasure);
              return isNaN(pm) ? base : `${base} (${p.crossRouteLabel ?? 'PM'} ${pm.toFixed(3)})`;
            }
            return base;
          })(),
          hwyGroup,
          cityCode,
          county:    p.county      ?? '',
          district:  p.district    ?? '',
          pmPrefix:  p.pmPrefix    ?? '',
          pmSuffix:  p.pmSuffix    ?? '.',
          pmMeasure: p.pmMeasure,
          odMeasure: p.odMeasure   ?? ''
        };
      });

      const lengths = hsl_computeLengths(results);
      const nowMs = Date.now();
      const adds = results.map((p, i) => {
        const length = lengths[i];
        const rId = p.routeId || '';
        const m = rId.match(/^SHS_(\d+)([^_]*)_([PS])$/);
        const rNum    = m ? m[1] : null;
        const rSuffix = m ? (m[2] || '.') : null;
        const align   = m ? (m[3] === 'P' ? 'R' : 'L') : null;
        return {
          attributes: {
            routeId:            p.routeId    ?? null,
            fromMeasure:        p.arMeasure  ?? null,
            District_Code:      p.district   ? parseInt(p.district, 10) : null,
            City_Code:          p.cityCode   || null,
            Highway_Group:      p.pmSuffix === 'L' ? 'L' : (p.hwyGroup || null),
            FileType:           p.featureType || null,
            hslDescription:     p.desc       || null,
            distToNextLandmark: length !== '' ? parseFloat(length) : null,
            County:             p.county     || null,
            RouteNum:           rNum,
            RouteSuffix:        rSuffix,
            PMPrefix:           (p.pmPrefix && p.pmPrefix !== '.') ? p.pmPrefix : null,
            PMSuffix:           p.pmSuffix   || null,
            Alignment:          align,
            PMMeasure:          p.pmMeasure !== '' && p.pmMeasure != null ? parseFloat(p.pmMeasure) : null,
            LRSFromDate:        nowMs,
            LRSToDate:          null
          }
        };
      });

      // Resolve point geometry by querying AllRoads network (layer 4) for route polylines,
      // then interpolating each record's point at its measure value (M coordinate).
      try {
        // Get layer 215 spatial reference
        const fsInfoResp = await fetch(`${CONFIG.featureServiceUrl}/215?f=json&token=${_token}`);
        const fsInfo = await fsInfoResp.json();
        const outSR = fsInfo.extent?.spatialReference?.wkid || fsInfo.sourceSpatialReference?.wkid || 4326;

        // Use LRS measureToGeometry to get point geometry for each record
        const GEOM_CHUNK = 100;
        for (let i = 0; i < adds.length; i += GEOM_CHUNK) {
          const chunk = adds.slice(i, i + GEOM_CHUNK);
          const locations = chunk.map(a => ({
            routeId: a.attributes.routeId,
            measure: a.attributes.fromMeasure
          }));
          try {
            const params = new URLSearchParams({ locations: JSON.stringify(locations), outSR: String(outSR), f: 'json', token: _token });
            const geomResp = await fetch(`${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/4/measureToGeometry?${params}`);
            const geomData = await geomResp.json();
            if (geomData.error) {
              console.error('[Push to Crash] measureToGeometry error:', geomData.error.code, geomData.error.message, geomData.error.details);
            } else {
              (geomData.locations || []).forEach((loc, idx) => {
                if (loc.geometry) chunk[idx].geometry = { ...loc.geometry, spatialReference: { wkid: outSR } };
              });
            }
          } catch (e) {
            console.warn('[Push to Crash] measureToGeometry chunk failed:', e);
          }
        }
      } catch (e) {
        console.warn('[Push to Crash] Geometry resolution failed:', e);
      }

      const gdbVersion = getVersion();

      // Delete existing records for the same routeId(s) before inserting
      const pushRouteIds = [...new Set(adds.map(a => a.attributes.routeId).filter(Boolean))];
      const inList = pushRouteIds.map(r => `'${r.replace(/'/g, "''")}'`).join(',');
      const delQuery = await (await fetch(`${CONFIG.featureServiceUrl}/215/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ where: `routeId IN (${inList})`, outFields: 'OBJECTID', returnGeometry: 'false', gdbVersion, f: 'json', token: _token }).toString()
      })).json();
      if (delQuery.error) {
        alert(`Query failed (${delQuery.error.code}): ${delQuery.error.message}`);
        return;
      }
      const existingOids = (delQuery.features || []).map(f => f.attributes.OBJECTID);
      if (existingOids.length > 0) {
        const DEL_CHUNK = 500;
        let totalDeleted = 0;
        for (let i = 0; i < existingOids.length; i += DEL_CHUNK) {
          const delBody = new URLSearchParams({
            deletes:           JSON.stringify(existingOids.slice(i, i + DEL_CHUNK)),
            gdbVersion,
            rollbackOnFailure: 'false',
            f:                 'json',
            token:             _token
          });
          const delResp = await (await fetch(`${CONFIG.featureServiceUrl}/215/applyEdits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: delBody.toString()
          })).json();
          if (delResp.error) {
            const details = Array.isArray(delResp.error.details) ? delResp.error.details : [];
            details.forEach((d, idx) => console.error(`[Push to Crash] Delete detail[${idx}]:`, d));
            alert(`Delete failed (${delResp.error.code}): ${delResp.error.message}\n${details.join('\n')}`);
            return;
          }
          totalDeleted += (delResp.deleteResults || []).filter(r => r.success).length;
          (delResp.deleteResults || []).filter(r => !r.success).forEach((r, idx) => console.error(`[Push to Crash] Delete row error[${idx}]:`, JSON.stringify(r)));
        }
      }

      let totalAdded = 0, totalErrors = 0;
      const CHUNK = 500;
      for (let i = 0; i < adds.length; i += CHUNK) {
        const chunk = adds.slice(i, i + CHUNK);
        const body = new URLSearchParams({
          adds:              JSON.stringify(chunk),
          gdbVersion,
          rollbackOnFailure: 'false',
          f:                 'json',
          token:             _token
        });
        const resp = await fetch(`${CONFIG.featureServiceUrl}/215/applyEdits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        });
        const data = await resp.json();
        if (data.error) {
          const details = Array.isArray(data.error.details) ? data.error.details : [];
          console.error('[Push to Crash] Service error code:', data.error.code, 'extendedCode:', data.error.extendedCode);
          details.forEach((d, idx) => console.error(`[Push to Crash] Detail[${idx}]:`, d));
          alert(`Push failed (${data.error.code}): ${data.error.message}\n${details.join('\n')}`);
          return;
        }
        const addResults = Array.isArray(data.addResults) ? data.addResults : [];
        totalAdded  += addResults.filter(r => r.success).length;
        totalErrors += addResults.filter(r => !r.success).length;
        addResults.filter(r => !r.success).forEach((r, idx) => console.error(`[Push to Crash] Row error[${idx}]:`, JSON.stringify(r)));
      }

      if (totalErrors > 0) {
        alert(`Push completed: ${totalAdded} added, ${totalErrors} error(s). Check console for details.`);
      } else {
        alert(`Successfully pushed ${totalAdded} record(s) to layer 215.`);
      }
    } finally {
      refDateEl.value = savedDate;
      btn.disabled = false;
      btn.querySelector('.ptc-label').textContent = 'PUSH TO CRASH';
    }
  }

  function hsl_exportToExcel() {
    if (_allResults.length === 0) return;
    const headers = ['County', 'City', '', 'PM', '', 'HG', 'FT', 'Distance To Next Point', 'Description'];
    // TODO: hsl_printAll and hsl_exportToExcel both call hsl_computeLengths independently.
    // Consider sharing _hslLengths (already cached for the screen view) instead of recomputing here.
    const lengths = hsl_computeLengths(_allResults);
    const rows = _allResults.map((p, i) => {
      const length = lengths[i];
      return [
        p.county      ?? '',
        p.cityCode    ?? '',
        (p.pmPrefix && p.pmPrefix !== '.') ? p.pmPrefix : '',
        padMeasure(p.pmMeasure),
        p.pmSuffix === 'E' ? 'E' : '',
        p.pmSuffix === 'L' ? 'L' : (p.hwyGroup ?? ''),
        p.featureType ?? '',
        p.isCross ? '*P*' : p.featureType !== 'R' && p.featureType !== 'I' && length !== '' ? padMeasure(length) : '',
        p.desc        ?? ''
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Highway Locations');
    XLSX.writeFile(wb, 'highway_sequence_listing.xlsx');
  }
