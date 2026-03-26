  // ── RS: Ramp Summary — State ──────────────────────────────────────────────
  let _rs_summary = null;  // { counts: Map<code,count>, othersCount, total }

  const RS_HWY_GROUPS = [
    { code: 'R', label: 'R - Right' },
    { code: 'D', label: 'D - Divided' },
    { code: 'U', label: 'U - Undivided' },
    { code: 'X', label: 'X - Unconstructed' },
    { code: 'L', label: 'L - Left' },
  ];

  const RS_ON_OFF_GROUPS = [
    { code: 1, label: 'ON - On' },
    { code: 0, label: 'OFF - Off' },
    { code: 2, label: 'OTH - Other' },
  ];

  const RS_RAMP_TYPES = [
    { code: 'A',  label: 'A - Frontage Road' },
    { code: 'B',  label: 'B - Collector Road' },
    { code: 'C',  label: 'C - Direct or Semi-direct Connector (Left)' },
    { code: 'D',  label: 'D - Diamond Type Ramp' },
    { code: 'E',  label: 'E - Slip Ramp' },
    { code: 'F',  label: 'F - Direct or Semi-direct Connector (Right)' },
    { code: 'G',  label: 'G - Loop (w/Left turn)' },
    { code: 'H',  label: 'H - Buttonhook Ramp' },
    { code: 'J',  label: 'J - Scissors' },
    { code: 'K',  label: 'K - Split Ramp' },
    { code: 'L',  label: 'L - Loop without Left Turn' },
    { code: 'M',  label: 'M - Two way Ramp Segment' },
    { code: 'R',  label: 'R - Rest Area, Vista Point, Truck Scale' },
    { code: 'Z',  label: 'Z - Other' },
  ];

  // ── RS: Ramp Summary — Run functions ──────────────────────────────────────

  async function rs_runDistrictRouteMode() {
    if (!tokenIsValid()) { login(); return; }
    const district = document.getElementById('districtSelect').value || null; // null = ALL
    const routeNum = document.getElementById('districtRouteSelect').value;
    const county   = getDistrictCounty();
    if (!routeNum) { showRampResults('error', 'Please select a route.');    return; }

    const paddedRoute    = String(routeNum).padStart(3, '0');
    const isSupplemental = /[A-Z]$/.test(paddedRoute);
    const primaryId      = isSupplemental ? `SHS_${paddedRoute}_P`  : `SHS_${paddedRoute}._P`;
    const secondaryId    = isSupplemental ? `SHS_${paddedRoute}_S`  : `SHS_${paddedRoute}._S`;
    const segments = [
      { fromBest: { routeId: primaryId,   measure: -0.001 }, toBest: { routeId: primaryId,   measure: 999.999 } },
      { fromBest: { routeId: secondaryId, measure: -0.001 }, toBest: { routeId: secondaryId, measure: 999.999 } }
    ];

    const btn = document.getElementById('districtRouteBtn');
    btn.disabled = true;
    startThinking(btn);
    clearResults();
    try {
      const [rampPairs, direction] = await Promise.all([
        queryAttributeSet(segments, district, county),
        queryRouteDirection(routeNum)
      ]);
      _routeLabel = paddedRoute; _directionFrom = direction.from; _directionTo = direction.to;
      const allPairs = sortWithIndependentAlignments(rampPairs);
      if (allPairs.length === 0) { showRampResults('none'); return; }
      await rs_buildSummary(allPairs);
    } catch (err) {
      showRampResults('error', err.message || 'An error occurred.');
    } finally {
      btn.disabled = false;
      stopThinking(btn);
    }
  }

  async function rs_runTranslate() {
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

    const needsLAlt = from.pmSuffix !== 'L';
    const fromL     = { ...from, pmSuffix: 'L' };
    const toL       = { ...to,   pmSuffix: 'L' };

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
        setFieldError('from', 'INVALID LOCATION'); hasError = true;
      }
      if (toResult.status === 'rejected') {
        if (toResult.reason?.message !== 'auth') setFieldError('to', 'INVALID LOCATION');
        hasError = true;
      } else if (!toResult.value.bestR && !toResult.value.bestL) {
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

      const [rampPairs, direction] = await Promise.all([
        queryAttributeSet(segments),
        queryRouteDirection(from.routeNum.padStart(3, '0'))
      ]);
      _routeLabel = from.routeNum.padStart(3, '0');
      _directionFrom = direction.from;
      _directionTo   = direction.to;
      const allPairs = sortWithIndependentAlignments(rampPairs);
      if (allPairs.length === 0) { showRampResults('none'); return; }
      await rs_buildSummary(allPairs);
    } finally {
      btn.disabled = false;
      stopThinking(btn);
    }
  }

  // ── RS: Ramp Summary — Query ───────────────────────────────────────────────

  async function rs_buildSummary(allPairs) {
    const [hwyMap, { onOffMap, rampDesignMap }, popMap, cityMap] = await Promise.all([
      queryRangeLayer(allPairs, 116, 'Highway_Group'),
      rs_queryOnOff(allPairs),
      queryRangeLayer(allPairs, 130, 'Population_Code'),
      queryRangeLayer(allPairs, 74,  'City_Code')
    ]);

    // Debug: log any ramp names not found in layer 131
    const missing = allPairs.filter(p => !onOffMap.has(p.name));
    if (missing.length > 0) {
      console.warn(`[rs_buildSummary] ${missing.length} ramp(s) not found in layer 131 onOffMap:`);
      missing.forEach(p => console.warn(`  name: "${p.name}"  routeId: "${p.routeId}"  arMeasure: ${p.arMeasure}`));
    }

    // Apply on/off filter if selected
    const onOffFilter = getOnOffFilter();
    const pairs = onOffFilter === null
      ? allPairs
      : allPairs.filter(p => onOffMap.get(p.name) === onOffFilter);

    // Tally highway groups — PMSuffix 'L' (already on p.pmSuffix from layer 132) overrides to group L
    const known    = new Set(RS_HWY_GROUPS.map(g => g.code));
    const counts   = new Map(RS_HWY_GROUPS.map(g => [g.code, 0]));
    let othersCount = 0;
    for (const p of pairs) {
      const pmSuffix = (p.pmSuffix || '').trim().toUpperCase();
      const rawHwy   = (hwyMap.get(p.name) || '').trim().toUpperCase();
      const code     = pmSuffix === 'L' ? 'L' : rawHwy;
      if (known.has(code)) counts.set(code, counts.get(code) + 1);
      else othersCount++;
    }

    // Tally on/off indicator
    const onOffCounts = new Map(RS_ON_OFF_GROUPS.map(g => [g.code, 0]));
    for (const p of pairs) {
      const val = onOffMap.get(p.name);
      if (onOffCounts.has(val)) onOffCounts.set(val, onOffCounts.get(val) + 1);
    }

    // Tally population groups
    const popCounts = { ruralIn: 0, ruralOut: 0, urbanIn: 0, urbanOut: 0, invalid: 0 };
    for (const p of pairs) {
      const pop      = (popMap.get(p.name)  || '').trim().toUpperCase();
      const city     = (cityMap.get(p.name) || '').trim();
      const isRural  = pop === 'R';
      const isUrban  = pop === 'B' || pop === 'U';
      const insideCity = city !== '';
      if      (isRural && insideCity)  popCounts.ruralIn++;
      else if (isRural && !insideCity) popCounts.ruralOut++;
      else if (isUrban && insideCity)  popCounts.urbanIn++;
      else if (isUrban && !insideCity) popCounts.urbanOut++;
      else                             popCounts.invalid++;
    }

    // Tally ramp types
    const knownTypes  = new Set(RS_RAMP_TYPES.map(g => g.code));
    const typeCounts  = new Map(RS_RAMP_TYPES.map(g => [g.code, 0]));
    for (const p of pairs) {
      const code = rampDesignMap.get(p.name);
      if (code && knownTypes.has(code)) typeCounts.set(code, typeCounts.get(code) + 1);
    }

    const noLineworkCount = allPairs.filter(p => !onOffMap.has(p.name)).length;
    _rs_summary  = {
      counts, othersCount, onOffCounts, popCounts, typeCounts,
      total: pairs.length, onOffFilter, noLineworkCount,
      district: document.getElementById('districtSelect').value || null,
      county:   getDistrictCounty(),
      route:    document.getElementById('districtRouteSelect').value || null,
      refDate:  document.getElementById('refDate').value || null,
    };
    _generatedOn = new Date().toLocaleString();
    rs_renderPage();
  }

  async function rs_queryOnOff(allPairs) {
    const CHUNK = 100;
    const names = allPairs.map(p => p.name).filter(Boolean);
    const chunks = chunkArray(names, CHUNK);

    const allFeatures = (await Promise.all(chunks.map(async chunk => {
      const inList = chunk.map(n => `'${n.replace(/'/g, "''")}'`).join(',');
      const body = new URLSearchParams({
        where:          `Ramp_Name IN (${inList})${getDateFilter()}`,
        outFields:      'Ramp_Name,Ramp_On_Off_Ind,Ramp_Design',
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
          if (code === 498 || code === 499) { _token = null; login(); }
          console.error(`[rs_queryOnOff] API error ${code}: ${data.error.message}`);
          return [];
        }
        const features = Array.isArray(data.features) ? data.features : [];
        if (data.exceededTransferLimit) {
          console.warn(`[rs_queryOnOff] exceededTransferLimit on chunk of ${chunk.length} — asked for ${chunk.length}, got ${features.length}`);
        }
        return features;
      } catch (e) {
        console.error('[rs_queryOnOff] error:', e.message);
        return [];
      }
    }))).flat();

    // One record per Ramp_Name — keep first match
    const seen          = new Set();
    const onOffMap      = new Map();
    const rampDesignMap = new Map();
    for (const f of allFeatures) {
      const name = f.attributes?.Ramp_Name;
      if (name && !seen.has(name)) {
        seen.add(name);
        onOffMap.set(name,      f.attributes?.Ramp_On_Off_Ind);
        rampDesignMap.set(name, (f.attributes?.Ramp_Design || '').trim().toUpperCase());
      }
    }
    return { onOffMap, rampDesignMap };
  }

  // ── RS: Ramp Summary — Render ──────────────────────────────────────────────

  function rs_renderPage() {
    if (!_rs_summary) return;
    const box = document.getElementById('rampResults');
    box.style.display = 'block';
    box.className = 'ramp-results';

    const { counts, othersCount, onOffCounts, popCounts, typeCounts } = _rs_summary;
    const rows = RS_HWY_GROUPS.map(g =>
      `<tr><td class="rs-num result-val">${counts.get(g.code).toLocaleString()}</td><td class="result-val">${esc(g.label)}</td></tr>`
    ).join('');
    const othersRow = `<tr><td class="rs-num result-val">${othersCount.toLocaleString()}</td><td class="result-val">Others</td></tr>`;

    const onOffRows = RS_ON_OFF_GROUPS.map(g =>
      `<tr><td class="rs-num result-val">${(onOffCounts.get(g.code) ?? 0).toLocaleString()}</td><td class="result-val">${esc(g.label)}</td></tr>`
    ).join('');

    const rampTypeRows = RS_RAMP_TYPES.map(g =>
      `<tr><td class="rs-num result-val">${(typeCounts.get(g.code) ?? 0).toLocaleString()}</td><td class="result-val">${esc(g.label)}</td></tr>`
    ).join('');

    const v = (n) => `<td class="rs-num result-val">${Number(n).toLocaleString()}</td>`;
    const c = (s) => `<td class="result-val">${s}</td>`;
    const popRows =
      `<tr>${v(popCounts.ruralIn)}${c('R-RURAL -I INSIDE CITY')}</tr>` +
      `<tr>${v(popCounts.ruralOut)}${c('\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0-O OUTSIDE CITY')}</tr>` +
      `<tr>${v(popCounts.urbanIn)}${c('U-URBAN -I INSIDE CITY')}</tr>` +
      `<tr>${v(popCounts.urbanOut)}${c('\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0-O OUTSIDE CITY')}</tr>` +
      `<tr>${v(popCounts.invalid)}${c('\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0-INVALID DATA')}</tr>`;

    const onOffLabel =
      _rs_summary.onOffFilter === 1 ? 'All On Ramps' :
      _rs_summary.onOffFilter === 0 ? 'All Off Ramps' :
      _rs_summary.onOffFilter === 2 ? 'All Other Ramps' : 'All Ramps';

    const coverPage = buildCoverPage({
      coverTitle:  'TSAR - RAMPS SUMMARY',
      reportTitle: onOffLabel + ' on Route ' + (_routeLabel || ''),
      refDate:     _rs_summary.refDate,
      district:    _rs_summary.district,
      county:      _rs_summary.county,
      route:       _rs_summary.route,
    });

    box.innerHTML =
      `<div class="report-action-bar">
         <button class="export-btn" onclick="exportToExcel()">Export</button>
         <div class="report-title">
           <div class="report-title-line1">TASAS Selective Record Retrieval</div>
           <div class="report-title-line2">TSAR - Ramp Summary</div>
           <div class="report-title-line3">${onOffLabel} on Route ${esc(_routeLabel)}</div>
         </div>
         <button class="export-btn" onclick="printAll()">Print</button>
       </div>
       ${coverPage}
       <div class="rs-report">
         <div class="rs-fieldsets">
           <div class="rs-fieldsets-col">
             <fieldset class="mode-selector-box rs-fieldset">
               <legend class="mode-selector-label">Highway Groups</legend>
               <table class="rs-table">
                 <thead><tr><th class="rs-num result-val">NUMBER</th><th class="result-val">CODE</th></tr></thead>
                 <tbody>${rows}${othersRow}</tbody>
               </table>
             </fieldset>
             <fieldset class="mode-selector-box rs-fieldset">
               <legend class="mode-selector-label">On/Off Indicator</legend>
               <table class="rs-table">
                 <thead><tr><th class="rs-num result-val">NUMBER</th><th class="result-val">CODE</th></tr></thead>
                 <tbody>${onOffRows}</tbody>
               </table>
             </fieldset>
             <fieldset class="mode-selector-box rs-fieldset">
               <legend class="mode-selector-label">Population Groups</legend>
               <table class="rs-table">
                 <thead><tr><th class="rs-num result-val">NUMBER</th><th class="result-val">CODE</th></tr></thead>
                 <tbody>${popRows}</tbody>
               </table>
             </fieldset>
           </div>
           <div class="rs-fieldsets-right">
             <fieldset class="mode-selector-box rs-fieldset">
               <legend class="mode-selector-label">Ramp Types</legend>
               <table class="rs-table">
                 <thead><tr><th class="rs-num result-val">NUMBER</th><th class="result-val">CODE</th></tr></thead>
                 <tbody>${rampTypeRows}</tbody>
               </table>
             </fieldset>
             <div class="rs-summary-footer">
               <span>Total Number of Ramps: ${_rs_summary.total.toLocaleString()}</span>
               <span>Ramp Points w/out linework: ${_rs_summary.noLineworkCount.toLocaleString()}</span>
             </div>
           </div>
         </div>
         <div class="generated-on">Generated on ${esc(_generatedOn)}</div>
       </div>`;
  }

  function rs_printAll() {
    const box   = document.getElementById('rampResults');
    const saved = box.innerHTML;
    rs_renderPage();
    window.addEventListener('afterprint', () => { box.innerHTML = saved; }, { once: true });
    window.print();
  }
