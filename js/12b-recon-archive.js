/* Mission Visualizer - NOAA Recon Archive browser (noaa-recon-api: https://joshmurdock.net/api)
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   Lets a flight be loaded straight from the archive (Year -> Storm -> Mission dropdowns) instead of
   a manual file upload, and auto-loads the storm's whole-life best-track alongside it. Reuses
   RECON_API_BASE from js/02-satellite.js (same API, already used there for archive GOES tiles). */

    const reconYearSelect = document.getElementById('reconYearSelect');
    const reconStormSelect = document.getElementById('reconStormSelect');
    const reconMissionSelect = document.getElementById('reconMissionSelect');
    const reconLoadBtn = document.getElementById('reconLoadBtn');
    const reconSourceLink = document.getElementById('reconSourceLink');
    const reconArchiveStatus = document.getElementById('reconArchiveStatus');

    let reconStormsForYear = [];      // last-fetched [{storm_name, storm_id, mission_count}] for the selected year
    let reconMissionsForStorm = [];   // last-fetched missions for the selected storm

    function setReconStatus(msg) { if (reconArchiveStatus) reconArchiveStatus.textContent = msg || ''; }

    async function reconApiJson(path) {
        const resp = await fetch(RECON_API_BASE + path);
        const data = await resp.json().catch(() => null);
        if (!resp.ok) { const err = new Error((data && data.detail) || resp.statusText); err.status = resp.status; err.data = data; throw err; }
        return data;
    }

    function resetReconSelect(sel, placeholder) {
        sel.innerHTML = `<option value="">${placeholder}</option>`;
        sel.disabled = true;
    }

    async function populateReconYears() {
        try {
            const data = await reconApiJson('/v1/recon/years');
            const years = (data && data.years) || [];
            years.slice().reverse().forEach(y => {   // newest first - most-requested storms are recent
                const opt = document.createElement('option'); opt.value = y; opt.textContent = y; reconYearSelect.appendChild(opt);
            });
        } catch (e) { setReconStatus('Could not reach the recon archive (' + e.message + ').'); }
    }
    populateReconYears();

    reconYearSelect.addEventListener('change', async () => {
        resetReconSelect(reconStormSelect, 'Storm…');
        resetReconSelect(reconMissionSelect, 'Flight…');
        reconLoadBtn.disabled = true;
        reconStormsForYear = []; reconMissionsForStorm = [];
        const year = reconYearSelect.value;
        if (!year) return;
        setReconStatus('Loading storms for ' + year + '…');
        try {
            const data = await reconApiJson('/v1/recon/' + year);
            reconStormsForYear = (data && data.storms) || [];
            reconStormsForYear.forEach(s => {
                const opt = document.createElement('option'); opt.value = s.storm_name;
                opt.textContent = `${s.storm_name} (${s.mission_count} flight${s.mission_count === 1 ? '' : 's'})`;
                reconStormSelect.appendChild(opt);
            });
            reconStormSelect.disabled = false;
            setReconStatus(reconStormsForYear.length ? '' : 'No archived recon flights found for ' + year + '.');
        } catch (e) { setReconStatus('Could not load storms for ' + year + ' (' + e.message + ').'); }
    });

    reconStormSelect.addEventListener('change', async () => {
        resetReconSelect(reconMissionSelect, 'Flight…');
        reconLoadBtn.disabled = true;
        reconMissionsForStorm = [];
        const year = reconYearSelect.value, stormName = reconStormSelect.value;
        if (!year || !stormName) return;
        setReconStatus('Loading flights for ' + stormName + '…');
        try {
            const data = await reconApiJson('/v1/recon/' + year + '/' + encodeURIComponent(stormName));
            reconMissionsForStorm = (data && data.missions) || [];
            reconMissionsForStorm.forEach(m => {
                const opt = document.createElement('option'); opt.value = m.mission_id;
                opt.textContent = `${m.flight_date} · ${m.aircraft || m.tail_num} · ${m.obs_count} obs`;
                reconMissionSelect.appendChild(opt);
            });
            reconMissionSelect.disabled = false;
            reconLoadBtn.disabled = reconMissionsForStorm.length === 0;
            setReconStatus(reconMissionsForStorm.length ? '' : 'No archived flights found for ' + stormName + '.');
        } catch (e) { setReconStatus('Could not load flights for ' + stormName + ' (' + e.message + ').'); }
    });

    reconMissionSelect.addEventListener('change', () => { reconLoadBtn.disabled = !reconMissionSelect.value; });

    reconLoadBtn.addEventListener('click', () => {
        const missionId = reconMissionSelect.value;
        if (missionId) loadReconMission(missionId);
    });

    // Convert one mission's decimated obs ([unix_time, lat, lon, wind_kt, wind_dir, sfmr_kt, alt_m])
    // into the same tab-separated format parseEntireFile() already consumes for uploaded .txt/.nc
    // files - reuses ALL of the existing parse/clean/interpolate pipeline instead of duplicating it.
    // parseEntireFile requires >=10 tab fields per row (an upload-format guard), so two unused
    // trailing columns pad every row out to that minimum.
    function reconObsToTsv(mission) {
        const headers = ['HH', 'MM', 'SS', 'LATref', 'LONref', 'WSkt.d', 'WD.d', 'ALTref', 'X1', 'X2'];
        let tsv = headers.join('\t') + '\n';
        (mission.obs || []).forEach(o => {
            const [t, lat, lon, windKt, windDir, , altM] = o;
            const d = new Date(t * 1000);
            const HH = String(d.getUTCHours()).padStart(2, '0'), MM = String(d.getUTCMinutes()).padStart(2, '0'), SS = String(d.getUTCSeconds()).padStart(2, '0');
            const row = [HH, MM, SS, lat, lon, windKt ?? '', windDir ?? '', altM ?? '', '', ''];
            tsv += row.join('\t') + '\n';
        });
        return tsv;
    }

    // Stream a URL's body, reporting real byte progress via onProgress(received, total). Falls back to
    // a plain (progress-less) arrayBuffer() read if the response has no body stream or no Content-Length.
    async function fetchArrayBufferWithProgress(url, onProgress) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const total = parseInt(resp.headers.get('Content-Length') || '0', 10);
        if (!resp.body || !total) return await resp.arrayBuffer();
        const reader = resp.body.getReader();
        const chunks = []; let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value); received += value.length;
            if (onProgress) onProgress(received, total);
        }
        const buf = new Uint8Array(received); let offset = 0;
        chunks.forEach(c => { buf.set(c, offset); offset += c.length; });
        return buf.buffer;
    }

    async function loadReconMission(missionId) {
        const loader = document.getElementById('loadingOverlay'); loader.classList.remove('hidden'); loader.classList.add('flex');
        const subtext = document.getElementById('loadingOverlaySubtext');
        reconLoadBtn.disabled = true;
        setReconStatus('Fetching mission ' + missionId + '…');

        let mission;
        try {
            mission = await reconApiJson('/v1/recon/mission/' + encodeURIComponent(missionId));
            if (!mission.obs || mission.obs.length === 0) throw new Error('mission has no observations');
        } catch (e) {
            setReconStatus('Could not load mission ' + missionId + ' (' + e.message + ').');
            loader.classList.add('hidden'); loader.classList.remove('flex');
            reconLoadBtn.disabled = false;
            return;
        }

        flightMetaData = { id: `${mission.mission_id} (${mission.storm_name})`, date: mission.flight_date, aircraft: mission.aircraft || mission.tail_num || 'Unknown' };

        // Primary path: stream the mission's ORIGINAL full-resolution NetCDF straight through the API
        // (GET .../download - now a direct CORS-open stream, not a redirect to NOAA's non-CORS archive)
        // and run it through the same ncArrayBufferToTsv() + parseEntireFile() pipeline a manual .nc
        // upload uses, so every recorded variable (attitude, radar, etc.) is available - not just the
        // ~7-field decimated preview /v1/recon/mission/{id} returns. Falls back to that decimated JSON
        // (reconObsToTsv) if the download or parse fails for any reason (slow link, malformed file, ...).
        let tsv, usedFullRes = false;
        try {
            if (subtext) subtext.textContent = `Downloading full-resolution NetCDF for ${mission.mission_id}…`;
            const buf = await fetchArrayBufferWithProgress(
                RECON_API_BASE + '/v1/recon/mission/' + encodeURIComponent(missionId) + '/download',
                (received, total) => {
                    const pct = Math.round(received / total * 100);
                    const mb = n => (n / 1048576).toFixed(1);
                    const msg = `Downloading full-resolution NetCDF… ${pct}% (${mb(received)} / ${mb(total)} MB)`;
                    if (subtext) subtext.textContent = msg;
                    setReconStatus(msg);
                }
            );
            if (subtext) subtext.textContent = 'Parsing NetCDF variables…';
            tsv = ncArrayBufferToTsv(buf);
            usedFullRes = true;
        } catch (e) {
            tsv = reconObsToTsv(mission);
            setReconStatus(`Full-res download failed (${e.message}) - loaded the quick decimated preview instead.`);
        }
        if (subtext) subtext.textContent = 'Pulling variables...';   // restore the default for the next (manual-upload) use of this overlay

        isNcFile = usedFullRes;
        // parseEntireFile() resets reconArchiveMeta/the source link at its top (so a manual upload
        // afterwards doesn't inherit stale archive state) - so this metadata must be set AFTER it
        // returns, not before, or its own reset would immediately wipe what we just set.
        parseEntireFile(tsv);   // hides loadingOverlay itself when done

        reconArchiveMeta = { missionId: mission.mission_id, stormName: mission.storm_name, stormId: mission.storm_id, aircraft: mission.aircraft, tailNum: mission.tail_num, sourceUrl: mission.source_url };
        if (mission.source_url) {
            reconSourceLink.href = mission.source_url; reconSourceLink.classList.remove('hidden');
            reconSourceLink.title = 'Open the original full-resolution NetCDF from NOAA directly (same file this loaded automatically)';
        } else { reconSourceLink.classList.add('hidden'); }

        if (usedFullRes) setReconStatus(`Loaded full-resolution ${mission.mission_id} (${allParsedData.length} samples). Fetching storm track…`);
        else setReconStatus(`Loaded ${mission.obs_count} decimated pts for ${mission.mission_id}. Fetching storm track…`);
        loadStormTrackForMission(mission);

        reconLoadBtn.disabled = false;
    }

    // Best-track (every ~6-hourly fix) for the WHOLE storm life - not just the flight's window - so the
    // map shows where the storm came from and where it went. storm_id is an ATCF id like "AL142024":
    // first 2 chars are the basin NHC's /v1/storms endpoints want to disambiguate reused names.
    async function loadStormTrackForMission(mission) {
        stormTrackPoints = []; stormTrackMeta = null;
        const stormName = mission.storm_name;
        if (!stormName || /unknown|training/i.test(stormName)) { setReconStatus(`Loaded ${mission.mission_id}. No named storm to fetch a best-track for.`); refreshStormTrackDisplay(); return; }
        const basin = mission.storm_id ? mission.storm_id.slice(0, 2) : undefined;
        try {
            const params = new URLSearchParams({}); if (basin) params.set('basin', basin);
            const qs = params.toString();
            const track = await reconApiJson(`/v1/storms/${mission.year}/${encodeURIComponent(stormName)}${qs ? '?' + qs : ''}`);
            stormTrackPoints = (track.points || []).map(p => ({
                ms: Date.parse(p.datetime_utc), lat: p.lat, lon: p.lon,
                windKt: p.wind_kt, pressureMb: p.pressure_mb, category: p.category, status: p.status
            })).filter(p => isFinite(p.ms));
            stormTrackMeta = { year: track.year, name: track.name, basin: track.basin, atcfId: track.atcf_id };
            setReconStatus(`Loaded ${mission.mission_id} + ${stormTrackPoints.length}-pt best-track for ${track.name}.`);
        } catch (e) {
            setReconStatus(`Loaded ${mission.mission_id}. No best-track found for ${stormName} (${e.message}).`);
        }
        refreshStormTrackDisplay();
    }

    // Show/hide the "Storm Track" toggle (only meaningful once a track is loaded) and repaint.
    function refreshStormTrackDisplay() {
        const label = document.getElementById('stormTrackToggleLabel');
        if (label) label.style.display = stormTrackPoints.length > 0 ? 'flex' : 'none';
        bgNeedsUpdate = true;
        if (typeof threeDInitialized !== 'undefined' && threeDInitialized) build3DScene();
        if (filteredData.length > 0) updateVisualComponents(currentIdx);
    }

    document.getElementById('toggleStormTrack').addEventListener('change', (e) => {
        showStormTrack = e.target.checked;
        if (typeof threeDInitialized !== 'undefined' && threeDInitialized) build3DScene();
        if (filteredData.length > 0) updateVisualComponents(currentIdx);
    });

    // Color a best-track segment/point by intensity, roughly matching NHC's conventional track-map palette.
    function stormWindColor(windKt) {
        if (windKt == null) return '#94a3b8';           // unknown intensity - neutral grey
        if (windKt < 34) return '#5da5da';               // tropical depression
        if (windKt < 64) return '#fbea59';                // tropical storm
        if (windKt < 96) return '#f5a623';                // cat 1-2
        if (windKt < 113) return '#f2453d';               // cat 3
        if (windKt < 137) return '#e93cb5';               // cat 4
        return '#7c2d92';                                 // cat 5
    }

    // Nearest best-track fix to the current playback time (points are chronological, ~6h apart).
    function nearestStormPoint(ms) {
        if (!stormTrackPoints.length) return null;
        let best = stormTrackPoints[0], bestDiff = Math.abs(best.ms - ms);
        for (let i = 1; i < stormTrackPoints.length; i++) {
            const diff = Math.abs(stormTrackPoints[i].ms - ms);
            if (diff < bestDiff) { bestDiff = diff; best = stormTrackPoints[i]; }
        }
        return { point: best, diffMs: bestDiff };
    }

    // Per-frame storm status card (left side, next to the archive controls - not an on-map overlay),
    // refreshed from updateVisualComponents() alongside the sat time badge.
    function updateStormTrackBadge() {
        const card = document.getElementById('stormStatusCard');
        const body = document.getElementById('stormStatusBody');
        if (!card || !body) return;
        if (!showStormTrack || stormTrackPoints.length === 0 || !stormTrackMeta || flightMetaData.date === 'Unknown' || filteredData.length === 0) {
            card.classList.add('hidden'); return;
        }
        const row = filteredData[currentIdx]; if (!row) { card.classList.add('hidden'); return; }
        const flightMs = new Date(flightMetaData.date + 'T00:00:00Z').getTime() + row.absSeconds * 1000;
        const near = nearestStormPoint(flightMs); if (!near) { card.classList.add('hidden'); return; }
        const p = near.point;
        const windTxt = p.windKt != null ? `${p.windKt}kt` : '—';
        const presTxt = p.pressureMb != null ? `${p.pressureMb}mb` : '—';
        // Direction relative to the aircraft's current playback time: positive = observation is in the
        // past (ago), negative = the nearest best-track fix is still ahead of the flight clock (from now).
        const rawDiffMs = flightMs - p.ms;
        const totalMin = Math.round(Math.abs(rawDiffMs) / 60000);
        const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
        const mm = String(totalMin % 60).padStart(2, '0');
        const dirTxt = rawDiffMs >= 0 ? 'ago' : 'from now';
        const hrsOff = near.diffMs / 3600000;
        body.innerHTML = `${stormTrackMeta.name} - <b>${p.category || p.status || ''}</b><br>`
            + `${windTxt} / ${presTxt}<br>`
            + `<span style="color:${hrsOff <= 3 ? '#4ade80' : '#fbbf24'}">Data Observed ${hh}:${mm} ${dirTxt}</span>`;
        card.classList.remove('hidden');
    }

    // Hover tooltip for individual best-track points on the 2D map. Uses ONLY the storm-track fix's
    // own fields (category/status, wind, pressure, observation time) - never anything flight-level.
    // Hit-tested in SCREEN space (constant pixel radius) so the target size doesn't shrink when zoomed out.
    function stormPointIndexAt(mx, my) {
        if (!showStormTrack || stormTrackPoints.length === 0 || trackerModeSelect.value !== '2d') return -1;
        const HIT_R = 7, hitR2 = HIT_R * HIT_R;
        let best = -1, bestD2 = hitR2;
        for (let i = 0; i < stormTrackPoints.length; i++) {
            const p = stormTrackPoints[i];
            const sx = mapOffsetX + mapScale * getX(p.lon);
            const sy = mapOffsetY + mapScale * getY(p.lat);
            const dx = sx - mx, dy = sy - my, d2 = dx * dx + dy * dy;
            if (d2 <= bestD2) { bestD2 = d2; best = i; }
        }
        return best;
    }

    function formatStormPointTooltip(p) {
        const timeStr = isFinite(p.ms) ? new Date(p.ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '—';
        const windTxt = p.windKt != null ? `${p.windKt} kt` : '—';
        const presTxt = p.pressureMb != null ? `${p.pressureMb} mb` : '—';
        const catTxt = p.category || p.status || '—';
        return `<div class="font-bold" style="color:${stormWindColor(p.windKt)}">${catTxt}</div>`
            + `<div>Time: ${timeStr}</div>`
            + `<div>Wind: ${windTxt}</div>`
            + `<div>Pressure: ${presTxt}</div>`;
    }

    (function wireStormTrackHover() {
        const tooltip = document.getElementById('stormTrackTooltip');
        if (!tooltip || !canvas) return;
        canvas.addEventListener('mousemove', (e) => {
            if (isDraggingMap || isDraggingShape || isMeasuring) { tooltip.classList.add('hidden'); return; }
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const idx = stormPointIndexAt(mx, my);
            if (idx !== hoveredStormIdx) {
                hoveredStormIdx = idx;
                if (filteredData.length > 0 && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
            }
            if (idx >= 0) {
                tooltip.innerHTML = formatStormPointTooltip(stormTrackPoints[idx]);
                tooltip.style.left = (e.clientX + 14) + 'px';
                tooltip.style.top = (e.clientY + 14) + 'px';
                tooltip.classList.remove('hidden');
                canvas.style.cursor = 'pointer';
            } else {
                tooltip.classList.add('hidden');
                if (drawnShapes.length === 0) canvas.style.cursor = '';
            }
        });
        canvas.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
            if (hoveredStormIdx !== -1) {
                hoveredStormIdx = -1;
                if (filteredData.length > 0 && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
            }
        });
    })();
