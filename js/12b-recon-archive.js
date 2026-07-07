/* Mission Visualizer, NOAA Recon Archive browser (noaa-recon-api: https://joshmurdock.net/api)
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   Lets a flight be loaded straight from the archive (Year -> Storm -> Mission dropdowns) instead of
   a manual file upload, and auto-loads the storm's whole-life best-track alongside it. Reuses
   RECON_API_BASE from js/02-satellite.js (same API, already used there for archive GOES tiles). */

    const reconYearSelect = document.getElementById('reconYearSelect');
    const reconStormSelect = document.getElementById('reconStormSelect');
    const reconMissionSelect = document.getElementById('reconMissionSelect');
    const reconLoadBtn = document.getElementById('reconLoadBtn');

    // <option> text can't hold HTML markup, so this swaps A-Z/a-z/0-9 for Unicode "Mathematical
    // Sans-Serif Bold" lookalikes to make the storm name / mission id read bold in the dropdown.
    const BOLD_UP = 0x1D5D4 - 65, BOLD_LOW = 0x1D5EE - 97, BOLD_DIGIT = 0x1D7EC - 48;
    function boldUnicode(str) {
        return String(str).replace(/[A-Za-z0-9]/g, ch => {
            const c = ch.charCodeAt(0);
            if (c >= 65 && c <= 90) return String.fromCodePoint(c + BOLD_UP);
            if (c >= 97 && c <= 122) return String.fromCodePoint(c + BOLD_LOW);
            return String.fromCodePoint(c + BOLD_DIGIT);
        });
    }
    const reconSourceLink = document.getElementById('reconSourceLink');
    const reconArchiveStatus = document.getElementById('reconArchiveStatus');

    let reconYearsLanded = false;   // flips when the archive year list arrives; gates the pre-cache buttons
    function syncReconLoadButtonState() {
        if (!reconLoadBtn) return;
        const apiDown = reconApiHealthChecked && !reconApiHealthOk;
        reconLoadBtn.disabled = apiDown || !reconMissionSelect.value;
        // Both pre-cache buttons open modals with their own pickers, so they only need the
        // archive bootstrap done (year list landed) and the API alive.
        const ready = reconYearsLanded && !apiDown;
        const preBtn = document.getElementById('reconPreloadBtn');
        if (preBtn) preBtn.disabled = !ready;
        const batchBtn = document.getElementById('batchCacheBtn');
        if (batchBtn) batchBtn.disabled = !ready;
    }

    let reconStormsForYear = [];      // last-fetched [{storm_name, storm_id, mission_count}] for the selected year
    let reconMissionsForStorm = [];   // last-fetched missions for the selected storm
    let reconMissionListCache = {};   // storm_name -> chronologically-sorted missions, prefetched per year
    let stormListReqId = 0;           // guards against an older year's slower fetch overwriting a newer one

    const RECON_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // "Aug 12-16" / "Sep 24, Oct 9" span of a storm's (sorted) missions, from flight_date YYYY-MM-DD.
    function reconDateSpan(missions) {
        const fmt = d => { const p = d.split('-'); return RECON_MONTHS[+p[1] - 1] + ' ' + (+p[2]); };
        const a = missions[0].flight_date, b = missions[missions.length - 1].flight_date;
        if (!a || !b) return '';
        if (a === b) return fmt(a);
        return a.slice(0, 7) === b.slice(0, 7) ? fmt(a) + ' to ' + (+b.split('-')[2]) : fmt(a) + ' to ' + fmt(b);
    }

    let suppressReconStatus = false;   // true while reflectLoadedMissionInSelectors() drives the dropdowns
    let stormTrackFetchPromise = null; // last loadStormTrackForMission() run, so auto-load can wait it out
    function setReconStatus(msg) { if (!suppressReconStatus && reconArchiveStatus) reconArchiveStatus.textContent = msg || ''; }

    async function reconApiJson(path) {
        const resp = await fetch(RECON_API_BASE + path);
        const data = await resp.json().catch(() => null);
        if (!resp.ok) {
            // detail can be a string OR structured (FastAPI validation errors), stringify the
            // latter so status messages never read "[object Object]".
            let detail = (data && data.detail) || resp.statusText;
            if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
            const err = new Error(detail); err.status = resp.status; err.data = data; throw err;
        }
        return data;
    }

    function resetReconSelect(sel, placeholder) {
        sel.innerHTML = `<option value="">${placeholder}</option>`;
        sel.disabled = true;
    }

    // The select starts disabled with a "Loading…" placeholder in the markup, so a refresh never
    // offers a clickable empty list; it opens up only once the year list has actually arrived.
    async function populateReconYears() {
        try {
            const data = await reconApiJson('/v1/recon/years');
            const years = (data && data.years) || [];
            years.slice().reverse().forEach(y => {   // newest first, most-requested storms are recent
                const opt = document.createElement('option'); opt.value = y; opt.textContent = y; reconYearSelect.appendChild(opt);
            });
        } catch (e) { setReconStatus('Could not reach the recon archive (' + e.message + ').'); }
        reconYearSelect.options[0].textContent = 'Year…';
        reconYearSelect.disabled = false;
        reconYearSelect.style.cursor = '';
        reconYearsLanded = true;
        syncReconLoadButtonState();   // the pre-cache buttons open up with the year list
        ['archiveLoadingSpin', 'preloadBtnSpin', 'batchBtnSpin'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
    }
    const reconYearsReady = populateReconYears();

    // Shareable links: opening the page with ?mission=20241007N1 auto-loads that archive mission;
    // optional t=HHMMSS seeks the playhead there and view=2d|3d picks the tracker (both written by
    // the Share button). Deferred to window 'load' so every script file has parsed before the load
    // pipeline runs; a bad/unknown id just surfaces through loadReconMission's own error status.
    (function autoLoadSharedMission() {
        let shared = '', sharedT = '', sharedView = '';
        try {
            const params = new URLSearchParams(window.location.search);
            shared = (params.get('mission') || '').trim();
            sharedT = (params.get('t') || '').trim();
            sharedView = (params.get('view') || '').trim();
        } catch (e) { return; }
        if (!/^\d{8}[A-Z]+\d+$/i.test(shared)) return;
        // Refresh-as-reset: the params exist for SHARING (fresh navigations). On a reload,
        // strip them and start clean instead of re-loading the mission, so F5 resets the app.
        const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
        if (nav && nav.type === 'reload') {
            try { const u = new URL(window.location.href); ['mission', 't', 'view'].forEach(k => u.searchParams.delete(k)); history.replaceState(null, '', u); } catch (e) {}
            return;
        }
        window.addEventListener('load', async () => {
            await loadReconMission(shared.toUpperCase());
            // Let the storm-track fetch land its final status message BEFORE the selector
            // reflection suppresses status writes, otherwise "Loaded … + N obs best-track"
            // arrives mid-reflection and gets swallowed.
            try { await stormTrackFetchPromise; } catch (e) { }
            reflectLoadedMissionInSelectors();
            applySharedPlaybackParams(sharedT, sharedView);
        });
    })();

    // Apply a share link's t/view once its mission has loaded: switch the tracker first, then seek
    // the playhead to the first sample at/after the shared clock time.
    function applySharedPlaybackParams(t, view) {
        if ((view === '2d' || view === '3d') && trackerModeSelect.value !== view) {
            trackerModeSelect.value = view;
            trackerModeSelect.dispatchEvent(new Event('change'));
        }
        if (!/^\d{6}$/.test(t) || !filteredData.length) return;
        let sec = timeToSeconds(t);
        if (sec < filteredData[0].absSeconds) sec += 86400;   // shared moment past midnight relative to takeoff
        let idx = filteredData.findIndex(d => d.absSeconds >= sec);
        if (idx === -1) idx = filteredData.length - 1;
        currentIdx = idx;
        timelineSlider.value = idx;
        updateVisualComponents(currentIdx);
    }

    // Share button: copies a link that reopens this mission at the current playback moment in the
    // current tracker view. Enabled by updateMissionHeader() only while an archive mission is loaded
    // (a manually uploaded file has no mission id to share).
    (function wireShareLink() {
        const btn = document.getElementById('shareLinkBtn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            if (!reconArchiveMeta || !filteredData.length) return;
            const row = filteredData[currentIdx] || filteredData[0];
            let url = '';
            try {
                const u = new URL(window.location.href);
                u.searchParams.set('mission', reconArchiveMeta.missionId);
                u.searchParams.set('t', row.time);
                u.searchParams.set('view', trackerModeSelect.value);
                url = u.toString();
            } catch (e) { return; }
            const hhmmss = row.time.slice(0,2) + ':' + row.time.slice(2,4) + ':' + row.time.slice(4);
            // The address bar stays as it is, so a refresh still resets cleanly; only the
            // clipboard-unavailable fallback writes the link into the URL as a last resort.
            try {
                await navigator.clipboard.writeText(url);
                showToast('Share link copied. It opens this mission at ' + hhmmss + 'Z in the ' + (trackerModeSelect.value === '3d' ? '3D' : '2D') + ' tracker.', 6000);
            } catch (e) {
                try { history.replaceState(null, '', url); } catch (e2) {}
                showToast('Could not access the clipboard, but the address bar now holds the share link.', 6000);
            }
        });
    })();

    // Drive the Year/Storm/Flight selectors to match an auto-loaded shared mission, without
    // this a ?mission= load leaves them on their placeholders and the load card looks empty.
    // Cosmetic only: failures are swallowed and the loaded flight is unaffected.
    async function reflectLoadedMissionInSelectors() {
        if (!reconArchiveMeta) return;
        suppressReconStatus = true;   // the drive-by change handlers must not clobber "Loaded …"
        try {
            await reconYearsReady;
            const year = String(reconArchiveMeta.missionId).slice(0, 4);
            if (![...reconYearSelect.options].some(o => o.value === year)) return;
            reconYearSelect.value = year;
            await onReconYearChange();
            const stormName = String(reconArchiveMeta.stormName || '').toLowerCase();
            const stormOpt = [...reconStormSelect.options].find(o => o.value.toLowerCase() === stormName);
            if (!stormOpt) return;
            reconStormSelect.value = stormOpt.value;
            await onReconStormChange();
            if ([...reconMissionSelect.options].some(o => o.value === reconArchiveMeta.missionId)) {
                reconMissionSelect.value = reconArchiveMeta.missionId;
            }
            syncReconLoadButtonState();
        } catch (e) { /* leave the placeholders */ }
        finally { suppressReconStatus = false; }
    }

    const onReconYearChange = async () => {
        resetReconSelect(reconStormSelect, 'Storm…');
        resetReconSelect(reconMissionSelect, 'Flight…');
        syncReconLoadButtonState();
        reconStormsForYear = []; reconMissionsForStorm = []; reconMissionListCache = {};
        const year = reconYearSelect.value;
        if (!year) return;
        const req = ++stormListReqId;
        reconStormSelect.options[0].textContent = 'Loading…';   // stays disabled until the list lands
        reconStormSelect.style.cursor = 'progress';
        setReconStatus('Loading storms for ' + year + '…');
        try {
            const data = await reconApiJson('/v1/recon/' + year);
            if (req !== stormListReqId) return;
            reconStormsForYear = (data && data.storms) || [];
            // The storms payload carries no dates, so prefetch every storm's mission list in parallel
            // to date and sort the dropdown chronologically and make the storm pick instant. A failed
            // list (e.g. "Unknown / Training", whose slash breaks its routing) sorts to the end.
            const lists = await Promise.all(reconStormsForYear.map(s =>
                reconApiJson('/v1/recon/' + year + '/' + encodeURIComponent(s.storm_name)).catch(() => null)));
            if (req !== stormListReqId) return;
            reconStormsForYear.forEach((s, i) => {
                const ms = (lists[i] && lists[i].missions) || null;
                if (ms && ms.length) {
                    ms.sort((a, b) => (a.start_unix || 0) - (b.start_unix || 0));
                    reconMissionListCache[s.storm_name] = ms;
                    s._firstUnix = ms[0].start_unix || Infinity;
                    s._dateSpan = reconDateSpan(ms);
                } else { s._firstUnix = Infinity; s._dateSpan = ''; }
            });
            reconStormsForYear.sort((a, b) => a._firstUnix - b._firstUnix || a.storm_name.localeCompare(b.storm_name));
            reconStormsForYear.forEach(s => {
                const opt = document.createElement('option'); opt.value = s.storm_name;
                opt.textContent = `${boldUnicode(s.storm_name)} (${s.mission_count} flight${s.mission_count === 1 ? '' : 's'}${s._dateSpan ? ', ' + s._dateSpan : ''})`;
                reconStormSelect.appendChild(opt);
            });
            reconStormSelect.options[0].textContent = 'Storm…';
            reconStormSelect.disabled = false;
            reconStormSelect.style.cursor = '';
            syncReconLoadButtonState();   // mission lists just landed, the preload modal is usable now
            setReconStatus(reconStormsForYear.length ? '' : 'No archived recon flights found for ' + year + '.');
        } catch (e) {
            if (req === stormListReqId) {
                reconStormSelect.options[0].textContent = 'Storm…';
                reconStormSelect.style.cursor = '';
                setReconStatus('Could not load storms for ' + year + ' (' + e.message + ').');
            }
        }
    };
    reconYearSelect.addEventListener('change', onReconYearChange);

    const onReconStormChange = async () => {
        resetReconSelect(reconMissionSelect, 'Flight…');
        syncReconLoadButtonState();
        reconMissionsForStorm = [];
        const year = reconYearSelect.value, stormName = reconStormSelect.value;
        if (!year || !stormName) return;
        reconMissionSelect.options[0].textContent = 'Loading…';   // invisible on the (usual) prefetched path, no await before the restore
        reconMissionSelect.style.cursor = 'progress';
        setReconStatus('Loading flights for ' + stormName + '…');
        try {
            // Usually already prefetched (and sorted) by the year handler above.
            let missions = reconMissionListCache[stormName];
            if (!missions) {
                const data = await reconApiJson('/v1/recon/' + year + '/' + encodeURIComponent(stormName));
                missions = ((data && data.missions) || []).slice().sort((a, b) => (a.start_unix || 0) - (b.start_unix || 0));
            }
            reconMissionsForStorm = missions;
            reconMissionsForStorm.forEach(m => {
                const opt = document.createElement('option'); opt.value = m.mission_id;
                // Mission id leads (its first 8 digits are the date, so a separate date column
                // would just repeat it in this narrow select).
                opt.textContent = `${boldUnicode(m.mission_id)} · ${m.aircraft || m.tail_num} · ${m.obs_count} obs`;
                opt.title = `${m.flight_date} · ${m.aircraft || m.tail_num} · ${m.obs_count} obs`;
                reconMissionSelect.appendChild(opt);
            });
            reconMissionSelect.options[0].textContent = 'Flight…';
            reconMissionSelect.disabled = false;
            reconMissionSelect.style.cursor = '';
            reconLoadBtn.disabled = reconMissionsForStorm.length === 0;
            setReconStatus(reconMissionsForStorm.length ? '' : 'No archived flights found for ' + stormName + '.');
        } catch (e) {
            reconMissionSelect.options[0].textContent = 'Flight…';
            reconMissionSelect.style.cursor = '';
            setReconStatus('Could not load flights for ' + stormName + ' (' + e.message + ').');
        }
    };
    reconStormSelect.addEventListener('change', onReconStormChange);

    reconMissionSelect.addEventListener('change', () => { syncReconLoadButtonState(); });

    reconLoadBtn.addEventListener('click', () => {
        const missionId = reconMissionSelect.value;
        if (missionId) loadReconMission(missionId);
    });

    // Convert one mission's decimated obs ([unix_time, lat, lon, wind_kt, wind_dir, sfmr_kt, alt_m])
    // into the same tab-separated format parseEntireFile() already consumes for uploaded .txt/.nc
    // files, reuses ALL of the existing parse/clean/interpolate pipeline instead of duplicating it.
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
        syncReconLoadButtonState();
        setReconStatus('Fetching mission ' + missionId + '…');

        let mission;
        try {
            mission = await reconApiJson('/v1/recon/mission/' + encodeURIComponent(missionId));
            if (!mission.obs || mission.obs.length === 0) throw new Error('mission has no observations');
        } catch (e) {
            setReconStatus('Could not load mission ' + missionId + ' (' + e.message + ').');
            loader.classList.add('hidden'); loader.classList.remove('flex');
            syncReconLoadButtonState();
            return;
        }

        flightMetaData = { id: `${mission.mission_id} (${mission.storm_name})`, date: mission.flight_date, aircraft: mission.aircraft || mission.tail_num || 'Unknown' };

        // Primary path: stream the mission's original full-resolution NetCDF through the API's
        // CORS-open download endpoint into the same parseEntireFile() pipeline a manual .nc upload
        // uses (parse worker + parser core), so every recorded variable is available, not just the
        // ~7-field decimated preview. Falls back to that decimated JSON if the download or parse
        // fails or yields no usable rows.
        let usedFullRes = false;
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
                    // Backgrounded tabs stop repainting, so this text can look frozen while the download
                    // keeps progressing underneath. The document title still updates while hidden, so
                    // mirror the percent there; updateMissionHeader() overwrites it once loading finishes.
                    document.title = `${pct}% ↓ ${mission.mission_id} · AOC Mission Visualizer`;
                }
            );
            if (subtext) subtext.textContent = 'Parsing NetCDF variables…';
            await parseEntireFile(buf);
            usedFullRes = true;
        } catch (e) {
            setReconStatus(`Full-res load failed (${e.message}), loading the decimated preview…`);
            try {
                await parseEntireFile(reconObsToTsv(mission));
            } catch (e2) {
                setReconStatus(`Could not load mission ${missionId} (${e2.message}).`);
                hideLoadingOverlay();
                syncReconLoadButtonState();
                return;
            }
        }
        if (subtext) subtext.textContent = 'Pulling variables...';   // restore the default for the next (manual-upload) use of this overlay

        isNcFile = usedFullRes;
        // parseEntireFile() resets reconArchiveMeta/the source link at its top (so a manual upload
        // afterwards doesn't inherit stale archive state), so this metadata must be set AFTER it
        // returns, not before, or its own reset would immediately wipe what we just set.
        reconArchiveMeta = { missionId: mission.mission_id, stormName: mission.storm_name, stormId: mission.storm_id, aircraft: mission.aircraft, tailNum: mission.tail_num, sourceUrl: mission.source_url };
        updateMissionHeader();   // re-run with reconArchiveMeta now set so the subline picks up the storm name
        // Reflect the loaded mission in the URL so the address bar is a shareable link. Only the
        // Share button writes t/view, so a fresh load clears any stale pair.
        try { const u = new URL(window.location.href); u.searchParams.set('mission', mission.mission_id); u.searchParams.delete('t'); u.searchParams.delete('view'); history.replaceState(null, '', u); } catch (e) {}
        if (mission.source_url) {
            reconSourceLink.href = mission.source_url; reconSourceLink.classList.remove('hidden');
            reconSourceLink.title = 'Open the original full-resolution NetCDF from NOAA directly (same file this loaded automatically)';
        } else { reconSourceLink.classList.add('hidden'); }

        if (usedFullRes) setReconStatus(`Loaded full-resolution ${mission.mission_id} (${allParsedData.length} samples). Fetching storm track…`);
        else setReconStatus(`Loaded ${mission.obs_count} decimated obs for ${mission.mission_id}. Fetching storm track…`);
        // Every archive mission loaded this session joins the preloaded list too, so it can be
        // reopened instantly without an explicit preload. Rows are captured by reference now
        // (another load may replace allParsedData before the storm fetch settles).
        const parsedRef = { rows: allParsedData, stats: lastParseStats };
        stormTrackFetchPromise = loadStormTrackForMission(mission).then(() => {   // fire-and-forget; awaited only by autoLoadSharedMission
            savePreloadedMission(mission.mission_id, {
                mission, parsed: parsedRef, isNc: usedFullRes,
                storm: stormTrackPoints.length ? { points: stormTrackPoints, meta: stormTrackMeta } : null
            });
            updatePreloadedSelect(mission.mission_id);
        });

        syncReconLoadButtonState();
    }

    // Best-track (every ~6-hourly fix) for the WHOLE storm life, not just the flight's window, so the
    // map shows where the storm came from and where it went. storm_id is an ATCF id like "AL142024":
    // first 2 chars are the basin NHC's /v1/storms endpoints want to disambiguate reused names.
    // Pure fetch (no globals): shared by the live loader and the mission preloader.
    async function fetchStormTrackData(mission) {
        const stormName = mission.storm_name;
        if (!stormName || /unknown|training/i.test(stormName)) return null;
        const basin = mission.storm_id ? mission.storm_id.slice(0, 2) : undefined;
        const params = new URLSearchParams({}); if (basin) params.set('basin', basin);
        const qs = params.toString();
        const track = await reconApiJson(`/v1/storms/${mission.year}/${encodeURIComponent(stormName)}${qs ? '?' + qs : ''}`);
        return {
            points: (track.points || []).map(p => ({
                ms: Date.parse(p.datetime_utc), lat: p.lat, lon: p.lon,
                windKt: p.wind_kt, pressureMb: p.pressure_mb, category: p.category, status: p.status
            })).filter(p => isFinite(p.ms)),
            meta: { year: track.year, name: track.name, basin: track.basin, atcfId: track.atcf_id }
        };
    }

    async function loadStormTrackForMission(mission) {
        stormTrackPoints = []; stormTrackMeta = null;
        if (!mission.storm_name || /unknown|training/i.test(mission.storm_name)) { setReconStatus(`Loaded ${mission.mission_id}. No named storm to fetch a best-track for.`); refreshStormTrackDisplay(); return; }
        try {
            const track = await fetchStormTrackData(mission);
            stormTrackPoints = track.points; stormTrackMeta = track.meta;
            setReconStatus(`Loaded ${mission.mission_id} + ${stormTrackPoints.length} obs best-track for ${track.meta.name}.`);
        } catch (e) {
            setReconStatus(`Loaded ${mission.mission_id}. No best-track found for ${mission.storm_name} (${e.message}).`);
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

    // Color a best-track segment/point by intensity: monotonic cool-to-hot ramp (the standard
    // Saffir-Simpson track-map palette) so a stronger category always reads as more severe.
    function stormWindColor(windKt) {
        if (windKt == null) return '#94a3b8';            // unknown intensity, neutral grey
        if (windKt < 34) return '#5ebaff';               // tropical depression
        if (windKt < 64) return '#00faf4';               // tropical storm
        if (windKt < 83) return '#ffffcc';               // cat 1
        if (windKt < 96) return '#ffe775';               // cat 2
        if (windKt < 113) return '#ffc140';              // cat 3
        if (windKt < 137) return '#ff8f20';              // cat 4
        return '#ff6060';                                // cat 5
    }

    // Short label drawn inside each best-track marker (matches the buckets above).
    function stormCatLabel(windKt) {
        if (windKt == null) return '';
        if (windKt < 34) return 'TD';
        if (windKt < 64) return 'TS';
        if (windKt < 83) return '1';
        if (windKt < 96) return '2';
        if (windKt < 113) return '3';
        if (windKt < 137) return '4';
        return '5';
    }

    // Nearest best-track fix to the current playback time (points are chronological, ~6h apart).
    function nearestStormPoint(ms) {
        if (!stormTrackPoints.length) return null;
        let bestIdx = 0, bestDiff = Math.abs(stormTrackPoints[0].ms - ms);
        for (let i = 1; i < stormTrackPoints.length; i++) {
            const diff = Math.abs(stormTrackPoints[i].ms - ms);
            if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
        }
        return { point: stormTrackPoints[bestIdx], idx: bestIdx, diffMs: bestDiff };
    }

    // The fix the status card refers to; both trackers mark it with a discreet thin ring
    // (drawStormTrack2D in 2D, stormFixRing3D in 3D), kept in step with the card here.
    let currentStormFixIdx = -1;
    function setCurrentStormFix(idx) {
        currentStormFixIdx = idx;
        if (typeof stormFixRing3D === 'undefined' || !stormFixRing3D) return;
        const p = idx >= 0 ? stormTrackPoints[idx] : null;
        if (!p) { stormFixRing3D.visible = false; return; }
        const c = get3DCoord(p.lon, p.lat, 0);
        stormFixRing3D.position.x = c.x; stormFixRing3D.position.z = c.z;
        stormFixRing3D.visible = true;
    }

    // Per-frame storm status card (left side, next to the archive controls, not an on-map overlay),
    // refreshed from updateVisualComponents() alongside the sat time badge.
    function updateStormTrackBadge() {
        const card = document.getElementById('stormStatusCard');
        const body = document.getElementById('stormStatusBody');
        if (!card || !body) return;
        if (!showStormTrack || stormTrackPoints.length === 0 || !stormTrackMeta || flightMetaData.date === 'Unknown' || filteredData.length === 0) {
            card.classList.add('hidden'); setCurrentStormFix(-1); return;
        }
        const row = filteredData[currentIdx]; if (!row) { card.classList.add('hidden'); setCurrentStormFix(-1); return; }
        const flightMs = new Date(flightMetaData.date + 'T00:00:00Z').getTime() + row.absSeconds * 1000;
        const near = nearestStormPoint(flightMs); if (!near) { card.classList.add('hidden'); setCurrentStormFix(-1); return; }
        setCurrentStormFix(near.idx);
        const p = near.point;
        const windTxt = p.windKt != null ? `${p.windKt}kt` : '-';
        const presTxt = p.pressureMb != null ? `${p.pressureMb}mb` : '-';
        // Direction relative to the aircraft's current playback time: positive = observation is in the
        // past (ago), negative = the nearest best-track fix is still ahead of the flight clock (from now).
        const rawDiffMs = flightMs - p.ms;
        const totalMin = Math.round(Math.abs(rawDiffMs) / 60000);
        const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
        const mm = String(totalMin % 60).padStart(2, '0');
        const dirTxt = rawDiffMs >= 0 ? 'ago' : 'from now';
        const hrsOff = near.diffMs / 3600000;
        body.innerHTML = `${escapeHtml(stormTrackMeta.name)} · <b>${escapeHtml(p.category || p.status || '')}</b><br>`
            + `${escapeHtml(windTxt)} / ${escapeHtml(presTxt)}<br>`
            + `<span style="color:${hrsOff <= 3 ? '#38bdf8' : '#fbbf24'}">Data Observed ${hh}:${mm} ${dirTxt}</span>`;
        card.classList.remove('hidden');
    }

    // Hover tooltip for individual best-track points on the 2D map. Uses ONLY the storm-track fix's
    // own fields (category/status, wind, pressure, observation time), never anything flight-level.
    // Hit-tested in SCREEN space (constant pixel radius) so the target size doesn't shrink when zoomed out.
    function stormPointIndexAt(mx, my) {
        if (!showStormTrack || stormTrackPoints.length === 0 || trackerModeSelect.value !== '2d') return -1;
        // Generous radius: the dots are only ~9px wide and an arrow cursor's hotspot is at its very
        // tip, so a tight radius forces pixel-perfect aiming ("hover just under the point" syndrome).
        const HIT_R = 12, hitR2 = HIT_R * HIT_R;
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
        const timeStr = isFinite(p.ms) ? new Date(p.ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '-';
        const windTxt = p.windKt != null ? `${p.windKt} kt` : '-';
        const presTxt = p.pressureMb != null ? `${p.pressureMb} mb` : '-';
        const catTxt = escapeHtml(p.category || p.status || '-');
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
                // Show the card ABOVE the point (not trailing under the cursor) so the data never
                // sits beneath what you're pointing at; flip below only when clipped by the top edge.
                tooltip.style.left = (e.clientX + 14) + 'px';
                if (e.clientY > 130) {
                    tooltip.style.top = (e.clientY - 12) + 'px';
                    tooltip.style.transform = 'translateY(-100%)';
                } else {
                    tooltip.style.top = (e.clientY + 18) + 'px';
                    tooltip.style.transform = 'none';
                }
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

    // --- Mission preloader: download + parse flights in the background (like the satellite tile
    // pre-cache, but for flight data). Records live in a session Map mirrored write-through into
    // IndexedDB (db aocPreloadedMissions), so preloaded flights survive reloads and open with no
    // download or parse on any later visit. The preloaded list is its own dropdown; the Preload
    // button opens a modal where any of the selected year's missions can be queued together. ---
    const preloadedMissions = new Map();   // missionId -> { mission, parsed { rows, stats }, isNc, storm }; stored-only stubs carry no parsed
    const PRELOADED_STORE_MAX = 12;        // full-resolution missions are tens of MB each in IndexedDB

    let missionDB = null;
    const missionStoreReady = new Promise(resolve => {
        try {
            const rq = indexedDB.open('aocPreloadedMissions', 1);
            rq.onupgradeneeded = () => {
                rq.result.createObjectStore('missions');   // missionId -> full record, rows included
                rq.result.createObjectStore('meta');       // missionId -> light listing entry for the dropdown
            };
            rq.onerror = () => resolve();
            rq.onsuccess = () => { missionDB = rq.result; resolve(); };
        } catch (e) { resolve(); }
    });
    function missionIdbDelete(id) {
        if (!missionDB) return;
        try {
            const tx = missionDB.transaction(['missions', 'meta'], 'readwrite');
            tx.objectStore('missions').delete(id); tx.objectStore('meta').delete(id);
        } catch (e) {}
    }
    function missionIdbGet(id) {
        return new Promise(resolve => {
            if (!missionDB) return resolve(null);
            try {
                const rq = missionDB.transaction('missions').objectStore('missions').get(id);
                rq.onsuccess = () => resolve(rq.result || null);
                rq.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
    // Write-through save + prune: the oldest stored missions past the cap leave IndexedDB (an
    // in-memory copy, if the session holds one, stays usable until reload).
    function savePreloadedMission(id, rec) {
        preloadedMissions.set(id, rec);
        missionStoreReady.then(() => {
            if (!missionDB) return;
            try {
                const tx = missionDB.transaction(['missions', 'meta'], 'readwrite');
                tx.objectStore('missions').put(rec, id);
                tx.objectStore('meta').put({ missionId: id, stormName: (rec.mission && rec.mission.storm_name) || '', isNc: rec.isNc, savedAt: Date.now() }, id);
                const listRq = tx.objectStore('meta').getAll();
                listRq.onsuccess = () => {
                    const metas = (listRq.result || []).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
                    metas.slice(0, Math.max(0, metas.length - PRELOADED_STORE_MAX)).forEach(m => {
                        missionIdbDelete(m.missionId);
                        const stub = preloadedMissions.get(m.missionId);
                        if (stub && !stub.parsed) { preloadedMissions.delete(m.missionId); updatePreloadedSelect(); }
                    });
                };
            } catch (e) {}
        });
    }
    // Startup: list what the store already holds as light stubs; rows stay on disk until opened.
    missionStoreReady.then(() => {
        if (!missionDB) return;
        try {
            const rq = missionDB.transaction('meta').objectStore('meta').getAll();
            rq.onsuccess = () => {
                (rq.result || []).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0)).forEach(m => {
                    if (!preloadedMissions.has(m.missionId))
                        preloadedMissions.set(m.missionId, { mission: { mission_id: m.missionId, storm_name: m.stormName }, isNc: m.isNc });
                });
                if (preloadedMissions.size) updatePreloadedSelect();
            };
        } catch (e) {}
    });

    function updatePreloadedSelect(selectedId) {
        const sel = document.getElementById('preloadedSelect'); if (!sel) return;
        const keep = selectedId !== undefined ? selectedId : sel.value;
        sel.innerHTML = '<option value="">Preloaded missions…</option>';
        preloadedMissions.forEach((rec, id) => {
            const opt = document.createElement('option'); opt.value = id;
            opt.textContent = `${boldUnicode(id)} · ${rec.mission.storm_name || ''}${rec.isNc ? '' : ' (preview)'}`;
            sel.appendChild(opt);
        });
        sel.disabled = preloadedMissions.size === 0;
        sel.value = preloadedMissions.has(keep) ? keep : '';
    }

    async function preloadReconMission(missionId, statusFn) {
        const status = statusFn || setReconStatus;
        if (preloadedMissions.has(missionId)) { status(missionId + ' is already preloaded.'); return true; }
        status('Preloading ' + missionId + ' in the background…');
        try {
            const mission = await reconApiJson('/v1/recon/mission/' + encodeURIComponent(missionId));
            if (!mission.obs || mission.obs.length === 0) throw new Error('mission has no observations');
            let parsed, isNc = false;
            try {
                const buf = await fetchArrayBufferWithProgress(
                    RECON_API_BASE + '/v1/recon/mission/' + encodeURIComponent(missionId) + '/download',
                    (r, t) => status('Preloading ' + missionId + '… ' + Math.round(r / t * 100) + '%'));
                parsed = await parseFlightSource(buf);
                if (!parsed.rows.length) throw new Error('no usable rows');
                isNc = true;
            } catch (e) {
                parsed = await parseFlightSource(reconObsToTsv(mission));   // decimated preview fallback
            }
            if (!parsed.rows.length) throw new Error('no usable rows');
            let storm = null;
            try { storm = await fetchStormTrackData(mission); } catch (e) { }
            savePreloadedMission(missionId, { mission, parsed, isNc, storm });
            updatePreloadedSelect();
            status('Preloaded ' + missionId + '. Pick it from the preloaded list to open it instantly.');
            return true;
        } catch (e) {
            status('Could not preload ' + missionId + ' (' + e.message + ').');
            return false;
        }
    }

    // Open a preloaded mission: no download, no parse. A stored-only stub from a previous visit
    // pulls its record out of IndexedDB first, then applies like a session-cached one.
    async function openPreloadedMission(missionId) {
        // The preloaded list rehydrates from IndexedDB while later script files are still
        // loading, so on a slow connection a stub can be opened before the playback engine
        // (js/18-engine.js and beyond) has executed; wait out the page load first.
        if (document.readyState !== 'complete') await new Promise(r => window.addEventListener('load', r, { once: true }));
        let rec = preloadedMissions.get(missionId); if (!rec) return;
        if (!rec.parsed) {
            setReconStatus('Opening ' + missionId + ' from the on-device store…');
            const stored = await missionIdbGet(missionId);
            if (!stored || !stored.parsed) {
                setReconStatus('The stored copy of ' + missionId + ' is gone. Preload it again.');
                preloadedMissions.delete(missionId); missionIdbDelete(missionId); updatePreloadedSelect();
                return;
            }
            rec = stored; preloadedMissions.set(missionId, rec);
        }
        const mission = rec.mission;
        flightMetaData = { id: `${mission.mission_id} (${mission.storm_name})`, date: mission.flight_date, aircraft: mission.aircraft || mission.tail_num || 'Unknown' };
        try {
            applyParsedFlight(rec.parsed);
        } catch (e) {
            setReconStatus('Could not open ' + missionId + ' (' + e.message + ').');
            return;
        }
        isNcFile = rec.isNc;
        reconArchiveMeta = { missionId: mission.mission_id, stormName: mission.storm_name, stormId: mission.storm_id, aircraft: mission.aircraft, tailNum: mission.tail_num, sourceUrl: mission.source_url };
        updateMissionHeader();
        try { const u = new URL(window.location.href); u.searchParams.set('mission', mission.mission_id); u.searchParams.delete('t'); u.searchParams.delete('view'); history.replaceState(null, '', u); } catch (e) {}
        if (mission.source_url) { reconSourceLink.href = mission.source_url; reconSourceLink.classList.remove('hidden'); }
        stormTrackPoints = rec.storm ? rec.storm.points : [];
        stormTrackMeta = rec.storm ? rec.storm.meta : null;
        refreshStormTrackDisplay();
        setReconStatus('Opened preloaded ' + mission.mission_id + ' (' + allParsedData.length + ' samples' + (rec.storm ? ', best-track included' : '') + ').');
    }

    (function wirePreload() {
        const modal = document.getElementById('preloadModal');
        const checksBox = document.getElementById('preloadMissionChecks');
        const fill = document.getElementById('preloadFill');
        const statusEl = document.getElementById('preloadModalStatus');
        const startBtn = document.getElementById('preloadStartBtn');
        const yearSel = document.getElementById('preloadYearSelect');
        let preloadRunning = false;
        const setModalStatus = msg => { if (statusEl) statusEl.textContent = msg || ''; };
        const preloadListCache = {};   // year -> [{ name, missions }] storm groups, fetched once per season
        let preloadListReq = 0;        // guards a slow season fetch against a newer pick

        const checksNote = text => {
            checksBox.innerHTML = '';
            const note = document.createElement('div');
            note.className = 'text-slate-500';
            note.textContent = text;
            checksBox.appendChild(note);
        };

        // Season storm groups, ordered chronologically by each storm's first mission.
        async function fetchSeasonGroups(year) {
            if (preloadListCache[year]) return preloadListCache[year];
            let groups;
            if (year === reconYearSelect.value && Object.keys(reconMissionListCache).length) {
                // the archive dropdowns already prefetched this season's lists
                groups = Object.entries(reconMissionListCache).map(([name, missions]) => ({ name, missions }));
            } else {
                const data = await reconApiJson('/v1/recon/' + year);
                const storms = (data && data.storms) || [];
                const lists = await Promise.all(storms.map(s =>
                    reconApiJson('/v1/recon/' + year + '/' + encodeURIComponent(s.storm_name)).catch(() => null)));
                groups = storms.map((s, i) => {
                    const ms = ((lists[i] && lists[i].missions) || []).slice().sort((a, b) => (a.start_unix || 0) - (b.start_unix || 0));
                    return { name: s.storm_name, missions: ms };
                }).filter(g => g.missions.length);
            }
            groups.sort((a, b) => ((a.missions[0].start_unix || Infinity) - (b.missions[0].start_unix || Infinity)) || a.name.localeCompare(b.name));
            preloadListCache[year] = groups;
            return groups;
        }

        // One block per storm: a group checkbox toggling the whole storm, missions in a
        // two-column grid beneath it, already-preloaded ones checked and locked.
        function renderSeason(groups) {
            checksBox.innerHTML = '';
            if (!groups.length) { checksNote('No archived recon flights found for this season.'); return; }
            groups.forEach(gr => {
                const block = document.createElement('div');
                const head = document.createElement('label');
                head.className = 'flex items-center gap-2 cursor-pointer font-semibold text-slate-300';
                const all = document.createElement('input');
                all.type = 'checkbox'; all.className = 'accent-blue-500';
                const title = document.createElement('span');
                title.textContent = gr.name;
                const meta = document.createElement('span');
                meta.className = 'text-slate-500 font-normal';
                const span = reconDateSpan(gr.missions);
                meta.textContent = `(${gr.missions.length} flight${gr.missions.length === 1 ? '' : 's'}${span ? ', ' + span : ''})`;
                head.appendChild(all); head.appendChild(title); head.appendChild(meta);
                const grid = document.createElement('div');
                grid.className = 'grid grid-cols-2 gap-x-3 pl-5 mt-0.5';
                gr.missions.forEach(m => {
                    const done = preloadedMissions.has(m.mission_id);
                    const lbl = document.createElement('label');
                    lbl.className = 'flex items-center gap-2 cursor-pointer min-w-0';
                    const cb = document.createElement('input');
                    cb.type = 'checkbox'; cb.value = m.mission_id; cb.className = 'accent-blue-500 flex-none';
                    if (done) { cb.checked = true; cb.disabled = true; }
                    else if (m.mission_id === reconMissionSelect.value) cb.checked = true;
                    const span = document.createElement('span');
                    span.className = 'truncate';
                    span.textContent = `${m.mission_id} · ${m.tail_num || m.aircraft || ''} · ${m.obs_count} obs${done ? ' (preloaded)' : ''}`;
                    span.title = `${m.flight_date} · ${m.aircraft || m.tail_num || ''} · ${m.obs_count} obs`;
                    lbl.appendChild(cb); lbl.appendChild(span);
                    grid.appendChild(lbl);
                });
                all.addEventListener('change', () => {
                    grid.querySelectorAll('input[type=checkbox]:not(:disabled)').forEach(cb => { cb.checked = all.checked; });
                });
                block.appendChild(head); block.appendChild(grid);
                checksBox.appendChild(block);
            });
        }

        async function loadSeasonIntoModal(year) {
            const req = ++preloadListReq;
            if (!year) { checksNote('Pick a season above; its storms and missions appear here.'); return; }
            checksNote('Loading the ' + year + ' season…');
            try {
                const groups = await fetchSeasonGroups(year);
                if (req !== preloadListReq) return;
                renderSeason(groups);
            } catch (e) {
                if (req === preloadListReq) checksNote('Could not load ' + year + ' (' + e.message + ').');
            }
        }

        // The modal carries its own season selector (filled from the same year list as the
        // archive), so preloading works with nothing picked in the archive cascade.
        async function openPreloadModal() {
            if (!modal || !checksBox) return;
            if (fill) fill.style.width = '0%';
            setModalStatus(preloadRunning ? 'A preload pass is running…' : 'Check the missions to preload.');
            modal.style.display = 'flex';
            await reconYearsReady;
            if (yearSel && yearSel.options.length <= 1) {
                yearSel.innerHTML = '<option value="">Year…</option>';
                [...reconYearSelect.options].slice(1).forEach(o => {
                    const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.value;
                    yearSel.appendChild(opt);
                });
            }
            if (yearSel && !yearSel.value && reconYearSelect.value) yearSel.value = reconYearSelect.value;
            loadSeasonIntoModal(yearSel ? yearSel.value : '');
        }

        // Sequential download + parse of everything checked; closing the modal lets it keep
        // running in the background (progress stays visible in the archive status line).
        async function runPreload() {
            if (preloadRunning) { setModalStatus('A preload pass is already running.'); return; }
            const ids = [...checksBox.querySelectorAll('input[type=checkbox]:checked:not(:disabled)')].map(cb => cb.value);
            if (!ids.length) { setModalStatus('Nothing checked.'); return; }
            preloadRunning = true; if (startBtn) startBtn.disabled = true;
            let ok = 0;
            for (let i = 0; i < ids.length; i++) {
                const good = await preloadReconMission(ids[i], msg => { setModalStatus(`(${i + 1}/${ids.length}) ${msg}`); setReconStatus(msg); });
                if (good) ok++;
                if (fill) fill.style.width = Math.round((i + 1) / ids.length * 100) + '%';
            }
            preloadRunning = false; if (startBtn) startBtn.disabled = false;
            setModalStatus(`Done: ${ok}/${ids.length} preloaded. They stay on this device and open instantly from the Preloaded missions list.`);
            setReconStatus(`Preloaded ${ok}/${ids.length} missions.`);
            if (yearSel && yearSel.value) loadSeasonIntoModal(yearSel.value);   // relist so finished missions show checked and locked
        }

        const btn = document.getElementById('reconPreloadBtn');
        if (btn) btn.addEventListener('click', openPreloadModal);
        if (yearSel) yearSel.addEventListener('change', () => loadSeasonIntoModal(yearSel.value));
        if (startBtn) startBtn.addEventListener('click', runPreload);
        ['preloadCloseX', 'preloadCloseBtn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
        });
        const sel = document.getElementById('preloadedSelect');
        if (sel) sel.addEventListener('change', () => { if (sel.value) openPreloadedMission(sel.value); });
    })();
