/* Mission Visualizer, clip rendering for Record Clip
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   renders the clip one frame at a time into a 1920x1080 canvas and encodes it straight to an .mp4
   with the browser's VideoEncoder (WebCodecs) and lib/mp4-muxer.js, so the output does not depend on
   the screen size, the display's pixel density, or how fast the machine plays. each frame sets the
   playhead to an exact flight time, seeks the MMR video to the same moment when it is included,
   redraws the tracker at the size of its spot in the frame (the map container is resized to that
   spot for the duration), and draws the title band, graph cards, and timeline around it. */

    const CLIP_W = 1920, CLIP_H = 1080, CLIP_FPS = 30, CLIP_BITRATE = 8000000;
    const CLIP_FONT = '"Nunito Sans", system-ui, sans-serif';
    const CLIP_C = {
        page: '#d5d5d5', card: '#ececec', cardLine: '#a3a3a3', band: '#161616', bandInk: '#ececec',
        bandMuted: '#a6a6a6', ink: '#1b1b1b', muted: '#474747', faint: '#6b6b6b', grid: 'rgba(0, 0, 0, 0.09)',
        mapBg: '#dfe3e7', videoBg: '#111111'
    };
    let clipJob = null;

    function clipRenderSupported() {
        return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof Mp4Muxer !== 'undefined';
    }

    // the first codec this browser can encode at 1080p30: H.264 High, Main, then Baseline, then VP9
    async function clipPickCodec() {
        const cands = [
            { codec: 'avc1.640028', mux: 'avc' }, { codec: 'avc1.4d0028', mux: 'avc' },
            { codec: 'avc1.42e028', mux: 'avc' }, { codec: 'vp09.00.40.08', mux: 'vp9' }
        ];
        for (const c of cands) {
            try {
                const r = await VideoEncoder.isConfigSupported({ codec: c.codec, width: CLIP_W, height: CLIP_H, bitrate: CLIP_BITRATE, framerate: CLIP_FPS });
                if (r && r.supported) return c;
            } catch (e) { /* try the next codec */ }
        }
        return null;
    }

    function clipSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    // hands control back to the browser for a moment without a timer, which a background tab slows
    const clipYieldCh = new MessageChannel(), clipYieldQ = [];
    clipYieldCh.port1.onmessage = () => { const r = clipYieldQ.shift(); if (r) r(); };
    function clipYield() { return new Promise(r => { clipYieldQ.push(r); clipYieldCh.port2.postMessage(0); }); }
    function clipNextFrame() { return new Promise(r => requestAnimationFrame(() => r())); }

    // HH:MM:SS for a flight-clock second count, wrapped past midnight
    function clipClock(sec) {
        sec = Math.max(0, Math.floor(sec)) % 86400;
        const p = n => String(n).padStart(2, '0');
        return p(Math.floor(sec / 3600)) + ':' + p(Math.floor(sec % 3600 / 60)) + ':' + p(sec % 60);
    }

    function clipRoundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    // draws img to fill the box, cropping the overflow evenly, so no empty bands are left
    function clipDrawCover(ctx, img, x, y, w, h) {
        const iw = img.videoWidth || img.width, ih = img.videoHeight || img.height;
        if (!iw || !ih) return;
        const s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
        ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
    }

    // where everything goes in the frame: title band, footer timeline, the map on the left, and a
    // right column with the MMR video on top and the graph cards sharing the rest
    function clipLayout(hasVideo, graphCount, videoAspect) {
        const HEAD = 84, FOOT = 52, M = 24, GAP = 20;
        const body = { x: M, y: HEAD + M, w: CLIP_W - 2 * M, h: CLIP_H - HEAD - FOOT - 2 * M };
        const L = { head: { x: 0, y: 0, w: CLIP_W, h: HEAD }, foot: { x: 0, y: CLIP_H - FOOT, w: CLIP_W, h: FOOT }, video: null, graphs: [] };
        if (!hasVideo && !graphCount) { L.map = body; return L; }
        if (!graphCount) {
            // video only: map and video side by side, the video as large as the height allows
            const colW = Math.min(Math.round(body.w * 0.46), Math.round(body.h * videoAspect));
            const vh = Math.round(colW / videoAspect);
            L.map = { x: body.x, y: body.y, w: body.w - colW - GAP, h: body.h };
            L.video = { x: body.x + body.w - colW, y: body.y + Math.round((body.h - vh) / 2), w: colW, h: vh };
            return L;
        }
        const colW = Math.round(body.w * 0.38);
        L.map = { x: body.x, y: body.y, w: body.w - colW - GAP, h: body.h };
        const cx = body.x + body.w - colW;
        let cy = body.y, remain = body.h;
        if (hasVideo) {
            const vh = Math.min(Math.round(colW / videoAspect), Math.round(body.h * (graphCount >= 3 ? 0.34 : 0.48)));
            L.video = { x: cx, y: cy, w: colW, h: vh };
            cy += vh + GAP; remain -= vh + GAP;
        }
        const gh = (remain - GAP * (graphCount - 1)) / graphCount;
        for (let i = 0; i < graphCount; i++) L.graphs.push({ x: cx, y: Math.round(cy + i * (gh + GAP)), w: colW, h: Math.round(gh) });
        return L;
    }

    // the series a graph card plots: a page graph's visible datasets, or a custom graph's metrics
    function clipGraphSeries(g) {
        let sets = [];
        const cd = typeof clipCustomDef === 'function' ? clipCustomDef(g.id) : null;
        if (cd) sets = clipDatasetsFor(cd.keys);
        else {
            const ch = clipChartFor(g.id);
            if (ch) sets = ch.data.datasets.filter((ds, i) => ch.isDatasetVisible(i));
        }
        return sets.map(ds => ({ label: String(ds.label || ''), color: ds.borderColor || CLIP_C.ink, data: ds.data }));
    }

    function clipNiceStep(span) {
        const raw = span / 3, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
        const f = raw / mag;
        return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    }
    function clipFmt(v) { return Math.abs(v) >= 100 ? v.toFixed(0) : (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)); }

    // a graph card: the static part (card, title, grid, axis labels, and the whole line faded) is
    // drawn once into its own canvas, and each frame adds the played part of the line in full
    // color, the playhead, and the current values
    function clipBuildGraph(g, box, startIdx, endIdx) {
        const series = clipGraphSeries(g).filter(s => s.data && s.data.length);
        const compact = box.h < 150;
        const top = compact ? 40 : 74;
        const plot = { x: box.x + 70, y: box.y + top, w: box.w - 70 - 18, h: box.h - top - (compact ? 14 : 30) };
        let lo = Infinity, hi = -Infinity;
        series.forEach(s => { for (let i = startIdx; i <= endIdx; i++) { const v = s.data[i]; if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } } });
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
        const span = Math.max(1, endIdx - startIdx);
        const xOf = i => plot.x + (i - startIdx) / span * plot.w;
        const yOf = v => plot.y + (1 - (v - lo) / (hi - lo)) * plot.h;
        // one point per pixel column at most, so a long clip draws quickly
        const step = Math.max(1, Math.floor(span / plot.w));
        series.forEach(s => {
            s.pts = [];
            for (let i = startIdx; i <= endIdx; i += step) { const v = s.data[i]; s.pts.push(v != null && isFinite(v) ? { i, x: xOf(i), y: yOf(v) } : null); }
        });

        const st = document.createElement('canvas'); st.width = CLIP_W; st.height = CLIP_H;
        const c = st.getContext('2d');
        c.fillStyle = CLIP_C.card; clipRoundRect(c, box.x, box.y, box.w, box.h, 8); c.fill();
        c.strokeStyle = CLIP_C.cardLine; c.lineWidth = 1; clipRoundRect(c, box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, 8); c.stroke();
        c.fillStyle = CLIP_C.muted; c.font = '800 15px ' + CLIP_FONT; c.textBaseline = 'top'; c.textAlign = 'left';
        c.fillText(String(g.name || '').toUpperCase(), box.x + 18, box.y + 14);
        // grid lines and y labels
        const tick = clipNiceStep(hi - lo);
        c.font = '600 13px ' + CLIP_FONT; c.textAlign = 'right'; c.textBaseline = 'middle';
        const tickDec = Math.max(0, Math.min(3, -Math.floor(Math.log10(tick))));
        for (let v = Math.ceil(lo / tick) * tick; v <= hi; v += tick) {
            const y = Math.round(yOf(v)) + 0.5;
            c.strokeStyle = CLIP_C.grid; c.beginPath(); c.moveTo(plot.x, y); c.lineTo(plot.x + plot.w, y); c.stroke();
            c.fillStyle = CLIP_C.faint; c.fillText((Math.abs(v) < tick / 1e6 ? 0 : v).toFixed(tickDec), plot.x - 10, y);
        }
        if (!compact) {
            c.textBaseline = 'top'; c.fillStyle = CLIP_C.faint;
            c.textAlign = 'left'; c.fillText(clipClock(filteredData[startIdx].absSeconds) + 'Z', plot.x, plot.y + plot.h + 8);
            c.textAlign = 'right'; c.fillText(clipClock(filteredData[endIdx].absSeconds) + 'Z', plot.x + plot.w, plot.y + plot.h + 8);
        }
        // the whole line, faded, so the part still to come is visible
        c.globalAlpha = 0.28; c.lineWidth = 2; c.lineJoin = 'round';
        series.forEach(s => clipStrokePts(c, s.pts, s.color, Infinity));
        c.globalAlpha = 1;
        return { box, plot, series, st, compact, xOf, yOf };
    }

    function clipStrokePts(c, pts, color, maxIdx) {
        c.strokeStyle = color; c.beginPath();
        let pen = false;
        for (const p of pts) {
            if (!p || p.i > maxIdx) { if (p && p.i > maxIdx) break; pen = false; continue; }
            if (pen) c.lineTo(p.x, p.y); else { c.moveTo(p.x, p.y); pen = true; }
        }
        c.stroke();
    }

    function clipDrawGraph(ctx, G, idx) {
        ctx.drawImage(G.st, G.box.x, G.box.y, G.box.w, G.box.h, G.box.x, G.box.y, G.box.w, G.box.h);
        ctx.lineWidth = 3; ctx.lineJoin = 'round';
        G.series.forEach(s => clipStrokePts(ctx, s.pts, s.color, idx));
        const px = G.xOf(idx);
        ctx.strokeStyle = CLIP_C.ink; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, G.plot.y); ctx.lineTo(px, G.plot.y + G.plot.h); ctx.stroke();
        // current values: a dot on each line at the playhead, and above the plot the series color,
        // label, and value large
        let x = G.box.x + 18;
        const y = G.compact ? G.box.y + 12 : G.box.y + 40;
        const right = G.box.x + G.box.w - 18;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        G.series.forEach(s => {
            const v = s.data[idx];
            const vy = y + 12;
            if (v != null && isFinite(v)) {
                ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(px, G.yOf(v), 5, 0, Math.PI * 2); ctx.fill();
            }
            if (G.compact) return;
            const label = s.label.replace(/\s*\([^)]*\)\s*$/, '');
            const val = (v != null && isFinite(v)) ? clipFmt(v) : '--';
            ctx.font = '700 14px ' + CLIP_FONT;
            const lw = ctx.measureText(label).width;
            ctx.font = '800 22px ' + CLIP_FONT;
            const vw = ctx.measureText(val).width;
            if (x + 14 + lw + 8 + vw > right) return;
            ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x + 5, vy, 5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = CLIP_C.muted; ctx.font = '700 14px ' + CLIP_FONT; ctx.fillText(label, x + 14, vy + 1);
            ctx.fillStyle = CLIP_C.ink; ctx.font = '800 22px ' + CLIP_FONT; ctx.fillText(val, x + 14 + lw + 8, vy);
            x += 14 + lw + 8 + vw + 26;
        });
        // a compact card shows the first series' value at the right of its title line
        if (G.compact && G.series.length) {
            const v = G.series[0].data[idx];
            ctx.textAlign = 'right'; ctx.fillStyle = CLIP_C.ink; ctx.font = '800 18px ' + CLIP_FONT;
            ctx.fillText((v != null && isFinite(v)) ? clipFmt(v) : '--', right, y + 9);
        }
    }

    function clipDrawFrame(J, T, idx) {
        const ctx = J.ctx, L = J.L;
        ctx.fillStyle = CLIP_C.page; ctx.fillRect(0, 0, CLIP_W, CLIP_H);

        // title band: mission on the left, the UTC clock on the right
        ctx.fillStyle = CLIP_C.band; ctx.fillRect(L.head.x, L.head.y, L.head.w, L.head.h);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = CLIP_C.bandInk; ctx.font = '800 30px ' + CLIP_FONT;
        ctx.fillText(J.title, 28, 42);
        ctx.fillStyle = CLIP_C.bandMuted; ctx.font = '600 17px ' + CLIP_FONT;
        ctx.fillText(J.subtitle, 28, 68);
        ctx.textAlign = 'right';
        ctx.fillStyle = CLIP_C.bandInk; ctx.font = '800 38px ' + CLIP_FONT;
        ctx.fillText(clipClock(T) + 'Z', CLIP_W - 28, 50);
        ctx.fillStyle = CLIP_C.bandMuted; ctx.font = '700 13px ' + CLIP_FONT;
        ctx.fillText(J.dateLabel, CLIP_W - 28, 70);

        // the tracker, filling its card
        const m = L.map;
        ctx.save(); clipRoundRect(ctx, m.x, m.y, m.w, m.h, 8); ctx.clip();
        ctx.fillStyle = CLIP_C.mapBg; ctx.fillRect(m.x, m.y, m.w, m.h);
        const src = trackerModeSelect.value === '3d' ? (typeof renderer3D !== 'undefined' && renderer3D ? renderer3D.domElement : null) : canvas;
        if (src && src.width) clipDrawCover(ctx, src, m.x, m.y, m.w, m.h);
        ctx.restore();
        ctx.strokeStyle = CLIP_C.cardLine; ctx.lineWidth = 1; clipRoundRect(ctx, m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1, 8); ctx.stroke();

        // the MMR video
        if (L.video) {
            const v = L.video;
            ctx.save(); clipRoundRect(ctx, v.x, v.y, v.w, v.h, 8); ctx.clip();
            ctx.fillStyle = CLIP_C.videoBg; ctx.fillRect(v.x, v.y, v.w, v.h);
            if (video && video.videoWidth) clipDrawCover(ctx, video, v.x, v.y, v.w, v.h);
            ctx.restore();
        }

        J.graphs.forEach(G => clipDrawGraph(ctx, G, idx));

        // footer: the clip's start and end times with a progress bar between them
        const f = L.foot;
        ctx.fillStyle = CLIP_C.band; ctx.fillRect(f.x, f.y, f.w, f.h);
        ctx.font = '700 15px ' + CLIP_FONT; ctx.textBaseline = 'middle';
        const midY = f.y + f.h / 2;
        ctx.fillStyle = CLIP_C.bandMuted; ctx.textAlign = 'left';
        const startTxt = clipClock(J.t0) + 'Z', endTxt = clipClock(J.t1) + 'Z';
        ctx.fillText(startTxt, 28, midY);
        ctx.textAlign = 'right';
        ctx.fillText('AOC Mission Visualizer', CLIP_W - 28, midY);
        const brandW = ctx.measureText('AOC Mission Visualizer').width;
        const endX = CLIP_W - 28 - brandW - 40;
        ctx.fillText(endTxt, endX, midY);
        const bx0 = 28 + ctx.measureText(startTxt).width + 20, bx1 = endX - ctx.measureText(endTxt).width - 20;
        const frac = Math.max(0, Math.min(1, (T - J.t0) / Math.max(1, J.t1 - J.t0)));
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'; clipRoundRect(ctx, bx0, midY - 3, bx1 - bx0, 6, 3); ctx.fill();
        ctx.fillStyle = CLIP_C.bandInk; clipRoundRect(ctx, bx0, midY - 3, Math.max(6, (bx1 - bx0) * frac), 6, 3); ctx.fill();
    }

    // redraws only what a clip frame shows: the tracker (with the storm marker, TDR, and satellite
    // tile drawn on it), leaving the page's charts, HUD, and PFD alone, since the clip draws its own
    function clipUpdateTracker(idx) {
        const row = filteredData[idx]; if (!row) return;
        let vr = row;
        const smooth = document.getElementById('toggle8Hz');
        if (smooth && smooth.checked) { const t = getInterpolatedRow(); if (t) vr = t; }
        if (typeof updateStormNowMarker === 'function') updateStormNowMarker();
        if (typeof updateTdr3D === 'function') updateTdr3D(row.absSeconds);
        if (trackerModeSelect.value === '2d') renderMapEngineFrame(idx, vr); else update3DFrame(idx, vr);
        const sat = document.getElementById('satelliteSelect');
        if (sat && sat.value !== 'none' && trackerModeSelect.value === '2d') fetchSatelliteImage(row.absSeconds);
    }

    async function clipSeekVideo(vt) {
        if (!videoLoaded || !video.duration) return;
        vt = Math.max(0, Math.min(video.duration - 0.05, vt));
        if (Math.abs(video.currentTime - vt) < 0.001 && !video.seeking) return;
        await new Promise(resolve => {
            let done = false;
            const finish = () => { if (done) return; done = true; video.removeEventListener('seeked', finish); resolve(); };
            video.addEventListener('seeked', finish);
            setTimeout(finish, 4000);
            video.currentTime = vt;
        });
    }

    // waits while a satellite tile for this moment is still downloading, then redraws the frame
    async function clipWaitSatellite() {
        const sat = document.getElementById('satelliteSelect');
        const overlay = document.getElementById('satLoadingOverlay');
        if (!sat || sat.value === 'none' || trackerModeSelect.value !== '2d' || !overlay) return;
        const until = performance.now() + 60000;
        let waited = false;
        while (overlay.classList.contains('show') && performance.now() < until && clipJob && !clipJob.stop) { waited = true; await clipSleep(120); }
        if (waited) clipUpdateTracker(currentIdx);
    }

    async function clipSetTime(J, T) {
        let lo = 0, hi = filteredData.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (filteredData[mid].absSeconds <= T) lo = mid; else hi = mid - 1; }
        currentIdx = lo;
        playbackAccumulator = Math.max(0, T - filteredData[lo].absSeconds);
        clipRenderSec = T;
        if (J.withVideo) await clipSeekVideo(T - videoStartSeconds);
        clipUpdateTracker(currentIdx);
        await clipWaitSatellite();
        // the 3D view redraws in its own animation loop, which runs first in the next animation
        // frame, so one frame is enough before the canvas is copied
        if (trackerModeSelect.value === '3d') await clipNextFrame();
        return lo;
    }

    // the progress card shown over the page while a clip renders, with Stop and Save and Cancel
    function clipShowProgress() {
        let ov = document.getElementById('clipRenderOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'clipRenderOverlay'; ov.className = 'modal-overlay';
            // a solid backdrop, since the map being rendered is resized and moved behind it
            ov.style.zIndex = '6000'; ov.style.background = 'var(--page)';
            ov.innerHTML =
                '<div class="modal-card" style="max-width:520px">' +
                  '<div class="modal-head"><div class="modal-head-text"><h2>Rendering Clip</h2></div></div>' +
                  '<div class="modal-body">' +
                    '<p class="modal-intro">The clip is being drawn frame by frame at full 1080p and saved as an .mp4 when it finishes, so keep this tab open until then.</p>' +
                    '<div class="modal-progress"><div id="clipRenderFill" class="h-full bg-accent" style="width:0%"></div></div>' +
                    '<div id="clipRenderStatus" class="modal-status">Starting...</div>' +
                  '</div>' +
                  '<div class="modal-foot">' +
                    '<button id="clipRenderCancel" class="modal-btn secondary">Cancel</button>' +
                    '<button id="clipRenderStop" class="modal-btn">Stop and Save</button>' +
                  '</div>' +
                '</div>';
            document.body.appendChild(ov);
            document.getElementById('clipRenderCancel').addEventListener('click', () => { if (clipJob) { clipJob.stop = true; clipJob.discard = true; } });
            document.getElementById('clipRenderStop').addEventListener('click', () => { if (clipJob) clipJob.stop = true; });
        }
        document.getElementById('clipRenderFill').style.width = '0%';
        document.getElementById('clipRenderStatus').textContent = 'Starting...';
        ov.style.display = 'flex';
        return ov;
    }
    function clipSetProgress(done, total, startedMs) {
        const frac = total ? done / total : 0;
        document.getElementById('clipRenderFill').style.width = (frac * 100).toFixed(1) + '%';
        const el = (performance.now() - startedMs) / 1000;
        let eta = '';
        if (done > 10 && frac < 1) {
            const left = el / done * (total - done);
            eta = left >= 90 ? `, about ${Math.round(left / 60)} min left` : `, about ${Math.max(1, Math.round(left))} s left`;
        }
        document.getElementById('clipRenderStatus').textContent = `Frame ${done.toLocaleString()} of ${total.toLocaleString()}${eta}`;
    }

    async function renderClipToMp4(startIdx, endIdx, graphs, videoStack) {
        if (clipJob) return;
        const codec = await clipPickCodec();
        if (!codec) { showToast('This browser can\'t encode video, so try the latest Chrome, Edge, or Safari.', 7000); return; }
        try { await Promise.all(['600 15px', '700 15px', '800 30px'].map(f => document.fonts.load(f + ' "Nunito Sans"'))); } catch (e) { /* the fallback font is used */ }

        // stop playback; the render moves the playhead directly
        isPlaying = false; if (animationFrameId) cancelAnimationFrame(animationFrameId);
        if (typeof playPauseBtn !== 'undefined' && playPauseBtn) playPauseBtn.innerText = 'Play';
        if (videoLoaded) video.pause();

        const speed = (typeof speeds !== 'undefined' && speeds[currentSpeedIdx]) || 1;
        const t0 = filteredData[startIdx].absSeconds, t1 = filteredData[endIdx].absSeconds;
        const total = Math.max(1, Math.floor((t1 - t0) / speed * CLIP_FPS) + 1);
        const withVideo = !!(videoLoaded && videoStack && videoStack !== 'off' && video.videoWidth);
        const aspect = withVideo ? video.videoWidth / video.videoHeight : 4 / 3;
        const L = clipLayout(withVideo, graphs.length, aspect);
        const saved = { idx: currentIdx, acc: playbackAccumulator, vt: videoLoaded ? video.currentTime : 0 };

        // the map renders at its spot's exact size and twice the pixel density for the whole render
        const stage = canvas.parentElement;
        const savedStage = stage.style.cssText;
        stage.style.cssText = `position:fixed;left:0;top:0;width:${L.map.w}px;height:${L.map.h}px;z-index:4000;`;
        renderDprOverride = 2;
        resizeCanvasLayout();

        const out = document.createElement('canvas'); out.width = CLIP_W; out.height = CLIP_H;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

        const muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.ArrayBufferTarget(),
            video: { codec: codec.mux, width: CLIP_W, height: CLIP_H, frameRate: CLIP_FPS },
            fastStart: 'in-memory'
        });
        let encErr = null;
        const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encErr = e; } });
        encoder.configure({ codec: codec.codec, width: CLIP_W, height: CLIP_H, bitrate: CLIP_BITRATE, framerate: CLIP_FPS });

        const id = String(flightMetaData.id || 'Mission');
        const sub = [flightMetaData.aircraft, flightMetaData.date].filter(s => s && s !== 'Unknown').join('  ·  ');
        const J = clipJob = {
            ctx, L, t0, t1, withVideo, stop: false, discard: false,
            title: id, subtitle: sub || 'AOC flight-level replay', dateLabel: 'UTC', graphs: []
        };
        J.graphs = graphs.map((g, i) => L.graphs[i] ? clipBuildGraph(g, L.graphs[i], startIdx, endIdx) : null).filter(Boolean);

        clipShowProgress();
        const startedMs = performance.now();
        let written = 0;
        try {
            for (let k = 0; k < total; k++) {
                if (J.stop || encErr) break;
                const T = Math.min(t1, t0 + k * speed / CLIP_FPS);
                const idx = await clipSetTime(J, T);
                clipDrawFrame(J, T, idx);
                const frame = new VideoFrame(out, { timestamp: Math.round(k * 1e6 / CLIP_FPS), duration: Math.round(1e6 / CLIP_FPS) });
                encoder.encode(frame, { keyFrame: k % (CLIP_FPS * 2) === 0 });
                frame.close();
                written++;
                while (encoder.encodeQueueSize > 6) await clipYield();
                if (k % 5 === 0) { clipSetProgress(k + 1, total, startedMs); await clipYield(); }
            }
            if (!J.discard && written && !encErr) {
                document.getElementById('clipRenderStatus').textContent = 'Saving the .mp4...';
                await encoder.flush();
                muxer.finalize();
                const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `MissionClip_${String(flightMetaData.id).split(' ')[0]}_${clipClock(t0).replace(/:/g, '')}.mp4`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 8000);
                showToast(J.stop ? 'The clip was stopped early and what was rendered is saved to your downloads.' : 'The clip is saved to your downloads.', 6000);
            } else if (encErr) {
                showToast('The video encoder stopped with an error (' + encErr.message + '), so the clip was not saved.', 8000);
            }
        } catch (e) {
            showToast('The clip could not be rendered (' + e.message + ').', 8000);
        } finally {
            try { if (encoder.state !== 'closed') encoder.close(); } catch (e) { /* already closed */ }
            clipRenderSec = null;
            renderDprOverride = 0;
            stage.style.cssText = savedStage;
            resizeCanvasLayout();
            currentIdx = saved.idx; playbackAccumulator = saved.acc;
            if (videoLoaded) video.currentTime = saved.vt;
            updateVisualComponents(currentIdx);
            J.graphs = [];
            clipJob = null;
            const ov = document.getElementById('clipRenderOverlay'); if (ov) ov.style.display = 'none';
        }
    }
