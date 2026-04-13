  // ── In-memory token state ──────────────────────────────────────────────────
  let _token         = null;
  let _tokenExpiry   = null;
  let _portalUsername = '';

  // ── Pagination state ───────────────────────────────────────────────────────
  const PAGE_SIZE  = 25;
  let _allResults    = [];
  let _unresolvedIntersections = [];
  let _currentPage   = 0;
  let _allRouteIds        = new Set(); // pre-fetched AllRoads RouteIDs from layer 116
  let _routeDirectionCache = new Map(); // routeNum → { from, to }
  let _hslLengths        = null;       // cached result of hsl_computeLengths for current dataset
  let _countyNameToCode  = new Map(); // county name → 3-letter County_Code for layer 151
  let _generatedOn   = '';

  function startThinking(btn) {
    if (btn._thinkingTimer) { clearInterval(btn._thinkingTimer); btn._thinkingTimer = null; }
    const phrases = [
      'Poking the database',
      'Crunching the numbers',
      'Asking the interwebs',
      'Doing math stuff',
      'Feeding the hamsters',
      'Chewing on that',
      'Phoning a friend',
      'Checking with Jaime'
    ];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    const frames = [
      phrase + '\u00A0\u00A0\u00A0',
      phrase + '.\u00A0\u00A0',
      phrase + '..\u00A0',
      phrase + '...'
    ];
    let i = 0;
    btn.textContent = frames[i];
    btn._thinkingTimer = setInterval(() => {
      i = (i + 1) % frames.length;
      btn.textContent = frames[i];
    }, 400);
  }

  function stopThinking(btn) {
    if (btn._thinkingTimer) { clearInterval(btn._thinkingTimer); btn._thinkingTimer = null; }
    btn.textContent = 'Generate';
  }
  let _routeLabel    = '';
  let _directionFrom = '';
  let _directionTo   = '';

  // ── County codes ──────────────────────────────────────────────────────────
  const COUNTY_CODES = [
    {value:'ALA',display:'ALA'}, {value:'ALP',display:'ALP'}, {value:'AMA',display:'AMA'},
    {value:'BUT',display:'BUT'}, {value:'CAL',display:'CAL'}, {value:'CC.',display:'CC' },
    {value:'COL',display:'COL'}, {value:'DN.',display:'DN' }, {value:'ED.',display:'ED' },
    {value:'FRE',display:'FRE'}, {value:'GLE',display:'GLE'}, {value:'HUM',display:'HUM'},
    {value:'IMP',display:'IMP'}, {value:'INY',display:'INY'}, {value:'KER',display:'KER'},
    {value:'KIN',display:'KIN'}, {value:'LA.',display:'LA' }, {value:'LAK',display:'LAK'},
    {value:'LAS',display:'LAS'}, {value:'MAD',display:'MAD'}, {value:'MEN',display:'MEN'},
    {value:'MER',display:'MER'}, {value:'MNO',display:'MNO'}, {value:'MOD',display:'MOD'},
    {value:'MON',display:'MON'}, {value:'MPA',display:'MPA'}, {value:'MRN',display:'MRN'},
    {value:'NAP',display:'NAP'}, {value:'NEV',display:'NEV'}, {value:'ORA',display:'ORA'},
    {value:'PLA',display:'PLA'}, {value:'PLU',display:'PLU'}, {value:'RIV',display:'RIV'},
    {value:'SAC',display:'SAC'}, {value:'SB.',display:'SB' }, {value:'SBD',display:'SBD'},
    {value:'SBT',display:'SBT'}, {value:'SCL',display:'SCL'}, {value:'SCR',display:'SCR'},
    {value:'SD.',display:'SD' }, {value:'SF.',display:'SF' }, {value:'SHA',display:'SHA'},
    {value:'SIE',display:'SIE'}, {value:'SIS',display:'SIS'}, {value:'SJ.',display:'SJ' },
    {value:'SLO',display:'SLO'}, {value:'SM.',display:'SM' }, {value:'SOL',display:'SOL'},
    {value:'SON',display:'SON'}, {value:'STA',display:'STA'}, {value:'SUT',display:'SUT'},
    {value:'TEH',display:'TEH'}, {value:'TRI',display:'TRI'}, {value:'TUL',display:'TUL'},
    {value:'TUO',display:'TUO'}, {value:'VEN',display:'VEN'}
  ];

  // ── OAuth (ArcGIS implicit flow) ──────────────────────────────────────────

  function login() {
    const params = new URLSearchParams({
      client_id:     CONFIG.oauthClientId,
      response_type: 'token',
      redirect_uri:  CONFIG.oauthRedirectUrl,
      expiration:    '120'
    });
    window.location.href = `${CONFIG.oauthAuthorizeUrl}?${params}`;
  }

  function tokenIsValid() {
    if (!_token) return false;
    if (_tokenExpiry && Date.now() >= _tokenExpiry) { _token = null; return false; }
    return true;
  }


