/* Mission Visualizer, file/video upload + flight-load pipeline
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   The parsing itself lives in js/11b-parser-core.js (pure, shared with the parse worker, the
   batch sat-cache, and the node tests). This file owns the DOM side: upload wiring, the worker
   round-trip, the data report, and the post-parse UI/global setup. */

    let lastParseStats = null;   // stats ledger from the most recent load (see parseFlightTextToRows)

    function showLoadingOverlay() { const l = document.getElementById('loadingOverlay'); l.classList.remove('hidden'); l.classList.add('flex'); }
    function hideLoadingOverlay() { const l = document.getElementById('loadingOverlay'); l.classList.add('hidden'); l.classList.remove('flex'); }

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
                parseEntireFile(evt.target.result).catch(err => {
                    hideLoadingOverlay();
                    showToast('Could not load ' + fName + ': ' + err.message, 10000);
                });
            };
            reader.onerror = () => { hideLoadingOverlay(); showToast('Could not read ' + fName + ' from disk.', 8000); };
            if (isNc) reader.readAsArrayBuffer(file); else reader.readAsText(file);
        }, 50);
    });

    // The shared ?v= cache-buster, read off this page's own script tags so the worker URL stays in
    // step with the single version string in index.html.
    function assetVer() {
        const s = document.querySelector('script[src*="?v="]');
        const m = s && s.src.match(/\?v=[^&]+/);
        return m ? m[0] : '';
    }

    // Parse a flight source (TSV string, or an .nc ArrayBuffer) into { rows, stats }, off the main
    // thread so the page never freezes on a big file. Falls back to parsing on the main thread when
    // workers are unavailable (e.g. file://). Rejects with the parse error for the caller to report.
    function parseFlightSource(source) {
        const onMainThread = () => {
            const tsv = typeof source === 'string' ? source : ncArrayBufferToTsv(source);
            return parseFlightTextToRows(tsv);
        };
        return new Promise((resolve, reject) => {
            let w;
            try { w = new Worker('js/parse-worker.js' + assetVer()); }
            catch (e) { try { resolve(onMainThread()); } catch (err) { reject(err); } return; }
            w.onmessage = (e) => {
                w.terminate();
                if (e.data && e.data.error) reject(new Error(e.data.error)); else resolve(e.data);
            };
            // Worker infrastructure failure (script blocked / failed to load): parse here instead.
            w.onerror = () => {
                w.terminate();
                try { resolve(onMainThread()); } catch (err) { reject(err); }
            };
            if (typeof source === 'string') w.postMessage({ tsv: source });
            else w.postMessage({ nc: source }, [source]);
        });
    }

    // Fill #dataReportLine with the parser's honesty ledger (rows filtered, values derived) and
    // warn loudly when a large share of the file was dropped, so a wrong-format file can never
    // quietly present itself as a clean flight.
    function updateDataReport(stats) {
        const line = document.getElementById('dataReportLine');
        if (line) {
            line.textContent = 'Data report: ' + summarizeParseStats(stats);
            line.classList.remove('hidden');
        }
        const d = stats.dropped;
        const totalDropped = d.shortLine + d.noTime + d.badPosition + d.error + d.taxi + d.ground + d.dupTime + d.glitch + d.gapReset;
        if (stats.dataLines > 0 && totalDropped > 0.2 * stats.dataLines && stats.rows > 0) {
            showToast('Heads up: ' + totalDropped.toLocaleString('en-US') + ' of ' + stats.dataLines.toLocaleString('en-US')
                + ' lines were filtered out. See the data report under the mission header for the breakdown.', 9000);
        }
    }

    // Load a flight from a TSV string or an .nc ArrayBuffer. Throws (after cleaning up its own
    // state) when the file yields nothing usable; callers decide how to surface that.
    async function parseEntireFile(source) {
        // New flight: KEEP the satellite tile cache (it accumulates across storms until the tab closes;
        // tiles are keyed by layer/band/time/box so they never collide between flights). Just reset the
        // preloader's neighborhood pointer so it re-warms around the new flight.
        if (typeof resetSatPreload === 'function') resetSatPreload();
        // Clear any storm best-track / archive-mission metadata from the previous flight, it's
        // re-set after this returns by loadReconMission for an archive load.
        stormTrackPoints = []; stormTrackMeta = null; reconArchiveMeta = null;
        // Same reasoning for the shareable ?mission= URL params, an archive load re-sets them after this returns.
        try { const u = new URL(window.location.href); ['mission', 't', 'view'].forEach(k => u.searchParams.delete(k)); history.replaceState(null, '', u); } catch (e) {}
        const stormToggleLabel = document.getElementById('stormTrackToggleLabel'); if (stormToggleLabel) stormToggleLabel.style.display = 'none';
        const srcLink = document.getElementById('reconSourceLink'); if (srcLink) srcLink.classList.add('hidden');

        const parsed = await parseFlightSource(source);
        allParsedData = parsed.rows; lastParseStats = parsed.stats;
        updateDataReport(parsed.stats);
        if (allParsedData.length === 0) {
            throw new Error('no usable rows (' + summarizeParseStats(parsed.stats) + ')');
        }

        availableMetrics.clear();
        allParsedData.forEach(row => { Object.keys(METRIC_DEFS).forEach(k => { if (row[k] !== null && row[k] !== undefined && !isNaN(row[k])) availableMetrics.add(k); }); });

        updateMissionHeader();

        ['startTimeInput', 'endTimeInput', 'playPauseBtn', 'exportKmlBtn', 'exportClipBtn'].forEach(id => document.getElementById(id).disabled = false);
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

        hideLoadingOverlay();
    }
