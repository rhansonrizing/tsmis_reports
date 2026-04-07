  // ── TSAR: Ramp Detail — Query & result pipeline ──────────────────────────

  async function queryRampDescriptions(allPairs) {
    const fetchDescriptions = async () => {
      const descMap   = new Map();
      const area4Map  = new Map();
      const onOffMap      = new Map();
      const rampDesignMap = new Map();
      if (allPairs.length === 0) return { descMap, area4Map, onOffMap, rampDesignMap };
      const CHUNK = 100;
      const chunks = chunkArray(allPairs, CHUNK);
      const allDescFeatures = (await Promise.all(chunks.map(async chunk => {
        const inList = chunk.map(p => `'${p.name.replace(/'/g, "''")}'`).join(', ');
        const body = new URLSearchParams({
          where:          `Ramp_Name IN (${inList})${getDateFilter()}`,
          outFields:      'Ramp_Name,Ramp_Description,Area4_Ind,Ramp_On_Off_Ind,Ramp_Design',
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
            console.error(`[queryRampDesc] API error ${code}: ${data.error.message}`);
            return [];
          }
          return Array.isArray(data.features) ? data.features : [];
        } catch (e) {
          console.error('[queryRampDesc] error:', e.message);
          return [];
        }
      }))).flat();
      for (const f of allDescFeatures) {
        const n = f.attributes?.Ramp_Name;
        if (n == null) continue;
        if (!descMap.has(n))   descMap.set(n,   f.attributes?.Ramp_Description ?? '');
        if (!area4Map.has(n))  area4Map.set(n,  f.attributes?.Area4_Ind        ?? null);
        if (!onOffMap.has(n))      onOffMap.set(n,      f.attributes?.Ramp_On_Off_Ind ?? null);
        if (!rampDesignMap.has(n)) rampDesignMap.set(n, f.attributes?.Ramp_Design     ?? '');
      }
      return { descMap, area4Map, onOffMap, rampDesignMap };
    };

    const [{ descMap, area4Map, onOffMap, rampDesignMap }, hwyMap, cityMap, popMap, odMap, { aadtYearMap, aadtMap }] = await Promise.all([
      fetchDescriptions(),
      queryRangeLayer(allPairs, 116, 'Highway_Group'),
      queryRangeLayer(allPairs, 74,  'City_Code'),
      queryRangeLayer(allPairs, 130, 'Population_Code'),
      translateToOD(allPairs),
      queryAadt(allPairs)
    ]);

    const results = allPairs.map((p) => {
      return ({
      name:        p.name,
      featureType: 'R',
      desc:        descMap.get(p.name)  ?? '',
      hwyGroup:    hwyMap.get(p.name)   ?? '',
      area4:       area4Map.get(p.name) ?? null,
      cityCode:    cityMap.get(p.name)  ?? '',
      popCode:     popMap.get(p.name)   ?? '',
      onOff:       onOffMap.get(p.name)       ?? null,
      rampDesign:  rampDesignMap.get(p.name) ?? '',
      aadtYear:    aadtYearMap.get(p.name) ?? '',
      aadt:        aadtMap.get(p.name)     ?? null,
      county:      p.county,
      district:    p.district ?? '',
      routeSuffix: p.routeSuffix,
      pmPrefix:    p.pmPrefix ?? '',
      pmSuffix:    p.pmSuffix ?? '.',
      pmMeasure:   p.pmMeasure,
      odMeasure:   odMap.get(p.name)   ?? '',
      startDate:   p.startDate,
      endDate:     p.endDate
      });
    });

    const onOffFilter = getOnOffFilter();
    const filtered = onOffFilter === null ? results : results.filter(r => r.onOff === onOffFilter);
    showRampResults('success', null, filtered);
  }

  // Returns a Map of name → OD measure.
  // OD measures are pre-populated on pairs that carry them (landmarks, equation points).
  // Types without an OD measure (ramps, intersections) will have an empty string.
  function translateToOD(allPairs) {
    return new Map(allPairs.map(p => [p.name, p.odMeasure ?? '']));
  }

  // Returns a Map of name → fieldName value for range-based event layers (e.g. 116, 74)
  // For _S records, both _P and _S RouteIDs are queried — city/HG ranges on L independent
  // alignments may be stored under _S and would be missed if only _P is queried.
  async function queryRangeLayer(pairs, layerNum, fieldName, fromField = 'FromARMeasure', toField = 'ToARMeasure') {
    const CHUNK = 100;
    const chunks = chunkArray(pairs, CHUNK);

    const allFeatures = (await Promise.all(chunks.map(async chunk => {
      const clauseSet = new Set();
      for (const p of chunk) {
        const isS = p.routeId.endsWith('_S');
        const rid  = isS ? p.routeId.slice(0, -2) + '_P' : p.routeId;
        const ridS = isS ? p.routeId : null;
        // Prefer odMeasure for the range lookup — it reflects the OD position on
        // the main alignment and avoids the _S→_P translation mismatch that can
        // place a feature inside the wrong highway-group / city-code segment.
        const m = (p.odMeasure !== '' && p.odMeasure != null) ? parseFloat(p.odMeasure) : p.arMeasure;
        clauseSet.add(`(RouteID = '${rid}' AND ${fromField} <= ${m} AND ${toField} >= ${m})`);
        // For _S records also query the _S RouteID — city ranges on L independent
        // alignments are stored against _S and won't appear under _P.
        if (ridS) clauseSet.add(`(RouteID = '${ridS}' AND ${fromField} <= ${m} AND ${toField} >= ${m})`);
      }
      const orClauses = [...clauseSet].join(' OR ');
      const body = new URLSearchParams({
        where:          `(${orClauses})${getDateFilter()}`,
        outFields:      `RouteID,${fromField},${toField},${fieldName}`,
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
          console.error(`[queryRangeLayer/${layerNum}] API error ${code}: ${data.error.message}`);
          return [];
        }
        return Array.isArray(data.features) ? data.features : [];
      } catch (e) {
        console.error(`[queryRangeLayer/${layerNum}] error:`, e.message);
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
      const isS       = p.routeId.endsWith('_S');
      const lookupId  = isS ? p.routeId.slice(0, -2) + '_P' : p.routeId;
      const lookupIdS = isS ? p.routeId : null;
      const m = (p.odMeasure !== '' && p.odMeasure != null) ? parseFloat(p.odMeasure) : p.arMeasure;
      const candidatesP = byRoute.get(lookupId)  ?? [];
      const candidatesS = lookupIdS ? (byRoute.get(lookupIdS) ?? []) : [];
      const tryMatch = (cands) => cands.filter(f => {
        const from = f.attributes?.[fromField];
        const to   = f.attributes?.[toField];
        return from != null && to != null && m >= from && m <= to;
      });
      // For _S records prefer _S candidates (city stored on secondary alignment);
      // fall back to _P candidates if no _S match found.
      let matches = isS ? tryMatch(candidatesS) : [];
      if (matches.length === 0) matches = tryMatch(candidatesP);
      // For independent-alignment records the OD measure projects onto the main alignment
      // and can exceed the layer's AR-based range boundary. Fall back to AR measure when
      // the OD lookup returns nothing and AR differs from OD.
      if (matches.length === 0 && p.arMeasure != null && p.arMeasure !== m) {
        if (isS) matches = candidatesS.filter(f => {
          const from = f.attributes?.[fromField];
          const to   = f.attributes?.[toField];
          return from != null && to != null && p.arMeasure >= from && p.arMeasure <= to;
        });
        if (matches.length === 0) matches = candidatesP.filter(f => {
          const from = f.attributes?.[fromField];
          const to   = f.attributes?.[toField];
          return from != null && to != null && p.arMeasure >= from && p.arMeasure <= to;
        });
      }
      // When multiple ranges share the same boundary point, prefer the one whose
      // from-measure is highest — i.e. the range that *starts* at the boundary
      // rather than the range that merely *ends* there.
      const match = matches.length > 1
        ? matches.reduce((best, f) => f.attributes[fromField] > best.attributes[fromField] ? f : best)
        : matches[0];
      map.set(p.name, match?.attributes?.[fieldName] ?? '');
    }
    return map;
  }

  // Returns { aadtYearMap, aadtMap } from layer 157 for the given pairs
  async function queryAadt(pairs) {
    const aadtYearMap = new Map();
    const aadtMap     = new Map();
    if (pairs.length === 0) return { aadtYearMap, aadtMap };

    // Query layer 157 spatially using bounding envelope of each chunk's ramp geometries
    const CHUNK = 50;
    const chunks = chunkArray(pairs, CHUNK);

    const allFeatures = (await Promise.all(chunks.map(async chunk => {
      const withGeo = chunk.filter(p => p.x != null && p.y != null);
      if (withGeo.length === 0) return [];
      const xMin = Math.min(...withGeo.map(p => p.x));
      const xMax = Math.max(...withGeo.map(p => p.x));
      const yMin = Math.min(...withGeo.map(p => p.y));
      const yMax = Math.max(...withGeo.map(p => p.y));
      const envelope = JSON.stringify({ xmin: xMin, ymin: yMin, xmax: xMax, ymax: yMax, spatialReference: { wkid: 3310 } });
      const body = new URLSearchParams({
        where:          '1=1',
        geometry:       envelope,
        geometryType:   'esriGeometryEnvelope',
        spatialRel:     'esriSpatialRelIntersects',
        outFields:      'OBJECTID,LRSFromDate,AADT_YEAR,AADT',
        returnGeometry: 'true',
        ...versionParam(),
        f:              'json',
        token:          _token
      });
      try {
        const resp = await fetch(`${CONFIG.mapServiceUrl}/157/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
        });
        const data = await resp.json();
        if (data.error) {
          const code = data.error.code;
          if (code === 498 || code === 499) { _token = null; login(); }
          console.error(`[queryAadt] API error ${code}: ${data.error.message}`);
          return [];
        }
        return Array.isArray(data.features) ? data.features : [];
      } catch (e) {
        console.error('[queryAadt] error:', e.message);
        return [];
      }
    }))).flat();

    // For each ramp, find the layer 157 feature at the same x,y location,
    // picking the most recent LRSFromDate when multiple records share that point
    for (const p of pairs) {
      if (p.x == null || p.y == null) continue;
      const candidates = allFeatures.filter(f => {
        const fx = f.geometry?.x;
        const fy = f.geometry?.y;
        return fx != null && fy != null &&
               Math.abs(fx - p.x) < 0.01 && Math.abs(fy - p.y) < 0.01;
      });
      const match = candidates.reduce((best, f) => {
        if (!best) return f;
        return (f.attributes?.LRSFromDate ?? 0) > (best.attributes?.LRSFromDate ?? 0) ? f : best;
      }, null);
      aadtYearMap.set(p.name, match?.attributes?.AADT_YEAR ?? '');
      aadtMap.set(p.name,     match?.attributes?.AADT      ?? null);
    }
    return { aadtYearMap, aadtMap };
  }

  // ── TSAR: Ramp Detail — Result display ───────────────────────────────────

  function showRampResults(type, message, names) {
    const box = document.getElementById('rampResults');
    box.style.display = 'block';

    if (type === 'error') {
      box.className = 'ramp-results error';
      box.innerHTML = esc(message);
    } else if (type === 'none') {
      box.className = 'ramp-results';
      box.innerHTML = `<span class="ramp-empty">No ramps found in this segment.</span>`;
    } else {
      _allResults    = names;
      _currentPage   = 0;
      _generatedOn             = new Date().toLocaleString();
      renderPage();
    }
  }

  // Renders a single result row as an HTML <li> string
  function renderItem(p, idx) {
    return `<li class="ramp-item ramp-col-template">
         <span>${p.district && p.county ? `${esc(p.district)}-${esc(String(p.county).padEnd(3, '.'))}-${esc(_routeLabel)}` : ''}</span>
         <span>${p.pmPrefix && p.pmPrefix !== '.' ? esc(p.pmPrefix) : ''}</span>
         <span>${esc(padMeasure(p.pmMeasure))}</span>
         <span>${p.startDate != null ? esc(formatDate(p.startDate)) : ''}</span>
         <span>${p.pmSuffix === 'L' ? 'L' : p.hwyGroup ? esc(p.hwyGroup) : ''}</span>
         <span>${p.area4 === 1 ? 'Y' : p.area4 === 0 ? 'N' : ''}</span>
         <span>${p.cityCode ? esc(p.cityCode) : ''}</span>
         <span>${p.popCode ? esc(p.popCode) : ''}</span>
         <span>${p.onOff === 0 ? 'F' : p.onOff === 1 ? 'N' : p.onOff === 2 ? 'T' : ''}</span>
         <span>${p.aadtYear ? esc(p.aadtYear) : ''}</span>
         <span>${p.aadt != null ? String(p.aadt).padStart(6, '0') : ''}</span>
         <span>${p.rampDesign ? esc(p.rampDesign) : ''}</span>
         <span>${p.desc ? esc(p.desc) : ''}</span>
       </li>`;
  }

  function renderPage() {
    if (document.getElementById('reportSelect').value === 'highway_sequence') { hsl_renderPage(); return; }
    if (document.getElementById('reportSelect').value === 'Ramp_Summary')     { rs_renderPage(); return; }
    const box       = document.getElementById('rampResults');
    box.style.display = 'block';
    box.className   = 'ramp-results';

    const totalPages = Math.ceil(_allResults.length / PAGE_SIZE);
    const page       = _currentPage;
    const start      = page * PAGE_SIZE;
    const pageSlice  = _allResults.slice(start, start + PAGE_SIZE);

    const prevDis = page === 0              ? 'disabled' : '';
    const nextDis = page === totalPages - 1 ? 'disabled' : '';

    const routeLine3  = _routeLabel ? `Route: ${esc(_routeLabel)}&emsp;&emsp;&emsp;Direction: ${esc(_directionFrom)} &ndash; ${esc(_directionTo)}` : '';
    const actionBar       = renderActionBar('TASAS Selective Record Retrieval', 'TSAR - Ramp Detail', routeLine3, 'exportToExcel()', 'printAll()');
    const paginationBtns  = `<div class="ramp-pagination">
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
      `<div class="ramp-list-header ramp-col-template">
         <span>Location</span>
         <span>P<br>R<br>E</span>
         <span>PM</span>
         <span>DATE OF<br>RECORD</span>
         <span>H<br>G</span>
         <span>AREA 4</span>
         <span>CITY CODE</span>
         <span>R<br>U</span>
         <span>O<br>F</span>
         <span>AADT<br>YEAR</span>
         <span>ADT</span>
         <span>T<br>Y</span>
         <span>Description</span>
       </div>`;

    const items = pageSlice.map((p, i) => renderItem(p, start + i)).join('');

    const pageFooter = totalPages > 1
      ? `<div class="page-info">Page ${page + 1} of ${totalPages}</div>`
      : '';

    const generatedFooter = `<div class="generated-on">Generated on ${esc(_generatedOn)}</div>`;

    box.innerHTML = `${actionBar}${header}<ul class="ramp-list">${items}</ul>${pageFooter}${paginationBtns}${generatedFooter}`;
    box.scrollIntoView({ behavior: 'instant', block: 'start' });
  }
