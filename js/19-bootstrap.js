/* Mission Visualizer — remaining wiring, map geojson fetch, clip recorder
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    ['startTimeInput', 'endTimeInput', 'videoStartInput'].forEach(id => { 
        const el = document.getElementById(id);
        const handleChange = () => {
            if (id === 'videoStartInput' && videoLoaded) updateEndWindowFromVideo(false);
            else if (allParsedData.length > 0) applyFiltersAndInit(false); 
        };
        el.addEventListener('change', handleChange);
        el.addEventListener('keyup', (e) => { if (e.key === 'Enter') el.blur(); });
    });
    
    document.getElementById('barbIntervalInput').addEventListener('change', () => { if (filteredData.length > 0) { if (trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]); else build3DScene(); } });
    document.getElementById('runBtn').addEventListener('click', function() { applyFiltersAndInit(true); });

    // Jump the playhead by N flight-minutes (10-min steps line up with the GOES scan cadence).
    function skipFlightMinutes(mins) {
        if (!filteredData.length || !filteredData[currentIdx]) return;
        const targetSec = filteredData[currentIdx].absSeconds + mins * 60;
        let bestIdx = currentIdx, bestDiff = Infinity;
        for (let i = 0; i < filteredData.length; i++) {
            const diff = Math.abs(filteredData[i].absSeconds - targetSec);
            if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
        }
        if (bestIdx === currentIdx) return;
        currentIdx = bestIdx;
        timelineSlider.value = currentIdx;
        if (videoLoaded && filteredData[currentIdx]) {
            let vt = Math.max(0, filteredData[currentIdx].absSeconds - videoStartSeconds);
            if (video.duration) vt = Math.min(vt, video.duration);
            video.currentTime = vt;
        }
        updateVisualComponents(currentIdx);
    }
    document.getElementById('skipBack10Btn').addEventListener('click', () => skipFlightMinutes(-10));
    document.getElementById('skipFwd10Btn').addEventListener('click', () => skipFlightMinutes(10));

    playPauseBtn.addEventListener('click', function() {
        if (filteredData.length === 0) return;
        if (isPlaying) { 
            isPlaying = false; playPauseBtn.innerText = "▶ Play"; 
            if (videoLoaded) video.pause(); 
            if (animationFrameId) cancelAnimationFrame(animationFrameId); 
        } else { 
            isPlaying = true; playPauseBtn.innerText = "⏸ Pause"; 
            playbackAccumulator = 0; lastTickTime = performance.now(); 
            
            if (videoSyncMode.value === 'auto' && !hasInitialSyncOccurred) {
                setTimeout(() => {
                    forceOcrSyncNextTick = true;
                    hasInitialSyncOccurred = true;
                }, 2000);
            }

            if (videoLoaded && speeds[currentSpeedIdx] <= 16) { 
                try { video.playbackRate = speeds[currentSpeedIdx]; } catch(e) {}
                video.play().catch(e=>{}); 
            } 
            masterSyncEngineTick(); 
        }
    });

    speedUpBtn.addEventListener('click', function() { currentSpeedIdx = Math.min(currentSpeedIdx + 1, speeds.length - 1); updateSpeedDisplay(); });
    speedDownBtn.addEventListener('click', function() { currentSpeedIdx = Math.max(currentSpeedIdx - 1, 0); updateSpeedDisplay(); });
    
    replayBtn.addEventListener('click', function() {
        if (filteredData.length === 0) return;
        isPlaying = false; playPauseBtn.innerText = "▶ Play"; currentSpeedIdx = 0; updateSpeedDisplay();
        updateSatelliteOptions();
        satImageLoaded = false; lastSatFetchTime = ''; bgNeedsUpdate = true;

        if (videoLoaded) { video.pause(); video.playbackRate = speeds[currentSpeedIdx]; } if (animationFrameId) cancelAnimationFrame(animationFrameId);
        
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0,0, canvas.width, canvas.height);
        [masterChartInstance, ...Object.values(customCharts)].forEach(c => { if(c) { c.resetZoom(); c.draw(); } });
        
        resetMapView(); if (trackerModeSelect.value === '3d') build3DScene(); updateMasterGraphVisibility();
        
        const pfdC = document.getElementById('pfdCanvas'); if(pfdC) { const pfdCtx = pfdC.getContext('2d'); pfdCtx.clearRect(0,0, pfdC.width, pfdC.height); }

        hasInitialSyncOccurred = false; clearTimeout(scrubSyncTimeout); clearTimeout(slideSyncTimer);
        satImageLoaded = false; lastSatFetchTime = ''; bgNeedsUpdate = true;

        if (videoLoaded) { video.currentTime = 0; currentIdx = 0; syncTelemetryToVideoClock(); } 
        else { setTimeout(() => { currentIdx = 0; isPlaying = true; playPauseBtn.innerText = "⏸ Pause"; playbackAccumulator = 0; lastTickTime = performance.now(); masterSyncEngineTick(); }, 30); }
    });

    function calculateFeatureBBox(feature) {
        let minX = 180, maxX = -180, minY = 90, maxY = -90;
        const checkCoord = (c) => {
            if(c[0] < minX) minX = c[0]; if(c[0] > maxX) maxX = c[0];
            if(c[1] < minY) minY = c[1]; if(c[1] > maxY) maxY = c[1];
        };
        if(feature.geometry && feature.geometry.coordinates) {
            if(feature.geometry.type === 'Polygon') feature.geometry.coordinates.forEach(ring => ring.forEach(checkCoord));
            else if(feature.geometry.type === 'MultiPolygon') feature.geometry.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(checkCoord)));
        }
        return [minX, minY, maxX, maxY];
    }

    Promise.all([
        fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson').then(r => r.json()),
        fetch('https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json').then(r => r.json())
    ]).then(([world, us]) => {
        if (world && world.features) {
            world.features.forEach(f => {
                f.properties = f.properties || {}; f.properties.bbox = calculateFeatureBBox(f);
                mapFeatures.push(f);
            });
        }
        if (us && us.features) {
            us.features.forEach(f => { 
                f.properties = f.properties || {}; f.properties.isState = true; f.properties.bbox = calculateFeatureBBox(f);
                mapFeatures.push(f);
            });
        }
        bgNeedsUpdate = true; if (filteredData.length > 0 && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
    }).catch(e => {});

    // --- MP4 Video Zoom & Pan Logic ---
    let vidZoom = 1;
    let vidPanX = 0;
    let vidPanY = 0;
    let isVidDragging = false;
    let vidStartX = 0;
    let vidStartY = 0;

    const radarVid = document.getElementById('radarVideo');
    const vidWrapper = radarVid.parentElement;

    // Set up CSS for bounds and smooth zooming
    radarVid.style.transformOrigin = 'center center';
    radarVid.style.transition = 'transform 0.1s ease-out';
    vidWrapper.style.overflow = 'hidden';

    // Mouse Wheel: Zoom in/out
    vidWrapper.addEventListener('wheel', (e) => {
        if (!videoLoaded) return;
        e.preventDefault();
        const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
        vidZoom = Math.max(1, Math.min(vidZoom * zoomDelta, 8)); // Limits zoom from 1x to 8x
        
        // Snap back to center if fully zoomed out
        if (vidZoom === 1) { 
            vidPanX = 0; 
            vidPanY = 0; 
        }
        radarVid.style.transform = `translate(${vidPanX}px, ${vidPanY}px) scale(${vidZoom})`;
    });

    // Mouse Down: Start Pan
    vidWrapper.addEventListener('mousedown', (e) => {
        if (!videoLoaded || vidZoom <= 1) return;
        isVidDragging = true;
        vidStartX = e.clientX - vidPanX;
        vidStartY = e.clientY - vidPanY;
        vidWrapper.style.cursor = 'grabbing';
    });

    // Mouse Move: Drag Pan
    window.addEventListener('mousemove', (e) => {
        if (!isVidDragging) return;
        
        // Let the user pan, but keep it constrained inside the zoom area
        let maxX = (radarVid.clientWidth * vidZoom - radarVid.clientWidth) / 2;
        let maxY = (radarVid.clientHeight * vidZoom - radarVid.clientHeight) / 2;

        vidPanX = Math.max(-maxX, Math.min(maxX, e.clientX - vidStartX));
        vidPanY = Math.max(-maxY, Math.min(maxY, e.clientY - vidStartY));

        radarVid.style.transform = `translate(${vidPanX}px, ${vidPanY}px) scale(${vidZoom})`;
    });

    // Mouse Up: Stop Pan
    window.addEventListener('mouseup', () => {
        isVidDragging = false;
        vidWrapper.style.cursor = 'default';
    });

    // Double Click: Reset View
    vidWrapper.addEventListener('dblclick', () => {
        vidZoom = 1; 
        vidPanX = 0; 
        vidPanY = 0;
        radarVid.style.transform = `translate(0px, 0px) scale(1)`;
    });

    // --- Composite Clip Recorder ---------------------------------------------------------------
    // Records a single 1080p WebM by compositing the live tracker (2D/3D + satellite) on the left and
    // the user-selected graphs stacked down the right onto an offscreen canvas — no screen sharing.
    // The recorder drives playback through the chosen segment; the user can keep adjusting the view.
    const recordCanvas = document.getElementById('recordCanvas');
    let clipGraphEntries = [];   // graphs offered in the modal this open
    let recState = null;         // active recording state, or null when idle

    const CLIP_NAME_FALLBACK = {
        tempChart: 'Temperature', navChart: 'Navigation Angles', attChart: 'Attitude / Flow',
        altChart: 'Altitude', tasChart: 'Speed', vertWindChart: 'Vertical Wind & Accel',
        sfcChart: 'Pressure', thermoChart: 'Thermodynamics', parameterChart: 'Custom Graph'
    };
    function clipChartFor(id) { return id === 'parameterChart' ? masterChartInstance : customCharts[id]; }
    function clipGraphName(id) {
        const titleEl = document.getElementById('title-' + id);
        if (titleEl && titleEl.childNodes[0] && titleEl.childNodes[0].nodeValue) {
            const t = titleEl.childNodes[0].nodeValue.trim();
            if (t) return t;
        }
        return CLIP_NAME_FALLBACK[id] || id;
    }
    function populateClipGraphList() {
        const list = document.getElementById('clipGraphList');
        clipGraphEntries = [];
        Object.keys(customCharts).forEach(id => {
            if (customCharts[id] && customCharts[id].data.datasets.length > 0) clipGraphEntries.push(id);
        });
        if (masterChartInstance && masterChartInstance.data.datasets.length > 0) clipGraphEntries.push('parameterChart');
        if (clipGraphEntries.length === 0) {
            list.innerHTML = '<div class="text-[11px] text-slate-500 italic col-span-2 py-1">No graphs with data yet — the clip will record just the tracker.</div>';
            return;
        }
        list.innerHTML = clipGraphEntries.map((id, i) =>
            `<label class="flex items-center gap-2 text-xs text-slate-300 py-1 cursor-pointer">` +
            `<input type="checkbox" class="clip-graph-chk accent-purple-500 w-3.5 h-3.5" value="${id}" ${i < 4 ? 'checked' : ''}> ${clipGraphName(id)}</label>`
        ).join('');
    }

    document.getElementById('exportClipBtn').addEventListener('click', () => {
        if (filteredData.length === 0) return;
        document.getElementById('clipRecordModal').style.display = 'flex';

        const startSlider = document.getElementById('clipStartSlider');
        const endSlider = document.getElementById('clipEndSlider');
        startSlider.max = endSlider.max = filteredData.length - 1;
        startSlider.value = 0;
        endSlider.value = filteredData.length - 1;
        const fmt = d => d.time.slice(0,2) + ":" + d.time.slice(2,4) + ":" + d.time.slice(4) + " UTC";
        document.getElementById('clipStartLbl').innerText = fmt(filteredData[0]);
        document.getElementById('clipEndLbl').innerText = fmt(filteredData[filteredData.length - 1]);

        // Mirror the live tracker mode + satellite menu so they can be chosen here.
        document.getElementById('clipTrackerMode').value = trackerModeSelect.value;
        const liveSat = document.getElementById('satelliteSelect');
        const clipSat = document.getElementById('clipSatSelect');
        if (liveSat) { clipSat.innerHTML = liveSat.innerHTML; clipSat.value = liveSat.value; }

        populateClipGraphList();
    });

    // Cap the graph selection at 4 (the list is rebuilt each open, so delegate off the stable container).
    document.getElementById('clipGraphList').addEventListener('change', (e) => {
        if (!e.target || !e.target.classList || !e.target.classList.contains('clip-graph-chk')) return;
        if (document.querySelectorAll('.clip-graph-chk:checked').length > 4) {
            e.target.checked = false;
            showToast('You can record up to 4 graphs.', 2500);
        }
    });

    // --- compositor helpers ---
    function drawImageContain(rctx, img, x, y, w, h) {
        const iw = img.videoWidth || img.width, ih = img.videoHeight || img.height;
        if (!iw || !ih || w <= 0 || h <= 0) return;
        const s = Math.min(w / iw, h / ih), dw = iw * s, dh = ih * s;
        rctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }
    function roundRectPath(rctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        rctx.beginPath();
        rctx.moveTo(x + r, y);
        rctx.arcTo(x + w, y, x + w, y + h, r);
        rctx.arcTo(x + w, y + h, x, y + h, r);
        rctx.arcTo(x, y + h, x, y, r);
        rctx.arcTo(x, y, x + w, y, r);
        rctx.closePath();
    }
    function drawTrackerInto(rctx, x, y, w, h) {
        const is3D = trackerModeSelect.value === '3d';
        const src = is3D ? (typeof renderer3D !== 'undefined' && renderer3D ? renderer3D.domElement : null) : canvas;
        rctx.fillStyle = '#161b22';
        roundRectPath(rctx, x, y, w, h, 12); rctx.fill();
        rctx.save(); roundRectPath(rctx, x, y, w, h, 12); rctx.clip();
        if (src && src.width && src.height) drawImageContain(rctx, src, x, y, w, h);
        rctx.restore();
    }
    function drawVideoInto(rctx, x, y, w, h) {
        rctx.fillStyle = '#000';
        roundRectPath(rctx, x, y, w, h, 12); rctx.fill();
        rctx.save(); roundRectPath(rctx, x, y, w, h, 12); rctx.clip();
        if (video && video.videoWidth) drawImageContain(rctx, video, x, y, w, h);
        rctx.restore();
    }

    // Static per-graph stats (min/max of the first visible series over the clip range) — computed once at capture start.
    function computeGraphStats(ch, startIdx, endIdx) {
        if (!ch || !ch.data || !ch.data.datasets.length) return null;
        let dsIdx = -1;
        for (let i = 0; i < ch.data.datasets.length; i++) { if (ch.isDatasetVisible(i)) { dsIdx = i; break; } }
        if (dsIdx < 0) return null;
        const ds = ch.data.datasets[dsIdx];
        let mn = Infinity, mx = -Infinity;
        const lo = Math.max(0, startIdx), hi = Math.min(ds.data.length - 1, endIdx);
        for (let i = lo; i <= hi; i++) { const v = ds.data[i]; if (v != null && isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } }
        if (!isFinite(mn) || !isFinite(mx)) return null;
        return { scaleId: ds.yAxisID || 'y', mn, mx, color: ds.borderColor || '#e6edf3' };
    }
    function clipFmtVal(v) { return Math.abs(v) >= 100 ? v.toFixed(0) : (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)); }
    function drawValTag(rctx, rightX, leftX, Y, top, bot, txt, color, lineColor, bold) {
        Y = Math.min(bot - 10, Math.max(top + 10, Y));
        rctx.strokeStyle = lineColor; rctx.lineWidth = 1; rctx.setLineDash([4, 4]);
        rctx.beginPath(); rctx.moveTo(leftX, Y); rctx.lineTo(rightX, Y); rctx.stroke(); rctx.setLineDash([]);
        rctx.font = (bold ? '700 13px' : '600 11px') + ' Inter, system-ui, sans-serif';
        rctx.textBaseline = 'middle'; rctx.textAlign = 'right';
        const padX = 5, tw = rctx.measureText(txt).width;
        rctx.fillStyle = 'rgba(11,14,19,0.82)';
        rctx.fillRect(rightX - tw - padX * 2, Y - 9, tw + padX * 2, 18);
        rctx.fillStyle = color; rctx.fillText(txt, rightX - padX, Y);
    }
    // Crisp overlay on each recorded graph: yellow recording-bound lines + min/max/in-between value tags.
    function annotateGraph(rctx, ch, stats, dx, dy, kx, ky, startIdx, endIdx) {
        const ca = ch.chartArea; if (!ca) return;
        const N = ch.data.labels.length;
        const xCss = idx => ca.left + (ca.right - ca.left) * (N > 1 ? Math.min(1, Math.max(0, idx / (N - 1))) : 0.5);
        const top = dy + ca.top * ky, bot = dy + ca.bottom * ky;
        rctx.lineWidth = 2; rctx.strokeStyle = '#facc15'; rctx.setLineDash([]);
        [startIdx, endIdx].forEach(idx => { const X = dx + xCss(idx) * kx; rctx.beginPath(); rctx.moveTo(X, top); rctx.lineTo(X, bot); rctx.stroke(); });
        if (!stats) return;
        const sc = ch.scales[stats.scaleId] || ch.scales.y; if (!sc || !(sc.max > sc.min)) return;
        const yCss = v => ca.bottom - (ca.bottom - ca.top) * (v - sc.min) / (sc.max - sc.min);
        const leftX = dx + ca.left * kx, rightX = dx + ca.right * kx;
        [1 / 3, 2 / 3].forEach(f => { const v = stats.mn + (stats.mx - stats.mn) * f; drawValTag(rctx, rightX, leftX, dy + yCss(v) * ky, top, bot, clipFmtVal(v), 'rgba(190,198,206,0.9)', 'rgba(255,255,255,0.10)', false); });
        drawValTag(rctx, rightX, leftX, dy + yCss(stats.mx) * ky, top, bot, 'max ' + clipFmtVal(stats.mx), '#34d399', 'rgba(52,211,153,0.4)', true);
        drawValTag(rctx, rightX, leftX, dy + yCss(stats.mn) * ky, top, bot, 'min ' + clipFmtVal(stats.mn), '#f87171', 'rgba(248,113,113,0.4)', true);
    }

    function drawRecordFrame() {
        if (!recState) return;
        const rctx = recState.ctx, W = recordCanvas.width, H = recordCanvas.height, pad = 20;
        const graphs = recState.graphs, hasGraphs = graphs.length > 0;
        rctx.fillStyle = '#0b0e13';
        rctx.fillRect(0, 0, W, H);

        const mapAreaW = hasGraphs ? Math.round(W * 0.62) : W;
        const colAreaW = W - mapAreaW;
        const lx = pad, lw = mapAreaW - (hasGraphs ? pad * 1.5 : pad * 2), lTop = pad, lH = H - pad * 2;

        // Left column: tracker, optionally stacked with the MMR video above or below it.
        const stack = recState.videoStack;
        if (videoLoaded && (stack === 'above' || stack === 'below')) {
            const vGap = 14, trackerH = Math.round(lH * 0.6) - vGap / 2, videoH = lH - trackerH - vGap;
            const trackerY = stack === 'above' ? lTop + videoH + vGap : lTop;
            const videoY = stack === 'above' ? lTop : lTop + trackerH + vGap;
            drawTrackerInto(rctx, lx, trackerY, lw, trackerH);
            drawVideoInto(rctx, lx, videoY, lw, videoH);
        } else {
            drawTrackerInto(rctx, lx, lTop, lw, lH);
        }

        // Right column: stacked graphs with crisp value/bound annotations.
        if (hasGraphs) {
            const gx = mapAreaW + pad * 0.5, gw = colAreaW - pad * 1.5, gapV = 16;
            const slotH = (H - pad * 2 - gapV * (graphs.length - 1)) / graphs.length;
            graphs.forEach((g, i) => {
                const y = pad + i * (slotH + gapV);
                rctx.fillStyle = '#14191f';
                roundRectPath(rctx, gx, y, gw, slotH, 10); rctx.fill();
                rctx.strokeStyle = '#232b35'; rctx.lineWidth = 1;
                roundRectPath(rctx, gx, y, gw, slotH, 10); rctx.stroke();
                rctx.fillStyle = '#aab4be'; rctx.font = '600 15px Inter, system-ui, sans-serif';
                rctx.textBaseline = 'top'; rctx.textAlign = 'left';
                rctx.fillText(g.name, gx + 14, y + 11);
                const ch = clipChartFor(g.id), cv = ch && ch.canvas;
                if (cv && cv.width && cv.height) {
                    const bx = gx + 10, by = y + 38, bw = gw - 20, bh = slotH - 48;
                    const s = Math.min(bw / cv.width, bh / cv.height), dw = cv.width * s, dh = cv.height * s;
                    const dxi = bx + (bw - dw) / 2, dyi = by + (bh - dh) / 2;
                    rctx.drawImage(cv, dxi, dyi, dw, dh);
                    const kx = (cv.width / ch.width) * s, ky = (cv.height / ch.height) * s;
                    annotateGraph(rctx, ch, g.stats, dxi, dyi, kx, ky, recState.startIdx, recState.endIdx);
                }
            });
        }
    }

    function setRecordProgress(frac) {
        frac = Math.max(0, Math.min(1, frac));
        document.getElementById('recordProgressFill').style.width = (frac * 100).toFixed(1) + '%';
        document.getElementById('recordProgressLabel').innerText = `Recording… ${Math.round(frac * 100)}%`;
    }

    function recordCompositeLoop() {
        if (!recState) return;
        if (videoLoaded && video.ended && currentIdx < recState.endIdx) { finishRecording(); return; }
        drawRecordFrame();
        const span = Math.max(1, recState.endIdx - recState.startIdx);
        setRecordProgress((currentIdx - recState.startIdx) / span);
        if (currentIdx >= recState.endIdx) { finishRecording(); return; }
        recState.raf = requestAnimationFrame(recordCompositeLoop);
    }

    function finishRecording() {
        if (!recState || recState.finishing) return;
        recState.finishing = true;
        if (recState.raf) cancelAnimationFrame(recState.raf);
        isPlaying = false; playPauseBtn.innerText = "▶ Play";
        if (videoLoaded) video.pause();
        try { recState.recorder.stop(); } catch (e) {}
    }

    function pickClipMime() {
        const opts = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
        for (const o of opts) { if (window.MediaRecorder && MediaRecorder.isTypeSupported(o)) return o; }
        return 'video/webm';
    }

    document.getElementById('startClipRecordBtn').addEventListener('click', () => {
        if (filteredData.length === 0 || recState) return;
        document.getElementById('clipRecordModal').style.display = 'none';

        let startIdx = parseInt(document.getElementById('clipStartSlider').value);
        let endIdx = parseInt(document.getElementById('clipEndSlider').value);
        if (startIdx > endIdx) { const t = startIdx; startIdx = endIdx; endIdx = t; }

        const graphs = Array.from(document.querySelectorAll('.clip-graph-chk:checked')).slice(0, 4)
            .map(c => ({ id: c.value, name: clipGraphName(c.value) }));
        const videoStack = document.getElementById('clipVideoStack').value;

        // Apply the chosen tracker mode + satellite to the live view (the recorder captures it live).
        const wantMode = document.getElementById('clipTrackerMode').value;
        if (trackerModeSelect.value !== wantMode) { trackerModeSelect.value = wantMode; trackerModeSelect.dispatchEvent(new Event('change')); }
        const liveSat = document.getElementById('satelliteSelect');
        const wantSat = document.getElementById('clipSatSelect').value;
        if (liveSat && liveSat.value !== wantSat) { liveSat.value = wantSat; liveSat.dispatchEvent(new Event('change')); }

        // Wait for any satellite fetch to finish, then run a 3-second countdown so the user can frame the tracker.
        waitForSatThenCountdown(() => startClipCapture(startIdx, endIdx, graphs, videoStack));
    });

    function waitForSatThenCountdown(cb) {
        const overlay = document.getElementById('satLoadingOverlay');
        const satOn = document.getElementById('satelliteSelect').value !== 'none';
        const deadline = performance.now() + 8000;
        function waitSat() {
            const fetching = overlay && overlay.classList.contains('show');
            if (satOn && fetching && performance.now() < deadline) { setTimeout(waitSat, 150); return; }
            runRecordCountdown(3, cb);
        }
        setTimeout(waitSat, 250);   // let the 2D/3D switch + satellite fetch kick off first
    }

    function runRecordCountdown(n, cb) {
        const pill = document.getElementById('recordProgress');
        const label = document.getElementById('recordProgressLabel');
        const bar = pill.querySelector('.rec-bar');
        const stopBtn = document.getElementById('recordStopBtn');
        pill.classList.add('show');
        if (bar) bar.style.display = 'none';
        stopBtn.style.display = 'none';
        (function tick() {
            if (!pill.classList.contains('show')) return;   // aborted
            if (n <= 0) { if (bar) bar.style.display = ''; stopBtn.style.display = ''; cb(); return; }
            label.innerText = `Recording in ${n}…  frame the tracker`;
            n--;
            setTimeout(tick, 1000);
        })();
    }

    function startClipCapture(startIdx, endIdx, graphs, videoStack) {
        const ctx2d = recordCanvas.getContext('2d');
        ctx2d.imageSmoothingEnabled = true;
        ctx2d.imageSmoothingQuality = 'high';
        let stream;
        try { stream = recordCanvas.captureStream(30); }
        catch (e) { showToast('Recording is not supported in this browser.', 4000); return; }

        // Fold in the MMR audio track if a video is loaded, so cockpit audio is captured too.
        if (videoLoaded) {
            try {
                const vs = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
                if (vs) vs.getAudioTracks().forEach(t => stream.addTrack(t));
            } catch (e) {}
        }

        // High bitrate keeps the 1080p composite (upscaled tracker + graphs) crisp instead of mushy.
        let recorder;
        const mime = pickClipMime();
        try { recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16000000 }); }
        catch (e) {
            try { recorder = new MediaRecorder(stream, { mimeType: mime }); }
            catch (e2) { showToast('Could not start the recorder: ' + e2.message, 4000); return; }
        }

        const chunks = [];
        recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
            stream.getVideoTracks().forEach(t => t.stop());
            const blob = new Blob(chunks, { type: 'video/webm' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `MissionClip_${flightMetaData.id}_${filteredData[recState.startIdx].time}.webm`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            document.getElementById('recordProgress').classList.remove('show');
            recState = null;
            showToast('Recording saved to your downloads.', 4000);
        };

        // Precompute each graph's min/max over the clip range once (static for the whole recording).
        graphs.forEach(g => { g.stats = computeGraphStats(clipChartFor(g.id), startIdx, endIdx); });

        recState = { recorder, stream, ctx: ctx2d, startIdx, endIdx, graphs, videoStack, raf: null, finishing: false };

        // Seek the playhead to the clip start and begin playback.
        currentIdx = startIdx;
        timelineSlider.value = currentIdx;
        if (videoLoaded && filteredData[currentIdx]) video.currentTime = Math.max(0, filteredData[currentIdx].absSeconds - videoStartSeconds);
        updateVisualComponents(currentIdx, false);

        isPlaying = true; playPauseBtn.innerText = "⏸ Pause";
        playbackAccumulator = 0; lastTickTime = performance.now();
        if (videoLoaded && speeds[currentSpeedIdx] <= 16) video.play().catch(e => {});

        document.getElementById('recordProgress').classList.add('show');
        setRecordProgress(0);
        recorder.start();
        masterSyncEngineTick();
        recState.raf = requestAnimationFrame(recordCompositeLoop);
    }

    document.getElementById('recordStopBtn').addEventListener('click', finishRecording);

