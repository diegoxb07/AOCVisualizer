/* Mission Visualizer — OCR sync lock + KML export
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    async function performImmediateOcrLock({ silent = false, gateGapSeconds = null } = {}) {
        if (!videoLoaded) return;
        if (!ocrWorker || !ocrAvailable) { if (!silent) showToast("Auto-sync (OCR) isn't available. Use Manual time inputs.", 6000); return; }
        if (isOcrRunning) return; 
        
        isOcrRunning = true;
        refreshSyncingIndicator();  // hunting for the timestamp frame
        let wasPlaying = !video.paused; if (wasPlaying) video.pause();
        
        videoSyncMode.value = 'auto'; document.getElementById('ocrIndicator').style.display = 'block'; document.getElementById('videoStartInput').disabled = true;
        applySyncModeLock();
        
        if (!silent) showToast("Scanning frame at native resolution... Please wait.", 4000);
        
        if (!window.ocrCanvas) { window.ocrCanvas = document.createElement('canvas'); window.ocrCtx = window.ocrCanvas.getContext('2d', { willReadFrequently: true }); }

        let attempts = 0; const maxAttempts = 4; const originalVideoTime = video.currentTime;

        async function attemptSync() {
            if (attempts >= maxAttempts) {
                isOcrRunning = false; refreshSyncingIndicator();
                video.currentTime = originalVideoTime;
                if (wasPlaying) video.play().catch(e=>{});
                if (!silent) showToast("Sync failed after multiple attempts. Try jumping to a clearer frame.", 5000); return;
            }

            attempts++; const vw = video.videoWidth; const vh = video.videoHeight;
            if (vw === 0 || vh === 0) { attemptSync(); return; }

            const scanW = vw; const scanH = vh * 0.40;
            window.ocrCanvas.width = scanW; window.ocrCanvas.height = scanH;
            window.ocrCtx.fillStyle = "black"; window.ocrCtx.fillRect(0, 0, scanW, scanH);
            
            const sliceH = scanH * 0.20;
            window.ocrCtx.drawImage(video, 0, 0, vw, vh * 0.15, 0, 0, scanW, vh * 0.15);
            window.ocrCtx.drawImage(video, 0, vh * 0.75, vw, vh * 0.25, 0, vh * 0.15, scanW, vh * 0.25);
            
            const imgData = window.ocrCtx.getImageData(0, 0, scanW, scanH); const data = imgData.data;
            const isAggressive = (attempts % 2 === 0);
            
            for(let i = 0; i < data.length; i += 4) {
                let luma = data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114;
                if (isAggressive) { luma = luma > 140 ? 255 : 0; }
                data[i] = data[i+1] = data[i+2] = luma;
            }
            window.ocrCtx.putImageData(imgData, 0, 0);

            try {
                const { data: { text } } = await ocrWorker.recognize(window.ocrCanvas);
                let cleanText = text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[Z]/g, '2').replace(/[S]/g, '5').replace(/[,;.]/g, ':'); 
                const timeRegex = /([0-2]?\d):([0-5]\d):([0-5]\d)/g;
                let matches = [...cleanText.matchAll(timeRegex)]; let validLock = false;
                
                if (matches.length > 0) {
                    const hasTelemetry = allParsedData.length > 0;
                    const minSecs = hasTelemetry ? allParsedData[0].absSeconds : 0;
                    const maxSecs = hasTelemetry ? allParsedData[allParsedData.length - 1].absSeconds : 0;

                    for (const match of matches) {
                        const h = parseInt(match[1], 10); const m = parseInt(match[2], 10); const s = parseInt(match[3], 10);
                        let ocrSecs = h * 3600 + m * 60 + s;
                        
                        if (hasTelemetry) {
                            if (minSecs > 43200 && ocrSecs < 43200 && maxSecs > 86400) ocrSecs += 86400;
                            if (ocrSecs < minSecs - 14400 || ocrSecs > maxSecs + 14400) continue;
                        }
                        
                        validLock = true; isOcrRunning = false; refreshSyncingIndicator();
                        const currentGap = Math.abs(ocrSecs - (videoStartSeconds + video.currentTime));
                        if (gateGapSeconds != null && currentGap < gateGapSeconds) {
                            if (wasPlaying) video.play().catch(e=>{}); break;
                        }

                        const dynamicBase = ocrSecs - video.currentTime;
                        videoStartSeconds = dynamicBase;

                        document.getElementById('videoStartInput').value = toHHMMSS(videoStartSeconds);
                        flashAutoSyncLabel(); updateEndWindowFromVideo(true); 

                        // If the video begins before any flight-level data exists, skip the intro:
                        // jump the playhead forward to the data's start time, then let the sync follow.
                        if (gateGapSeconds == null && hasTelemetry && videoStartSeconds < minSecs - 0.5) {
                            const skipTo = minSecs - videoStartSeconds;
                            if (skipTo > 0.1 && video.currentTime < skipTo && (!video.duration || skipTo < video.duration - 0.05)) {
                                video.currentTime = skipTo;
                                if (!silent) showToast("Video started before flight data — skipped ahead to data start.", 3500);
                            }
                        }

                        if (!silent) showToast("Sync Locked Successfully!", 2000);
                        
                        ocrHistory = []; forceOcrSyncNextTick = false; isManualSyncRequest = false;
                        refreshSyncingIndicator();  // lock settled — clear the badge even when paused
                        if (wasPlaying) video.play().catch(e=>{});
                        break;
                    }
                }
                
                if (!validLock) { video.currentTime += 0.5; video.addEventListener('seeked', attemptSync, { once: true }); }
            } catch(e) { isOcrRunning = false; refreshSyncingIndicator(); if (wasPlaying) video.play().catch(e=>{}); }
        }
        attemptSync(); 
    }

    document.getElementById('forceSyncBtn').addEventListener('click', () => performImmediateOcrLock({ silent: false }));

    document.getElementById('exportKmlBtn').addEventListener('click', () => {
        if (filteredData.length === 0) return;
        const useGps = document.getElementById('toggleGpsAlt').checked;
        let kmlCoords = filteredData.map(d => {
            const altM = useGps ? (d.gpsAlt !== null ? d.gpsAlt : (d.pAlt !== null ? d.pAlt : 0)) : (d.pAlt !== null ? d.pAlt : (d.gpsAlt !== null ? d.gpsAlt : 0));
            return `${d.lon},${d.lat},${altM}`;
        }).join('\n');

        const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Flight Track: ${flightMetaData.id}</name>
    <Style id="trackStyle"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style>
    <Placemark><name>Flight Path</name><styleUrl>#trackStyle</styleUrl><LineString><extrude>1</extrude><tessellate>1</tessellate><altitudeMode>absolute</altitudeMode><coordinates>
          ${kmlCoords}
        </coordinates></LineString></Placemark>
  </Document>
</kml>`;
        const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `FlightTrack_${flightMetaData.id}.kml`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
