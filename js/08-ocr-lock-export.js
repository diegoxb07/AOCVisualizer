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
        // A manual Sync Now means the user is telling us the current lock is wrong, so drop the
        // drift-hunt history and the pending-correction hysteresis and re-derive the offset from
        // scratch below. The commit is ungated for a manual request, so it always replaces the lock.
        if (!silent) { ocrHistory = []; pendingSyncBase = null; pendingSyncCount = 0; ocrSetMismatchHold(true); }
        let wasPlaying = !video.paused; if (wasPlaying) video.pause();

        videoSyncMode.value = 'auto'; document.getElementById('ocrIndicator').style.display = 'block'; document.getElementById('videoStartInput').disabled = true;
        applySyncModeLock();

        if (!silent) showToast("Scanning the frame for the MMR clock... Please wait.", 4000);
        ocrNoteScanStart();

        let attempts = 0; const maxAttempts = 6; const originalVideoTime = video.currentTime;
        const seen = [];      // { vTime, secs: [candidates] } per attempt, for the moving-clock check
        let fallback = null;  // first in-range candidate, taken at exhaustion if nothing confirmed moving

        const finishFail = () => {
            isOcrRunning = false; ocrSetMismatchHold(false); refreshSyncingIndicator();
            video.currentTime = originalVideoTime;
            if (wasPlaying && isPlaying) video.play().catch(e => {});
            ocrMaybeWarnCompiled();
            if (!silent) showToast("Sync failed after multiple attempts. Try jumping to a clearer frame.", 5000);
        };

        const commitLock = (ocrSecs, atVTime) => {
            isOcrRunning = false; ocrSetMismatchHold(false); refreshSyncingIndicator();
            const currentGap = Math.abs(ocrSecs - (videoStartSeconds + atVTime));
            if (gateGapSeconds != null && currentGap < gateGapSeconds) { if (wasPlaying && isPlaying) video.play().catch(e => {}); return; }

            applyAutoSyncBase(ocrSecs - atVTime);
            lastOcrVideoTime = atVTime;

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
            syncTelemetryToVideoClock();   // snap the data player onto the corrected offset, even while paused
            if (wasPlaying && isPlaying) video.play().catch(e => {});
        };

        async function attemptSync() {
            if (attempts >= maxAttempts) {
                // The unverified fallback serves only ungated requests (Sync Now, first lock); a
                // gated recheck never moves an established lock on a single unconfirmed read.
                if (fallback && gateGapSeconds == null) { commitLock(fallback.secs, fallback.vTime); return; }
                finishFail(); return;
            }

            attempts++;
            const cv = ocrCaptureFullFrame(attempts % 2 === 0);
            if (!cv) { attemptSync(); return; }
            // The video clock is read at frame capture: recognize() can take seconds, and on a
            // playing video a clock read after it would skew the derived offset by that latency.
            const vNow = video.currentTime;

            try {
                const { data: { text } } = await ocrWorker.recognize(cv);
                let cleanText = text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[Z]/g, '2').replace(/[S]/g, '5').replace(/[,;.]/g, ':');
                const timeRegex = /([0-2]?\d):([0-5]\d):([0-5]\d)/g;
                const matches = [...cleanText.matchAll(timeRegex)];
                const hasTelemetry = allParsedData.length > 0;
                const minSecs = hasTelemetry ? allParsedData[0].absSeconds : 0;
                const maxSecs = hasTelemetry ? allParsedData[allParsedData.length - 1].absSeconds : 0;

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
                    // One plausible clock on screen: that is the MMR clock. An ungated request
                    // (Sync Now, first lock) takes it immediately; a gated recheck that disagrees
                    // with the current offset falls through to the motion check below, so an
                    // established lock only moves on a reading that advances with the video clock.
                    // Several candidates (a compiled video can burn in more than one time): only
                    // lock the one that ADVANCES across the stepped frames; a static number holds
                    // still.
                    if (cands.length === 1 && seen.length === 0
                        && (gateGapSeconds == null || Math.abs(cands[0] - (videoStartSeconds + vNow)) < gateGapSeconds)) { commitLock(cands[0], vNow); return; }
                    // A gated recheck reading a clock that disagrees with the current offset: a
                    // mismatch is being corrected, so show the pill and hold the timeline while
                    // the motion check confirms it.
                    if (gateGapSeconds != null && cands.some(c => Math.abs(c - (videoStartSeconds + vNow)) >= gateGapSeconds)) ocrSetMismatchHold(true);
                    for (const c of cands) {
                        for (const past of seen) {
                            const dv = vNow - past.vTime;
                            if (dv < 1.5) continue;   // below this a real HH:MM:SS may legitimately not tick
                            if (past.secs.some(p => Math.abs((c - p) - dv) <= 1.25)) { commitLock(c, vNow); return; }
                        }
                    }
                    seen.push({ vTime: vNow, secs: cands });
                }

                stepAndContinue();
            } catch(e) { isOcrRunning = false; ocrSetMismatchHold(false); refreshSyncingIndicator(); if (wasPlaying && isPlaying) video.play().catch(e=>{}); }
        }
        // Step the clock forward and continue the hunt on 'seeked', but never wait on it forever: a
        // seek to a non-seekable or near-end spot, or one a user interaction interrupts, can silently
        // skip the event, which would strand the hunt with isOcrRunning stuck true and dead-lock every
        // later sync (including Sync Now). The timeout guarantees the hunt always reaches its end.
        function stepAndContinue() {
            let advanced = false;
            const go = () => { if (advanced) return; advanced = true; video.removeEventListener('seeked', go); attemptSync(); };
            video.addEventListener('seeked', go, { once: true });
            setTimeout(go, 1500);
            video.currentTime += 0.5;
        }
        attemptSync();
    }

    // Runs an OCR lock as soon as the worker is free: a full-frame recognize can hold the worker
    // for seconds, so the request waits it out (up to ~8 s) instead of being silently dropped on
    // a busy worker; a manual request that still cannot run says so. A request arriving mid-scrub
    // is dropped; the release handler schedules its own recheck.
    function requestOcrLock(opts, tries = 40) {
        if (isScrubbing) return;
        if (isOcrRunning) {
            if (tries > 0) { setTimeout(() => requestOcrLock(opts, tries - 1), 200); return; }
            if (!opts || !opts.silent) showToast('Auto-Sync is busy scanning. Try Sync Now again in a moment.', 5000);
            return;
        }
        performImmediateOcrLock(opts);
    }

    // Recheck once the players reach a stable state: half a second after the last playhead jump
    // settles, the frame is re-read and the lock re-derived when the burned-in clock disagrees
    // with the current offset by 3 seconds or more (the motion check above confirms the reading
    // before the lock moves).
    function scheduleOcrRecheck() {
        if (!videoLoaded || videoSyncMode.value !== 'auto') return;
        clearTimeout(scrubSyncTimeout);
        scrubSyncTimeout = setTimeout(() => { requestOcrLock({ silent: true, gateGapSeconds: 3 }); }, 500);
    }

    document.getElementById('forceSyncBtn').addEventListener('click', () => requestOcrLock({ silent: false }));

