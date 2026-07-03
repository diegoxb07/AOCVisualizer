/* Mission Visualizer - file/video upload + flight-log parser
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    document.getElementById('videoInput').addEventListener('change', function(e) {
        if (!e.target.files[0]) return;
        markDropZoneLoaded('videoDropZone', 'videoDropLabel', e.target.files[0].name);
        video.src = URL.createObjectURL(e.target.files[0]); document.getElementById('videoPlaceholder').style.display = 'none'; videoLoaded = true; 
        speeds = [1, 4, 8, 16]; currentSpeedIdx = 0; updateSpeedDisplay();
        videoSyncMode.disabled = false; document.getElementById('videoStartInput').disabled = false;
        if (allParsedData.length > 0) document.getElementById('videoStartInput').value = allParsedData[0].time;
        video.addEventListener('loadedmetadata', () => { updateEndWindowFromVideo(true); }, { once: true });
        video.addEventListener('seeking', syncTelemetryToVideoClock);
        evaluateAutoSyncDefault();
        video.addEventListener('loadeddata', () => { if (videoSyncMode.value === 'auto' && ocrAvailable) performImmediateOcrLock({ silent: true }); }, { once: true });
        setTimeout(() => { if (videoSyncMode.value === 'auto' && ocrAvailable && !isPlaying) performImmediateOcrLock({ silent: true }); }, 1000);
    });

    document.getElementById('fileInput').addEventListener('change', function(e) {
        if (!e.target.files[0]) return;
        markDropZoneLoaded('dataDropZone', 'dataDropLabel', e.target.files[0].name);
        const loader = document.getElementById('loadingOverlay'); loader.classList.remove('hidden'); loader.classList.add('flex');
        setTimeout(() => {
            currentSpeedIdx = 0; updateSpeedDisplay();
            const file = e.target.files[0]; const fName = file.name;
            const match = fName.match(/^(\d{4})(\d{2})(\d{2})([a-zA-Z])(.*)\./i);
            if (match) {
                flightMetaData.date = `${match[1]}-${match[2]}-${match[3]}`; const planeType = match[4].toUpperCase();
                if (planeType === 'H') flightMetaData.aircraft = 'NOAA42 (WP-3D Orion)'; else if (planeType === 'I') flightMetaData.aircraft = 'NOAA43 (WP-3D Orion)'; else if (planeType === 'N') flightMetaData.aircraft = 'NOAA49 (Gulfstream IV-SP)'; else flightMetaData.aircraft = 'Unknown';
                flightMetaData.id = match[0].replace('.', '');
            } else { flightMetaData.id = file.name; flightMetaData.date = 'Unknown'; flightMetaData.aircraft = 'Unknown'; }

            const ext = fName.split('.').pop().toLowerCase();
            if (ext === 'nc') {
                isNcFile = true; if (videoLoaded) videoSyncMode.disabled = false;
                const reader = new FileReader();
                reader.onload = function(evt) {
                    try {
                        parseEntireFile(ncArrayBufferToTsv(evt.target.result));
                    } catch (err) { document.getElementById('loadingOverlay').classList.add('hidden'); document.getElementById('loadingOverlay').classList.remove('flex'); }
                };
                reader.readAsArrayBuffer(file);
            } else {
                isNcFile = false; if (videoLoaded) videoSyncMode.disabled = false;
                const reader = new FileReader(); 
                reader.onload = function(evt) { parseEntireFile(evt.target.result); }; 
                reader.readAsText(file);
            }
        }, 50); 
    });

    // AOC flight files are named YYYYMMDD<plane>... - pull the UTC date the same way the loader does.
    function flightDateFromFilename(fName) {
        const match = fName.match(/^(\d{4})(\d{2})(\d{2})([a-zA-Z])(.*)\./i);
        return match ? `${match[1]}-${match[2]}-${match[3]}` : 'Unknown';
    }

    // Convert a NetCDF ArrayBuffer into the same tab-separated text the .txt parser consumes.
    // Shared by the single-file .nc loader and the multi-flight batch sat-cache.
    function ncArrayBufferToTsv(data) {
        const nc = new netcdfjs(data);
        const varNames = nc.variables.map(v => v.name); const varsData = {}; let numRows = 0;

        varNames.forEach(name => {
            let rawData = nc.getDataVariable(name); let variableDef = nc.variables.find(v => v.name === name);
            let scaleFactor = 1, addOffset = 0, fillValues = [];
            if (variableDef && variableDef.attributes) {
                variableDef.attributes.forEach(a => {
                    const lowerName = a.name.toLowerCase(); const val = Array.isArray(a.value) ? a.value[0] : a.value;
                    if (lowerName === 'scale_factor') scaleFactor = val; if (lowerName === 'add_offset') addOffset = val;
                    if (lowerName === '_fillvalue' || lowerName === 'missing_value') { if (Array.isArray(a.value)) fillValues.push(...a.value); else fillValues.push(a.value); }
                });
            }
            let unpacked = new Array(rawData.length);
            for(let k = 0; k < rawData.length; k++) { let rawVal = rawData[k]; if (fillValues.some(fv => Math.abs(fv - rawVal) < 0.0001)) { unpacked[k] = -9999; } else { unpacked[k] = (rawVal * scaleFactor) + addOffset; } }
            varsData[name] = unpacked; if (varsData[name].length > numRows) numRows = varsData[name].length;
        });

        let startSecs = -1, endSecs = -1;
        if (nc.globalAttributes) { nc.globalAttributes.forEach(attr => { if (attr.name === 'TimeInterval' && typeof attr.value === 'string') { const m = attr.value.match(/(\d{2}):(\d{2}):(\d{2})-(\d{2}):(\d{2}):(\d{2})/); if (m) { startSecs = parseInt(m[1])*3600 + parseInt(m[2])*60 + parseInt(m[3]); endSecs = parseInt(m[4])*3600 + parseInt(m[5])*60 + parseInt(m[6]); } } }); }
        if (startSecs === -1) { const decoder = new TextDecoder("utf-8"); const rawStr = decoder.decode(data.slice(0, Math.min(data.byteLength, 15000))); const tiMatch = rawStr.match(/TimeInterval.*?(\d{2}):(\d{2}):(\d{2})-(\d{2}):(\d{2}):(\d{2})/i); if (tiMatch) { startSecs = parseInt(tiMatch[1])*3600 + parseInt(tiMatch[2])*60 + parseInt(tiMatch[3]); endSecs = parseInt(tiMatch[4])*3600 + parseInt(tiMatch[5])*60 + parseInt(tiMatch[6]); } }

        let finalVarNames = varNames;
        if (startSecs !== -1 && endSecs !== -1 && numRows > 0) {
            if (endSecs < startSecs) endSecs += 86400;
            let totalDuration = endSecs - startSecs;
            finalVarNames = varNames.filter(n => n.toLowerCase() !== 'time'); finalVarNames.unshift('time');
            let timeArr = new Array(numRows);
            for (let i = 0; i < numRows; i++) {
                let curSecs = startSecs + (i / Math.max(1, numRows - 1)) * totalDuration;
                let h = Math.floor(curSecs / 3600) % 24, m = Math.floor((curSecs % 3600) / 60), s = Math.round(curSecs % 60);
                if (s === 60) { s = 0; m += 1; } if (m === 60) { m = 0; h += 1; }
                timeArr[i] = String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0');
            }
            varsData['time'] = timeArr;
        }

        let tsvStr = finalVarNames.join('\t') + '\n';
        for (let i = 0; i < numRows; i++) { let row = []; for (let j = 0; j < finalVarNames.length; j++) { let val = varsData[finalVarNames[j]][i]; row.push(val !== undefined && val !== null ? val : ''); } tsvStr += row.join('\t') + '\n'; }
        return tsvStr;
    }

    // Pure parse + clean of an AOC flight-log TSV string into cleaned rows, with NO globals/UI side
    // effects. MUST mirror the parse+clean logic inside parseEntireFile exactly, so the batch sat-cache
    // derives the same flight extent / time range (and thus identical satellite tile IDs) as playback.
    function parseFlightTextToRows(rawText) {
        const lines = rawText.split('\n');
        if (lines.length < 2) return [];
        const headers = lines[0].replace(/\r/g, '').split('\t').map(h => h.trim());
        const hMap = {}; headers.forEach((h, idx) => { if (h) hMap[h.toLowerCase()] = idx; });
        const getVal = (row, key) => { let k = key.toLowerCase(); if (hMap[k] !== undefined && row[hMap[k]] !== undefined && row[hMap[k]].trim() !== '') { const val = parseFloat(row[hMap[k]]); if (isNaN(val) || val <= -990) return null; return val; } return null; };

        let timeMax = -1; const tIdx = hMap['time'];
        if (tIdx !== undefined) { for (let i = 1; i < lines.length; i++) { const parts = lines[i].replace(/\r/g, '').split('\t'); if (parts.length > tIdx) { const v = parseFloat(parts[tIdx]); if (!isNaN(v) && v > timeMax) timeMax = v; } } }

        let firstSec = -1; let tempParsedData = [];
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].replace(/\r/g, '').split('\t'); if (parts.length < 10) continue;
            try {
                let timeStr = ""; const hhVal = getVal(parts, 'HH'); const mmVal = getVal(parts, 'MM'); const ssVal = getVal(parts, 'SS'); const mdsHour = getVal(parts, 'MDSHOUR.1');
                if (hhVal !== null && mmVal !== null && ssVal !== null) { timeStr = String(Math.floor(hhVal)).padStart(2, '0') + String(Math.floor(mmVal)).padStart(2, '0') + String(Math.floor(ssVal)).padStart(2, '0'); }
                else if (mdsHour !== null && mdsHour > 1000) { timeStr = String(Math.floor(mdsHour)).padStart(6, '0'); }
                else {
                    const timeRaw = getVal(parts, 'time');
                    if (timeRaw !== null) {
                        if (timeMax > 1000000000000) { let d = new Date(timeRaw); let h = d.getUTCHours(); let m = d.getUTCMinutes(); let s = d.getUTCSeconds(); timeStr = String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0'); }
                        else if (timeMax > 100000000) { let d = new Date(timeRaw * 1000); let h = d.getUTCHours(); let m = d.getUTCMinutes(); let s = d.getUTCSeconds(); timeStr = String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0'); }
                        else if (timeMax > 100000) { let h = Math.floor(timeRaw / 10000); let m = Math.floor((timeRaw % 10000) / 100); let s = Math.floor(timeRaw % 100); timeStr = String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0'); }
                        else { let secs = timeRaw; if (timeMax <= 24 && timeMax > 0) secs = timeRaw * 3600; else if (timeMax > 24 && timeMax <= 1000) secs = timeRaw * 60; let h = Math.floor(secs / 3600) % 24; let m = Math.floor((secs % 3600) / 60); let s = Math.floor(secs % 60); timeStr = String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0'); }
                    } else continue;
                }

                let currentSec = timeToSeconds(timeStr); if (firstSec === -1 && currentSec > 0) firstSec = currentSec;
                let absSeconds = currentSec; if (firstSec !== -1 && currentSec < firstSec - 43200) absSeconds += 86400;

                const lat = getVal(parts, 'LATref') ?? getVal(parts, 'LatGPS.1') ?? getVal(parts, 'LatGPS.2') ?? getVal(parts, 'LatGPS.3');
                const lon = getVal(parts, 'LONref') ?? getVal(parts, 'LonGPS.1') ?? getVal(parts, 'LonGPS.2') ?? getVal(parts, 'LonGPS.3');
                if (lat === null || lon === null || (Math.abs(lat) < 0.1 && Math.abs(lon) < 0.1) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

                let rawTas = getVal(parts, 'TAS.d') ?? getVal(parts, 'TASref'); let rawWs = getVal(parts, 'WS.d'); let rawVz = getVal(parts, 'UWZ.d'); let pressureVal = getVal(parts, 'PS.c') ?? getVal(parts, 'PSM.1') ?? getVal(parts, 'PSMref') ?? null;
                let altpa_d = getVal(parts, 'ALTPA.d'); let pAlt = altpa_d !== null ? altpa_d : (pressureVal !== null ? (1 - Math.pow(pressureVal / 1013.25, 0.190284)) * 44307.69 : null);
                let windSpdKt = getVal(parts, 'WSkt.d') ?? getVal(parts, 'WsIkt.1') ?? (rawWs !== null ? rawWs * 1.94384 : null);
                let tasKt = getVal(parts, 'TASkt.d') ?? getVal(parts, 'TASkt.1') ?? (rawTas !== null ? rawTas * 1.94384 : null);
                let iasKt = getVal(parts, 'IASkt.d') ?? getVal(parts, 'CasADDUkt.1') ?? (getVal(parts, 'IAS.d') !== null ? getVal(parts, 'IAS.d') * 1.94384 : null);
                let rawMixRate = getVal(parts, 'MRkg.d') ?? getVal(parts, 'MR.d') ?? null; let finalMixRate = (rawMixRate !== null && rawMixRate < 0.5) ? rawMixRate * 1000 : rawMixRate;

                tempParsedData.push({
                    time: timeStr, absSeconds: absSeconds, lat: lat, lon: lon, pressure: pressureVal, pAlt: pAlt,
                    windDir: getVal(parts, 'WD.d') ?? getVal(parts, 'WdI.1') ?? null, windSpd: windSpdKt, tempr: getVal(parts, 'TA.d') ?? getVal(parts, 'TaADDU.1') ?? null, dewpt: getVal(parts, 'TD.c') ?? getVal(parts, 'TDM.1') ?? getVal(parts, 'TDMref') ?? null,
                    sfcPr: getVal(parts, 'PSURF.d') ?? getVal(parts, 'SfmrAP.1') ?? null, driftAngle: getVal(parts, 'DA.d') ?? getVal(parts, 'DAI.1') ?? null, gTrack: getVal(parts, 'TRK.d') ?? getVal(parts, 'TrkI.1') ?? getVal(parts, 'TrkGPS.1') ?? null,
                    th: getVal(parts, 'THDGref') ?? getVal(parts, 'THdgI.1') ?? null, pitch: getVal(parts, 'PITCHref') ?? getVal(parts, 'PitchI.1') ?? null, roll: getVal(parts, 'ROLLref') ?? getVal(parts, 'RollI.1') ?? null,
                    alpha: getVal(parts, 'AA.1') ?? getVal(parts, 'AAref') ?? getVal(parts, 'PDALPHA.1') ?? getVal(parts, 'PDALPHAref') ?? null, beta: getVal(parts, 'SA.1') ?? getVal(parts, 'SAref') ?? getVal(parts, 'PDBETA.1') ?? getVal(parts, 'PDBETAref') ?? null,
                    tas: tasKt, ias: iasKt, gpsAlt: getVal(parts, 'ALTref') ?? getVal(parts, 'AltGPS.1') ?? getVal(parts, 'AltGPS.2') ?? getVal(parts, 'AltGPS.3') ?? getVal(parts, 'AltGPS.4') ?? null, radAlt: getVal(parts, 'AltRa.1') ?? (getVal(parts, 'AltRaft.1') !== null ? getVal(parts, 'AltRaft.1') * 0.3048 : null),
                    dValue: getVal(parts, 'DV.d') ?? null, vtWnd: rawVz, mixRate: finalMixRate, thetaE: getVal(parts, 'THETAE.d') ?? null, accZ: getVal(parts, 'ACCZref') ?? getVal(parts, 'AccZI.1') ?? null
                });
            } catch (err) { continue; }
        }

        if (tempParsedData.length === 0) return [];
        tempParsedData.sort((a,b) => a.absSeconds - b.absSeconds);
        let cleaned = [];
        for (let i = 0; i < tempParsedData.length; i++) {
            let current = tempParsedData[i];
            if (current.tas !== null && current.tas < 60) continue;
            if (cleaned.length === 0) { current.computedVsi = 0; cleaned.push(current); continue; }
            let prev = cleaned[cleaned.length - 1]; let dt = current.absSeconds - prev.absSeconds;
            if (dt <= 0) continue;
            if (dt > 3600) { cleaned = []; current.computedVsi = 0; cleaned.push(current); continue; }

            let latSpeed = Math.abs(current.lat - prev.lat) / dt; let lonSpeed = Math.abs(current.lon - prev.lon) / dt;
            if (latSpeed < 0.00001 && lonSpeed < 0.00001 && current.gpsAlt !== null && current.gpsAlt < 500) continue;
            if (latSpeed > 0.02 || lonSpeed > 0.02) continue;

            if (current.pAlt !== null && prev.pAlt !== null) current.computedVsi = ((current.pAlt - prev.pAlt) / dt);
            else if (current.gpsAlt !== null && prev.gpsAlt !== null) current.computedVsi = ((current.gpsAlt - prev.gpsAlt) / dt);
            else if (current.radAlt !== null && prev.radAlt !== null) current.computedVsi = ((current.radAlt - prev.radAlt) / dt);
            else current.computedVsi = 0;
            cleaned.push(current);
        }
        return cleaned;
    }

    function parseEntireFile(rawText) {
        const lines = rawText.split('\n');
        if (lines.length < 2) { document.getElementById('loadingOverlay').classList.add('hidden'); document.getElementById('loadingOverlay').classList.remove('flex'); return; }
        // New flight: KEEP the satellite tile cache (it accumulates across storms until the tab closes;
        // tiles are keyed by layer/band/time/box so they never collide between flights). Just reset the
        // preloader's neighborhood pointer so it re-warms around the new flight.
        if (typeof resetSatPreload === 'function') resetSatPreload();
        // New flight: any storm best-track / archive-mission metadata belonged to the PREVIOUS flight
        // (set after this function returns, by js/12b-recon-archive.js's loadReconMission for an
        // archive-loaded flight) - clear it here so a manual upload after an archive load doesn't keep
        // showing a stale storm's track, and so a fresh archive load starts from a clean slate too.
        stormTrackPoints = []; stormTrackMeta = null; reconArchiveMeta = null;
        // Same reasoning for the shareable ?mission= URL param - an archive load re-sets it after this returns.
        try { const u = new URL(window.location.href); if (u.searchParams.has('mission')) { u.searchParams.delete('mission'); history.replaceState(null, '', u); } } catch (e) {}
        const stormToggleLabel = document.getElementById('stormTrackToggleLabel'); if (stormToggleLabel) stormToggleLabel.style.display = 'none';
        const srcLink = document.getElementById('reconSourceLink'); if (srcLink) srcLink.classList.add('hidden');

        const headers = lines[0].replace(/\r/g, '').split('\t').map(h => h.trim());
        const hMap = {}; headers.forEach((h, idx) => { if (h) hMap[h.toLowerCase()] = idx; });
        const getVal = (row, key) => { let k = key.toLowerCase(); if (hMap[k] !== undefined && row[hMap[k]] !== undefined && row[hMap[k]].trim() !== '') { const val = parseFloat(row[hMap[k]]); if (isNaN(val) || val <= -990) return null; return val; } return null; };

        let timeMax = -1; const tIdx = hMap['time'];
        if (tIdx !== undefined) { for (let i = 1; i < lines.length; i++) { const parts = lines[i].replace(/\r/g, '').split('\t'); if (parts.length > tIdx) { const v = parseFloat(parts[tIdx]); if (!isNaN(v) && v > timeMax) timeMax = v; } } }

        let firstSec = -1; let tempParsedData = [];

        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].replace(/\r/g, '').split('\t'); if (parts.length < 10) continue;
            try {
                let timeStr = ""; const hhVal = getVal(parts, 'HH'); const mmVal = getVal(parts, 'MM'); const ssVal = getVal(parts, 'SS'); const mdsHour = getVal(parts, 'MDSHOUR.1');
                if (hhVal !== null && mmVal !== null && ssVal !== null) { timeStr = String(Math.floor(hhVal)).padStart(2, '0') + String(Math.floor(mmVal)).padStart(2, '0') + String(Math.floor(ssVal)).padStart(2, '0'); } 
                else if (mdsHour !== null && mdsHour > 1000) { timeStr = String(Math.floor(mdsHour)).padStart(6, '0'); } 
                else {
                    const timeRaw = getVal(parts, 'time');
                    if (timeRaw !== null) {
                        if (timeMax > 1000000000000) { let d = new Date(timeRaw); let h = d.getUTCHours(); let m = d.getUTCMinutes(); let s = d.getUTCSeconds(); timeStr = String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0'); } 
                        else if (timeMax > 100000000) { let d = new Date(timeRaw * 1000); let h = d.getUTCHours(); let m = d.getUTCMinutes(); let s = d.getUTCSeconds(); timeStr = String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0'); } 
                        else if (timeMax > 100000) { let h = Math.floor(timeRaw / 10000); let m = Math.floor((timeRaw % 10000) / 100); let s = Math.floor(timeRaw % 100); timeStr = String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0'); } 
                        else { let secs = timeRaw; if (timeMax <= 24 && timeMax > 0) secs = timeRaw * 3600; else if (timeMax > 24 && timeMax <= 1000) secs = timeRaw * 60; let h = Math.floor(secs / 3600) % 24; let m = Math.floor((secs % 3600) / 60); let s = Math.floor(secs % 60); timeStr = String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0'); }
                    } else continue;
                }

                let currentSec = timeToSeconds(timeStr); if (firstSec === -1 && currentSec > 0) firstSec = currentSec;
                let absSeconds = currentSec; if (firstSec !== -1 && currentSec < firstSec - 43200) absSeconds += 86400;

                const lat = getVal(parts, 'LATref') ?? getVal(parts, 'LatGPS.1') ?? getVal(parts, 'LatGPS.2') ?? getVal(parts, 'LatGPS.3'); 
                const lon = getVal(parts, 'LONref') ?? getVal(parts, 'LonGPS.1') ?? getVal(parts, 'LonGPS.2') ?? getVal(parts, 'LonGPS.3');
                if (lat === null || lon === null || (Math.abs(lat) < 0.1 && Math.abs(lon) < 0.1) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

                let rawTas = getVal(parts, 'TAS.d') ?? getVal(parts, 'TASref'); let rawWs = getVal(parts, 'WS.d'); let rawVz = getVal(parts, 'UWZ.d'); let pressureVal = getVal(parts, 'PS.c') ?? getVal(parts, 'PSM.1') ?? getVal(parts, 'PSMref') ?? null;
                let altpa_d = getVal(parts, 'ALTPA.d'); let pAlt = altpa_d !== null ? altpa_d : (pressureVal !== null ? (1 - Math.pow(pressureVal / 1013.25, 0.190284)) * 44307.69 : null);
                let windSpdKt = getVal(parts, 'WSkt.d') ?? getVal(parts, 'WsIkt.1') ?? (rawWs !== null ? rawWs * 1.94384 : null);
                let tasKt = getVal(parts, 'TASkt.d') ?? getVal(parts, 'TASkt.1') ?? (rawTas !== null ? rawTas * 1.94384 : null);
                let iasKt = getVal(parts, 'IASkt.d') ?? getVal(parts, 'CasADDUkt.1') ?? (getVal(parts, 'IAS.d') !== null ? getVal(parts, 'IAS.d') * 1.94384 : null);
                let rawMixRate = getVal(parts, 'MRkg.d') ?? getVal(parts, 'MR.d') ?? null; let finalMixRate = (rawMixRate !== null && rawMixRate < 0.5) ? rawMixRate * 1000 : rawMixRate;

                tempParsedData.push({ 
                    time: timeStr, absSeconds: absSeconds, lat: lat, lon: lon, pressure: pressureVal, pAlt: pAlt,
                    windDir: getVal(parts, 'WD.d') ?? getVal(parts, 'WdI.1') ?? null, windSpd: windSpdKt, tempr: getVal(parts, 'TA.d') ?? getVal(parts, 'TaADDU.1') ?? null, dewpt: getVal(parts, 'TD.c') ?? getVal(parts, 'TDM.1') ?? getVal(parts, 'TDMref') ?? null, 
                    sfcPr: getVal(parts, 'PSURF.d') ?? getVal(parts, 'SfmrAP.1') ?? null, driftAngle: getVal(parts, 'DA.d') ?? getVal(parts, 'DAI.1') ?? null, gTrack: getVal(parts, 'TRK.d') ?? getVal(parts, 'TrkI.1') ?? getVal(parts, 'TrkGPS.1') ?? null, 
                    th: getVal(parts, 'THDGref') ?? getVal(parts, 'THdgI.1') ?? null, pitch: getVal(parts, 'PITCHref') ?? getVal(parts, 'PitchI.1') ?? null, roll: getVal(parts, 'ROLLref') ?? getVal(parts, 'RollI.1') ?? null,
                    alpha: getVal(parts, 'AA.1') ?? getVal(parts, 'AAref') ?? getVal(parts, 'PDALPHA.1') ?? getVal(parts, 'PDALPHAref') ?? null, beta: getVal(parts, 'SA.1') ?? getVal(parts, 'SAref') ?? getVal(parts, 'PDBETA.1') ?? getVal(parts, 'PDBETAref') ?? null,
                    tas: tasKt, ias: iasKt, gpsAlt: getVal(parts, 'ALTref') ?? getVal(parts, 'AltGPS.1') ?? getVal(parts, 'AltGPS.2') ?? getVal(parts, 'AltGPS.3') ?? getVal(parts, 'AltGPS.4') ?? null, radAlt: getVal(parts, 'AltRa.1') ?? (getVal(parts, 'AltRaft.1') !== null ? getVal(parts, 'AltRaft.1') * 0.3048 : null), 
                    dValue: getVal(parts, 'DV.d') ?? null, vtWnd: rawVz, mixRate: finalMixRate, thetaE: getVal(parts, 'THETAE.d') ?? null, accZ: getVal(parts, 'ACCZref') ?? getVal(parts, 'AccZI.1') ?? null
                });
            } catch (err) { continue; }
        }

        if (tempParsedData.length === 0) { document.getElementById('loadingOverlay').classList.add('hidden'); document.getElementById('loadingOverlay').classList.remove('flex'); return; }
        
        tempParsedData.sort((a,b) => a.absSeconds - b.absSeconds);
        allParsedData = [];
        for (let i = 0; i < tempParsedData.length; i++) {
            let current = tempParsedData[i];
            if (current.tas !== null && current.tas < 60) continue; 
            if (allParsedData.length === 0) { current.computedVsi = 0; allParsedData.push(current); continue; }
            let prev = allParsedData[allParsedData.length - 1]; let dt = current.absSeconds - prev.absSeconds;
            if (dt <= 0) continue; 
            if (dt > 3600) { allParsedData = []; current.computedVsi = 0; allParsedData.push(current); continue; }

            let latSpeed = Math.abs(current.lat - prev.lat) / dt; let lonSpeed = Math.abs(current.lon - prev.lon) / dt;
            if (latSpeed < 0.00001 && lonSpeed < 0.00001 && current.gpsAlt !== null && current.gpsAlt < 500) continue;
            if (latSpeed > 0.02 || lonSpeed > 0.02) continue;

            if (current.pAlt !== null && prev.pAlt !== null) current.computedVsi = ((current.pAlt - prev.pAlt) / dt);
            else if (current.gpsAlt !== null && prev.gpsAlt !== null) current.computedVsi = ((current.gpsAlt - prev.gpsAlt) / dt);
            else if (current.radAlt !== null && prev.radAlt !== null) current.computedVsi = ((current.radAlt - prev.radAlt) / dt);
            else current.computedVsi = 0;
            allParsedData.push(current);
        }

        if (allParsedData.length === 0) { document.getElementById('loadingOverlay').classList.add('hidden'); document.getElementById('loadingOverlay').classList.remove('flex'); return; }
        
        availableMetrics.clear();
        allParsedData.forEach(row => { Object.keys(METRIC_DEFS).forEach(k => { if (row[k] !== null && row[k] !== undefined && !isNaN(row[k])) availableMetrics.add(k); }); });

        document.getElementById('detectedRangeText').innerText = `[ Detected: ${allParsedData[0].time.slice(0,2)}:${allParsedData[0].time.slice(2,4)} UTC → ${allParsedData[allParsedData.length-1].time.slice(0,2)}:${allParsedData[allParsedData.length-1].time.slice(2,4)} UTC ]`;
        updateMissionHeader();
        
        ['startTimeInput', 'endTimeInput', 'runBtn', 'exportKmlBtn', 'exportClipBtn'].forEach(id => document.getElementById(id).disabled = false);
        document.getElementById('startTimeInput').value = allParsedData[0].time; 
        document.getElementById('endTimeInput').value = allParsedData[allParsedData.length-1].time; 
        
        if (videoLoaded) {
            document.getElementById('videoStartInput').value = allParsedData[0].time;
            updateEndWindowFromVideo(false);
        } else {
            document.getElementById('videoStartInput').value = "000000";
            document.getElementById('videoStartInput').disabled = true;
            videoSyncMode.disabled = true;
            applyFiltersAndInit(false);
        }
        
        evaluateAutoSyncDefault();
        applySyncModeLock();

        if (filteredData.length > 0 && !isPlaying) {
            isPlaying = true; playPauseBtn.innerText = "⏸ Pause"; playbackAccumulator = 0; lastTickTime = performance.now();
            if (videoLoaded && speeds[currentSpeedIdx] <= 16) video.play().catch(e=>{});
            masterSyncEngineTick();
        }

        document.getElementById('loadingOverlay').classList.add('hidden'); document.getElementById('loadingOverlay').classList.remove('flex');
    }
