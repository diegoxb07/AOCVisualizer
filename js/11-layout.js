/* Mission Visualizer, canvas/layout resize + time helpers
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
            // A panned/zoomed 2D view is stored in pixels against the old canvas size; capture it as
            // geography first so the same place stays centered after the resize instead of jumping.
            // captured in 3D too, so a resize while 3D is up still hands 2D back its view.
            const keepView = (filteredData.length > 0 && isMapPanned()) ? getMapViewportGeo() : null;
            DPR = dpr; cssW = wCss; cssH = hCss;
            canvas.width = bgCanvas.width = bw;
            canvas.height = bgCanvas.height = bh;
            // the base frame's lon and lat spans are fitted to the canvas aspect, so a new canvas shape
            // must refit it or the map stretches. done here, the one place the size changes, since a pin
            // with no window resize (tdr mode, a pin inside real fullscreen) or a resize while 3D is up
            // has no other caller to refit. calculateMapScales only reads the size and the flight, so
            // the callers that refit again after this get the same frame.
            if (filteredData.length > 0) calculateMapScales();
            if (keepView) applyMapViewportGeo(keepView);
            bgNeedsUpdate = true;
            if (threeDInitialized && camera3D) {
                camera3D.aspect = wCss / hCss;
                camera3D.updateProjectionMatrix();
                renderer3D.setSize(wCss, hCss);
                if (renderer3D.setPixelRatio) renderer3D.setPixelRatio(dpr);
            }
        }

        // PFD backing store is DPR-scaled too (CSS keeps the display size at 100%); renderPFD
        // draws in logical CSS pixels through a setTransform(dpr) base, so its text stays crisp.
        const pfdC = document.getElementById('pfdCanvas');
        if (pfdC && pfdC.parentElement && pfdC.parentElement.style.display !== 'none') {
            const pRect = pfdC.parentElement.getBoundingClientRect();
            const pbw = Math.round(pRect.width * dpr), pbh = Math.round(pRect.height * dpr);
            if (pRect.width > 0 && pRect.height > 0 && (pfdC.width !== pbw || pfdC.height !== pbh)) {
                pfdC.width = pbw; pfdC.height = pbh;
                if(filteredData.length > 0) renderPFD(filteredData[currentIdx]);
            }
        }
        // the satellite legend fits itself to the map box's new height
        if (typeof fitSatColorLegend === 'function') fitSatColorLegend();
        fitAttitudeHud();
    }

    // the 3D pitch/roll box (top left) and the metric hud (bottom left) scale together but grow from
    // opposite ends of the left edge, so a short player would stack one on the other. when the box in its
    // top-left spot would come within 8px of the metric hud, .att-beside moves it beside the hud
    // (css/app.css). measured against the top-left spot, never the current one, so the move cannot
    // flip the result. --hud-w carries the hud's width for the beside position.
    function fitAttitudeHud() {
        const box = document.getElementById('mapContainer'), panel = document.getElementById('mapPanel'), hudEl = document.getElementById('hudOverlay');
        if (!box || !panel || !hudEl) return;
        box.style.setProperty('--hud-w', hudEl.offsetWidth + 'px');
        const cs = getComputedStyle(box);
        const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hud-scale')) || 1;
        const attBottom = (parseFloat(cs.getPropertyValue('--att-top')) || 0) + (parseFloat(cs.getPropertyValue('--att-h')) || 0) * s;
        const hr = hudEl.getBoundingClientRect();
        panel.classList.toggle('att-beside', hr.height > 0 && attBottom + 8 > hr.top - box.getBoundingClientRect().top);
    }
    // the metric hud grows and shrinks with its rows (units toggle, a new flight), with no map resize
    (function watchMetricHud() {
        const hudEl = document.getElementById('hudOverlay');
        if (hudEl && typeof ResizeObserver !== 'undefined') { try { new ResizeObserver(fitAttitudeHud).observe(hudEl); } catch (e) {} }
    })();
    window.addEventListener('resize', () => {
        if (filteredData.length > 0) {
            resizeCanvasLayout();
            if(trackerModeSelect.value === '2d') {
                // calculateMapScales reframes the base to fit the flight; preserve a user-panned view
                // across that reframe so a window resize doesn't yank them back to the default frame.
                const keepView = isMapPanned() ? getMapViewportGeo() : null;
                calculateMapScales();
                if (keepView) applyMapViewportGeo(keepView);
                bgNeedsUpdate = true; renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
            }
            if (document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]);
        }
        if (typeof syncVideoCrop === 'function') syncVideoCrop();
    });

    // collapses the mmr panel out of the media bar whenever no video is loaded, so the
    // flight player spans the full media width at the same height. called after a video
    // loads or clears, and re-runs the map resize and redraw to fill the new width.
    function syncMediaGridLayout() {
        const grid = document.getElementById('mediaGrid');
        if (!grid) return;
        // An MMR appearing or leaving changes the 2D map's width (full width vs. sharing the row with
        // the video). Preserving the geographic span across that would shrink or enlarge everything on
        // screen, so the follow view reads as zooming out when a video loads and the user has to zoom
        // back in. Scale the visible span by the width change instead, so on-screen feature size (and
        // the follow zoom) stays put; an unpanned default frame still refits to the new aspect.
        const track2D = filteredData.length > 0 && trackerModeSelect.value === '2d';
        const preW = cssW;
        const preView = (track2D && isMapPanned()) ? getMapViewportGeo() : null;
        grid.classList.toggle('no-video', !videoLoaded);
        resizeCanvasLayout();
        if (typeof syncVideoCrop === 'function') syncVideoCrop();
        if (track2D) {
            calculateMapScales();
            if (preView && preW > 0 && cssW > 0) {
                applyMapViewportGeo({ cLon: preView.cLon, cLat: preView.cLat, spanLon: preView.spanLon * (cssW / preW) });
            }
            bgNeedsUpdate = true;
            renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
        }
        if (filteredData.length > 0 && document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]);
    }

    (function setupMediaResize() {
        const handle = document.getElementById('mediaResizeHandle'), bar = document.getElementById('stickyMediaBar');
        if (!handle || !bar) return;
        const MIN_H = 240, MAX_H = 900;  // keep the players usable when dragging; use the collapse button to fully hide them
        // until the handle is first dragged the height follows the screen: 54vh up to 600px, but on a
        // short screen it gives way so most of a graph row still shows under the stuck bar. 180px keeps
        // a 13 inch laptop window (about 790 to 830px tall) on the plain 54vh height; only shorter
        // windows shrink. css/app.css carries the same rule as the --media-h default, so first paint lands close.
        const AUTO_VH = 0.54, AUTO_MAX = 600, GRAPH_ROOM = 180;
        // the hard ceiling keeps this much clear above the sticky bottom bar, so the drag handle (in the
        // bar's bottom padding) never slips under it and the layout is never stuck big with no way to shrink.
        const HANDLE_GAP = 20;
        const lgQuery = window.matchMedia ? window.matchMedia('(min-width: 1024px)') : null;
        let userH = null;      // the dragged height; null while the height still follows the screen
        let appliedH = null;   // the --media-h currently set, the one source for the docked panel height

        // below tailwind's lg breakpoint the grid is one column, so a loaded mmr stacks under the map
        // and the bar holds two panels of --media-h. a floating panel leaves the other one alone in it.
        const panelRows = (grid) => {
            if (!grid || (lgQuery && lgQuery.matches)) return 1;
            return ['no-video', 'map-floating', 'video-floating'].some(c => grid.classList.contains(c)) ? 1 : 2;
        };
        // height each docked panel can take once the bar sticks: the viewport minus the bar's sticky top
        // (it clears the fixed top-right cluster), its padding and border, the sticky bottom bar, the gap
        // between stacked panels, and `reserve` kept free under the bar.
        const roomPerPanel = (reserve) => {
            const cs = getComputedStyle(bar);
            const chrome = (parseFloat(cs.top) || 0) + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
            const bb = document.getElementById('stickyBottomBar');
            const bbH = bb ? bb.getBoundingClientRect().height : 90;
            const grid = document.getElementById('mediaGrid'), rows = panelRows(grid);
            const gap = rows > 1 ? (parseFloat(getComputedStyle(grid).rowGap) || 0) : 0;
            return (window.innerHeight - chrome - bbH - reserve - gap * (rows - 1)) / rows;
        };
        const maxMediaH = () => Math.max(MIN_H, Math.min(MAX_H, roomPerPanel(HANDLE_GAP)));
        const autoMediaH = () => Math.max(MIN_H, Math.min(AUTO_MAX, window.innerHeight * AUTO_VH, roomPerPanel(GRAPH_ROOM)));
        let dragging = false, startY = 0, startH = 0, dragMax = MAX_H, rafPending = false;
        const pointerY = (e) => (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
        // returns false when the height is already set, so callers skip a redundant relayout
        const applyMediaH = (h) => {
            h = Math.round(h);
            if (h === appliedH) return false;
            appliedH = h;
            document.documentElement.style.setProperty('--media-h', h + 'px');
            // overlay scale (hud, attitude, pfd, satellite legend): full size from 420px, down to 0.8 at
            // the shortest player so the readouts stay legible.
            document.documentElement.style.setProperty('--hud-scale', Math.max(0.8, Math.min(1, h / 420)).toFixed(3));
            return true;
        };

        // the drag starts from the set height, not a panel rect: a floating map's rect is its own window size.
        function onDown(e) { dragging = true; isResizingMedia = true; startY = pointerY(e); startH = appliedH !== null ? appliedH : document.getElementById('mapPanel').getBoundingClientRect().height; dragMax = maxMediaH(); bar.classList.add('resizing'); e.preventDefault(); }
        function onMove(e) {
            if (!dragging) return;
            userH = Math.max(MIN_H, Math.min(dragMax, startH + (pointerY(e) - startY)));
            applyMediaH(userH);
            if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(() => {
                    rafPending = false; resizeCanvasLayout();
                    if (filteredData.length > 0 && trackerModeSelect.value === '2d') { calculateMapScales(); bgNeedsUpdate = true; renderMapEngineFrame(currentIdx, filteredData[currentIdx]); }
                    if (typeof syncVideoCrop === 'function') syncVideoCrop();   // squashed flat enough, the MMR starts cropping its baked-in bands
                });
            }
            if (e.cancelable) e.preventDefault();
        }
        function onUp() { if (!dragging) return; dragging = false; isResizingMedia = false; bar.classList.remove('resizing'); resizeCanvasLayout(); if (filteredData.length > 0) { if (trackerModeSelect.value === '2d') { calculateMapScales(); bgNeedsUpdate = true; renderMapEngineFrame(currentIdx, filteredData[currentIdx]); } if (document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]); } if (typeof syncVideoCrop === 'function') syncVideoCrop(); }
        handle.addEventListener('mousedown', onDown); handle.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('mousemove', onMove); window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('mouseup', onUp); window.addEventListener('touchend', onUp);

        // re-fit whenever the room changes: the window, the bottom bar's height (its observer below also
        // fires when a collapsed bar expands and the bottom bar comes back), the mmr loading or clearing,
        // a panel floating or docking. a dragged height is kept and only clamped to the ceiling. pinned
        // (.fake-fs) panels are viewport-sized by design and skip this; a collapsed bar has nothing to fit.
        function fitMediaToViewport() {
            const mapPanelEl = document.getElementById('mapPanel'), videoPanelEl = document.getElementById('videoPanel');
            if (mapPanelEl.classList.contains('fake-fs') || (videoPanelEl && videoPanelEl.classList.contains('fake-fs'))) return;
            if (bar.classList.contains('collapsed')) return;
            if (!applyMediaH(userH === null ? autoMediaH() : Math.min(userH, maxMediaH()))) return;
            resizeCanvasLayout();
            if (filteredData.length > 0) {
                if (trackerModeSelect.value === '2d') {
                    // same as the window resize handler: keep a user-panned view across the reframe
                    const keepView = isMapPanned() ? getMapViewportGeo() : null;
                    calculateMapScales();
                    if (keepView) applyMapViewportGeo(keepView);
                    bgNeedsUpdate = true; renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
                }
                if (document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]);
            }
            if (typeof syncVideoCrop === 'function') syncVideoCrop();
        }
        window.addEventListener('resize', fitMediaToViewport);
        // no-video and the floating classes on the grid decide whether the panels stack
        const mediaGridEl = document.getElementById('mediaGrid');
        if (mediaGridEl && typeof MutationObserver !== 'undefined') new MutationObserver(fitMediaToViewport).observe(mediaGridEl, { attributes: true, attributeFilter: ['class'] });
        fitMediaToViewport();

        // The sticky bottom bar's height varies: it wraps to more rows on narrow widths and grows
        // once a loaded mission enables the Share/Record controls. Publish the live height as
        // --bottom-bar-h so the fullscreen recenter/skip overlays sit just above it via calc(),
        // and re-fit the docked media height on every change so the map never slips under a bar
        // that just grew taller.
        const bottomBar = document.getElementById('stickyBottomBar');
        if (bottomBar) {
            const publishBarH = () => {
                document.documentElement.style.setProperty('--bottom-bar-h', bottomBar.getBoundingClientRect().height + 'px');
                fitMediaToViewport();
            };
            publishBarH();
            if (typeof ResizeObserver !== 'undefined') { try { new ResizeObserver(publishBarH).observe(bottomBar); } catch (e) {} }
        }
    })();

    // collapser button above the player titles: toggles a collapsed class that hides the media
    // players. on expand the map was display:none, so recompute its size and redraw.
    (function setupMediaCollapse() {
        const btn = document.getElementById('mediaCollapseBtn'), bar = document.getElementById('stickyMediaBar');
        if (!btn || !bar) return;
        btn.addEventListener('click', () => {
            const collapsed = bar.classList.toggle('collapsed');
            document.body.classList.toggle('media-collapsed', collapsed);   // also hides any floating players
            btn.setAttribute('aria-expanded', String(!collapsed));
            btn.innerHTML = collapsed ? '&#9660; Show media' : '&#9650; Collapse media';
            // while the media is collapsed the full playback bar is hidden; the mini bar in the strip covers play/slide/mark.
            const bottom = document.getElementById('stickyBottomBar');
            if (bottom) bottom.style.display = collapsed ? 'none' : '';
            if (typeof syncMiniPlaybackBar === 'function') syncMiniPlaybackBar();
            if (!collapsed) {
                resizeCanvasLayout();
                if (filteredData.length > 0 && trackerModeSelect.value === '2d') { calculateMapScales(); bgNeedsUpdate = true; renderMapEngineFrame(currentIdx, filteredData[currentIdx]); }
                if (filteredData.length > 0 && document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]);
            }
        });
    })();

    // timeToSeconds/toHHMMSS live in js/11b-parser-core.js (shared with the parse worker and tests).

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
                            isPlaying = true; playPauseBtn.innerText = "Pause"; lastTickTime = performance.now();
                            if (videoLoaded && speeds[currentSpeedIdx] <= nativePlaybackCeiling) video.play().catch(e=>{});
                            masterSyncEngineTick();
                        }
                    }
                }
                showToast(`tracker window auto-adjusted to synced video timeframe (${toHHMMSS(video.duration)})`, 5000);
            }
        }
    }
