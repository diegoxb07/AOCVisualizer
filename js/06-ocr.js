/* Mission Visualizer, OCR worker init + drop-zone helper
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    let ocrWorker = null, isOcrRunning = false, lastOcrTime = 0, lastOcrVideoTime = 0, ocrHistory = [], ocrAvailable = false;
    let ocrInitPromise = null, ocrWarmingUp = false;
    async function initOCR() {
        if (ocrWorker) return;
        if (typeof Tesseract === 'undefined') { ocrAvailable = false; return; }
        try {
            // Worker, wasm core, and eng language data are all vendored in lib/tesseract/ so
            // Auto-Sync OCR works with no internet. Absolute URLs (resolved against the page)
            // because the worker resolves relative corePath/langPath against ITS OWN location.
            const base = new URL('lib/tesseract/', window.location.href).href;
            ocrWorker = await Tesseract.createWorker({
                workerPath: base + 'worker.min.js',
                corePath: base.replace(/\/$/, ''),
                langPath: base.replace(/\/$/, '')
            });
            await ocrWorker.loadLanguage('eng'); await ocrWorker.initialize('eng');
            await ocrWorker.setParameters({ tessedit_char_whitelist: '0123456789:;.,|IloOZS ', tessjs_create_hocr: '0', tessjs_create_tsv: '0', tessjs_create_osd: '0' });
            ocrAvailable = true;
        } catch(e) { ocrAvailable = false; ocrWorker = null; console.warn("Auto-sync OCR unavailable."); }
    }

    // The vendored engine (wasm core + eng training data) is ~12 MB and only Auto-Sync needs it, so
    // the warmup waits until an MMR video arrives. Idempotent: concurrent callers share the one
    // in-flight promise, and it never rejects (initOCR swallows its own errors and leaves
    // ocrAvailable false), so callers can await it unguarded and check ocrAvailable afterwards.
    function ensureOCR() {
        if (ocrInitPromise) return ocrInitPromise;
        ocrWarmingUp = true;
        refreshSyncingIndicator();
        ocrInitPromise = initOCR().finally(() => { ocrWarmingUp = false; refreshSyncingIndicator(); });
        return ocrInitPromise;
    }

    // --- Non-blocking "Syncing…" badge, shown while Auto-Sync is hunting for the MMR timestamp ---
    // State-driven (not a counter) so the multi-scan drift hunt stays solid instead of flickering.
    // Visible whenever Auto-Sync has a video and is either warming the engine up (ensureOCR),
    // scanning (isOcrRunning), or holding a queued (re)lock (forceOcrSyncNextTick). A badge rather
    // than a cover, since the MMR plays through the warmup and only the alignment is pending.
    function refreshSyncingIndicator() {
        const el = document.getElementById('syncingIndicator');
        if (!el) return;
        const onAuto = videoLoaded && videoSyncMode && videoSyncMode.value === 'auto';
        const warming = onAuto && ocrWarmingUp;
        const hunting = onAuto && ocrAvailable && (isOcrRunning || forceOcrSyncNextTick);
        const label = el.querySelector('.sync-label'), sub = el.querySelector('.sync-sub');
        if (label) label.textContent = warming ? 'Preparing Auto-Sync…' : 'Syncing…';
        if (sub) sub.textContent = warming ? 'loading OCR engine, first video only' : 'aligning tracker';
        el.classList.toggle('show', !!(warming || hunting));
    }

    // --- Shared frame capture for both OCR paths ---------------------------------------------
    // MMR exports differ: the burned-in clock is usually bottom-right, but compiled and cropped
    // videos move it (often near the center) and aspect ratios vary, so the WHOLE frame is
    // captured at native resolution and the sync logic picks the candidate time that advances
    // with the video clock. Grayscale always; the aggressive flag adds a hard threshold for
    // low-contrast frames.
    function ocrCaptureFullFrame(aggressive) {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return null;
        if (!window.ocrCanvas) { window.ocrCanvas = document.createElement('canvas'); window.ocrCtx = window.ocrCanvas.getContext('2d', { willReadFrequently: true }); }
        window.ocrCanvas.width = vw; window.ocrCanvas.height = vh;
        window.ocrCtx.drawImage(video, 0, 0, vw, vh);
        const imgData = window.ocrCtx.getImageData(0, 0, vw, vh); const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            let luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            if (aggressive) luma = luma > 140 ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = luma;
        }
        window.ocrCtx.putImageData(imgData, 0, 0);
        return window.ocrCanvas;
    }

    // --- 30-second no-lock watchdog ------------------------------------------------------------
    // Compiled nose-radar videos re-render the clock somewhere unusual (or too small) and
    // routinely defeat the scan. Once 30 s pass after the first scan with no lock ever landing,
    // say so once; a new video resets the clock.
    let ocrHuntStartMs = 0, ocrEverLocked = false, ocrCompiledWarned = false;
    function ocrNoteScanStart() { if (!ocrHuntStartMs) ocrHuntStartMs = performance.now(); }
    function ocrNoteLock() { ocrEverLocked = true; }
    function ocrResetWatchdog() { ocrHuntStartMs = 0; ocrEverLocked = false; ocrCompiledWarned = false; }
    function ocrMaybeWarnCompiled() {
        if (ocrEverLocked || ocrCompiledWarned || !ocrHuntStartMs) return;
        if (performance.now() - ocrHuntStartMs < 30000) return;
        ocrCompiledWarned = true;
        showToast('Auto-Sync has not found the MMR clock after 30 seconds of trying. Upload only the MMR video, not the nose-radar compiled video: compiled videos place the clock somewhere unusual and often cannot sync. Manual Time Input also works.', 14000);
    }

    // Inverse of markDropZoneLoaded: returns a drop zone to its dashed waiting state.
    function resetDropZone(zoneId, labelId, text) {
        const zone = document.getElementById(zoneId);
        const label = document.getElementById(labelId);
        if (!zone || !label) return;
        zone.classList.add('bg-panel-strip', 'border-dashed', 'hover:border-accent', 'hover:bg-elevated');
        zone.classList.remove('bg-[color-mix(in_oklab,var(--bg)_40%,transparent)]', 'border-solid', 'hover:border-hairline-strong', 'hover:bg-[color-mix(in_oklab,var(--bg)_60%,transparent)]');
        label.classList.add('text-muted', 'group-hover:text-accent');
        label.classList.remove('text-ink', 'group-hover:text-ink');
        label.textContent = text;
        label.removeAttribute('title');
    }

    // --- Mark a drop zone as "file loaded": turn it gray + show the filename small ---
    function markDropZoneLoaded(zoneId, labelId, filename) {
        const zone = document.getElementById(zoneId);
        const label = document.getElementById(labelId);
        if (!zone || !label) return;
        zone.classList.remove('bg-panel-strip', 'border-hairline-strong', 'border-dashed', 'hover:border-accent', 'hover:bg-elevated');
        zone.classList.add('bg-[color-mix(in_oklab,var(--bg)_40%,transparent)]', 'border-hairline-strong', 'border-solid', 'hover:border-hairline-strong', 'hover:bg-[color-mix(in_oklab,var(--bg)_60%,transparent)]');
        label.classList.remove('text-muted', 'group-hover:text-accent');
        label.classList.add('text-ink', 'group-hover:text-ink');
        label.textContent = filename;
        label.title = filename;
    }
