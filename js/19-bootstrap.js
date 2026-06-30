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

    // --- Record Screen Clip Logic ---
    document.getElementById('exportClipBtn').addEventListener('click', () => {
        if(filteredData.length === 0) return;
        document.getElementById('clipRecordModal').style.display = 'flex';
        const startSlider = document.getElementById('clipStartSlider');
        const endSlider = document.getElementById('clipEndSlider');
        
        startSlider.max = filteredData.length - 1;
        endSlider.max = filteredData.length - 1;
        
        startSlider.value = 0;
        endSlider.value = filteredData.length - 1;
        
        document.getElementById('clipStartLbl').innerText = filteredData[0].time.slice(0,2) + ":" + filteredData[0].time.slice(2,4) + ":" + filteredData[0].time.slice(4) + " UTC";
        document.getElementById('clipEndLbl').innerText = filteredData[filteredData.length - 1].time.slice(0,2) + ":" + filteredData[filteredData.length - 1].time.slice(2,4) + ":" + filteredData[filteredData.length - 1].time.slice(4) + " UTC";
    });

    document.getElementById('startClipRecordBtn').addEventListener('click', async () => {
        document.getElementById('clipRecordModal').style.display = 'none';
        
        let startIdx = parseInt(document.getElementById('clipStartSlider').value);
        let endIdx = parseInt(document.getElementById('clipEndSlider').value);
        if (startIdx > endIdx) { let temp = startIdx; startIdx = endIdx; endIdx = temp; }
        
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: "browser" },
                audio: true 
            });
            
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            const chunks = [];
            
            mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `MissionClip_${flightMetaData.id}_Sync.webm`;
                a.click();
                showToast("Recording saved successfully! Check your downloads folder.", 4000);
            };
            
            mediaRecorder.start();
            showToast("Recording Started! The segment will now play automatically...", 3000);
            
            currentIdx = startIdx;
            timelineSlider.value = currentIdx;
            if (videoLoaded) {
                video.currentTime = Math.max(0, filteredData[currentIdx].absSeconds - videoStartSeconds);
            }
            updateVisualComponents(currentIdx, true);
            
            isPlaying = true;
            playPauseBtn.innerText = "⏸ Pause";
            playbackAccumulator = 0;
            lastTickTime = performance.now();
            
            window.recordingEndIdx = endIdx;
            window.activeRecorder = mediaRecorder;
            window.recordingStream = stream;
            
            if (videoLoaded && speeds[currentSpeedIdx] <= 16) video.play().catch(e=>{});
            masterSyncEngineTick();
            
        } catch (err) {
            showToast("Screen recording was cancelled or denied.", 4000);
        }
    });

    // Background interval to auto-stop recording when it hits the end index
    setInterval(() => {
        if (window.activeRecorder && isPlaying && currentIdx >= window.recordingEndIdx) {
            isPlaying = false;
            playPauseBtn.innerText = "▶ Play";
            if (videoLoaded) video.pause();
            
            window.activeRecorder.stop();
            window.recordingStream.getTracks().forEach(track => track.stop());
            
            window.activeRecorder = null;
            window.recordingStream = null;
        }
    }, 500);

