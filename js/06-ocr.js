/* Mission Visualizer - OCR worker init + drop-zone helper
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    let ocrWorker = null, isOcrRunning = false, lastOcrTime = 0, lastOcrVideoTime = 0, ocrHistory = [], ocrAvailable = false;
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
    window.addEventListener('load', initOCR);

    // --- Non-blocking "Syncing…" badge, shown while Auto-Sync is hunting for the MMR timestamp ---
    // State-driven (not a counter) so the multi-scan drift hunt stays solid instead of flickering.
    // Visible whenever Auto-Sync has a video and is either actively scanning (isOcrRunning) or
    // still has a pending (re)lock queued (forceOcrSyncNextTick). Hidden once a lock settles.
    function refreshSyncingIndicator() {
        const el = document.getElementById('syncingIndicator');
        if (!el) return;
        const hunting = videoLoaded
            && videoSyncMode && videoSyncMode.value === 'auto'
            && ocrAvailable && (isOcrRunning || forceOcrSyncNextTick);
        el.classList.toggle('show', !!hunting);
    }

    // --- Mark a drop zone as "file loaded": turn it purple + show the filename small ---
    function markDropZoneLoaded(zoneId, labelId, filename) {
        const zone = document.getElementById(zoneId);
        const label = document.getElementById(labelId);
        if (!zone || !label) return;
        zone.classList.remove('bg-slate-800', 'border-slate-600', 'border-dashed', 'hover:border-blue-500', 'hover:bg-slate-700');
        zone.classList.add('bg-purple-950/40', 'border-purple-800', 'border-solid', 'hover:border-purple-600', 'hover:bg-purple-950/60');
        label.classList.remove('text-slate-300', 'group-hover:text-blue-300');
        label.classList.add('text-purple-300', 'group-hover:text-purple-200');
        label.textContent = filename;
        label.title = filename;
    }
