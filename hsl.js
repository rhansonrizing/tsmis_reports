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
      outFields:      'Landmarks_Short,Landmarks_Long,RouteID,ARMeasure,County,RouteSuffix,PMPrefix,PMSuffix,PMMeasure,ODMeasure,District,InventoryItemStartDate,InventoryItemEndDate',
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
      const long = a.Landmarks_Long;
      const desc = (long != null && long !== '') ? `${name}, ${long}` : name;
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
        startDate:   a.InventoryItemStartDate ?? null,
        endDate:     a.InventoryItemEndDate   ?? null
      };
      const existing = nameMap.get(key);
      if (!existing || (pair.county !== '' && existing.county === '')) {
        nameMap.set(key, pair);
      }
    }
    return Array.from(nameMap.values());
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
    const segClauses = segments.map(({ fromBest, toBest }) => {
      const rid   = fromBest.routeId.endsWith('_S') ? fromBest.routeId.slice(0, -2) + '_P' : fromBest.routeId;
      const fromM = Math.min(fromBest.measure, toBest.measure) - 0.005;
      const toM   = Math.max(fromBest.measure, toBest.measure) + 0.005;
      return `(RouteID = '${rid}' AND FromARMeasure <= ${toM} AND ToARMeasure >= ${fromM})`;
    });
    // Layer 74 is filtered by RouteID + measure range only — it does not carry
    // District/County fields so those filters are omitted.
    const dateFilter = getDateFilter();
    const where = segClauses.length === 1
      ? segClauses[0].slice(1, -1) + dateFilter
      : `(${segClauses.join(' OR ')})${dateFilter}`;
    const body = new URLSearchParams({
      where,
      outFields:      'RouteID,FromARMeasure,ToARMeasure,City_Code,BeginPMPrefix,BeginPMMeasure,BeginCounty,EndPMPrefix,EndPMMeasure,EndCounty,District',
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
      return [
        {
          type:        'citybegin',
          name:        `cb_${a.RouteID}_${a.FromARMeasure}`,
          desc:        cityCode ? `CITY BEGIN: ${cityCode}` : 'CITY BEGIN',
          routeId:     a.RouteID,
          arMeasure:   a.FromARMeasure,
          county:      a.BeginCounty   ?? '',
          routeSuffix: '',
          pmPrefix:    a.BeginPMPrefix ?? '',
          pmSuffix:    '.',
          pmMeasure:   a.BeginPMMeasure != null ? String(a.BeginPMMeasure) : '',
          odMeasure:   '',
          district:    fmtDistrict(a),
          cityCode,
          startDate:   null,
          endDate:     null
        },
        {
          type:        'cityend',
          name:        `ce_${a.RouteID}_${a.ToARMeasure}`,
          desc:        cityCode ? `CITY END: ${cityCode}` : 'CITY END',
          routeId:     a.RouteID,
          arMeasure:   a.ToARMeasure,
          county:      a.EndCounty   ?? '',
          routeSuffix: '',
          pmPrefix:    a.EndPMPrefix ?? '',
          pmSuffix:    '.',
          pmMeasure:   a.EndPMMeasure != null ? String(a.EndPMMeasure) : '',
          odMeasure:   '',
          district:    fmtDistrict(a),
          cityCode,
          startDate:   null,
          endDate:     null
        }
      ];
    });

    // Translate AR → OD to get the sort position for each city boundary point.
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
      const segRouteIds  = new Set(segments.map(s => s.fromBest.routeId));
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
      for (const f of mainResults) {
        const a = f.attributes ?? {};
        if (a.INTERSECTION_ID == null) continue;
        if ((a.Main_RouteSuffix ?? '') !== routeSuffix) continue;
        const pmPrefix     = a.Main_PMPrefix  ?? '';
        const pmSuffix     = a.Main_PMSuffix  ?? '.';
        const pmMeasureVal = a.Main_PMMeasure ?? '';
        const pmRouteId    = (a.County_Code ?? '.') + routeNumDigits + (routeSuffix || '.') + (a.Main_PMPrefix ?? '.') + (a.Main_PMSuffix ?? '.') + (a.Main_PMSuffix === 'L' ? 'L' : (a.Main_Alignment ?? '.'));
        detailMap.set(a.INTERSECTION_ID, {
          desc:      a.Intersection_Name ?? '',
          county:    a.County_Code       ?? '',
          district:  a.District_Code ? String(a.District_Code).padStart(2, '0') : '',
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
          desc:      a.Intersection_Name ?? '',
          county:    a.County_Code       ?? '',
          district:  a.District_Code ? String(a.District_Code).padStart(2, '0') : '',
          pmPrefix, pmSuffix, pmMeasure: pmMeasureVal, pmRouteId, isCross: true
        });
      }
      if (detailMap.size === 0) return { pairs: [], unresolved: [] };
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
        for (const f of qData.features ?? []) {
          const id = f.attributes?.INTERSECTION_ID;
          if (id != null && f.geometry && !geometryMap.has(id)) geometryMap.set(id, f.geometry);
        }
      }));
      if (geometryMap.size === 0) return { pairs: [], unresolved: [] };
      // Chunk g2m to avoid oversized payloads when querying the full route without a county filter.
      const measuredIds  = Array.from(geometryMap.keys());
      const G2M_CHUNK    = 200;
      const g2mChunks    = chunkArray(measuredIds, G2M_CHUNK);
      const idToMeasure  = new Map();
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
          if (result?.routeId && result.measure != null) {
            idToMeasure.set(id, { routeId: result.routeId, arMeasure: result.measure });
          }
        });
      }
      // Only translate intersections that g2m confirmed are on the route.
      // IDs in detailMap but not idToMeasure failed to snap to the route and are dropped.
      const matchedIds  = Array.from(idToMeasure.keys());
      const XLATE_CHUNK = 100;
      const xlateChunks = chunkArray(matchedIds, XLATE_CHUNK);
      const idToOdMeasure = new Map();
      // Translate from AR network (4) → OD network (5) using the g2m-confirmed AR location.
      // Avoids PM-prefix ambiguity (e.g. 'D' duplicate postmile routes) where PM→OD translate
      // returns multiple translated locations and may pick the wrong route's OD measure.
      await Promise.all(xlateChunks.map(async chunk => {
        const locs = chunk.map(id => {
          const m = idToMeasure.get(id);
          return { routeId: m.routeId, measure: m.arMeasure };
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
          `${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/4/translate`,
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
      console.error('[queryIntersectionsByDistrict] error:', e.message);
      return { pairs: [], unresolved: [] };
    }
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
      const allPairs = sortWithIndependentAlignments(unsortedPairs);
      if (allPairs.length === 0) { hsl_showRampResults('none'); return; }
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
      const allPairs = sortWithIndependentAlignments(unsortedPairs);
      if (allPairs.length === 0) { hsl_showRampResults('none'); return; }
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
        desc:        p.type === 'ramp' ? (descMap.get(p.name) ?? '') : p.desc,
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
      hsl_renderPage();
    }
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
    const hgAndF  = isEq1
      ? `<span style="grid-column: 7 / -1;">EQUATES TO</span>`
      : `<span>${p.pmSuffix === 'L' ? 'L' : p.hwyGroup ? esc(p.hwyGroup) : ''}</span>
         <span>${p.featureType}</span>`;
    return `<li class="ramp-item hsl-ramp-col-template">
         <span>${p.district    ? esc(p.district)        : ''}</span>
         <span>${p.county      ? esc(String(p.county)) : ''}</span>
         <span>${p.cityCode    ? esc(p.cityCode)        : ''}</span>
         <span style="text-align:right;">${p.pmPrefix && p.pmPrefix !== '.' ? esc(p.pmPrefix) : ''}</span>
         <span style="text-align:center;">${esc(padMeasure(p.pmMeasure))}</span>
         <span style="justify-self:start;">${p.pmSuffix === 'E' ? 'E' : ''}</span>
         ${hgAndF}
         ${isEq1 ? '' : `<span style="display:block;text-align:center;">${p.isCross ? '*P*' : p.featureType !== 'R' && p.featureType !== 'I' && length !== '' ? padMeasure(length) : ''}</span>`}
         ${isEq1 ? '' : `<span style="text-align:left;">${p.desc ? esc(p.desc) : ''}</span>`}
         <span style="color:#999;font-size:0.8em;">${p.odMeasure ? esc(parseFloat(p.odMeasure).toFixed(3)) : ''}</span>
       </li>`;
  }

  function hsl_renderItemAsRow(p, idx, lengths) {
    const length = lengths[idx];
    const isEq1  = p.type === 'equation' && !p.isSecondEq;
    const distToNext = p.isCross ? '*P*'
      : p.featureType !== 'R' && p.featureType !== 'I' && length !== '' ? padMeasure(length) : '';
    return `<tr>
      <td>${p.district  ? esc(p.district)        : ''}</td>
      <td>${p.county    ? esc(String(p.county))   : ''}</td>
      <td>${p.cityCode  ? esc(p.cityCode)         : ''}</td>
      <td style="text-align:right">${p.pmPrefix && p.pmPrefix !== '.' ? esc(p.pmPrefix) : ''}</td>
      <td style="text-align:center">${esc(padMeasure(p.pmMeasure))}</td>
      <td>${p.pmSuffix === 'E' ? 'E' : ''}</td>
      ${isEq1
        ? `<td colspan="4" style="text-align:center">EQUATES TO</td>`
        : `<td>${p.pmSuffix === 'L' ? 'L' : p.hwyGroup ? esc(p.hwyGroup) : ''}</td>
           <td>${p.featureType ? esc(p.featureType) : ''}</td>
           <td style="text-align:center">${distToNext}</td>
           <td style="text-align:left">${p.desc ? esc(p.desc) : ''}</td>`
      }
      <td style="color:#999;font-size:0.8em;">${p.odMeasure ? esc(parseFloat(p.odMeasure).toFixed(3)) : ''}</td>
    </tr>`;
  }

  function hsl_renderPage() {
    const box = document.getElementById('rampResults');
    box.style.display = 'block';
    box.className     = 'ramp-results';
    const totalPages = Math.ceil(_allResults.length / PAGE_SIZE);
    const page       = _currentPage;
    const start      = page * PAGE_SIZE;
    const pageSlice  = _allResults.slice(start, start + PAGE_SIZE);
    const prevDis = page === 0              ? 'disabled' : '';
    const nextDis = page === totalPages - 1 ? 'disabled' : '';
    const routeLine3 = _routeLabel ? `Route: ${esc(_routeLabel)}&emsp;&emsp;&emsp;Direction: ${esc(_directionFrom)} &ndash; ${esc(_directionTo)}` : '';
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
         <span>Dist</span>
         <span>County</span>
         <span>City</span>
         <span></span>
         <span>PM</span>
         <span></span>
         <span style="padding-left:4ch">HG</span>
         <span style="padding-left:4ch">F</span>
         <span style="padding-left:5ch">DISTANCE TO<br>NEXT POINT</span>
         <span style="padding-left:5ch">Description</span>
         <span style="padding-left:2ch">Odometer</span>
       </div>`;
    const lengths = _hslLengths ?? hsl_computeLengths(_allResults);
    const items = pageSlice.map((p, i) => hsl_renderItem(p, start + i, lengths)).join('');
    const pageFooter = totalPages > 1
      ? `<div class="page-info">Page ${page + 1} of ${totalPages}</div>`
      : '';
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
    box.innerHTML = `${actionBar}${header}<ul class="ramp-list">${items}</ul>${pageFooter}${paginationBtns}${generatedFooter}${unresolvedSection}${pushToCrashBtn}`;
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

  function hsl_printAll() {
    const box   = document.getElementById('rampResults');
    const saved = box.innerHTML;
    const routeLine3  = _routeLabel ? `Route: ${esc(_routeLabel)}&emsp;&emsp;&emsp;Direction: ${esc(_directionFrom)} &ndash; ${esc(_directionTo)}` : '';
    const reportTitle = renderActionBar('California Department of Transportation', 'Highway Locations', routeLine3, null, null);
    const lengths = _hslLengths ?? hsl_computeLengths(_allResults);
    const rows    = _allResults.map((p, i) => hsl_renderItemAsRow(p, i, lengths)).join('');
    const table   =
      `<table class="hsl-print-table">
         <colgroup>
           <col style="width:5%">
           <col style="width:6%">
           <col style="width:8%">
           <col style="width:4%">
           <col style="width:7%">
           <col style="width:4%">
           <col style="width:2%">
           <col style="width:4%">
           <col style="width:13%">
           <col style="width:38%">
           <col style="width:9%">
         </colgroup>
         <thead>
           <tr>
             <th>Dist</th>
             <th>County</th>
             <th>City</th>
             <th></th>
             <th>PM</th>
             <th></th>
             <th>HG</th>
             <th>F</th>
             <th>Distance to<br>Next Point</th>
             <th>Description</th>
             <th>Odometer</th>
           </tr>
         </thead>
         <tbody>${rows}</tbody>
       </table>`;
    const generatedFooter = `<div class="generated-on">Generated on ${esc(_generatedOn)}</div>`;
    const unresolvedSection = renderUnresolvedSection(_unresolvedIntersections);
    const coverPage = hsl_buildCoverPage();
    box.innerHTML = `${coverPage}${reportTitle}${table}${generatedFooter}${unresolvedSection}`;
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
      const allPairs = sortWithIndependentAlignments(unsortedPairs);
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
          desc:        p.type === 'ramp' ? (descMap.get(p.name) ?? '') : (p.desc ?? ''),
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
            PMMeasure:          p.pmMeasure  ?? null,
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
    const headers = ['Dist', 'County', 'City', '', 'PM', '', 'HG', 'F', 'Distance To Next Point', 'Description'];
    // TODO: hsl_printAll and hsl_exportToExcel both call hsl_computeLengths independently.
    // Consider sharing _hslLengths (already cached for the screen view) instead of recomputing here.
    const lengths = hsl_computeLengths(_allResults);
    const rows = _allResults.map((p, i) => {
      const length = lengths[i];
      return [
        p.district    ?? '',
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
