/* Mission Visualizer, filter window init + video-clock sync
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    function applyFiltersAndInit(shouldPlay = false) {
        isPlaying = false; playPauseBtn.innerText = "Play"; if (animationFrameId) cancelAnimationFrame(animationFrameId);

        const sLim = timeToSeconds(document.getElementById('startTimeInput').value); const eLim = timeToSeconds(document.getElementById('endTimeInput').value); videoStartSeconds = timeToSeconds(document.getElementById('videoStartInput').value);
        // Remember the applied time window so the Play button can tell whether the manual window
        // was edited since and needs re-applying before playing.
        window._appliedWindow = document.getElementById('startTimeInput').value + '|' + document.getElementById('endTimeInput').value + '|' + document.getElementById('videoStartInput').value;
        filteredData = allParsedData.filter(d => d.absSeconds >= sLim && (d.absSeconds <= eLim || eLim < sLim && d.absSeconds <= eLim + 86400));
        if (filteredData.length === 0) return;

        customMarkers = []; computeTempBaseline(); mapPlaceholder.style.display = 'none'; hud.style.display = 'block';
        const pfd = document.getElementById('pfdOverlay'); pfd.style.display = document.getElementById('togglePfd').checked ? 'block' : 'none';
        ['replayBtn','playPauseBtn','markBtn','timelineSlider','skipBack10Btn','skipFwd10Btn'].forEach(id => document.getElementById(id).disabled = false);
        if (typeof syncClearMarksBtn === 'function') syncClearMarksBtn();   // stays disabled until a point is marked
        const ovBtn = document.getElementById('satPickerBtn'); if (ovBtn) ovBtn.disabled = false;   // enable the Overlays dropdown now that a flight is loaded
        if (typeof updateTimelineSyncLock === 'function') updateTimelineSyncLock();   // re-lock the slider if the MMR is still doing its first sync

        timelineSlider.min = 0; timelineSlider.max = filteredData.length - 1; timelineSlider.value = 0;
        resizeCanvasLayout(); calculateMapScales(); resetMapView(); buildChartLayout();
        
        masterChartInstance.data.datasets = []; buildMasterMenu(); updateMasterGraphVisibility();
        if (trackerModeSelect.value === '3d') build3DScene();
        
        currentIdx = 0; masterChartInstance.update('none');
        hasInitialSyncOccurred = false; clearTimeout(scrubSyncTimeout); lastOcrVideoTime = 0;

        updateSatelliteOptions(); satImageLoaded = false; lastSatFetchTime = ''; bgNeedsUpdate = true;

        if (videoLoaded) { video.pause(); if(speeds[currentSpeedIdx] <= MAX_NATIVE_PLAYBACK_RATE) { try { video.playbackRate = speeds[currentSpeedIdx]; } catch(e){} } syncTelemetryToVideoClock(); }
        else updateVisualComponents(currentIdx);

        if (shouldPlay === true) {
            isPlaying = true; playPauseBtn.innerText = "Pause"; playbackAccumulator = 0; lastTickTime = performance.now(); 
            if (videoSyncMode.value === 'auto' && !hasInitialSyncOccurred) { setTimeout(() => { forceOcrSyncNextTick = true; hasInitialSyncOccurred = true; }, 2000); }
            if (videoLoaded && speeds[currentSpeedIdx] <= MAX_NATIVE_PLAYBACK_RATE) video.play().catch(e=>{});
            masterSyncEngineTick();
        }
    }

    // Commit a newly locked video/telemetry offset: shift videoStartSeconds and reflect it in the
    // manual time field, the auto-sync flash, and the end-of-window derivation.
    function applyAutoSyncBase(base) {
        videoStartSeconds = base;
        document.getElementById('videoStartInput').value = toHHMMSS(videoStartSeconds);
        flashAutoSyncLabel(); updateEndWindowFromVideo(true);
    }

    async function syncTelemetryToVideoClock() {
        if (!videoLoaded || filteredData.length === 0 || isScrubbing) return;
        const mode = videoSyncMode.value, now = performance.now();

        if (mode === 'auto' && !isOcrRunning) {
            // Re-verify the lock periodically; while a disagreeing offset is pending confirmation,
            // re-check more often so a genuine correction still lands within seconds, not minutes.
            const recheckGap = pendingSyncBase != null ? 8 : 60;
            if (Math.abs(video.currentTime - lastOcrVideoTime) >= recheckGap) forceOcrSyncNextTick = true;
        }

        if (mode === 'auto' && ocrAvailable && ocrWorker && !isOcrRunning && forceOcrSyncNextTick && (now - lastOcrTime > 500 || lastOcrTime === 0)) {
            isOcrRunning = true; lastOcrTime = now; refreshSyncingIndicator();
            ocrNoteScanStart();
            // Whole frame, native resolution (ocrCaptureFullFrame in js/06-ocr.js): the clock can
            // sit anywhere depending on the export, and the drift-hunt below already keys on the
            // candidate that advances with the video clock.
            const cv = ocrCaptureFullFrame(false);
            if (cv && ocrWorker) {
                try {
                    const { data: { text } } = await ocrWorker.recognize(cv);
                    let cleanText = text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[Z]/g, '2').replace(/[S]/g, '5').replace(/[,;.]/g, ':');
                    const timeRegex = /([0-2]?\d):([0-5]\d):([0-5]\d)/g;
                    let matches = [...cleanText.matchAll(timeRegex)], timeFoundAndVerified = false, currentVTime = video.currentTime;

                    for (const match of matches) {
                        const h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10); let ocrSecs = h * 3600 + m * 60 + s;
                        let minSecs = 0;
                        if (allParsedData.length > 0) {
                            minSecs = allParsedData[0].absSeconds;
                            const maxSecs = allParsedData[allParsedData.length - 1].absSeconds;
                            if (minSecs > 43200 && ocrSecs < 43200 && maxSecs > 86400) ocrSecs += 86400;
                            if (ocrSecs < minSecs - 14400 || ocrSecs > maxSecs + 14400) continue; 
                        }

                        for (let i = 0; i < ocrHistory.length; i++) {
                            const hist = ocrHistory[i], vTimeDelta = currentVTime - hist.vTime, ocrDelta = ocrSecs - hist.ocrSecs;
                            if (vTimeDelta >= 1.0 && Math.abs(ocrDelta - vTimeDelta) <= 1.0) {
                                const dynamicBase = ocrSecs - currentVTime;
                                const timeDiff = Math.abs(dynamicBase - videoStartSeconds);
                                lastOcrVideoTime = currentVTime;

                                if (isManualSyncRequest && timeDiff > 1) {
                                    // Explicit user re-sync request: take the new offset immediately.
                                    applyAutoSyncBase(dynamicBase);
                                    forceOcrSyncNextTick = false; isManualSyncRequest = false;
                                    pendingSyncBase = null; pendingSyncCount = 0;
                                } else if (timeDiff > 120) {
                                    if (!ocrEverLocked) {
                                        // No established sync yet: the first good lock takes the offset directly.
                                        applyAutoSyncBase(dynamicBase);
                                        pendingSyncBase = null; pendingSyncCount = 0;
                                    } else {
                                        // A good sync already exists and this scan disagrees. A single frame can
                                        // misread, so require the SAME new offset to hold across several scans
                                        // before switching; a scan that agrees with the current offset (below)
                                        // clears the pending candidate, so a momentary mispick never yanks the lock.
                                        if (pendingSyncBase != null && Math.abs(dynamicBase - pendingSyncBase) <= 3) pendingSyncCount++;
                                        else { pendingSyncBase = dynamicBase; pendingSyncCount = 1; }
                                        if (pendingSyncCount >= 3) { applyAutoSyncBase(dynamicBase); pendingSyncBase = null; pendingSyncCount = 0; }
                                    }
                                    forceOcrSyncNextTick = false;
                                } else {
                                    // This scan agrees with the current sync: it is still good, so forget any
                                    // pending disagreement (it was momentary).
                                    pendingSyncBase = null; pendingSyncCount = 0;
                                    forceOcrSyncNextTick = false; isManualSyncRequest = false;
                                }

                                ocrNoteLock();
                                timeFoundAndVerified = true; ocrHistory = []; break;
                            }
                        }
                        if (timeFoundAndVerified) break;
                        ocrHistory.push({ vTime: currentVTime, ocrSecs: ocrSecs });
                    }
                    ocrHistory = ocrHistory.filter(h => (currentVTime - h.vTime) <= 10.0);
                } catch(e) { } finally { isOcrRunning = false; ocrMaybeWarnCompiled(); }
            } else { isOcrRunning = false; }
        }

        // Keep the non-blocking "Syncing…" badge in step with the hunt state every frame.
        refreshSyncingIndicator();

        const targetSec = videoStartSeconds + video.currentTime;
        // First row at/after the video clock. Binary search (filteredData is time-sorted), this
        // runs every animation frame during video playback so a full-array scan is too slow.
        let lo = 0, hi = filteredData.length - 1, newIdx = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (filteredData[mid].absSeconds >= targetSec) { newIdx = mid; hi = mid - 1; } else lo = mid + 1;
        }
        if (newIdx === -1) newIdx = targetSec < filteredData[0].absSeconds ? 0 : filteredData.length - 1;
        
        let force8HzUpdate = document.getElementById('toggle8Hz') && document.getElementById('toggle8Hz').checked;
        if (newIdx !== currentIdx) { currentIdx = newIdx; updateVisualComponents(currentIdx); } 
        else if (force8HzUpdate && !video.paused) { updateVisualComponents(currentIdx, true); }
    }