async function loadCountyCodeDomain() {
    try {
      const resp = await fetch(`${CONFIG.featureServiceUrl}/151?f=json&token=${_token}`);
      const data = await resp.json();
      const field = (data.fields ?? []).find(f => f.name === 'County_Code');
      const coded = field?.domain?.codedValues ?? [];
      _countyNameToCode = new Map();
      for (const cv of coded) {
        _countyNameToCode.set(cv.name, cv.code); // full name  → code  (e.g. "Lake"  → "LAK")
        _countyNameToCode.set(cv.code, cv.code); // code → code  (e.g. "LAK"  → "LAK")
      }
    } catch (e) {
      console.warn('[loadCountyCodeDomain] error:', e.message);
    }
  }

  /*
   * Feature Service Layer Index Reference
   * ─────────────────────────────────────
   *  0   – Intersection geometry (point features)
   *  116 – AllRoads (route geometry / LRS)
   *  123 – Landmarks (EV_SHS_LANDMARK; County uses 3-char code e.g. 'LA.')
   *  132 – Ramps (EV_SHS_RAMP; County uses 3-char code)
   *  133 – Route Breaks (EV_SHS_ROUTE_BREAK; County uses 3-char code)
   *  149 – Intersection AOI (area-of-interest polygon)
   *  151 – Intersection Attributes (County_Code uses 3-char code e.g. 'LA.')
   *  305 – PM Equation Points (County uses 2-char code e.g. 'LA')
   */

  /**
   * Resolves a county name or code to the 3-char code used by layers 123, 132, 133, and 151
   * (e.g., "Los Angeles" → "LA.", "LA" → "LA.", "LA." → "LA.").
   * Returns null when county is falsy.
   * NOTE: Layer 305 (equation points) uses 2-char codes — do NOT use this helper there.
   */
  function normalizeCountyCode(county) {
    if (!county) return null;
    const code = _countyNameToCode.get(county) ?? county;
    return code.length === 2 ? code + '.' : code;
  }

  /**
   * Returns true when a County_Code value stored in layer 85 matches a normalized
   * county code from normalizeCountyCode().  Layer 85 omits the trailing period that
   * normalizeCountyCode() appends for 2-char codes (e.g. 'SJ' stored vs 'SJ.' normalized),
   * so we accept both with and without the trailing period.
   */
  function countyCodeMatches(storedCode, normalizedCode) {
    if (!storedCode || !normalizedCode) return false;
    const s = storedCode.trim();
    return s === normalizedCode ||
      (normalizedCode.endsWith('.') && s === normalizedCode.slice(0, -1)) ||
      (!normalizedCode.endsWith('.') && s === normalizedCode + '.');
  }

  /**
   * Splits an array into chunks of at most `size` elements.
   * Used to stay within the feature service's max-record-count per request.
   */
  function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Builds a segment descriptor object from route/county/district and postmile range.
   */
  function makeSegment(fromPrimary, fromAlt, toPrimary, toAlt) {
    const fromEff = fromPrimary ?? fromAlt;
    const toEff   = toPrimary   ?? toAlt;
    if (!fromEff || !toEff) return null;
    const fromM = Math.min(fromEff.measure, fromAlt?.measure ?? fromEff.measure);
    const toM   = Math.max(toEff.measure,   toAlt?.measure   ?? toEff.measure);
    return { fromBest: { routeId: fromEff.routeId, measure: fromM },
             toBest:   { routeId: toEff.routeId,   measure: toM   } };
  }

  function setAuthUI(authenticated) {
    document.getElementById('loginPrompt').style.display  = authenticated ? 'none'  : 'block';
    document.getElementById('modeSelector').style.display = authenticated ? 'block' : 'none';
    document.getElementById('appForm').style.display      = 'none';
    document.getElementById('controlsGrid').style.display = 'none';
    if (authenticated) { loadVersions(); loadRouteList(); loadCountyCodeDomain(); }
  }

  function resetModeSelections() {
    document.getElementById('districtSelect').value = '';
    document.getElementById('districtSelect').classList.remove('has-value');
    const countySel = document.getElementById('districtCountySelect');
    countySel.innerHTML = '<option value="" disabled hidden selected>-- Select County --</option><option value="">-- ALL --</option>';
    countySel.classList.remove('has-value');
    countySel.disabled = true;
    const routeSel = document.getElementById('districtRouteSelect');
    routeSel.innerHTML = '<option value="" disabled hidden selected>-- Select Route --</option>';
    routeSel.classList.remove('has-value');
    routeSel.disabled = true;
    document.getElementById('districtRouteBtn').disabled = true;
  }

  function selectMode(mode) {
    resetModeSelections();
    const report = document.getElementById('reportSelect').value;
    const isHSL  = report === 'highway_sequence';
    const isHL   = report === 'highway_log';
    const isINX  = report === 'intersection_detail' || report === 'intersection_summary';
    document.getElementById('appForm').style.display              = mode === 'routeMeasure' ? 'block' : 'none';
    document.getElementById('controlsGrid').style.display         = 'grid';
    const showDR = mode === 'districtRoute';
    ['districtRow', 'districtCountyRow', 'districtRouteRow'].forEach(id => {
      document.getElementById(id).style.display = showDR ? 'flex' : 'none';
    });
    document.getElementById('districtRouteBtn').style.display     = showDR ? 'inline-block' : 'none';
    if (showDR) document.getElementById('districtRouteBtn').disabled = true;
    document.getElementById('generateRow').style.display          = showDR ? 'flex' : 'none';
    document.getElementById('onOffSection').style.display         = showDR && !isHSL && !isHL && !isINX ? 'flex' : 'none';
    if (isHSL || isHL || isINX) {
      document.getElementById('translateOnOffRow').style.display  = 'none';
    } else {
      document.getElementById('translateOnOffRow').style.display  = '';
    }
    document.getElementById('modeBtnRouteMeasure').classList.toggle('active', mode === 'routeMeasure');
    document.getElementById('modeBtnDistrictRoute').classList.toggle('active', mode === 'districtRoute');
    clearResults();
  }

  async function loadRouteList() {
    const params = new URLSearchParams({
      where:                '1=1',
      outFields:            'RouteID',
      returnDistinctValues: 'true',
      returnGeometry:       'false',
      ...versionParam(),
      f:                    'json',
      token:                _token
    });
    let data;
    try {
      const resp = await fetch(`${CONFIG.mapServiceUrl}/116/query?${params}`);
      data = await resp.json();
    } catch (e) {
      console.warn('[loadRouteList] fetch error:', e.message);
      return;
    }
    if (!Array.isArray(data.features)) {
      console.warn('[loadRouteList] unexpected response:', data);
      return;
    }

    for (const f of data.features) {
      const rid = f.attributes?.RouteID;
      if (rid) _allRouteIds.add(rid);
    }
  }

  async function onDistrictChange() {
    const districtSel = document.getElementById('districtSelect');
    const district    = districtSel.value;
    districtSel.classList.toggle('has-value', !districtSel.options[districtSel.selectedIndex]?.disabled);

    const countySel  = document.getElementById('districtCountySelect');
    const routeSel   = document.getElementById('districtRouteSelect');
    const btn        = document.getElementById('districtRouteBtn');

    // Reset county and route
    countySel.innerHTML = '<option value="" disabled hidden selected>-- Select County --</option><option value="">-- ALL --</option>';
    countySel.classList.remove('has-value');
    countySel.disabled = true;
    routeSel.innerHTML = '<option value="" disabled hidden selected>-- Select Route --</option>';
    routeSel.classList.remove('has-value');
    routeSel.disabled = true;
    btn.disabled = true;

    // If placeholder still selected, leave county/route disabled
    if (districtSel.options[districtSel.selectedIndex]?.disabled) return;

    countySel.innerHTML = '<option value="" disabled hidden selected>-- Loading counties\u2026 --</option>';

    const params = new URLSearchParams({
      where:                district ? `District = ${parseInt(district, 10)}` : '1=1',
      outFields:            'County_Code',
      returnDistinctValues: 'true',
      returnGeometry:       'false',
      orderByFields:        'County_Code ASC',
      ...versionParam(),
      f:                    'json',
      token:                _token
    });
    let data;
    try {
      const resp = await fetch(`${CONFIG.featureServiceUrl}/85/query?${params}`);
      data = await resp.json();
    } catch (e) {
      console.warn('[onDistrictChange] fetch error:', e.message);
      countySel.innerHTML = '<option value="" disabled hidden selected>-- Error loading counties --</option>';
      return;
    }
    const counties = Array.isArray(data.features)
      ? data.features.map(f => f.attributes?.County_Code).filter(v => v != null).sort()
      : [];
    countySel.innerHTML = '<option value="" disabled hidden selected>-- Select County --</option><option value="">-- ALL --</option>';
    for (const c of counties) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      countySel.appendChild(opt);
    }
    countySel.disabled = false;
  }

  async function onCountyChange() {
    const district  = document.getElementById('districtSelect').value;
    const countySel = document.getElementById('districtCountySelect');
    const county    = countySel.value;
    const routeSel  = document.getElementById('districtRouteSelect');
    const btn       = document.getElementById('districtRouteBtn');

    countySel.classList.toggle('has-value', !countySel.options[countySel.selectedIndex]?.disabled);

    // Reset route
    routeSel.innerHTML = '<option value="" disabled hidden selected>-- Select Route --</option>';
    routeSel.classList.remove('has-value');
    routeSel.disabled = true;
    btn.disabled = true;

    // If county placeholder still selected, leave route disabled
    if (countySel.options[countySel.selectedIndex]?.disabled) return;

    const whereClause = district && county
      ? `District_Code = ${parseInt(district, 10)} AND County = '${county.replace(/'/g, "''")}'`
      : district
        ? `District_Code = ${parseInt(district, 10)}`
        : county
          ? `County = '${county.replace(/'/g, "''")}'`
          : '1=1';

    const params = new URLSearchParams({
      where:                whereClause,
      outFields:            'RouteNum,RouteSuffix',
      returnDistinctValues: 'true',
      returnGeometry:       'false',
      orderByFields:        'RouteNum ASC',
      ...versionParam(),
      f:                    'json',
      token:                _token
    });
    let data;
    try {
      const resp = await fetch(`${CONFIG.featureServiceUrl}/215/query?${params}`);
      data = await resp.json();
    } catch (e) {
      console.warn('[onCountyChange] fetch error:', e.message);
      routeSel.innerHTML = '<option value="" disabled hidden>-- Error loading routes --</option>';
      return;
    }
    if (!Array.isArray(data.features)) {
      routeSel.innerHTML = '<option value="" disabled hidden>-- No routes found --</option>';
      return;
    }

    const seen = new Set();
    const routes = [];
    for (const f of data.features) {
      const num = f.attributes?.RouteNum;
      if (num == null) continue;
      const sfx = f.attributes?.RouteSuffix;
      const hasSignificantSuffix = sfx && sfx !== '.';
      const padded = String(num).padStart(3, '0');
      const value  = hasSignificantSuffix ? padded + sfx : num;
      const label  = hasSignificantSuffix ? padded + sfx : padded;
      const key    = label;
      if (!seen.has(key)) { seen.add(key); routes.push({ value, label, num }); }
    }
    routes.sort((a, b) => a.num - b.num || String(a.label).localeCompare(String(b.label)));

    routeSel.innerHTML = '<option value="" disabled hidden selected>-- Select Route --</option>';
    for (const { value, label } of routes) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      routeSel.appendChild(opt);
    }
    routeSel.disabled = false;
    routeSel.onchange = () => {
      routeSel.classList.toggle('has-value', !!routeSel.value);
      btn.disabled = !routeSel.value;
    };
  }

  async function runDistrictRouteMode() {
    if (document.getElementById('reportSelect').value === 'highway_sequence')    { await hsl_runDistrictRouteMode();  return; }
    if (document.getElementById('reportSelect').value === 'Ramp_Summary')        { await rs_runDistrictRouteMode();   return; }
    if (document.getElementById('reportSelect').value === 'highway_log')         { await hl_runDistrictRouteMode();   return; }
    if (document.getElementById('reportSelect').value === 'intersection_detail') { await intd_runDistrictRouteMode(); return; }
    if (document.getElementById('reportSelect').value === 'intersection_summary'){ await ints_runDistrictRouteMode(); return; }
    if (!tokenIsValid()) { login(); return; }

    const district = document.getElementById('districtSelect').value || null; // null = ALL
    const routeNum = document.getElementById('districtRouteSelect').value;
    const county   = getDistrictCounty();
    if (!routeNum) { showRampResults('error', 'Please select a route.');    return; }

    const paddedRoute    = String(routeNum).padStart(3, '0');
    const isSupplemental = /[A-Z]$/.test(paddedRoute);
    const routeSuffix    = isSupplemental ? paddedRoute.slice(-1) : '.';
    const primaryId      = isSupplemental ? `SHS_${paddedRoute}_P`  : `SHS_${paddedRoute}._P`;
    const secondaryId    = isSupplemental ? `SHS_${paddedRoute}_S`  : `SHS_${paddedRoute}._S`;

    // Always include both alignments — layer 116 may not list all RouteIDs present in layer 132/123
    // Use -0.001 lower bound to capture records with ARMeasure slightly below 0 due to float precision
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
      _routeLabel    = paddedRoute;
      _directionFrom = direction.from;
      _directionTo   = direction.to;
      const allPairs = sortWithIndependentAlignments(rampPairs);
      if (allPairs.length === 0) { showRampResults('none'); return; }
      await queryRampDescriptions(allPairs);
    } catch (err) {
      showRampResults('error', err.message || 'An error occurred.');
    } finally {
      btn.disabled = false;
      stopThinking(btn);
    }
  }

  async function loadVersions() {
    const vmsUrl = CONFIG.vmsUrl;
    const sel = document.getElementById('versionSelect');

    let resp, data;
    try {
      resp = await fetch(`${vmsUrl}/versionInfos`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({ f: 'json', token: _token }).toString()
      });
      data = await resp.json();
    } catch (e) {
      console.error('[loadVersions] error:', e.message);
      return;
    }

    if (!Array.isArray(data.versions)) {
      console.warn('[loadVersions] unexpected response:', data);
      return;
    }

    // Sort: DEFAULT first, then alphabetically
    const sorted = [...data.versions].sort((a, b) => {
      const aDefault = a.versionName.toUpperCase() === 'SDE.DEFAULT';
      const bDefault = b.versionName.toUpperCase() === 'SDE.DEFAULT';
      if (aDefault) return -1;
      if (bDefault) return  1;
      return a.versionName.localeCompare(b.versionName);
    });

    sel.innerHTML = '';
    for (const v of sorted) {
      const opt = document.createElement('option');
      const isDefault = v.versionName.toUpperCase() === 'SDE.DEFAULT';
      opt.value       = isDefault ? '' : v.versionName;
      opt.textContent = isDefault ? 'Default' : v.versionName;
      sel.appendChild(opt);
    }
  }

  function getVersion() {
    return document.getElementById('versionSelect').value;
  }

  // Returns { gdbVersion: '...' } for named versions, or {} for Default (omit parameter)
  function versionParam() {
    const v = getVersion();
    return v ? { gdbVersion: v } : {};
  }

  function historicMomentParam() {
    const val = document.getElementById('refDate')?.value; // "YYYY-MM-DD"
    if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return {};
    return { historicMoment: new Date(val).getTime() };
  }

  function parseHashParams(hash) {
    return Object.fromEntries(new URLSearchParams(hash.replace(/^#/, '')));
  }

  function initAuth() {
    if (window.location.hash) {
      const hp = parseHashParams(window.location.hash);
      if (hp.access_token) {
        _token = hp.access_token;
        if (hp.expires_in) _tokenExpiry = Date.now() + parseInt(hp.expires_in, 10) * 1000;
        if (hp.username) _portalUsername = hp.username;
        history.replaceState(null, '', window.location.pathname + window.location.search);
        setAuthUI(true);
        return;
      }
    }
    login();
  }

  // ── Input population & validation ─────────────────────────────────────────

  function populateCounties() {
    ['from-county', 'to-county'].forEach(id => {
      const sel = document.getElementById(id);
      const placeholder = document.createElement('option');
      placeholder.value       = '';
      placeholder.textContent = '-- Select County --';
      placeholder.disabled    = true;
      placeholder.hidden      = true;
      placeholder.selected    = true;
      sel.appendChild(placeholder);
      COUNTY_CODES.forEach(({value, display}) => {
        const opt = document.createElement('option');
        opt.value       = value;
        opt.textContent = display;
        sel.appendChild(opt);
      });
    });
  }

  function setupValidation() {
    ['from-routeNum', 'to-routeNum'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        el.value = el.value.replace(/\D/g, '').slice(0, 3);
      });
    });

    // Mirror From route # into To route # while To hasn't been manually changed
    const fromRouteEl = document.getElementById('from-routeNum');
    const toRouteEl   = document.getElementById('to-routeNum');
    let toRouteEdited = false;
    toRouteEl.addEventListener('input', () => { toRouteEdited = true; });
    fromRouteEl.addEventListener('input', () => {
      if (!toRouteEdited) toRouteEl.value = fromRouteEl.value;
    });

    ['from-measure', 'to-measure'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        let v = el.value.replace(/[^0-9.]/g, '');
        const dotIdx = v.indexOf('.');
        if (dotIdx !== -1) {
          v = v.slice(0, dotIdx + 1) + v.slice(dotIdx + 1).replace(/\./g, '');
          if (v.length > dotIdx + 4) v = v.slice(0, dotIdx + 4);
        }
        el.value = v;
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function readSection(prefix) {
    return {
      county:      document.getElementById(`${prefix}-county`).value,
      routeNum:    document.getElementById(`${prefix}-routeNum`).value.trim(),
      routeSuffix: document.getElementById(`${prefix}-routeSuffix`).value,
      pmPrefix:    document.getElementById(`${prefix}-pmPrefix`).value,
      pmSuffix:    document.getElementById(`${prefix}-pmSuffix`).value,
      measureRaw:  document.getElementById(`${prefix}-measure`).value.trim(),
    };
  }

  function buildRouteId(s, alignment) {
    return s.county + s.routeNum.padStart(3, '0') + s.routeSuffix + s.pmPrefix + s.pmSuffix + alignment;
  }

  // Sort pairs by odMeasure, grouping independent alignment sections (PMSuffix R
  // or L) so all R records in a section appear before all L records.
  // Equation first-rows (isSecondEq=false, "EQUATES TO") are removed from the
  // sort to prevent them from breaking R/L groups, then re-inserted immediately
  // before their eq2 partner based on eqPairId.
  function sortWithIndependentAlignments(pairs) {
    const eq1ById = new Map();
    const main = pairs.filter(p => {
      if (p.type === 'equation' && !p.isSecondEq) { eq1ById.set(p.eqPairId, p); return false; }
      return true;
    });

    // Build a map: Route Break AR → its paired Route Resume, for tiebreak use.
    // Pair each Route Break with the nearest Route Resume at a higher AR.
    const rbBreaks  = main.filter(p => p.type === 'routebreak' && p.desc === 'Route Break');
    const rbResumes = main.filter(p => p.type === 'routebreak' && p.desc === 'Route Resume');
    const rbResumeForBreak = new Map(); // break.name → resume pair
    for (const brk of rbBreaks) {
      const brkAr = brk.arMeasure ?? Infinity;
      const paired = rbResumes
        .filter(r => (r.arMeasure ?? Infinity) >= brkAr)
        .sort((x, y) => (x.arMeasure ?? Infinity) - (y.arMeasure ?? Infinity))[0];
      if (paired) rbResumeForBreak.set(brk.name, paired);
    }
    // Build reverse map: resume.name → its Route Break
    const rbBreakForResume = new Map();
    for (const [brkName, resume] of rbResumeForBreak) {
      rbBreakForResume.set(resume.name, main.find(p => p.name === brkName));
    }

    main.sort((a, b) => {
      const aAr = a.arMeasure;
      const bAr = b.arMeasure;
      // Treat missing AR as Infinity so null/NaN records don't break comparator
      // consistency (which corrupts TimSort for all nearby records).
      // Round to 3 decimal places before comparing so that two AR values that
      // agree to 3dp (e.g. 239.2454 vs 239.2466) are treated as co-located and
      // fall through to the tiebreak rules below rather than sorting by raw AR.
      const aVal = (aAr == null || isNaN(aAr)) ? Infinity : Math.round(aAr * 1000) / 1000;
      const bVal = (bAr == null || isNaN(bAr)) ? Infinity : Math.round(bAr * 1000) / 1000;
      const diff = aVal - bVal;
      if (diff !== 0) return diff;
      // Two route break records at the same OD: Route Break before Route Resume.
      if (a.type === 'routebreak' && b.type === 'routebreak') {
        if (a.desc === 'Route Break' && b.desc !== 'Route Break') return -1;
        if (a.desc !== 'Route Break' && b.desc === 'Route Break') return 1;
      }
      // E-suffix tiebreak does not apply to equation records — eq2 uses pmSuffix='E'
      // as a marker but must fall through to the equation tiebreak below.
      if (a.pmSuffix === 'E' && b.pmSuffix !== 'E' && a.type !== 'equation') return 1;
      if (a.pmSuffix !== 'E' && b.pmSuffix === 'E' && b.type !== 'equation') return -1;
      // Equation points sort before all other record types at the same AR position.
      if (a.type === 'equation' && b.type !== 'equation') return -1;
      if (a.type !== 'equation' && b.type === 'equation') return 1;
      // Two equation points at the same 3dp AR: use full precision to differentiate.
      if (a.type === 'equation' && b.type === 'equation') return (aAr ?? Infinity) - (bAr ?? Infinity);
      // Same PM combination: H (landmarks/equations/etc.) before I (intersections) before R (ramps).
      // Within H type, H-valued HG records before non-H (R, L, D, etc.).
      // Use parseFloat+toFixed(3) for pmMeasure so "020.558" and "20.558" compare equal.
      const pmKey = p => `${p.pmPrefix}|${isNaN(parseFloat(p.pmMeasure)) ? p.pmMeasure : parseFloat(p.pmMeasure).toFixed(3)}|${p.pmSuffix}`;
      if (pmKey(a) === pmKey(b)) {
        const ftOf = p => {
          if (p.type === 'equation' || p.type === 'landmark' || p.type === 'routebreak' ||
              p.type === 'citybegin' || p.type === 'cityend') return 0; // H
          if (p.type === 'intersection') return 1;                       // I
          return 2;                                                       // R (ramp)
        };
        const ftDiff = ftOf(a) - ftOf(b);
        if (ftDiff !== 0) return ftDiff;
        const hgRank = p => (!p.hgValue || p.hgValue === 'H') ? 0 : 1;
        const hgDiff = hgRank(a) - hgRank(b);
        if (hgDiff !== 0) return hgDiff;
      }
      // Route break tiebreak: when a non-routebreak record shares OD with a Route Break or
      // Route Resume, place it before the pair if PM matches Route Break, after if PM matches Resume.
      const aIsRb = a.type === 'routebreak';
      const bIsRb = b.type === 'routebreak';
      if (aIsRb !== bIsRb) {
        const rb    = aIsRb ? a : b;
        const other = aIsRb ? b : a;
        const otherPm = parseFloat(other.pmMeasure);
        if (!isNaN(otherPm)) {
          // Find the break/resume pair members regardless of which one we're comparing against
          const isBreak  = rb.desc === 'Route Break';
          const isResume = rb.desc === 'Route Resume';
          const brk    = isBreak  ? rb : rbBreakForResume.get(rb.name);
          const resume = isResume ? rb : rbResumeForBreak.get(rb.name);
          const brkPm    = brk    ? parseFloat(brk.pmMeasure)    : NaN;
          const resumePm = resume ? parseFloat(resume.pmMeasure) : NaN;
          if (!isNaN(brkPm) && Math.abs(otherPm - brkPm) < 0.001) {
            // PM matches Route Break → other goes before the pair
            return aIsRb ? 1 : -1;
          }
          if (!isNaN(resumePm) && Math.abs(otherPm - resumePm) < 0.001) {
            // PM matches Route Resume → other goes after the pair
            return aIsRb ? -1 : 1;
          }
        }
      }
      // Equation point tiebreak: when a non-equation record shares OD with an eq2 record,
      // place it before the pair if its PM matches eq1 (source measure),
      // or after the pair if its PM matches eq2 (the "EQUATES TO" measure).
      const aIsEq2 = a.type === 'equation' && a.isSecondEq;
      const bIsEq2 = b.type === 'equation' && b.isSecondEq;
      if (aIsEq2 !== bIsEq2) {
        const eq2   = aIsEq2 ? a : b;
        const other = aIsEq2 ? b : a;
        const eq1   = eq1ById.get(eq2.eqPairId);
        if (eq1) {
          const otherPm = parseFloat(other.pmMeasure);
          const eq1Pm   = parseFloat(eq1.pmMeasure);
          const eq2Pm   = parseFloat(eq2.pmMeasure);
          if (!isNaN(otherPm)) {
            if (!isNaN(eq1Pm) && Math.abs(otherPm - eq1Pm) < 0.001) {
              // other PM matches eq1 (source) → other goes before the pair
              return aIsEq2 ? 1 : -1;
            }
            if (!isNaN(eq2Pm) && Math.abs(otherPm - eq2Pm) < 0.001) {
              // other PM matches eq2 → other goes after the pair
              return aIsEq2 ? -1 : 1;
            }
          }
        }
      }
      // Final tiebreaker: sort by PMMeasure ascending.
      // Exception: at a county boundary the PM resets (e.g. 24.750 → 0.000 at the same AR).
      // Detect this when one value is near-zero and the difference is large — in that case
      // the higher PM belongs to the ending county and must sort first.
      const aPm = parseFloat(a.pmMeasure);
      const bPm = parseFloat(b.pmMeasure);
      if (!isNaN(aPm) && !isNaN(bPm) && aPm !== bPm) {
        const minPm = Math.min(aPm, bPm);
        const maxPm = Math.max(aPm, bPm);
        if (minPm < 0.5 && maxPm - minPm > 5) return bPm - aPm; // county PM reset: larger PM first
        return aPm - bPm;
      }
      return 0;
    });
    const isIABoundaryRec = p => p.type === 'landmark' && (
      p.desc === 'BEGIN LEFT INDEPENDENT ALIGNMENT'  || p.desc === 'END LEFT INDEPENDENT ALIGNMENT' ||
      p.desc === 'BEGIN RIGHT INDEPENDENT ALIGNMENT' || p.desc === 'END RIGHT INDEPENDENT ALIGNMENT'
    );
    const grouped = [];
    let i = 0;
    while (i < main.length) {
      if ((main[i].pmSuffix === 'R' || main[i].pmSuffix === 'L') && !isIABoundaryRec(main[i])) {
        const j = i;
        // Continue through R, L, E, and any dot-record whose hgValue is 'R'
        // or 'L'. pmPrefix is unreliable — some END INDEP ALIGN landmarks
        // carry pmPrefix='.' rather than 'R', so we use hgValue exclusively.
        while (i < main.length) {
          const cur = main[i];
          if (cur.pmSuffix === 'R' || cur.pmSuffix === 'L' || cur.hgValue === 'R' || cur.hgValue === 'L') {
            i++;
          } else if (cur.pmSuffix === 'E') {
            // Equation records use pmSuffix='E' as a rendering marker, not as an
            // alignment boundary. Pulling them into a section reorders them out of
            // AR sequence (E-group lands before trailing dot records). Break so eq2
            // passes through the outer loop at its natural AR position.
            if (cur.type === 'equation') break;
            i++;
            // Only continue the section past this equation point if R/L records
            // follow before the next E. Stopping at the next E prevents a chain
            // of equation points from extending the section across the whole route.
            let hasMoreRL = false;
            for (let k = i; k < main.length; k++) {
              const la = main[k];
              if (la.pmSuffix === 'E') break;
              if (la.pmSuffix === 'R' || la.pmSuffix === 'L' || la.hgValue === 'R' || la.hgValue === 'L') {
                hasMoreRL = true;
                break;
              }
            }
            if (!hasMoreRL) break;
          } else {
            // Dot-suffix, non-hgValue record — look ahead for more R/L records
            // before the next E. If found, this record falls between the R and L
            // sub-sections and belongs in the section's trailing bucket.
            let hasMoreRL = false;
            for (let k = i + 1; k < main.length; k++) {
              const la = main[k];
              if (la.pmSuffix === 'E') break; // E marks end of current alignment span
              if (la.pmSuffix === 'R' || la.pmSuffix === 'L' || la.hgValue === 'R' || la.hgValue === 'L') {
                hasMoreRL = true;
                break;
              }
            }
            if (hasMoreRL) { i++; } else { break; }
          }
        }
        const section = main.slice(j, i);
        // R group: only R-suffix records confirmed on the R alignment by hgValue.
        // R-suffix records with empty hgValue are not confirmed as R-alignment and
        // go to the trailing bucket after the L group.
        grouped.push(...section.filter(p => p.pmSuffix === 'R' && (p.hgValue === 'R' || p.alignment === 'R')));
        // L group: all L-suffix records
        grouped.push(...section.filter(p => p.pmSuffix === 'L'));
        // E-suffix end markers
        grouped.push(...section.filter(p => p.pmSuffix === 'E'));
        // Trailing: dot-suffix records (END INDEP ALIGN landmarks via hgValue),
        // then R-suffix records not confirmed by hgValue or alignment
        grouped.push(...section.filter(p => p.pmSuffix !== 'R' && p.pmSuffix !== 'L' && p.pmSuffix !== 'E'));
        grouped.push(...section.filter(p => p.pmSuffix === 'R' && p.hgValue !== 'R' && p.alignment !== 'R'));
      } else {
        const p = main[i++];
        grouped.push(p);
      }
    }

    // Re-insert each eq1 immediately before its eq2 partner.
    const result = [];
    for (const p of grouped) {
      if (p.type === 'equation' && p.isSecondEq) {
        const eq1 = eq1ById.get(p.eqPairId);
        if (eq1) result.push(eq1);
      }
      result.push(p);
    }
    return result;
  }

  // When two equation-pair records share the same AR to 3dp, the lower-AR tie-
  // break used during sorting may not put them in the right order relative to
  // the surrounding records. This pass checks the pmPrefix of the record
  // immediately before and after each same-AR pair and swaps the PM data fields
  // if doing so produces a better prefix match (eq1 continues from the prefix
  // context before it; eq2 leads into the prefix context after it).
  function fixEqPairOrder(pairs) {
    for (let i = 0; i < pairs.length - 1; i++) {
      const eq1 = pairs[i];
      const eq2  = pairs[i + 1];
      if (eq1.type !== 'equation' || eq1.isSecondEq)  continue;
      if (eq2.type !== 'equation' || !eq2.isSecondEq) continue;
      if (eq1.eqPairId !== eq2.eqPairId)              continue;

      // Only act when both endpoints share the same AR to 3dp.
      const ar1 = Math.round((eq1.arMeasure ?? 0) * 1000);
      const ar2  = Math.round((eq2.arMeasure ?? 0) * 1000);
      if (ar1 !== ar2) continue;

      const eq1Pfx = eq1.pmPrefix ?? '';
      const eq2Pfx  = eq2.pmPrefix ?? '';
      if (eq1Pfx === eq2Pfx) continue; // prefixes identical — no information to use

      const prevPfx = i > 0                 ? (pairs[i - 1].pmPrefix ?? '') : null;
      const nextPfx  = i + 2 < pairs.length ? (pairs[i + 2].pmPrefix ?? '') : null;

      // Primary signal: the record before the pair should share its prefix with eq1
      // (the departure side of the old PM system). If eq2's prefix matches the
      // preceding context and eq1's does not, the pair is reversed — swap it.
      // Secondary signal (when no prev record): eq2 should match the following
      // context. If eq1 matches next but eq2 does not, swap.
      let shouldSwap = false;
      if (prevPfx !== null) {
        if (eq2Pfx === prevPfx && eq1Pfx !== prevPfx) shouldSwap = true;
      } else if (nextPfx !== null) {
        if (eq1Pfx === nextPfx && eq2Pfx !== nextPfx) shouldSwap = true;
      }
      if (!shouldSwap) continue;

      // Swap PM-related data fields only — structural fields (desc, isSecondEq,
      // eqPairId, type) stay in place so rendering labels are unaffected.
      for (const f of ['pmPrefix', 'pmSuffix', 'pmMeasure', 'routeId', 'arMeasure', 'odMeasure', 'county', 'name']) {
        const tmp = eq1[f]; eq1[f] = eq2[f]; eq2[f] = tmp;
      }
      console.log(`[eqOrder] swapped eqPairId=${eq1.eqPairId}: eq1 now (${eq1.pmPrefix||'.'}${eq1.pmMeasure}) eq2 now (${eq2.pmPrefix||'.'}${eq2.pmMeasure}) — prev=${prevPfx} next=${nextPfx}`);
    }
    return pairs;
  }

  function pickBest(locs) {
    const valid = locs.filter(l =>
      l.routeId != null &&
      l.measure != null &&
      (!l.status || l.status === 'esriLocatingOK' || l.status === 'esriLocatingMultipleLocation')
    );
    if (valid.length === 0) return null;
    return valid.reduce((a, b) => b.measure > a.measure ? b : a);
  }

  // ── Shared: Query method dispatch ────────────────────────────────────────
  // runDistrictRouteMode / runTranslate each check the active report and
  // delegate to the appropriate per-report implementation below.
  // To add a new report: add a dispatch branch here and a matching section.

  function checkTranslateReady() {
    ['from-county', 'to-county'].forEach(id => {
      document.getElementById(id).classList.toggle('has-value', !!document.getElementById(id).value);
    });
    const ready =
      document.getElementById('from-county').value   &&
      document.getElementById('from-routeNum').value.trim() &&
      document.getElementById('from-measure').value.trim()  &&
      document.getElementById('to-county').value     &&
      document.getElementById('to-routeNum').value.trim()   &&
      document.getElementById('to-measure').value.trim();
    document.getElementById('translateBtn').disabled = !ready;
  }

  function setFieldError(prefix, msg) {
    const el = document.getElementById(`${prefix}-translate-error`);
    if (!el) return;
    el.textContent    = msg;
    el.style.display  = msg ? 'block' : 'none';
  }

  // Translate one section (From or To) — returns { bestR, bestL } or throws
  async function translateSection(routeIdR, routeIdL, measure) {
    const body = new URLSearchParams({
      locations:             JSON.stringify([
        { routeId: routeIdR, measure },
        { routeId: routeIdL, measure }
      ]),
      targetNetworkLayerIds: JSON.stringify([4]),
      ...versionParam(),
      ...historicMomentParam(),
      f:     'json',
      token: _token
    });
    const resp = await fetch(`${CONFIG.mapServiceUrl}/exts/LRServer/networkLayers/3/translate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString()
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    const data = await resp.json();
    if (data.error) {
      const code = data.error.code;
      if (code === 498 || code === 499) { _token = null; login(); throw new Error('auth'); }
      throw new Error(`API error ${code}: ${data.error.message}`);
    }
    const locs = data.locations ?? [];
    return {
      bestR: pickBest(locs[0]?.translatedLocations ?? []),
      bestL: pickBest(locs[1]?.translatedLocations ?? [])
    };
  }

  async function runTranslate() {
    if (document.getElementById('reportSelect').value === 'highway_sequence')    { await hsl_runTranslate();  return; }
    if (document.getElementById('reportSelect').value === 'Ramp_Summary')        { await rs_runTranslate();   return; }
    if (document.getElementById('reportSelect').value === 'highway_log')         { await hl_runTranslate();   return; }
    if (document.getElementById('reportSelect').value === 'intersection_detail') { await intd_runTranslate(); return; }
    if (document.getElementById('reportSelect').value === 'intersection_summary'){ await ints_runTranslate(); return; }
    if (!tokenIsValid()) { login(); return; }

    const from = readSection('from');
    const to   = readSection('to');

    const fromMeasure = parseFloat(from.measureRaw);
    if (isNaN(fromMeasure)) { showRampResults('error', 'From measure must be a number.'); return; }
    const toMeasure = parseFloat(to.measureRaw);
    if (isNaN(toMeasure)) { showRampResults('error', 'To measure must be a number.'); return; }

    // Clear any previous per-field errors
    setFieldError('from', '');
    setFieldError('to',   '');

    const fromRouteIdR = buildRouteId(from, 'R');
    const fromRouteIdL = buildRouteId(from, 'L');
    const toRouteIdR   = buildRouteId(to,   'R');
    const toRouteIdL   = buildRouteId(to,   'L');

    // Also translate L-pmSuffix variants to capture features calibrated on the L postmile route
    const needsLAlt  = from.pmSuffix !== 'L';
    const fromL      = { ...from, pmSuffix: 'L' };
    const toL        = { ...to,   pmSuffix: 'L' };

    const btn = document.getElementById('translateBtn');
    btn.disabled = true;
    startThinking(btn);
    clearResults();

    try {
      // Translate primary and L-pmSuffix variants all in parallel
      const [fromResult, toResult, fromAltResult, toAltResult] = await Promise.allSettled([
        translateSection(fromRouteIdR, fromRouteIdL, fromMeasure),
        translateSection(toRouteIdR,   toRouteIdL,   toMeasure),
        needsLAlt ? translateSection(buildRouteId(fromL, 'R'), buildRouteId(fromL, 'L'), fromMeasure) : Promise.resolve(null),
        needsLAlt ? translateSection(buildRouteId(toL,   'R'), buildRouteId(toL,   'L'), toMeasure)   : Promise.resolve(null)
      ]);

      // Error display only on primary results
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

      // Pull alt (L-pmSuffix) results if available — used to widen the ARMeasure range
      const fromAltV = fromAltResult.status === 'fulfilled' ? fromAltResult.value : null;
      const toAltV   = toAltResult.status   === 'fulfilled' ? toAltResult.value   : null;

      // Build a segment using the most inclusive From/To measures across both pmSuffix variants.
      // Alt substitutes for primary when primary is null (e.g. only L-pmSuffix translates on that alignment).
      const segments = [
        makeSegment(fromBestR, fromAltV?.bestR, toBestR, toAltV?.bestR),
        makeSegment(fromBestL, fromAltV?.bestL, toBestL, toAltV?.bestL)
      ].filter(Boolean);

      if (segments.length === 0) {
        showRampResults('error', 'Translation failed for both R and L alignments.');
        return;
      }

      const [rampPairs, direction] = await Promise.all([
        queryAttributeSet(segments),
        queryRouteDirection(from.routeNum.padStart(3, '0'))
      ]);
      _routeLabel    = from.routeNum.padStart(3, '0');
      _directionFrom = direction.from;
      _directionTo   = direction.to;

      const allPairs = sortWithIndependentAlignments(rampPairs);

      if (allPairs.length === 0) {
        showRampResults('none');
        return;
      }

      await queryRampDescriptions(allPairs);

    } finally {
      btn.disabled = false;
      stopThinking(btn);
    }
  }

  function isPaginated() {
    return document.getElementById('paginatedCheck')?.checked !== false;
  }

  // ── Shared: State management & route direction ───────────────────────────

  function clearResults() {
    const rampBox = document.getElementById('rampResults');
    rampBox.style.display = 'none';
    rampBox.className = 'ramp-results';
    rampBox.innerHTML = '';
    _allResults              = [];
    _unresolvedIntersections = [];
    _currentPage   = 0;
    _routeLabel    = '';
    _directionFrom = '';
    _directionTo   = '';
    _hslLengths    = null;
  }

  async function queryRouteDirection(routeNum) {
    const cacheKey = `${routeNum}:${getVersion()}`;
    if (_routeDirectionCache.has(cacheKey)) return _routeDirectionCache.get(cacheKey);

    const routeInt = parseInt(routeNum, 10);
    if (isNaN(routeInt)) return { from: '', to: '' };
    const params = new URLSearchParams({
      where:          `ROUTE = ${routeInt}`,
      outFields:      'FROM_,TO_',
      returnGeometry: 'false',
      ...versionParam(),
      f:              'json',
      token:          _token
    });
    try {
      const resp = await fetch(`${CONFIG.mapServiceUrl}/304/query?${params}`);
      const data = await resp.json();
      if (data.features?.length > 0) {
        const a = data.features[0].attributes;
        const result = { from: a.FROM_ ?? '', to: a.TO_ ?? '' };
        if (_routeDirectionCache.size >= 100) _routeDirectionCache.clear();
        _routeDirectionCache.set(cacheKey, result);
        return result;
      }
    } catch (e) {
      console.error('[queryRouteDirection] error:', e.message);
    }
    return { from: '', to: '' };
  }

  // ── Shared: Core query functions ─────────────────────────────────────────
  // queryAttributeSet, queryRangeLayer, and translateToOD are used by both
  // the TSAR: Ramp Detail and HSL report pipelines.

  /** Queries ramp point events from layers 132, 123 (via shared pipeline), and 151 for the given measure segments. */
  async function queryAttributeSet(segments, district = null, county = null) {
    // Build one OR clause per segment (each segment is one alignment: R or L)
    // Small epsilon on both bounds absorbs floating-point drift from translate API
    const segClauses = segments.flatMap(({ fromBest, toBest }) => {
      const rid   = fromBest.routeId.endsWith('_S') ? fromBest.routeId.slice(0, -2) + '_P' : fromBest.routeId;
      const ridS  = rid.slice(0, -1) + 'S';
      const fromM = Math.min(fromBest.measure, toBest.measure) - 0.005;
      const toM   = Math.max(fromBest.measure, toBest.measure) + 0.005;
      return [
        `(RouteID = '${rid}' AND ARMeasure >= ${fromM} AND ARMeasure <= ${toM})`,
        `(RouteID = '${ridS}' AND ARMeasure >= ${fromM} AND ARMeasure <= ${toM})`
      ];
    });
    const uniqueSegClauses = [...new Set(segClauses)];

    const dateFilter     = getDateFilter();
    const districtFilter = district != null ? ` AND District = ${parseInt(district, 10)}` : '';
    const resolvedCounty = normalizeCountyCode(county);
    const countyFilter   = resolvedCounty != null ? ` AND County = '${resolvedCounty.replace(/'/g, "''")}'` : '';
    const where = uniqueSegClauses.length === 1
      ? uniqueSegClauses[0].slice(1, -1) + districtFilter + countyFilter + ' AND LRSToDate IS NULL' + dateFilter
      : `(${uniqueSegClauses.join(' OR ')})${districtFilter}${countyFilter} AND LRSToDate IS NULL${dateFilter}`;


    // Layer 132 is a point event layer — use standard feature layer query
    const body = new URLSearchParams({
      where,
      outFields:      'Ramp_Name,RouteID,ARMeasure,ODMeasure,County,RouteSuffix,PMPrefix,PMSuffix,PMMeasure,District,InventoryItemStartDate,InventoryItemEndDate',
      orderByFields:  'ARMeasure ASC',
      returnGeometry: 'true',
      ...versionParam(),
      f:              'json',
      token:          _token
    });


    let resp;
    try {
      resp = await fetch(`${CONFIG.mapServiceUrl}/132/query`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString()
      });
    } catch (e) {
      console.error('[queryRamps] network error:', e.message);
      return [];
    }

    if (!resp.ok) {
      console.error('[queryRamps] HTTP', resp.status, resp.statusText);
      return [];
    }

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      console.error('[queryRamps] invalid JSON');
      return [];
    }


    if (data.error) {
      const code = data.error.code;
      if (code === 498 || code === 499) { _token = null; login(); return []; }
      console.error(`[queryRamps] API error ${code}: ${data.error.message}`);
      return [];
    }

    const features = data.features;
    if (!Array.isArray(features)) return [];
    if (data.exceededTransferLimit) console.warn('[queryRamps] exceededTransferLimit — results truncated. Narrow the measure range.');

    // Build unique pairs keyed by Ramp_Name (keep first occurrence per name)
    const seenNames = new Set();
    const pairs = [];
    for (const f of features) {
      const a = f.attributes ?? {};
      const name = a.Ramp_Name;
      if (name != null && name !== '' && !seenNames.has(name)) {
        seenNames.add(name);
        pairs.push({
          type:        'ramp',
          name,
          routeId:     a.RouteID,
          arMeasure:   a.ARMeasure,
          odMeasure:   a.ODMeasure != null ? String(a.ODMeasure) : '',
          county:      a.County      ?? '',
          routeSuffix: a.RouteSuffix ?? '',
          pmPrefix:    a.PMPrefix    ?? '',
          pmSuffix:    a.PMSuffix    ?? '.',
          pmMeasure:   a.PMMeasure   ?? '',
          district:    a.District != null ? String(a.District).padStart(2, '0') : '',
          startDate:   a.InventoryItemStartDate ?? null,
          endDate:     a.InventoryItemEndDate   ?? null,
          x:           f.geometry?.x ?? null,
          y:           f.geometry?.y ?? null
        });
      }
    }

    // Translate AR → OD for all ramps so sort position reflects the
    // reference-date network state rather than the stale stored ODMeasure.
    const CHUNK = 200;
    const chunks = chunkArray(pairs, CHUNK);
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
        const result = xlated.find(r => r.measure != null)
                    ?? xlated[0];
        if (result?.measure != null) chunk[idx].odMeasure = String(result.measure);
      });
    }));
    return pairs;
  }

  // ── Shared: Pagination ───────────────────────────────────────────────────

  /**
   * Factory that returns {changePage, changePageFirst, changePageLast} bound
   * to the caller's state.  Each report passes its own getters/setters so the
   * three functions never need to be duplicated.
   * @param {()=>number}  getPage       - returns current page index
   * @param {(n:number)=>void} setPage  - sets current page index
   * @param {()=>number}  getTotalPages - returns total page count
   * @param {()=>void}    render        - re-renders the current page
   */
  function makePageController(getPage, setPage, getTotalPages, render) {
    return {
      changePage(delta) {
        const next = getPage() + delta;
        if (next < 0 || next >= getTotalPages()) return;
        setPage(next);
        render();
      },
      changePageFirst() {
        if (getPage() === 0) return;
        setPage(0);
        render();
      },
      changePageLast() {
        const last = getTotalPages() - 1;
        if (getPage() === last) return;
        setPage(last);
        render();
      }
    };
  }

  // Ramp detail / ramp summary pagination
  const _rdPageCtrl = makePageController(
    ()  => _currentPage,
    v   => { _currentPage = v; },
    ()  => Math.ceil(_allResults.length / PAGE_SIZE),
    ()  => renderPage()
  );
  function changePage(delta)  { _rdPageCtrl.changePage(delta); }
  function changePageFirst()  { _rdPageCtrl.changePageFirst(); }
  function changePageLast()   { _rdPageCtrl.changePageLast(); }

  function printAll() {
    if (document.getElementById('reportSelect').value === 'highway_sequence')    { hsl_printAll();  return; }
    if (document.getElementById('reportSelect').value === 'Ramp_Summary')        { rs_printAll();   return; }
    if (document.getElementById('reportSelect').value === 'intersection_detail') { intd_printAll(); return; }
    if (document.getElementById('reportSelect').value === 'intersection_summary'){ ints_printAll(); return; }
    const box = document.getElementById('rampResults');
    const saved = box.innerHTML;

    const routeLine3  = _routeLabel ? `Route: ${esc(_routeLabel)}&emsp;&emsp;&emsp;Direction: ${esc(_directionFrom)} &ndash; ${esc(_directionTo)}` : '';
    const reportTitle = renderActionBar('TASAS Selective Record Retrieval', 'TSAR - Ramp Detail', routeLine3, null, null);

    const rdOnOff = getOnOffFilter();
    const rdOnOffLabel =
      rdOnOff === 1 ? 'All On Ramps' :
      rdOnOff === 0 ? 'All Off Ramps' :
      rdOnOff === 2 ? 'All Other Ramps' : 'All Ramps';
    const coverPage = buildCoverPage({
      coverTitle:  'TSAR - RAMP DETAIL',
      reportTitle: _routeLabel ? `${rdOnOffLabel} on Route ${_routeLabel}` : rdOnOffLabel,
      refDate:     document.getElementById('refDate').value || null,
      district:    document.getElementById('districtSelect').value || null,
      county:      getDistrictCounty() || null,
      route:       _routeLabel || null,
    });

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

    const items = _allResults.map((p, i) => renderItem(p, i)).join('');

    const generatedFooter = `<div class="generated-on">Generated on ${esc(_generatedOn)}</div>`;

    box.innerHTML = `${coverPage}${reportTitle}${header}<ul class="ramp-list">${items}</ul>${generatedFooter}`;
    window.addEventListener('afterprint', () => { box.innerHTML = saved; }, { once: true });
    window.print();
  }

  function exportToExcel() {
    if (document.getElementById('reportSelect').value === 'highway_sequence')    { hsl_exportToExcel(); return; }
    if (document.getElementById('reportSelect').value === 'Ramp_Summary')        { alert('Export is not yet available for Ramp Summary.');        return; }
    if (document.getElementById('reportSelect').value === 'intersection_detail') { intd_exportToExcel(); return; }
    if (document.getElementById('reportSelect').value === 'intersection_summary'){ ints_exportToExcel(); return; }
    if (_allResults.length === 0) return;

    const headers  = ['Location', '', 'PM', 'Date of Record', '', 'HG', 'Area 4', '', 'City Code', 'R/U', 'Description'];

    const rows = _allResults.map((p) => {
      return [
        (p.district && p.county) ? `${p.district}-${String(p.county).padEnd(3, '.')}-${_routeLabel}` : '',
        (p.pmPrefix && p.pmPrefix !== '.') ? p.pmPrefix : '',
        padMeasure(p.pmMeasure),
        p.startDate != null ? formatDate(p.startDate) : '',
        p.pmSuffix === 'E' ? 'E' : '',
        p.pmSuffix === 'L' ? 'L' : (p.hwyGroup ?? ''),
        p.area4 === 1 ? 'Y' : p.area4 === 0 ? 'N' : '',
        p.cityCode    ?? '',
        p.popCode     ?? '',
        p.desc        ?? ''
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'TSAR - Ramp Detail');
    XLSX.writeFile(wb, 'highway_sequence_listing.xlsx');
  }

  // ── Shared: Utilities & date filters ─────────────────────────────────────

  // Returns a Promise that resolves true (Yes) or false (No).
  function showConfirm(message) {
    return new Promise(resolve => {
      document.getElementById('confirmModalMessage').textContent = message;
      const backdrop = document.getElementById('confirmModal');
      backdrop.classList.add('open');
      const yes = document.getElementById('confirmModalYes');
      const no  = document.getElementById('confirmModalNo');
      function done(result) {
        backdrop.classList.remove('open');
        yes.removeEventListener('click', onYes);
        no.removeEventListener('click',  onNo);
        resolve(result);
      }
      function onYes() { done(true);  }
      function onNo()  { done(false); }
      yes.addEventListener('click', onYes);
      no.addEventListener('click',  onNo);
    });
  }

  // Formats a numeric measure as NNN.NNN (3 digits each side of decimal)
  function formatDate(ts) {
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  }

  function padMeasure(val) {
    if (val === '' || val == null) return '';
    const num = parseFloat(val);
    if (isNaN(num)) return '';
    const [intPart, decPart] = num.toFixed(3).split('.');
    return intPart.padStart(3, '0') + '.' + decPart;
  }

  function esc(str) {
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getDistrictCounty() {
    const val = document.getElementById('districtCountySelect')?.value;
    return val || null; // null means ALL → no filter
  }

  function getOnOffFilter() {
    let val;
    const onOffSection = document.getElementById('onOffSection');
    if (onOffSection?.style.display !== 'none')
      val = document.getElementById('onOffFilter')?.value;
    else
      val = document.getElementById('translateOnOffFilter')?.value;
    return val === '' || val == null ? null : Number(val);
  }

  function getDateFilter(startField = 'InventoryItemStartDate', endField = 'InventoryItemEndDate') {
    const val = document.getElementById('refDate').value; // "YYYY-MM-DD"
    if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return '';
    const ts = `TIMESTAMP '${val} 00:00:00'`;
    return ` AND ${startField} <= ${ts}` +
           ` AND (${endField} IS NULL OR ${endField} > ${ts})`;
  }

  // ── Shared: Report header helpers ────────────────────────────────────────

  // Builds the three-column action bar with optional Export/Print buttons.
  // Pass null for onExport or onPrint to render an empty spacer instead.
  function renderActionBar(line1, line2, line3, onExport, onPrint) {
    const exportBtn = onExport ? `<button class="export-btn" onclick="${onExport}">Export</button>` : '<div></div>';
    const printBtn  = onPrint  ? `<button class="export-btn" onclick="${onPrint}">Print</button>`   : '<div></div>';
    const route3    = line3    ? `<div class="report-title-line3">${line3}</div>`                    : '';
    return `<div class="report-action-bar">
         ${exportBtn}
         <div class="report-title">
           <div class="report-title-line1">${line1}</div>
           <div class="report-title-line2">${line2}</div>
           ${route3}
         </div>
         ${printBtn}
       </div>`;
  }

  // Builds a print cover page HTML string.
  // coverTitle  : large title shown on the cover (e.g. "TSAR - RAMP DETAIL")
  // reportTitle : value for the REPORT TITLE row
  // refDate     : ISO date string (YYYY-MM-DD) or null
  // district, county, route : strings or null for location criteria
  function buildCoverPage({ coverTitle, reportTitle, refDate, district, county, route }) {
    const fmtDate = (iso) => {
      if (!iso) return '';
      const [y, m, d] = iso.split('-');
      return `${m}/${d}/${y}`;
    };
    const todayMDY = () => {
      const n = new Date();
      return `${String(n.getMonth()+1).padStart(2,'0')}/${String(n.getDate()).padStart(2,'0')}/${n.getFullYear()}`;
    };
    const cpRow = (name, val) =>
      `<tr><td class="cp-name">${esc(name)}</td><td class="cp-sep">:</td><td>${esc(val)}</td></tr>`;
    const locRows = [
      district ? `<tr><td class="cp-name">DISTRICT</td><td class="cp-sep"></td><td>${esc(district)}</td></tr>` : '',
      county   ? `<tr><td class="cp-name">COUNTY</td><td class="cp-sep"></td><td>${esc(county)}</td></tr>`   : '',
      route    ? `<tr><td class="cp-name">ROUTE</td><td class="cp-sep"></td><td>${esc(route)}</td></tr>`     : '',
    ].filter(Boolean).join('') || `<tr><td colspan="3">All Districts / All Counties / All Routes</td></tr>`;

    return `<div class="rs-cover">
       <div class="rs-cover-agency">California Department of Transportation</div>
       <div class="rs-cover-report-title">${esc(coverTitle)}</div>
       <div class="rs-cover-section">
         <div class="rs-cover-section-label">REPORT PARAMETERS:</div>
         <table class="rs-cover-table">
           ${cpRow('REPORT DATE',    todayMDY())}
           ${cpRow('REFERENCE DATE', fmtDate(refDate))}
           ${cpRow('SUBMITTOR',      _portalUsername)}
           ${cpRow('REPORT TITLE',   reportTitle)}
         </table>
       </div>
       <div class="rs-cover-section">
         <div class="rs-cover-section-label">LOCATION CRITERIA:</div>
         <table class="rs-cover-table">${locRows}</table>
       </div>
     </div>`;
  }
