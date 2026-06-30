/* Mission Visualizer — satellite overlay (NASA GIBS / CMR)
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    function showSatLoader() { const ov=document.getElementById('satLoadingOverlay'); if(ov) ov.classList.add('show'); }
    function hideSatLoader() { const ov=document.getElementById('satLoadingOverlay'); if(ov) ov.classList.remove('show'); }

    function updateSatTimeBadge() {
        const badge = document.getElementById('satTimeBadge');
        if (!badge) return;
        const satSel = document.getElementById('satelliteSelect');
        const on2d = satSel && satSel.value !== 'none' && (!trackerModeSelect || trackerModeSelect.value === '2d');
        if (!on2d) { satUnavailableNote = null; badge.classList.add('hidden'); return; }
        // GOES requested for a date outside the GIBS rolling archive — explain instead of showing nothing.
        if (satUnavailableNote) { badge.innerHTML = satUnavailableNote; badge.classList.remove('hidden'); return; }
        if (!satLoadedInfo || !satImageLoaded || !satSel || satSel.value === 'none') {
            badge.classList.add('hidden');
            return;
        }
        const row = filteredData[currentIdx];
        if (!row || flightMetaData.date === 'Unknown') { badge.classList.add('hidden'); return; }
        const flightMs = new Date(flightMetaData.date + 'T00:00:00Z').getTime() + row.absSeconds * 1000;

        const imgMs = satLoadedInfo.imageTimeMs;
        const fmt = (ms, withTime) => {
            const d = new Date(ms);
            const Y=d.getUTCFullYear(), M=String(d.getUTCMonth()+1).padStart(2,'0'), D=String(d.getUTCDate()).padStart(2,'0'),
                  h=String(d.getUTCHours()).padStart(2,'0'), m=String(d.getUTCMinutes()).padStart(2,'0');
            return withTime ? `${Y}-${M}-${D} ${h}:${m}Z` : `${Y}-${M}-${D}`;
        };

        let imgLabel;
        if (satLoadedInfo.isModis) {
            if (satLoadedInfo.modisTimePending) {
                imgLabel = fmt(imgMs, false) + ' (looking up overpass time…)';
            } else if (satLoadedInfo.modisExact) {
                imgLabel = fmt(imgMs, true) + ' (actual overpass)';
            } else {
                imgLabel = fmt(imgMs, false) + ' (daily composite)';
            }
        } else if (satLoadedInfo.isGoes) {
            imgLabel = fmt(imgMs, true) + ` (${satLoadedInfo.cadenceMin || 10}-min scan)`;
        } else {
            imgLabel = fmt(imgMs, true);
        }

        const diffMs = imgMs - flightMs;
        const absMin = Math.abs(diffMs) / 60000;
        let offStr;
        if (satLoadedInfo.isModis && satLoadedInfo.modisTimePending) {
            offStr = '';
        } else if (absMin < 1) {
            offStr = 'matches flight time';
        } else if (absMin < 60) {
            offStr = `${Math.round(absMin)} min ${diffMs >= 0 ? 'AFTER' : 'BEFORE'} this point`;
        } else if (absMin < 1440) {
            offStr = `${(absMin/60).toFixed(1)} hr ${diffMs >= 0 ? 'AFTER' : 'BEFORE'} this point`;
        } else {
            offStr = `${Math.round(absMin/1440)} day(s) ${diffMs >= 0 ? 'AFTER' : 'BEFORE'} this point`;
        }

        const closeThresh = satLoadedInfo.isModis ? 90 : 15;
        const within = absMin <= closeThresh;
        badge.innerHTML = `🛰 ${satLoadedInfo.layerLabel}<br>`
            + `Image: <b>${imgLabel}</b><br>`
            + (offStr ? `<span style="color:${within ? '#4ade80' : '#fbbf24'}">${offStr}</span>` : '');
        badge.classList.remove('hidden');
    }

    const GIBS_LAYERS = [
        { value:'MODIS-TERRA',  baseLabel:'Terra Pass', wmsPrefix:'MODIS_Terra_', shortName:'MOD09', swath:true,
          bands: [
              {id:'CorrectedReflectance_TrueColor', name:'True Color'}, 
              {id:'CorrectedReflectance_Bands721', name:'False Color (Bands 7-2-1)'},
              {id:'Brightness_Temp_Band31_Day', name:'Infrared (Band 31)'}
          ] 
        },
        { value:'VIIRS-SNPP',   baseLabel:'SNPP Pass', wmsPrefix:'VIIRS_SNPP_', shortName:'VNP09', swath:true, minDate:'2015-11-24',
          bands: [
              {id:'CorrectedReflectance_TrueColor', name:'True Color'}, 
              {id:'CorrectedReflectance_BandsM11-I2-I1', name:'False Color (M11-I2-I1)'},
              {id:'Brightness_Temp_BandM15_Day', name:'Infrared (Band M15)'}
          ] 
        },
        { value:'VIIRS-NOAA20', baseLabel:'NOAA20 Pass', wmsPrefix:'VIIRS_NOAA20_', shortName:'VJ109', swath:true, minDate:'2018-01-05',
          bands: [
              {id:'CorrectedReflectance_TrueColor', name:'True Color'}, 
              {id:'CorrectedReflectance_BandsM11-I2-I1', name:'False Color (M11-I2-I1)'},
              {id:'Brightness_Temp_BandM15_Day', name:'Infrared (Band M15)'}
          ] 
        },
        { value:'MODIS-AQUA',   baseLabel:'Aqua Pass', wmsPrefix:'MODIS_Aqua_', shortName:'MYD09', swath:true,
          bands: [
              {id:'CorrectedReflectance_TrueColor', name:'True Color'},
              {id:'CorrectedReflectance_Bands721', name:'False Color (Bands 7-2-1)'},
              {id:'Brightness_Temp_Band31_Day', name:'Infrared (Band 31)'}
          ]
        },
        // GOES geostationary imagery (NASA GIBS, EPSG:4326 WMS). Listed LAST. Unlike the polar
        // swaths above, GOES updates ~every 10 min, so its TIME dimension is a full timestamp tied
        // to the playback clock (rounded down to the cadence). Each "band" id is a full GIBS layer
        // name. `subLon` = the satellite's sub-point longitude, used for the in-view coverage test.
        // GIBS only archives a rolling ~90 days, so the labels say so.
        { value:'GOES-EAST', baseLabel:'GOES-East (<90 days)', isGoes:true, cadenceMin:10, minDate:'2018-01-01', subLon:-75.2,
          bands: [
              {id:'GOES-East_ABI_Band13_Clean_Infrared', name:'Clean IR — Band 13'},
              {id:'GOES-East_ABI_GeoColor',              name:'GeoColor (Day/Night)'},
              {id:'GOES-East_ABI_Band2_Red_Visible_1km', name:'Red Visible — Band 2'},
              {id:'GOES-East_ABI_Air_Mass',              name:'Air Mass RGB'},
              {id:'GOES-East_ABI_Dust',                  name:'Dust / Saharan Air Layer'}
          ]
        },
        { value:'GOES-WEST', baseLabel:'GOES-West (<90 days)', isGoes:true, cadenceMin:10, minDate:'2018-01-01', subLon:-137.0,
          bands: [
              {id:'GOES-West_ABI_Band13_Clean_Infrared', name:'Clean IR — Band 13'},
              {id:'GOES-West_ABI_GeoColor',              name:'GeoColor (Day/Night)'},
              {id:'GOES-West_ABI_Band2_Red_Visible_1km', name:'Red Visible — Band 2'},
              {id:'GOES-West_ABI_Air_Mass',              name:'Air Mass RGB'},
              {id:'GOES-West_ABI_Dust',                  name:'Dust / Saharan Air Layer'}
          ]
        }
    ];

    const SAT_DAY_RANGE = 2;
    const SAT_BBOX_MARGIN = 0.6;
    let satDayOffset = 0;
    let satFetchBox = null;

    // The layer def currently chosen in the dropdown (or null).
    function selectedSatLayerDef() {
        const s = document.getElementById('satelliteSelect');
        return s ? GIBS_LAYERS.find(d => d.value === s.value) : null;
    }
    // Format an epoch-ms as a GIBS full-timestamp TIME value: YYYY-MM-DDTHH:MM:00Z.
    function goesTimeStr(ms) {
        const d = new Date(ms);
        const Y=d.getUTCFullYear(), M=String(d.getUTCMonth()+1).padStart(2,'0'), D=String(d.getUTCDate()).padStart(2,'0'),
              h=String(d.getUTCHours()).padStart(2,'0'), m=String(d.getUTCMinutes()).padStart(2,'0');
        return `${Y}-${M}-${D}T${h}:${m}:00Z`;
    }
    // Flight UTC time of a sample, rounded DOWN to the layer's scan cadence (e.g. nearest 10 min).
    function goesBucketMs(layerDef, absSeconds) {
        if (flightMetaData.date === 'Unknown') return null;
        const cadMs = (layerDef.cadenceMin || 10) * 60000;
        const ms = new Date(flightMetaData.date + 'T00:00:00Z').getTime() + absSeconds * 1000;
        return Math.floor(ms / cadMs) * cadMs;
    }
    // NASA GIBS only keeps a rolling ~3-month archive of GOES; older imagery isn't served
    // (a blank tile comes back). Historical flights fall outside this, so we detect it up front.
    const GIBS_GOES_WINDOW_DAYS = 90;
    function goesOutsideGibsWindow(goesMs) {
        return (Date.now() - goesMs) > GIBS_GOES_WINDOW_DAYS * 86400000;
    }
    // When set, the sat time-badge shows this note instead of imagery info (e.g. "out of GIBS window").
    let satUnavailableNote = null;
    let _goesLabelMs = null;  // last 10-min bucket reflected in the GOES dropdown label

    // --- GOES Earth-disk coverage: a geostationary sat at `subLon` can only usefully see points
    // within ~65° (geocentric angle) of its sub-point; past that it's extreme limb / no data.
    const GOES_VIEW_LIMIT_DEG = 65;
    function flightToSubSatAngle(subLon) {
        if (!filteredData || filteredData.length === 0) return 999;
        const c = filteredData[Math.floor(filteredData.length / 2)];
        const latR = c.lat * Math.PI / 180, dLonR = (c.lon - subLon) * Math.PI / 180;
        let cosA = Math.cos(latR) * Math.cos(dLonR);
        cosA = Math.max(-1, Math.min(1, cosA));
        return Math.acos(cosA) * 180 / Math.PI;
    }
    function goesInCoverage(layerDef) {
        return layerDef.subLon == null || flightToSubSatAngle(layerDef.subLon) <= GOES_VIEW_LIMIT_DEG;
    }
    // Label a GOES dropdown option: disable + "out of view" if the flight isn't in this sat's disk,
    // otherwise show the ~scan time for the current playback position (ticks as the clock advances).
    function setGoesOptionState(opt, layerDef) {
        const inCov = goesInCoverage(layerDef);
        opt.disabled = !inCov;
        if (!inCov) { opt.textContent = `${layerDef.baseLabel} — out of view`; return; }
        const row = (filteredData[currentIdx] || filteredData[Math.floor(filteredData.length / 2)]);
        const ms = row ? goesBucketMs(layerDef, row.absSeconds) : null;
        if (ms != null) {
            const d = new Date(ms);
            opt.textContent = `${layerDef.baseLabel} [~${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}Z]`;
        } else {
            opt.textContent = layerDef.baseLabel;
        }
    }

    function computeSatFetchBox() {
        // Always fetch a wide synoptic composite (~90°×60°) centered on the flight — good for
        // planetary/synoptic context; capped resolution keeps it to a single image.
        const cLon = (plotMinLon + plotMaxLon) / 2, cLat = (plotMinLat + plotMaxLat) / 2;
        satFetchBox = {
            minLon: Math.max(-180, cLon - 45), maxLon: Math.min(180, cLon + 45),
            minLat: Math.max(-85,  cLat - 30), maxLat: Math.min(85,  cLat + 30),
        };
    }

    const _satChk = document.createElement('canvas');
    _satChk.width = _satChk.height = 32;
    const _satChkCtx = _satChk.getContext('2d', { willReadFrequently: true });
    
    function satImageHasContent(src) {
        try {
            _satChkCtx.clearRect(0, 0, 32, 32);
            _satChkCtx.drawImage(src, 0, 0, 32, 32);
            const d = _satChkCtx.getImageData(0, 0, 32, 32).data;
            let alphaHits = 0, lumSum = 0, lumMin = 255, lumMax = 0, n = 0;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i+3] > 10) alphaHits++;
                const lum = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
                lumSum += lum; if (lum < lumMin) lumMin = lum; if (lum > lumMax) lumMax = lum;
                n++;
            }
            return alphaHits > 4 && ((lumMax - lumMin) > 8 || (lumSum / n) > 6);
        } catch(e) {}
        return false;
    }

    function satDateForOffset(offset) {
        if (flightMetaData.date === 'Unknown') return null;
        const d = new Date(flightMetaData.date + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + offset);
        const Y=d.getUTCFullYear(), M=String(d.getUTCMonth()+1).padStart(2,'0'), D=String(d.getUTCDate()).padStart(2,'0');
        return Y+'-'+M+'-'+D;
    }

    function updateSatelliteDropdownTimes() {
        const satSelect = document.getElementById('satelliteSelect');
        if (!satSelect || flightMetaData.date === 'Unknown' || filteredData.length === 0) return;
        
        const dateStr = satDateForOffset(satDayOffset);
        if (!dateStr) return;
        
        const centerRow = filteredData[Math.floor(filteredData.length / 2)];
        const lon = centerRow.lon;
        const lat = centerRow.lat;

        for (let i = 0; i < satSelect.options.length; i++) {
            const opt = satSelect.options[i];
            if (opt.value === 'none') continue;
            
            const layerDef = GIBS_LAYERS.find(d => d.value === opt.value);
            if (!layerDef) continue;
            // GOES has no polar overpass to look up — label it with coverage + ~scan time instead.
            if (layerDef.isGoes) { setGoesOptionState(opt, layerDef); continue; }

            opt.textContent = `${layerDef.baseLabel} (Searching...)`;

            lookupModisGranuleTime(layerDef.shortName, dateStr, lon, lat).then(g => {
                if (g && g.timeStart) {
                    const s = new Date(g.timeStart).getTime(), e = new Date(g.timeEnd).getTime();
                    const midMs = s + (e - s) / 2;
                    const fmtDate = new Date(midMs);
                    const hh = String(fmtDate.getUTCHours()).padStart(2, '0');
                    const mm = String(fmtDate.getUTCMinutes()).padStart(2, '0');
                    opt.textContent = `${layerDef.baseLabel} [${hh}:${mm}Z]`;
                    
                    if (satSelect.value === layerDef.value && satLoadedInfo) {
                        satLoadedInfo.imageTimeMs = midMs;
                        satLoadedInfo.modisTimePending = false;
                        satLoadedInfo.modisExact = true;
                        updateSatTimeBadge();
                    }
                } else {
                    opt.textContent = `${layerDef.baseLabel} [Daily]`;
                    if (satSelect.value === layerDef.value && satLoadedInfo) {
                        satLoadedInfo.modisTimePending = false;
                        updateSatTimeBadge();
                    }
                }
            });
        }
    }

    function updateSatelliteOptions() {
        const satSelect = document.getElementById('satelliteSelect');
        const bandSelect = document.getElementById('satBandSelect');
        if (!satSelect || !bandSelect) return;
        
        const prevVal = satSelect.value;
        satSelect.innerHTML = '<option value="none">Sat: Off</option>';
        const fDate = flightMetaData.date;  
        
        GIBS_LAYERS.forEach(def => {
            if (def.minDate && fDate !== 'Unknown' && fDate < def.minDate) return;
            const el = document.createElement('option');
            el.value = def.value;
            el.textContent = def.baseLabel;
            if (def.isGoes && !goesInCoverage(def)) el.disabled = true;  // out of this sat's Earth-disk view
            satSelect.appendChild(el);
        });
        // Keep the previous choice only if it's still selectable (present and not disabled).
        const stillOk = [...satSelect.options].some(o => o.value === prevVal && !o.disabled);
        satSelect.value = stillOk ? prevVal : 'none';

        updateBandOptions();

        satDayOffset = 0;
        _goesLabelMs = null;
        buildSatDayStepper();
        const in2dMode = !trackerModeSelect || trackerModeSelect.value === '2d';
        satSelect.style.display = in2dMode ? '' : 'none';
        bandSelect.style.display = (in2dMode && satSelect.value !== 'none') ? '' : 'none';

        satImageLoaded = false; lastSatFetchTime = ''; bgNeedsUpdate = true;

        updateSatelliteDropdownTimes();
    }

    function updateBandOptions() {
        const satSelect = document.getElementById('satelliteSelect');
        const bandSelect = document.getElementById('satBandSelect');
        if (!satSelect || !bandSelect) return;
        _goesLabelMs = null;  // re-sync the GOES scan-time label after a layer/band change

        if (satSelect.value === 'none') {
            bandSelect.innerHTML = '';
            bandSelect.style.display = 'none';
            return;
        }

        const layerDef = GIBS_LAYERS.find(d => d.value === satSelect.value);
        if (layerDef && layerDef.bands) {
            bandSelect.innerHTML = '';
            layerDef.bands.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id;
                opt.textContent = b.name;
                bandSelect.appendChild(opt);
            });
            bandSelect.style.display = '';
        }
    }

    let _satStepperWired = false;
    function buildSatDayStepper() {
        const wrap = document.getElementById('satDayStepper');
        const satSelect = document.getElementById('satelliteSelect');
        const bandSelect = document.getElementById('satBandSelect');
        if (!wrap || !satSelect) return;
        if (!_satStepperWired) {
            const prev = document.getElementById('satDayPrev');
            const next = document.getElementById('satDayNext');
            if (prev) prev.addEventListener('click', () => stepSatDay(-1));
            if (next) next.addEventListener('click', () => stepSatDay(1));
            _satStepperWired = true;
        }
        const in2d = !trackerModeSelect || trackerModeSelect.value === '2d';
        const layerDef = GIBS_LAYERS.find(d => d.value === satSelect.value);
        const isGoes = !!(layerDef && layerDef.isGoes);
        const satOn = satSelect.value !== 'none';
        // Band picker is shown for any active 2D layer (including GOES); the day-stepper is
        // for browsing polar-orbiter calendar days, so it stays hidden for GOES.
        bandSelect.style.display = (in2d && satOn) ? '' : 'none';
        const active = in2d && satOn && flightMetaData.date !== 'Unknown' && !isGoes;
        if (active) { wrap.classList.remove('hidden'); wrap.classList.add('flex'); }
        else { wrap.classList.add('hidden'); wrap.classList.remove('flex'); }
        updateSatDayLabel();
    }
    
    function updateSatDayLabel() {
        const lbl = document.getElementById('satDayLabel');
        if (!lbl) return;
        const ds = satDateForOffset(satDayOffset) || '';
        const tag = satDayOffset === 0 ? 'flight day' : (satDayOffset < 0 ? satDayOffset + 'd' : '+' + satDayOffset + 'd');
        lbl.innerHTML = ds + '<br>' + tag;
        const prev = document.getElementById('satDayPrev'), next = document.getElementById('satDayNext');
        if (prev) prev.disabled = satDayOffset <= -SAT_DAY_RANGE;
        if (next) next.disabled = satDayOffset >=  SAT_DAY_RANGE;
    }
    
    function stepSatDay(dir) {
        const n = satDayOffset + dir;
        if (n < -SAT_DAY_RANGE || n > SAT_DAY_RANGE) return;
        satDayOffset = n;
        updateSatDayLabel();
        updateSatelliteDropdownTimes();
        satImageLoaded = false; lastSatFetchTime = ''; bgNeedsUpdate = true;
        if (filteredData.length > 0 && trackerModeSelect.value === '2d') {
            fetchSatelliteImage(filteredData[currentIdx].absSeconds);
        }
    }

    // Generic GIBS EPSG:4326 GetMap → canvas. `timeStr` is a date (polar) or full timestamp (GOES).
    function fetchGibsWMS(wmsLayerName, timeStr, box, pxW, pxH) {
        const url = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'
            + '?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1'
            + '&LAYERS=' + encodeURIComponent(wmsLayerName)
            + '&FORMAT=image%2Fjpeg&TRANSPARENT=false'
            + '&WIDTH=' + pxW + '&HEIGHT=' + pxH
            + '&SRS=EPSG:4326'
            + '&BBOX=' + box.minLon + ',' + box.minLat + ',' + box.maxLon + ',' + box.maxLat
            + '&TIME=' + encodeURIComponent(timeStr);
        return new Promise(res => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = pxW; c.height = pxH;
                c.getContext('2d').drawImage(img, 0, 0);
                res(c);
            };
            img.onerror = () => res(null);
            img.src = url;
        });
    }

    let _cmrCache = {};
    async function lookupModisGranuleTime(shortName, dateStr, pointLon, pointLat) {
        if (!dateStr) return null;
        const pad = 0.1;
        const bbox = (pointLon - pad).toFixed(3) + ',' + (pointLat - pad).toFixed(3) + ','
                   + (pointLon + pad).toFixed(3) + ',' + (pointLat + pad).toFixed(3);
        const cacheKey = shortName + '|' + dateStr + '|' + bbox;
        if (_cmrCache[cacheKey] !== undefined) return _cmrCache[cacheKey];
        const url = 'https://cmr.earthdata.nasa.gov/search/granules.json'
            + '?short_name=' + shortName
            + '&temporal=' + dateStr + 'T00:00:00Z,' + dateStr + 'T23:59:59Z'
            + '&bounding_box=' + bbox
            + '&page_size=20&sort_key=start_date';
        try {
            const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!resp.ok) { _cmrCache[cacheKey] = null; return null; }
            const data = await resp.json();
            const entries = (data.feed && data.feed.entry) || [];
            if (!entries.length) { _cmrCache[cacheKey] = null; return null; }
            
            let best = null, bestDist = Infinity;
            entries.forEach(e => {
                if (!e.time_start) return;
                let gLon = pointLon, gLat = pointLat;
                if (e.boxes && e.boxes[0]) {
                    const p = e.boxes[0].split(' ').map(parseFloat);
                    if (p.length === 4) { gLat = (p[0]+p[2])/2; gLon = (p[1]+p[3])/2; }
                }
                const dist = Math.abs(gLon - pointLon) + Math.abs(gLat - pointLat);
                if (dist < bestDist) { bestDist = dist; best = e; }
            });
            const result = best ? { timeStart: best.time_start, timeEnd: best.time_end || best.time_start } : null;
            _cmrCache[cacheKey] = result;
            return result;
        } catch(e) { _cmrCache[cacheKey] = null; return null; }
    }

    function fetchSatelliteImage(absSeconds) {
        const satSelect = document.getElementById('satelliteSelect');
        const bandSelect = document.getElementById('satBandSelect');
        if (!satSelect || satSelect.value === 'none' || !bandSelect) return;
        if (flightMetaData.date === 'Unknown') return;
        if (!canvas.width || !canvas.height) return;

        const layerDef = GIBS_LAYERS.find(d => d.value === satSelect.value);
        if (!layerDef) return;
        const bandId = bandSelect.value;

        computeSatFetchBox();
        const box = satFetchBox;
        const dateStr = satDateForOffset(satDayOffset);
        if (!dateStr) return;

        const isGoes = !!layerDef.isGoes;
        const bandName = (layerDef.bands.find(b => b.id === bandId) || {}).name || bandId;
        // GOES tracks the playback clock (full timestamp rounded to its scan cadence);
        // polar layers (MODIS/VIIRS) use the calendar day picked by the day-stepper.
        const goesShortLabel = layerDef.baseLabel.replace(' (<90 days)', '');
        let wmsLayer, wmsTime, idTimePart, goesMs = null;
        if (isGoes) {
            // Out of this satellite's Earth-disk view — bail with a clear note (option is also disabled).
            if (!goesInCoverage(layerDef)) {
                satImageLoaded = false; satImage = new Image(); satLoadedInfo = null; bgNeedsUpdate = true;
                satUnavailableNote = `🛰 ${goesShortLabel} can't see this area<br><span style="color:#fbbf24">flight is outside the satellite's Earth-disk view</span>`;
                updateSatTimeBadge();
                if (trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
                return;
            }
            goesMs = goesBucketMs(layerDef, absSeconds);
            if (goesMs == null) return;
            // Keep the dropdown label's ~scan time in step with the playback clock.
            if (goesMs !== _goesLabelMs) {
                _goesLabelMs = goesMs;
                const selOpt = satSelect.options[satSelect.selectedIndex];
                if (selOpt) setGoesOptionState(selOpt, layerDef);
            }
            if (goesOutsideGibsWindow(goesMs)) {
                // GIBS has no GOES this old — don't fire a request that just returns a blank tile.
                satImageLoaded = false; satImage = new Image(); bgNeedsUpdate = true;
                const firstTime = !satUnavailableNote;
                satUnavailableNote = `🛰 GOES unavailable<br><span style="color:#fbbf24">Flight data older than 90 days</span>`;
                satLoadedInfo = null;
                updateSatTimeBadge();
                if (trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
                if (firstTime) showToast('Flight Data is older than 90 days. Cannot do archival GOES satellites due to HTML limitations.', 8000);
                return;
            }
            wmsLayer = bandId; wmsTime = goesTimeStr(goesMs); idTimePart = wmsTime;
        } else {
            wmsLayer = layerDef.wmsPrefix + bandId; wmsTime = dateStr; idTimePart = dateStr;
        }
        satUnavailableNote = null;  // a fetchable layer/date — clear any prior "unavailable" note

        const boxLonSpan = box.maxLon - box.minLon, boxLatSpan = box.maxLat - box.minLat;
        const aspect = boxLonSpan / boxLatSpan;
        const NATIVE_PX_PER_DEG = 111320 / 250;   
        const SAT_PX_CAP = 4096;                   
        const nativeW = Math.round(boxLonSpan * NATIVE_PX_PER_DEG);
        let pxW = Math.min(SAT_PX_CAP, Math.max(canvas.width, nativeW));
        let pxH = Math.round(pxW / aspect);
        if (pxH > SAT_PX_CAP) { pxH = SAT_PX_CAP; pxW = Math.round(pxH * aspect); }

        const fetchId = layerDef.value + '||' + bandId + '||' + idTimePart + '||' +
            box.minLon.toFixed(2)+','+box.minLat.toFixed(2)+','+box.maxLon.toFixed(2)+','+box.maxLat.toFixed(2);
        // Attempt each distinct target once. Mark it SYNCHRONOUSLY (not inside the debounce) so the
        // per-frame calls during playback don't keep resetting the timer — that bug meant a new GOES
        // 10-min bucket never actually loaded. Layer/band/day changes reset lastSatFetchTime to ''.
        if (lastSatFetchTime === fetchId) return;
        lastSatFetchTime = fetchId;

        clearTimeout(satDebounceTimer);
        satDebounceTimer = setTimeout(async () => {
            showSatLoader();
            try {
                let result = await fetchGibsWMS(wmsLayer, wmsTime, box, pxW, pxH);
                let usedMs = goesMs;
                let ok = result && satImageHasContent(result);
                // GOES: a given 10-min slot can be missing (housekeeping, eclipse season, a skipped
                // scan). Step back up to 40 min to show the most recent scan that actually exists.
                if (isGoes && !ok) {
                    const cadMs = (layerDef.cadenceMin || 10) * 60000;
                    for (let i = 1; i <= 4 && !ok; i++) {
                        const tMs = goesMs - i * cadMs;
                        if (goesOutsideGibsWindow(tMs)) break;
                        const r = await fetchGibsWMS(wmsLayer, goesTimeStr(tMs), box, pxW, pxH);
                        if (r && satImageHasContent(r)) { result = r; usedMs = tMs; ok = true; }
                    }
                }
                hideSatLoader();
                if (ok) {
                    satImage = result;
                    satImageBox = { minLon: box.minLon, minLat: box.minLat, maxLon: box.maxLon, maxLat: box.maxLat };
                    satImageLoaded = true;
                    bgNeedsUpdate = true;

                    if (isGoes) {
                        satLoadedInfo = {
                            layerLabel: goesShortLabel + ' · ' + bandName,
                            imageTimeMs: usedMs,
                            isModis: false,
                            isGoes: true,
                            cadenceMin: layerDef.cadenceMin || 10
                        };
                    } else {
                        const opt = satSelect.options[satSelect.selectedIndex];
                        let defaultTimeMs = new Date(dateStr + 'T00:00:00Z').getTime();
                        let exact = false;
                        let pending = true;
                        const timeMatch = opt.textContent.match(/\[(\d{2}):(\d{2})Z\]/);
                        if (timeMatch) {
                            const d = new Date(dateStr + 'T00:00:00Z');
                            d.setUTCHours(parseInt(timeMatch[1], 10));
                            d.setUTCMinutes(parseInt(timeMatch[2], 10));
                            defaultTimeMs = d.getTime();
                            exact = true;
                            pending = false;
                        } else if (opt.textContent.includes('[Daily]')) {
                            pending = false;
                        }
                        satLoadedInfo = {
                            layerLabel: layerDef.baseLabel,
                            imageTimeMs: defaultTimeMs,
                            isModis: true,
                            modisTimePending: pending,
                            modisExact: exact,
                            dayOffset: satDayOffset
                        };
                    }

                    updateSatTimeBadge();
                    if (trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);

                } else {
                    satImageLoaded = false; bgNeedsUpdate = true;
                    satLoadedInfo = null; updateSatTimeBadge();
                    showToast(isGoes
                        ? `GOES ${bandName}: no scan near ${goesTimeStr(goesMs).slice(11,16)}Z (slot missing, or — for a visible band — no daylight here right now).`
                        : 'Satellite: No imagery found for ' + idTimePart + ' in this band/area.', 6000);
                }
            } catch(e) {
                hideSatLoader(); satImageLoaded = false; bgNeedsUpdate = true;
            }
        }, 350);
    }
