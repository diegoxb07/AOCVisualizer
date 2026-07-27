/* Mission Visualizer, speed display + master playback loop
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    function updateSpeedDisplay() {
        speedDisplayBtn.innerText = `${speeds[currentSpeedIdx]}x`;
        if (videoLoaded && isPlaying) {
            if (speeds[currentSpeedIdx] <= nativePlaybackCeiling) {
                try { video.playbackRate = speeds[currentSpeedIdx]; } catch(e) {}
                if (video.paused) video.play().catch(e=>{});
            } else {
                if (!video.paused) video.pause();
            }
        }
    }

    // Native-rate stall watchdog state (see the high-rate branch of masterSyncEngineTick).
    let _natWatchLastVt = null, _natWatchWallMs = 0, _natWatchVidSec = 0;

    function masterSyncEngineTick() {
        if (!isPlaying) return;
        const now = performance.now(); 
        const deltaMs = now - lastTickTime; 
        lastTickTime = now;

        if (videoLoaded) {
            if (video.ended) { isPlaying = false; playPauseBtn.innerText = "Play"; syncTelemetryToVideoClock(); return; }
            // An immediate OCR hunt pauses and steps the video itself; the engine idles until it
            // finishes so the play-restart below and the high-speed seek stepping never fight the
            // hunt's frame steps.
            if (isOcrRunning && video.paused) { animationFrameId = requestAnimationFrame(masterSyncEngineTick); return; }

            const curSpeed = speeds[currentSpeedIdx];
            if (curSpeed <= nativePlaybackCeiling) {
                if (video.paused && isPlaying) video.play().catch(e => {});
                // Stall watchdog for high native rates: a decoder that cannot sustain the rate
                // stops advancing the video clock, freezing both players. The clock is measured
                // against wall time; when it runs under 70% of the requested rate across a 1.5 s
                // window, the ceiling demotes to 4 and higher speeds go through the seek-stepping
                // branch below. A scrub or sync jump restarts the window rather than polluting it.
                if (curSpeed > 4) {
                    const vt = video.currentTime;
                    if (_natWatchLastVt != null && !video.seeking) {
                        const dv = vt - _natWatchLastVt;
                        if (dv < 0 || dv > (deltaMs / 1000) * curSpeed * 3 + 0.5) { _natWatchWallMs = 0; _natWatchVidSec = 0; }
                        else { _natWatchWallMs += deltaMs; _natWatchVidSec += dv; }
                        if (_natWatchWallMs >= 1500) {
                            if (_natWatchVidSec < (_natWatchWallMs / 1000) * curSpeed * 0.7) {
                                nativePlaybackCeiling = 4;
                                updateSpeedDisplay();
                            }
                            _natWatchWallMs = 0; _natWatchVidSec = 0;
                        }
                    }
                    _natWatchLastVt = vt;
                } else _natWatchLastVt = null;
            } else {
                _natWatchLastVt = null;
                // High speed past the native ceiling: step the clock by seeking rather than raising
                // playbackRate further. Small forward seeks keep both players moving at the selected
                // rate. A paused seek never fires 'ended', so stop at the video's end here.
                if (!video.paused) video.pause();
                // Cap the per-tick step so a backgrounded tab (rAF paused, large deltaMs on return)
                // catches up over several frames instead of seeking seconds ahead in one jump.
                videoPlaybackAccumulator += (Math.min(deltaMs, 250) / 1000) * curSpeed;
                if (videoPlaybackAccumulator > 0.25 || !window.lastVideoSeek) {
                    video.currentTime += videoPlaybackAccumulator;
                    videoPlaybackAccumulator = 0;
                    window.lastVideoSeek = performance.now();
                }
                if (video.duration && video.currentTime >= video.duration - 0.1) {
                    isPlaying = false; playPauseBtn.innerText = "Play"; syncTelemetryToVideoClock(); return;
                }
            }

            syncTelemetryToVideoClock();
            animationFrameId = requestAnimationFrame(masterSyncEngineTick);
        } else {
            if (deltaMs < 1000) {
                playbackAccumulator += (deltaMs / 1000) * speeds[currentSpeedIdx];
                
                let updatedIdx = false;
                while (true) {
                    if (currentIdx >= filteredData.length - 1) break;
                    let dt = filteredData[currentIdx+1].absSeconds - filteredData[currentIdx].absSeconds || 1;
                    if (playbackAccumulator >= dt) {
                        playbackAccumulator -= dt;
                        currentIdx++;
                        updatedIdx = true;
                    } else {
                        break;
                    }
                }
                
                if (currentIdx >= filteredData.length - 1) { 
                    currentIdx = filteredData.length - 1; 
                    playbackAccumulator = 0;
                    updateVisualComponents(currentIdx); 
                    isPlaying = false; 
                    playPauseBtn.innerText = "Play"; 
                    return; 
                } 
                
                let force8HzUpdate = document.getElementById('toggle8Hz') && document.getElementById('toggle8Hz').checked;
                
                if (updatedIdx) {
                    updateVisualComponents(currentIdx);
                } else if (force8HzUpdate) {
                    updateVisualComponents(currentIdx, true);
                }
            }
            animationFrameId = requestAnimationFrame(masterSyncEngineTick); 
        }
    }
