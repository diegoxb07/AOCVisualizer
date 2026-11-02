/* Mission Visualizer, file/video upload + flight-load pipeline
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   The parsing itself lives in js/11b-parser-core.js (pure, shared with the parse worker, the
   batch sat-cache, and the node tests). This file owns the DOM side: upload wiring, the worker
   round-trip, the data report, and the post-parse UI/global setup. */

    let lastParseStats = null;   // stats ledger from the most recent load (see parseFlightTextToRows)

    // body.flight-loading drives the skeleton placeholders in css/app.css while a flight is on its way
    // in: the loading overlay sets it, and so does opening a previously loaded mission, which shows no overlay.
    function setFlightLoading(on) { document.body.classList.toggle('flight-loading', !!on); }
    function showLoadingOverlay() {
        setFlightLoading(true);
        const l = document.getElementById('loadingOverlay'); l.classList.remove('hidden'); l.classList.add('flex');
        const st = document.getElementById('loadingOverlaySubtext'); if (st) st.textContent = 'Pulling variables...';
        // clear any stale download-progress state from a previous load (the leftover 100% bar / percent)
        const pw = document.getElementById('loadingProgressWrap'); if (pw) pw.classList.add('hidden');
        const pp = document.getElementById('loadingProgressPct'); if (pp) pp.textContent = '0%';
        parseShownPercent = 0;
        const ps = document.getElementById('loadingProgressSpeed'); if (ps) ps.textContent = '';
    }
    function hideLoadingOverlay() { setFlightLoading(false); const l = document.getElementById('loadingOverlay'); l.classList.add('hidden'); l.classList.remove('flex'); }

    document.getElementById('videoInput').addEventListener('change', function(e) {
        if (!e.target.files[0]) return;
        markDropZoneLoaded('videoDropZone', 'videoDropLabel', e.target.files[0].name);
        if (typeof ocrResetWatchdog === 'function') ocrResetWatchdog();   // fresh video, fresh 30 s no-lock clock
        video.src = URL.createObjectURL(e.target.files[0]); document.getElementById('videoPlaceholder').style.display = 'none'; videoLoaded = true;
        // First video of the session: start pulling the ~12 MB OCR engine, which loads on demand. Not
        // awaited, the video is usable meanwhile; evaluateAutoSyncDefault below flips on Auto and
        // shows the warmup badge, and the locks await it themselves.
        ensureOCR();
        syncMediaGridLayout();
        // A floating map means the user works in PiP; the fresh video joins it at its side.
        if (typeof floatVideoBesideMap === 'function') floatVideoBesideMap();
        speeds = [1, 2, 4, 8, 16]; currentSpeedIdx = 0; updateSpeedDisplay();
        nativePlaybackCeiling = 16; nativeRetryAtMs = 0; nativeRetryDelayMs = 20000;   // a new file gets its own decoder judgment (see the stall watchdog)
        videoSyncMode.disabled = false; document.getElementById('videoStartInput').disabled = false;
        if (allParsedData.length > 0) document.getElementById('videoStartInput').value = allParsedData[0].time;
        video.addEventListener('loadedmetadata', () => { updateEndWindowFromVideo(true); if (typeof syncVideoCrop === 'function') syncVideoCrop(); }, { once: true });
        video.addEventListener('seeking', syncTelemetryToVideoClock);
        evaluateAutoSyncDefault();
        // No ocrAvailable precondition: it reads false until the engine finishes warming up, so
        // gating on it here would drop the first auto-lock. performImmediateOcrLock awaits the
        // warmup itself and returns quietly (silent) if OCR is unavailable.
        video.addEventListener('loadeddata', () => { if (videoSyncMode.value === 'auto') performImmediateOcrLock({ silent: true }); }, { once: true });
        setTimeout(() => { if (videoSyncMode.value === 'auto' && !isPlaying) performImmediateOcrLock({ silent: true }); }, 1000);
    });

    document.getElementById('fileInput').addEventListener('change', function(e) {
        if (!e.target.files[0]) return;
        markDropZoneLoaded('dataDropZone', 'dataDropLabel', e.target.files[0].name);
        showLoadingOverlay();
        setTimeout(() => {
            currentSpeedIdx = 0; updateSpeedDisplay();
            const file = e.target.files[0]; const fName = file.name;
            const match = fName.match(/^(\d{4})(\d{2})(\d{2})([a-zA-Z])(.*)\./i);
            if (match) {
                flightMetaData.date = `${match[1]}-${match[2]}-${match[3]}`; const planeType = match[4].toUpperCase();
                if (planeType === 'H') flightMetaData.aircraft = 'NOAA42 (WP-3D Orion)'; else if (planeType === 'I') flightMetaData.aircraft = 'NOAA43 (WP-3D Orion)'; else if (planeType === 'N') flightMetaData.aircraft = 'NOAA49 (Gulfstream IV-SP)'; else flightMetaData.aircraft = 'Unknown';
                flightMetaData.id = match[0].replace('.', '');
            } else { flightMetaData.id = file.name; flightMetaData.date = 'Unknown'; flightMetaData.aircraft = 'Unknown'; }

            const isNc = fName.split('.').pop().toLowerCase() === 'nc';
            isNcFile = isNc; if (videoLoaded) videoSyncMode.disabled = false;
            const reader = new FileReader();
            reader.onload = (evt) => {
                // Parse and apply in two steps (rather than parseEntireFile) so the parsed rows
                // are in hand to register the upload in the previously-loaded list afterward.
                parseFlightSource(evt.target.result).then(parsed => {
                    applyParsedFlight(parsed);
                    // An uploaded flight is not an archive mission: it joins the previously-loaded
                    // list like a preload-modal upload, and the archive cascade goes back to blank
                    // so the pickers never claim it came from the archive.
                    if (typeof registerUploadedFlight === 'function') registerUploadedFlight(fName, parsed, isNc);
                    if (typeof resetArchiveCascade === 'function') resetArchiveCascade();
                }).catch(err => {
                    hideLoadingOverlay();
                    showToast('Could not load ' + fName + ': ' + err.message, 10000);
                });
            };
            reader.onerror = () => { hideLoadingOverlay(); showToast('Could not read ' + fName + ' from disk.', 8000); };
            if (isNc) reader.readAsArrayBuffer(file); else reader.readAsText(file);
        }, 50);
    });

    // Unloads the MMR video and clears both upload drop zones. Switching flights from the archive
    // or the preloaded list starts clean; a stale video belongs to the previous flight and its
    // sync offset is meaningless against the new one.
    function clearLoadedMedia() {
        document.getElementById('fileInput').value = '';
        resetDropZone('dataDropZone', 'dataDropLabel', 'Choose File/Drag & Drop');
        if (!videoLoaded) return;
        // An unloaded video panel has nothing to float; back to the bar before the video goes.
        if (typeof floatDock === 'function') floatDock('videoPanel');
        video.pause();
        try { URL.revokeObjectURL(video.src); } catch (e) {}
        video.removeAttribute('src'); video.load();
        videoLoaded = false;
        if (typeof ocrResetWatchdog === 'function') ocrResetWatchdog();
        if (typeof updateTimelineSyncLock === 'function') updateTimelineSyncLock();   // no video, no sync lock: hand the slider back
        document.getElementById('videoPlaceholder').style.display = '';
        document.getElementById('videoInput').value = '';
        resetDropZone('videoDropZone', 'videoDropLabel', 'Choose File/Drag & Drop');
        videoSyncMode.disabled = true;
        const vsi = document.getElementById('videoStartInput'); vsi.value = '000000'; vsi.disabled = true;
        speeds = [1, 2, 4, 8, 16, 32, 64, 128]; currentSpeedIdx = 0; updateSpeedDisplay();
        syncMediaGridLayout();
    }

    // The shared ?v= cache-buster, read off this page's own script tags so the worker URL stays in
    // step with the single version string in index.html.
    function assetVer() {
        const s = document.querySelector('script[src*="?v="]');
        const m = s && s.src.match(/\?v=[^&]+/);
        return m ? m[0] : '';
    }

    // How far a parse is, 0 to 1, from a parser progress report. A NetCDF goes through the variable
    // decode, then building the text rows, then parsing them; a text file only has the parse. The
    // shares follow measured worker times on a 132 variable, 30,000 row flight.
    function parseProgressFraction(p, fromNc) {
        const f = (p.total && p.index) ? Math.min(1, p.index / p.total) : 0;
        if (p.phase === 'parse') return fromNc ? 0.35 + 0.65 * f : f;
        if (p.phase === 'rows') return 0.15 + 0.2 * f;
        if (p.phase === 'var') return 0.15 * f;
        return 0;
    }

    // reflect the worker's progress in the loading overlay: the current step, and one percent for the
    // whole parse that only climbs (reset by showLoadingOverlay).
    let parseShownPercent = 0;
    function updateParseProgress(p, fromNc) {
        if (!p) return;
        const st = document.getElementById('loadingOverlaySubtext');
        const wrap = document.getElementById('loadingProgressWrap');
        const pct = document.getElementById('loadingProgressPct');
        const spd = document.getElementById('loadingProgressSpeed');
        if (p.phase === 'open' || p.phase === 'var') { if (st) st.textContent = `Reading ${p.total} NetCDF variables...`; }
        else if (p.phase === 'rows') { if (st) st.textContent = `Building ${Number(p.numRows).toLocaleString()} data rows...`; }
        else if (p.phase === 'parse') { if (st) st.textContent = 'Parsing data rows...'; }
        else return;
        // the parse reaching its end means the worker is done; drawing the flight then runs on this
        // thread with no reports, so that step shows without a percent
        if (p.phase === 'parse' && p.index >= p.total) {
            if (st) st.textContent = 'Drawing the flight...';
            if (wrap) wrap.classList.add('hidden');
            return;
        }
        parseShownPercent = Math.max(parseShownPercent, Math.round(parseProgressFraction(p, fromNc) * 100));
        if (wrap) wrap.classList.remove('hidden');
        if (pct) pct.textContent = parseShownPercent + '%';
        if (spd) spd.textContent = '';
    }

    // Parse a flight source (TSV string, or an .nc ArrayBuffer) into { rows, stats }, off the main
    // thread so the page never freezes on a big file. Falls back to parsing on the main thread when
    // workers are unavailable (e.g. file://). Rejects with the parse error for the caller to report.
    // onProgress (optional) receives each parser report and whether the source is a NetCDF; callers
    // that draw their own bar (the preload modal) pass one, everyone else defaults to updateParseProgress.
    function parseFlightSource(source, onProgress) {
        const fromNc = typeof source !== 'string';
        const report = (p) => (onProgress || updateParseProgress)(p, fromNc);
        const onMainThread = () => {
            if (source && typeof source !== 'string' && source.byteLength === 0)
                throw new Error('parse worker failed and the file buffer was already handed off. Please re-select the file.');
            const tsv = typeof source === 'string' ? source : ncArrayBufferToTsv(source, report);
            return parseFlightTextToRows(tsv, report);
        };
        return new Promise((resolve, reject) => {
            let w, settled = false;
            try { w = new Worker('js/parse-worker.js' + assetVer()); }
            catch (e) { try { resolve(onMainThread()); } catch (err) { reject(err); } return; }
            w.onmessage = (e) => {
                if (e.data && e.data.progress) { report(e.data.progress); return; }  // live decode feedback
                settled = true; w.terminate();
                if (e.data && e.data.error) reject(new Error(e.data.error)); else resolve(e.data);
            };
            // worker infrastructure failure (script blocked or failed to load) before a result: parse here.
            w.onerror = () => {
                if (settled) return;
                settled = true; w.terminate();
                try { resolve(onMainThread()); } catch (err) { reject(err); }
            };
            // transfer the .nc arraybuffer to the worker instead of cloning it. a structured clone copy of a
            // large netcdf buffer runs on the main thread and froze the loading spinner mid load. strings
            // (tsv) can't be transferred, so they're cloned, which is cheap.
            if (typeof source === 'string') w.postMessage({ tsv: source });
            else w.postMessage({ nc: source }, [source]);
        });
    }

    // Load a flight from a TSV string or an .nc ArrayBuffer. Throws (after cleaning up its own
    // state) when the file yields nothing usable; callers decide how to surface that.
    async function parseEntireFile(source) {
        applyParsedFlight(await parseFlightSource(source));
    }

    // Take an already-parsed { rows, stats } (fresh from the worker, or held by the mission
    // preloader) and make it the loaded flight: resets, globals, and the post-parse UI setup.
    // Throws when the rows are empty.
    function applyParsedFlight(parsed) {
        // the skeletons come off before the charts are built: with them on, building the charts ran
        // about thirtyfold slower. the screen holds its last frame until this returns, so they still
        // show for the whole step.
        setFlightLoading(false);
        // A new flight starts from the docked, expanded media layout: pull any floating player back
        // into the bar and open the media if it was collapsed.
        if (typeof floatPanelsDockAll === 'function') floatPanelsDockAll();
        const mediaBarEl = document.getElementById('stickyMediaBar');
        if (mediaBarEl && mediaBarEl.classList.contains('collapsed')) {
            const cb = document.getElementById('mediaCollapseBtn'); if (cb) cb.click();
        }
        // New flight: KEEP the satellite tile cache (it accumulates across storms until the tab closes;
        // tiles are keyed by layer/band/time/box so they never collide between flights). Just reset the
        // preloader's neighborhood pointer so it re-warms around the new flight.
        if (typeof resetSatPreload === 'function') resetSatPreload();
        // The satellite preference does NOT carry over: a new mission starts with the picker on
        // Off (a held-over layer/product would auto-rebuild its cache for the new flight
        // unasked). The old flight's auto cache pass stops with it; a modal batch pass caches
        // its own chosen flights and is left alone.
        if (typeof batchCaching !== 'undefined' && batchCaching && batchCacheIsAuto && typeof cancelSatCachePass === 'function') cancelSatCachePass('Stopped');
        const satSelReset = document.getElementById('satelliteSelect'); if (satSelReset) satSelReset.value = 'none';
        const bandSelReset = document.getElementById('satBandSelect'); if (bandSelReset) bandSelReset.value = '';
        satLoadedInfo = null; satImageBox = null;
        if (typeof refreshSatImageTimeNote === 'function') refreshSatImageTimeNote();
        // Clear any storm best-track / archive-mission metadata from the previous flight, it's
        // re-set after this returns by loadReconMission for an archive load.
        stormTrackPoints = []; stormTrackMeta = null; reconArchiveMeta = null;
        // Same reasoning for the shareable ?mission= URL params, an archive load re-sets them after this returns.
        try { const u = new URL(window.location.href); ['mission', 't', 'view'].forEach(k => u.searchParams.delete(k)); history.replaceState(null, '', u); } catch (e) {}
        const stormToggleLabel = document.getElementById('stormTrackToggleLabel'); if (stormToggleLabel) stormToggleLabel.style.display = 'none';
        const srcLink = document.getElementById('reconSourceLink'); if (srcLink) srcLink.classList.add('hidden');

        allParsedData = parsed.rows; lastParseStats = parsed.stats;
        if (allParsedData.length === 0) {
            throw new Error('no usable rows (' + summarizeParseStats(parsed.stats) + ')');
        }

        availableMetrics.clear();
        allParsedData.forEach(row => { Object.keys(METRIC_DEFS).forEach(k => { if (row[k] !== null && row[k] !== undefined && !isNaN(row[k])) availableMetrics.add(k); }); });

        updateMissionHeader();
        // TDR coverage probe for the new flight (js/07d-tdr.js); resets the previous overlay itself.
        if (typeof initTdrForFlight === 'function') initTdrForFlight();

        ['startTimeInput', 'endTimeInput', 'playPauseBtn', 'exportClipBtn'].forEach(id => document.getElementById(id).disabled = false);
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

        // New flight: start zoomed in on the aircraft and following it (js/15-map-render.js).
        if (typeof engageFollowAircraft === 'function') engageFollowAircraft();

        if (filteredData.length > 0 && !isPlaying) {
            isPlaying = true; playPauseBtn.innerText = "Pause"; playbackAccumulator = 0; lastTickTime = performance.now();
            if (videoLoaded && speeds[currentSpeedIdx] <= nativePlaybackCeiling) video.play().catch(e=>{});
            masterSyncEngineTick();
        }

        // Success: this runs only once processing is fully done. The note reads "Parsed successfully"
        // for a moment, then the card and the skeletons clear together and the flight shows.
        const st = document.getElementById('loadingOverlaySubtext'); if (st) st.textContent = 'Parsed successfully';
        setTimeout(hideLoadingOverlay, 400);
    }
