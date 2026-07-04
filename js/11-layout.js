/* Mission Visualizer - canvas/layout resize + time helpers
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    function resizeCanvasLayout() {
        const rect = canvas.parentElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        // HiDPI: render the backing store at devicePixelRatio so text/lines are crisp on Retina.
        // CSS size stays `rect` (the element is width/height:100%); logical coords use cssW/cssH.
        const dpr = window.devicePixelRatio || 1;
        const wCss = Math.round(rect.width), hCss = Math.round(rect.height);
        const bw = Math.round(wCss * dpr), bh = Math.round(hCss * dpr);
        if (canvas.width !== bw || canvas.height !== bh) {
            DPR = dpr; cssW = wCss; cssH = hCss;
            canvas.width = bgCanvas.width = bw;
            canvas.height = bgCanvas.height = bh;
            bgNeedsUpdate = true;
            if (threeDInitialized && camera3D) {
                camera3D.aspect = wCss / hCss;
                camera3D.updateProjectionMatrix();
                renderer3D.setSize(wCss, hCss);
                if (renderer3D.setPixelRatio) renderer3D.setPixelRatio(dpr);
            }
        }

        const pfdC = document.getElementById('pfdCanvas');
        if (pfdC && pfdC.parentElement && pfdC.parentElement.style.display !== 'none') {
            const pRect = pfdC.parentElement.getBoundingClientRect();
            if (pRect.width > 0 && pRect.height > 0 && (pfdC.width !== pRect.width || pfdC.height !== pRect.height)) {
                pfdC.width = pRect.width; pfdC.height = pRect.height;
                if(filteredData.length > 0) renderPFD(filteredData[currentIdx]);
            }
        }
    }
    window.addEventListener('resize', () => {
        if (filteredData.length > 0) {
            resizeCanvasLayout();
            if(trackerModeSelect.value === '2d') { calculateMapScales(); bgNeedsUpdate = true; renderMapEngineFrame(currentIdx, filteredData[currentIdx]); }
            if (document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]);
        }
    });

    // Fullscreen/fake-fs transitions resize the map's container on the browser's own timeline
    // (varies by OS/animation, and doesn't always fire a `window` 'resize' event) - the
    // fullscreenchange handler's fixed setTimeout (js/07-ui-controls.js) can fire before that
    // layout has actually settled, leaving the canvas's backing store sized for the OLD box while
    // its CSS size is already the new (much larger) one, which the browser then stretches to fit -
    // the "map gets stretched in fullscreen" symptom. A ResizeObserver reacts to the container's
    // TRUE rendered size whenever it actually changes, however many times, instead of guessing a
    // delay - resizeCanvasLayout() is a no-op unless the backing store is actually out of date.
    if (window.ResizeObserver) {
        new ResizeObserver(() => {
            resizeCanvasLayout();
            if (filteredData.length > 0) {
                if (trackerModeSelect.value === '2d') { calculateMapScales(); bgNeedsUpdate = true; renderMapEngineFrame(currentIdx, filteredData[currentIdx]); }
                if (document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]);
            }
        }).observe(canvas.parentElement);
    }

    (function setupMediaResize() {
        const handle = document.getElementById('mediaResizeHandle'), bar = document.getElementById('stickyMediaBar');
        if (!handle || !bar) return;
        const MIN_H = 44, MAX_H = 900;  // stops at just enough height to keep the panel titles visible, not fully gone
        // The hard ceiling: the panels must never grow under the sticky bottom bar, or the
        // drag handle ends up unreachable and the layout is stuck big with no way to shrink.
        // 60px ≈ media-bar padding + the handle itself + a small breathing gap above the bar.
        const maxMediaH = () => {
            const bb = document.getElementById('stickyBottomBar');
            const bbH = bb ? bb.getBoundingClientRect().height : 90;
            return Math.max(MIN_H, Math.min(MAX_H, window.innerHeight - bbH - 60));
        };
        let dragging = false, startY = 0, startH = 0, rafPending = false;
        const pointerY = (e) => (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
        const applyMediaH = (h) => {
            document.documentElement.style.setProperty('--media-h', h + 'px');
            document.documentElement.style.setProperty('--hud-scale', Math.max(0.55, Math.min(1, h / 480)).toFixed(3));
        };

        function onDown(e) { dragging = true; isResizingMedia = true; startY = pointerY(e); startH = document.getElementById('mapPanel').getBoundingClientRect().height; bar.classList.add('resizing'); e.preventDefault(); }
        function onMove(e) {
            if (!dragging) return;
            const h = Math.max(MIN_H, Math.min(maxMediaH(), startH + (pointerY(e) - startY)));
            applyMediaH(h);
            if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(() => {
                    rafPending = false; resizeCanvasLayout();
                    if (filteredData.length > 0 && trackerModeSelect.value === '2d') { calculateMapScales(); bgNeedsUpdate = true; renderMapEngineFrame(currentIdx, filteredData[currentIdx]); }
                });
            }
            if (e.cancelable) e.preventDefault();
        }
        function onUp() { if (!dragging) return; dragging = false; isResizingMedia = false; bar.classList.remove('resizing'); resizeCanvasLayout(); if (filteredData.length > 0) { if (trackerModeSelect.value === '2d') { calculateMapScales(); bgNeedsUpdate = true; renderMapEngineFrame(currentIdx, filteredData[currentIdx]); } if (document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]); } }
        handle.addEventListener('mousedown', onDown); handle.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('mousemove', onMove); window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('mouseup', onUp); window.addEventListener('touchend', onUp);

        // Re-clamp if the window shrinks around an already-tall layout (and once at startup,
        // for short screens where even the default height would bury the handle). Pinned
        // (.fake-fs) panels are viewport-sized by design and skip this.
        function clampMediaToViewport() {
            const mapPanelEl = document.getElementById('mapPanel'), videoPanelEl = document.getElementById('videoPanel');
            if (mapPanelEl.classList.contains('fake-fs') || (videoPanelEl && videoPanelEl.classList.contains('fake-fs'))) return;
            const mx = maxMediaH();
            if (mapPanelEl.getBoundingClientRect().height > mx + 1) {
                applyMediaH(mx);
                resizeCanvasLayout();
                if (filteredData.length > 0 && trackerModeSelect.value === '2d') { calculateMapScales(); bgNeedsUpdate = true; renderMapEngineFrame(currentIdx, filteredData[currentIdx]); }
            }
        }
        window.addEventListener('resize', clampMediaToViewport);
        clampMediaToViewport();
    })();

    function timeToSeconds(timeStr) {
        if (!timeStr) return 0; 
        let cleanStr = String(timeStr).replace(/[^0-9]/g, ''); 
        if (cleanStr.length === 4) cleanStr = cleanStr + "00";
        if (cleanStr.length < 6) cleanStr = cleanStr.padStart(6, '0');
        return parseInt(cleanStr.slice(0,2))*3600 + parseInt(cleanStr.slice(2,4))*60 + parseInt(cleanStr.slice(4,6));
    }
    
    function toHHMMSS(secs) {
        let secNum = parseInt(secs, 10);
        let h = Math.floor(secNum / 3600), m = Math.floor((secNum % 3600) / 60), s = secNum % 60;
        return String(h).padStart(2,'0') + String(m).padStart(2,'0') + String(s).padStart(2,'0');
    }
    
    function updateEndWindowFromVideo(preservePlayback = false) {
        if (videoLoaded && video.duration && !isNaN(video.duration)) {
            let startSecs = timeToSeconds(document.getElementById('videoStartInput').value);
            if (startSecs > 0) {
                let endSecs = startSecs + video.duration;
                document.getElementById('startTimeInput').value = toHHMMSS(startSecs);
                document.getElementById('endTimeInput').value = toHHMMSS(endSecs);
                if (allParsedData.length > 0) {
                    let wasPlaying = isPlaying, targetSec = startSecs + video.currentTime, savedSyncFlag = hasInitialSyncOccurred; 
                    applyFiltersAndInit(false);
                    hasInitialSyncOccurred = savedSyncFlag; 
                    if (preservePlayback) {
                        currentIdx = filteredData.findIndex(d => d.absSeconds >= targetSec);
                        if (currentIdx === -1) currentIdx = 0;
                        updateVisualComponents(currentIdx);
                        if (wasPlaying) {
                            isPlaying = true; playPauseBtn.innerHTML = PAUSE_ICON + "Pause"; lastTickTime = performance.now();
                            if (videoLoaded && speeds[currentSpeedIdx] <= 16) video.play().catch(e=>{});
                            masterSyncEngineTick();
                        }
                    }
                }
                showToast(`tracker window auto-adjusted to synced video timeframe (${toHHMMSS(video.duration)})`, 5000);
            }
        }
    }
