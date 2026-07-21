/* Mission Visualizer, OCR sync lock
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    async function performImmediateOcrLock({ silent = false, gateGapSeconds = null } = {}) {
        if (!videoLoaded) return;
        if (isOcrRunning) return;
        // The engine is fetched on the first video, so the first lock of a session must wait on that
        // warmup before it can judge ocrAvailable. No-op once warm.
        await ensureOCR();
        if (!ocrWorker || !ocrAvailable) { if (!silent) showToast("Auto-sync (OCR) isn't available. Use Manual time inputs.", 6000); return; }
        if (isOcrRunning) return;   // a lock may have started while the warmup above was awaited

        isOcrRunning = true;
        refreshSyncingIndicator();  // hunting for the timestamp frame
        let wasPlaying = !video.paused; if (wasPlaying) video.pause();

        videoSyncMode.value = 'auto'; document.getElementById('ocrIndicator').style.display = 'block'; document.getElementById('videoStartInput').disabled = true;
        applySyncModeLock();

        if (!silent) showToast("Scanning the frame for the MMR clock... Please wait.", 4000);
        ocrNoteScanStart();

        let attempts = 0; const maxAttempts = 6; const originalVideoTime = video.currentTime;
        const seen = [];      // { vTime, secs: [candidates] } per attempt, for the moving-clock check
        let fallback = null;  // first in-range candidate, taken at exhaustion if nothing confirmed moving

        const finishFail = () => {
            isOcrRunning = false; refreshSyncingIndicator();
            video.currentTime = originalVideoTime;
            if (wasPlaying) video.play().catch(e => {});
            ocrMaybeWarnCompiled();
            if (!silent) showToast("Sync failed after multiple attempts. Try jumping to a clearer frame.", 5000);
        };

        const commitLock = (ocrSecs, atVTime) => {
            isOcrRunning = false; refreshSyncingIndicator();
            const currentGap = Math.abs(ocrSecs - (videoStartSeconds + atVTime));
            if (gateGapSeconds != null && currentGap < gateGapSeconds) { if (wasPlaying) video.play().catch(e => {}); return; }

            videoStartSeconds = ocrSecs - atVTime;
            document.getElementById('videoStartInput').value = toHHMMSS(videoStartSeconds);
            flashAutoSyncLabel(); updateEndWindowFromVideo(true);

            // If the video begins before any flight-level data exists, skip the intro:
            // jump the playhead forward to the data's start time, then let the sync follow.
            const hasTelemetry = allParsedData.length > 0;
            const minSecs = hasTelemetry ? allParsedData[0].absSeconds : 0;
            if (gateGapSeconds == null && hasTelemetry && videoStartSeconds < minSecs - 0.5) {
                const skipTo = minSecs - videoStartSeconds;
                if (skipTo > 0.1 && video.currentTime < skipTo && (!video.duration || skipTo < video.duration - 0.05)) {
                    video.currentTime = skipTo;
                    if (!silent) showToast("Video started before flight data, skipped ahead to data start.", 3500);
                }
            }

            if (!silent) showToast("Sync Locked Successfully!", 2000);
            ocrNoteLock();
            ocrHistory = []; forceOcrSyncNextTick = false; isManualSyncRequest = false;
            refreshSyncingIndicator();  // lock settled, clear the badge even when paused
            if (wasPlaying) video.play().catch(e => {});
        };

        async function attemptSync() {
            if (attempts >= maxAttempts) {
                if (fallback) { commitLock(fallback.secs, fallback.vTime); return; }
                finishFail(); return;
            }

            attempts++;
            const cv = ocrCaptureFullFrame(attempts % 2 === 0);
            if (!cv) { attemptSync(); return; }

            try {
                const { data: { text } } = await ocrWorker.recognize(cv);
                let cleanText = text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[Z]/g, '2').replace(/[S]/g, '5').replace(/[,;.]/g, ':');
                const timeRegex = /([0-2]?\d):([0-5]\d):([0-5]\d)/g;
                const matches = [...cleanText.matchAll(timeRegex)];
                const hasTelemetry = allParsedData.length > 0;
                const minSecs = hasTelemetry ? allParsedData[0].absSeconds : 0;
                const maxSecs = hasTelemetry ? allParsedData[allParsedData.length - 1].absSeconds : 0;
                const vNow = video.currentTime;

                const cands = [];
                for (const match of matches) {
                    const h = parseInt(match[1], 10); const m = parseInt(match[2], 10); const s = parseInt(match[3], 10);
                    let ocrSecs = h * 3600 + m * 60 + s;
                    if (hasTelemetry) {
                        if (minSecs > 43200 && ocrSecs < 43200 && maxSecs > 86400) ocrSecs += 86400;
                        if (ocrSecs < minSecs - 14400 || ocrSecs > maxSecs + 14400) continue;
                    }
                    if (!cands.includes(ocrSecs)) cands.push(ocrSecs);
                }

                if (cands.length) {
                    if (!fallback) fallback = { secs: cands[0], vTime: vNow };
                    // One plausible clock on screen: that is the MMR clock. Several (a compiled
                    // video can burn in more than one time): only lock the one that ADVANCES with
                    // the video clock across the stepped frames; a static number holds still.
                    if (cands.length === 1 && seen.length === 0) { commitLock(cands[0], vNow); return; }
                    for (const c of cands) {
                        for (const past of seen) {
                            const dv = vNow - past.vTime;
                            if (dv < 1.5) continue;   // below this a real HH:MM:SS may legitimately not tick
                            if (past.secs.some(p => Math.abs((c - p) - dv) <= 1.25)) { commitLock(c, vNow); return; }
                        }
                    }
                    seen.push({ vTime: vNow, secs: cands });
                }

                video.currentTime += 0.5;
                video.addEventListener('seeked', attemptSync, { once: true });
            } catch(e) { isOcrRunning = false; refreshSyncingIndicator(); if (wasPlaying) video.play().catch(e=>{}); }
        }
        attemptSync();
    }

    document.getElementById('forceSyncBtn').addEventListener('click', () => performImmediateOcrLock({ silent: false }));

