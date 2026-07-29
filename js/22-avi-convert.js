/* Mission Visualizer, AVI to MP4 converter
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   Combines the MMR recorder's segmented videos (.avi/.ts, loose or inside .zip archives) into
   one browser-playable H.264 .mp4, entirely on this device, via the vendored ffmpeg.wasm in
   lib/ffmpeg/ (engine script + its worker chunk + the single-thread core, which needs no
   cross-origin isolation headers, so it runs on GitHub Pages). Zip entries are read straight
   off the picked File through Blob slices (the central directory is parsed here, deflate is
   inflated by the native DecompressionStream), so only one segment's bytes are in memory at a
   time. Each segment converts to an .mp4 fragment (stream copy when the source is already
   H.264, a veryfast x264 re-encode otherwise), and the fragments are stitched with ffmpeg's
   concat demuxer. Several engine workers convert segments in parallel (AVI_MAX_WORKERS,
   scaled to the machine's cores), and the work continues while the tab is hidden; closing
   the tab, Stop, or Reset All ends it. */

    // Per-part output cap: the concat step's output .mp4 lives in ffmpeg's in-memory FS, and
    // the core's wasm memory tops out at 2 GB (declared in ffmpeg-core.wasm), so a flight whose
    // converted total passes this is emitted as sequential part files. The veryfast re-encode
    // keeps a whole mission under it in the normal case.
    const AVI_PART_BYTES = 1.6e9;
    const AVI_SEG_EXT_RE = /\.(avi|ts|m2ts|mts|mov|mp4|mkv)$/i;
    const AVI_LIST_ROW_CAP = 600;   // rows rendered in the modal list; the rest fold into a count
    // Parallel converters for the per-segment stage: encoding is the slow part and each engine
    // is single threaded, so several segments convert at once, scaled to the machine's cores.
    const AVI_MAX_WORKERS = Math.max(2, Math.min(6, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
    const AVI_SEG_TIMEOUT_MS = 10 * 60 * 1000;   // one segment hanging past this marks its engine dead
    const AVI_ENGINE_RECYCLE = 10;               // segments per engine before it is retired for a fresh one

    let aviSegs = [];               // ordered segment list: { name, size, src, file } or { name, size, src, zipFile, entry, dur }
    let aviSegKeys = new Set();     // name+size dedupe across repeated picks and overlapping zips
    let aviRunning = false;
    let aviStopFlag = false;
    let aviDone = false;
    let aviDoneSeen = false;        // the finished state has been shown in the open modal, so the pill can rest
    let aviEngines = [];            // loaded converter engines, one ffmpeg worker each: { ff, log, onProgress, inflight }
    let aviResults = [];            // finished outputs: { name, blob, url }
    let aviSkipped = [];            // segments left out: { name, reason }

    // ---------- zip reading (central directory + per-entry extraction, off Blob slices) ----------

    // List a zip's entries from its central directory without decompressing anything.
    // Handles zip64 sizes/offsets; an encrypted or oddly compressed entry is surfaced by flags/method.
    async function aviListZipEntries(zipFile) {
        const tailLen = Math.min(zipFile.size, 65558);   // EOCD record + max comment
        const tail = new Uint8Array(await zipFile.slice(zipFile.size - tailLen).arrayBuffer());
        let eocd = -1;
        for (let i = tail.length - 22; i >= 0; i--) {
            if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('not a readable zip archive');
        const dv = new DataView(tail.buffer);
        let count = dv.getUint16(eocd + 10, true);
        let cdSize = dv.getUint32(eocd + 12, true);
        let cdOfs = dv.getUint32(eocd + 16, true);
        if (count === 0xffff || cdSize === 0xffffffff || cdOfs === 0xffffffff) {
            const loc = eocd - 20;   // zip64 EOCD locator sits directly before the EOCD
            if (loc >= 0 && tail[loc] === 0x50 && tail[loc + 1] === 0x4b && tail[loc + 2] === 0x06 && tail[loc + 3] === 0x07) {
                const e64Ofs = Number(dv.getBigUint64(loc + 8, true));
                const e64 = new DataView(await zipFile.slice(e64Ofs, e64Ofs + 56).arrayBuffer());
                count = Number(e64.getBigUint64(32, true));
                cdSize = Number(e64.getBigUint64(40, true));
                cdOfs = Number(e64.getBigUint64(48, true));
            }
        }
        const cd = new DataView(await zipFile.slice(cdOfs, cdOfs + cdSize).arrayBuffer());
        const dec = new TextDecoder();
        const entries = [];
        let p = 0;
        for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
            if (cd.getUint32(p, true) !== 0x02014b50) break;
            const flags = cd.getUint16(p + 8, true);
            const method = cd.getUint16(p + 10, true);
            let compSize = cd.getUint32(p + 20, true);
            let size = cd.getUint32(p + 24, true);
            const nameLen = cd.getUint16(p + 28, true);
            const extraLen = cd.getUint16(p + 30, true);
            const commentLen = cd.getUint16(p + 32, true);
            let localOfs = cd.getUint32(p + 42, true);
            const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
            let q = p + 46 + nameLen;                    // zip64 extra field carries the 64-bit values
            const extraEnd = q + extraLen;
            while (q + 4 <= extraEnd) {
                const id = cd.getUint16(q, true), len = cd.getUint16(q + 2, true);
                if (id === 1) {
                    let r = q + 4;
                    if (size === 0xffffffff) { size = Number(cd.getBigUint64(r, true)); r += 8; }
                    if (compSize === 0xffffffff) { compSize = Number(cd.getBigUint64(r, true)); r += 8; }
                    if (localOfs === 0xffffffff) { localOfs = Number(cd.getBigUint64(r, true)); }
                }
                q += 4 + len;
            }
            entries.push({ name, flags, method, compSize, size, localOfs });
            p += 46 + nameLen + extraLen + commentLen;
        }
        return entries;
    }

    // One segment's bytes as a Blob. A stored entry is the zip Blob slice itself (no copy, the
    // browser streams it from disk); a deflated entry inflates through DecompressionStream.
    async function aviSegBlob(seg) {
        if (seg.file) return seg.file;
        const lh = new DataView(await seg.zipFile.slice(seg.entry.localOfs, seg.entry.localOfs + 30).arrayBuffer());
        if (lh.getUint32(0, true) !== 0x04034b50) throw new Error('unreadable zip entry');
        const dataOfs = seg.entry.localOfs + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const comp = seg.zipFile.slice(dataOfs, dataOfs + seg.entry.compSize);
        if (seg.entry.method === 0) return comp;
        return await new Response(comp.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    }

    // ---------- picking + ordering ----------

    function aviPushSeg(seg) {
        const key = seg.name.toLowerCase() + '|' + seg.size;
        if (aviSegKeys.has(key)) return false;
        aviSegKeys.add(key);
        aviSegs.push(seg);
        return true;
    }

    async function aviAddPicked(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        let added = 0, dups = 0;
        const notes = [];
        for (const f of files) {
            if (/\.zip$/i.test(f.name)) {
                try {
                    const entries = await aviListZipEntries(f);
                    let found = 0;
                    for (const en of entries) {
                        const base = en.name.split('/').pop();
                        if (!AVI_SEG_EXT_RE.test(base) || en.size === 0) continue;
                        if (/^__MACOSX\//.test(en.name) || base.startsWith('.')) continue;
                        found++;
                        if (en.flags & 1) { notes.push(base + ' (password protected)'); continue; }
                        if (en.method !== 0 && en.method !== 8) { notes.push(base + ' (unsupported zip compression)'); continue; }
                        if (en.method === 8 && typeof DecompressionStream === 'undefined') { notes.push(base + ' (this browser cannot open compressed zips)'); continue; }
                        aviPushSeg({ name: base, size: en.size, src: f.name, zipFile: f, entry: en }) ? added++ : dups++;
                    }
                    if (!found) notes.push(f.name + ' (no video segments inside)');
                } catch (err) {
                    notes.push(f.name + ' (' + err.message + ')');
                }
            } else if (AVI_SEG_EXT_RE.test(f.name)) {
                aviPushSeg({ name: f.name, size: f.size, src: '', file: f }) ? added++ : dups++;
            } else {
                notes.push(f.name + ' (not a video or zip)');
            }
        }
        // Chronological order comes from the recorder's sequential filenames: numeric-aware
        // compare across every source, so segments split over several zips interleave correctly.
        aviSegs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.size - b.size);
        aviRenderList();
        let msg = added + ' segment' + (added === 1 ? '' : 's') + ' added.';
        if (dups) msg += ' ' + dups + ' duplicate' + (dups === 1 ? '' : 's') + ' skipped.';
        if (notes.length) msg += ' Could not be added: ' + notes.join(', ') + '.';
        aviSetStatus(aviSegs.length ? msg + ' Check the order above, then start.' : msg);
    }

    function aviFmtBytes(n) {
        if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
        if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
        return Math.max(1, Math.round(n / 1e3)) + ' KB';
    }

    function aviFmtDur(s) {
        s = Math.max(0, Math.round(s));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        if (h) return h + ' h ' + String(m).padStart(2, '0') + ' min';
        if (m) return m + ' min';
        return s + ' s';
    }

    function aviRenderList() {
        const host = document.getElementById('aviFileList');
        const summary = document.getElementById('aviListSummary');
        host.innerHTML = '';
        // the source zip tag only matters for checking how several sources interleave, so a
        // single-source list keeps the full row width for the filename itself
        const multiSrc = new Set(aviSegs.map(s => s.src || '')).size > 1;
        aviSegs.slice(0, AVI_LIST_ROW_CAP).forEach((seg, i) => {
            const row = document.createElement('div');
            row.className = 'avi-row';
            const left = document.createElement('span');
            left.className = 'avi-name';
            left.textContent = (i + 1) + '. ' + seg.name;
            const right = document.createElement('span');
            right.className = 'avi-meta';
            right.textContent = aviFmtBytes(seg.size) + (multiSrc && seg.src ? ' · ' + seg.src : '');
            row.append(left, right);
            host.appendChild(row);
        });
        if (aviSegs.length > AVI_LIST_ROW_CAP) {
            const row = document.createElement('div');
            row.className = 'avi-row avi-meta';
            row.textContent = 'plus ' + (aviSegs.length - AVI_LIST_ROW_CAP) + ' more in the same order';
            host.appendChild(row);
        }
        host.style.display = aviSegs.length ? '' : 'none';
        const total = aviSegs.reduce((s, x) => s + x.size, 0);
        summary.textContent = aviSegs.length ? aviSegs.length + ' segments · ' + aviFmtBytes(total) : '';
        document.getElementById('aviStartBtn').disabled = !aviSegs.length || aviRunning;
        document.getElementById('aviClearBtn').disabled = !aviSegs.length || aviRunning;
    }

    // ---------- engine ----------

    function aviLoadEngineScript() {
        return new Promise((resolve, reject) => {
            if (window.FFmpegWASM) { resolve(); return; }
            const s = document.createElement('script');
            s.src = 'lib/ffmpeg/ffmpeg.js';
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('the converter engine script did not load'));
            document.head.appendChild(s);
        });
    }

    async function aviSpawnEngine() {
        await aviLoadEngineScript();
        const eng = { ff: new FFmpegWASM.FFmpeg(), log: [], onProgress: null, inflight: 0, jobs: 0, dead: false };
        eng.ff.on('log', (e) => { eng.log.push(e.message); if (eng.log.length > 500) eng.log.shift(); });
        eng.ff.on('progress', (e) => { if (eng.onProgress) eng.onProgress(e); });
        await eng.ff.load({
            coreURL: new URL('lib/ffmpeg/ffmpeg-core.js', document.baseURI).href,
            wasmURL: new URL('lib/ffmpeg/ffmpeg-core.wasm', document.baseURI).href
        });
        try { await eng.ff.createDir('/in'); } catch (e) {}
        try { await eng.ff.createDir('/cc'); } catch (e) {}
        return eng;
    }

    // execs on one engine run one at a time, so the engine's own log buffer is the exec's log
    async function aviExec(eng, args) {
        eng.log = [];
        const code = await eng.ff.exec(args);
        return { code, log: eng.log };
    }

    // Drains a list of segment indices through the engine pool. Every runner retires its engine
    // after AVI_ENGINE_RECYCLE segments and starts a fresh one: each ffmpeg run leaves a little
    // memory behind in its instance, wasm memory never shrinks, and an engine kept for a whole
    // mission climbs into the core's 2 GB ceiling and dies mid-run. A dead engine is likewise
    // replaced in its slot, so one death costs one segment (retried later), never the queue.
    async function aviRunPool(indices, convertOne, onOne) {
        let qi = 0;
        const slotRunner = async (slot) => {
            for (;;) {
                if (aviStopFlag) return;
                const q = qi++;
                if (q >= indices.length) return;
                await convertOne(aviEngines[slot], indices[q]);
                if (onOne) onOne(indices[q]);
                const cur = aviEngines[slot];
                cur.jobs++;
                if (cur.dead || cur.jobs >= AVI_ENGINE_RECYCLE) {
                    if (qi >= indices.length && !cur.dead) return;
                    try { cur.ff.terminate(); } catch (e) {}
                    cur.inflight = 0;
                    let fresh;
                    try { fresh = await aviSpawnEngine(); } catch (e) { return; }
                    if (aviStopFlag) { try { fresh.ff.terminate(); } catch (e) {} return; }
                    aviEngines[slot] = fresh;
                }
            }
        };
        await Promise.all(aviEngines.map((eng, slot) => slotRunner(slot)));
    }

    // Codec, resolution and duration off ffmpeg's own stream banner (the -i run exits nonzero
    // by design).
    async function aviProbe(eng, path) {
        const r = await aviExec(eng, ['-hide_banner', '-i', path]);
        const text = r.log.join('\n');
        const v = text.match(/Stream #[^\n]*: Video: ([A-Za-z0-9_]+)/);
        const a = text.match(/Stream #[^\n]*: Audio: ([A-Za-z0-9_]+)/);
        const res = text.match(/Stream #[^\n]*: Video: [^\n]*?(\d{2,5}x\d{2,5})/);
        const d = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        return {
            vcodec: v ? v[1].toLowerCase() : '',
            acodec: a ? a[1].toLowerCase() : '',
            res: res ? res[1] : '',
            dur: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0
        };
    }

    // Convert one segment to an .mp4 fragment File. The input mounts read-only through WORKERFS
    // (no copy into the wasm heap), with a writeFile fallback; the fragment is read back out and
    // the FS entry dropped, so the heap only ever holds one fragment.
    async function aviConvertSeg(eng, seg, idx) {
        let blob;
        // a zip-read problem belongs to the segment; everything else that throws in here comes
        // out of the engine itself and marks the worker dead (see the runner loops)
        try { blob = await aviSegBlob(seg); }
        catch (e) { e.aviSegment = true; throw e; }
        const ext = (seg.name.match(/\.[A-Za-z0-9]+$/) || ['.avi'])[0].toLowerCase();
        const inName = 'seg' + ext;
        let mounted = false;
        try { await eng.ff.mount('WORKERFS', { files: [new File([blob], inName)] }, '/in'); mounted = true; }
        catch (e) { await eng.ff.writeFile('/' + inName, new Uint8Array(await blob.arrayBuffer())); }
        const inPath = mounted ? '/in/' + inName : '/' + inName;
        try {
            const probe = await aviProbe(eng, inPath);
            seg.dur = probe.dur;
            let usedCopy = probe.vcodec === 'h264';
            const args = ['-hide_banner', '-y', '-i', inPath];
            if (usedCopy) args.push('-c:v', 'copy');
            else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p');
            if (probe.acodec === 'aac') args.push('-c:a', 'copy');
            else if (probe.acodec) args.push('-c:a', 'aac', '-b:a', '96k');
            else args.push('-an');
            args.push('/frag.mp4');
            let r = await aviExec(eng, args);
            if (r.code !== 0 && !aviStopFlag) {
                // full re-encode absorbs any stream-copy incompatibility (odd codec, broken timestamps)
                usedCopy = false;
                const enc = ['-hide_banner', '-y', '-fflags', '+genpts', '-i', inPath,
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p'];
                if (probe.acodec) enc.push('-c:a', 'aac', '-b:a', '96k'); else enc.push('-an');
                enc.push('/frag.mp4');
                r = await aviExec(eng, enc);
            }
            if (r.code !== 0) { const e = new Error('ffmpeg could not read this segment'); e.aviSegment = true; throw e; }
            const bytes = await eng.ff.readFile('/frag.mp4');
            try { await eng.ff.deleteFile('/frag.mp4'); } catch (e) {}
            return {
                file: new File([bytes], 'f' + String(idx).padStart(5, '0') + '.mp4', { type: 'video/mp4' }),
                res: probe.res,
                // stream signature for the concat step: fragments that differ here cannot splice
                // by stream copy without boundary glitches
                sig: (usedCopy ? 'copy' : 'enc') + '|' + probe.res + '|' + (probe.acodec || 'silent')
            };
        } finally {
            if (mounted) { try { await eng.ff.unmount('/in'); } catch (e) {} }
            else { try { await eng.ff.deleteFile('/' + inName); } catch (e) {} }
        }
    }

    // One segment with a hang watchdog: a worker that stops replying would otherwise stall the
    // whole run, so a segment stuck past the timeout rejects and the engine is treated as dead.
    function aviConvertSegWatched(eng, seg, idx) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('the segment timed out')), AVI_SEG_TIMEOUT_MS);
            aviConvertSeg(eng, seg, idx).then(
                (v) => { clearTimeout(timer); resolve(v); },
                (e) => { clearTimeout(timer); reject(e); }
            );
        });
    }

    // Stitch fragment Files into one .mp4 through the concat demuxer: stream copy when every
    // fragment shares one stream signature, a unifying re-encode when they differ (mixed
    // resolutions or sources splice cleanly only through a re-encode).
    async function aviConcatPart(eng, frags, mixed, targetRes) {
        await eng.ff.mount('WORKERFS', { files: frags }, '/cc');
        await eng.ff.writeFile('/list.txt', frags.map(f => "file '/cc/" + f.name + "'").join('\n'));
        try {
            let r = mixed ? { code: 1 } : await aviExec(eng, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', '/list.txt', '-c', 'copy', '/out.mp4']);
            if (r.code !== 0 && !aviStopFlag) {
                const enc = ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', '/list.txt',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p'];
                // mixed resolutions decode at changing frame sizes; letterbox everything onto the
                // first fragment's frame so the encoder sees one size
                if (targetRes) {
                    const wh = targetRes.split('x');
                    enc.push('-vf', 'scale=' + wh[0] + ':' + wh[1] + ':force_original_aspect_ratio=decrease,pad=' + wh[0] + ':' + wh[1] + ':(ow-iw)/2:(oh-ih)/2,setsar=1');
                }
                enc.push('-c:a', 'aac', '-b:a', '96k', '/out.mp4');
                r = await aviExec(eng, enc);
            }
            if (r.code !== 0) throw new Error('the converted segments could not be combined');
            const bytes = await eng.ff.readFile('/out.mp4');
            try { await eng.ff.deleteFile('/out.mp4'); } catch (e) {}
            return new Blob([bytes], { type: 'video/mp4' });
        } finally {
            try { await eng.ff.deleteFile('/list.txt'); } catch (e) {}
            try { await eng.ff.unmount('/cc'); } catch (e) {}
        }
    }

    // ---------- the run ----------

    // AOC mission id (e.g. 20250817H1) found inside a filename, uppercased for the output name.
    function aviMissionIdFrom(text) {
        const m = (text || '').match(/\d{8}[A-Za-z]\d{1,2}/);
        return m ? m[0].toUpperCase() : '';
    }

    // Output names follow {missionId}_all_mmr.mp4: the id comes from the zip or segment
    // filenames (the MMR archive names carry it, e.g. 20250817H1_AVI.zip), then from the
    // loaded flight, then the first source's own base name when no id exists anywhere.
    function aviOutName(partIdx, partCount) {
        let base = '';
        for (const s of aviSegs) {
            base = aviMissionIdFrom(s.src) || aviMissionIdFrom(s.name);
            if (base) break;
        }
        if (!base && typeof flightMetaData !== 'undefined' && flightMetaData) base = aviMissionIdFrom(flightMetaData.id);
        if (!base) {
            const zipSeg = aviSegs.find(s => s.src);
            base = (zipSeg ? zipSeg.src.replace(/\.zip$/i, '') : aviSegs[0].name.replace(/\.[^.]+$/, '')).replace(/[^\w.-]+/g, '_') || 'mmr';
        }
        return base + '_all_mmr' + (partCount > 1 ? '_part' + (partIdx + 1) : '') + '.mp4';
    }

    // Measured only, and only once there is enough to measure: the clock starts when segments
    // start converting (engine downloads excluded) and nothing shows until a few segments have
    // truly finished, so the number never opens on a wild first-seconds extrapolation. Far-out
    // estimates round to calm 5-minute steps.
    function aviEtaNote(tSeg, doneBytes, totalBytes, doneCount) {
        const elapsed = (performance.now() - tSeg) / 1000;
        if (!doneBytes || doneCount < 3 || elapsed < 15) return '';
        let left = (totalBytes - doneBytes) / (doneBytes / elapsed);
        if (left > 600) left = Math.ceil(left / 300) * 300;
        else if (left > 90) left = Math.ceil(left / 60) * 60;
        return ' · about ' + aviFmtDur(left) + ' left';
    }

    async function aviStartRun() {
        if (aviRunning || !aviSegs.length) return;
        if (typeof Worker === 'undefined' || location.protocol === 'file:') {
            aviSetStatus('The converter only works on the hosted site. Opening the page as a local file disables the background engine it needs.');
            return;
        }
        aviRunning = true; aviStopFlag = false; aviDone = false; aviDoneSeen = false;
        aviSkipped = [];
        aviClearResults();
        aviUiRunning(true);
        aviSetBar(0);
        window.addEventListener('beforeunload', aviBeforeUnload);
        const t0 = performance.now();
        try {
            // engine pool: the first spawn downloads the engine once, later spawns start from
            // the local cache, and every engine converts its own segment at the same time
            if (!aviEngines.length) {
                aviSetStatus('Loading the converter engine, a one-time download of about 32 MB…');
                aviEngines.push(await aviSpawnEngine());
            }
            const target = Math.min(AVI_MAX_WORKERS, aviSegs.length);
            if (aviEngines.length < target && !aviStopFlag) {
                aviSetStatus('Getting the converter ready…');
                const extra = await Promise.all(Array.from({ length: target - aviEngines.length }, () => aviSpawnEngine().catch(() => null)));
                extra.filter(Boolean).forEach(e => aviEngines.push(e));
            }
            if (aviStopFlag) return;
            const totalBytes = aviSegs.reduce((s, x) => s + x.size, 0);
            const frags = new Array(aviSegs.length).fill(null);
            const failReason = {};
            let doneCount = 0, doneBytes = 0, durSum = 0;
            const tSeg = performance.now();
            const paintBar = () => {
                const inflight = aviEngines.reduce((s, e) => s + e.inflight, 0);
                aviSetBar(Math.min(doneBytes + inflight, totalBytes) / totalBytes * 0.85);
            };
            const paintStatus = () => {
                aviSetStatus('Converting segments: ' + doneCount + ' of ' + aviSegs.length + ' done'
                    + aviEtaNote(tSeg, doneBytes, totalBytes, doneCount));
            };
            // One segment on one engine. A failure tagged aviSegment belongs to the segment; any
            // other failure means the engine itself is gone, and aviRunPool replaces it so a
            // dead worker never keeps pulling from the queue.
            const convertInto = async (eng, i) => {
                const seg = aviSegs[i];
                eng.onProgress = (e) => { eng.inflight = Math.min(Math.max(e.progress || 0, 0), 1) * seg.size; paintBar(); };
                try {
                    const fr = await aviConvertSegWatched(eng, seg, i);
                    frags[i] = { file: fr.file, dur: seg.dur || 0, sig: fr.sig, res: fr.res };
                    delete failReason[i];
                    durSum += seg.dur || 0;
                } catch (err) {
                    if (aviStopFlag) return;
                    failReason[i] = err.message;
                    if (!err.aviSegment) {
                        eng.dead = true;
                        failReason[i] = 'the converter stopped mid-segment';
                        console.warn('[avi-convert] engine stopped', err);
                    }
                }
                eng.onProgress = null; eng.inflight = 0;
            };
            paintStatus();
            await aviRunPool(aviSegs.map((s, i) => i), convertInto, (i) => {
                doneCount++; doneBytes += aviSegs[i].size;
                paintStatus(); paintBar();
            });
            if (aviStopFlag) return;
            // anything still missing (a dead engine's failure, or segments never picked up
            // after a runner lost its engine) gets one more pass on a rebuilt pool
            let missing = [];
            frags.forEach((f, i) => { if (!f) missing.push(i); });
            if (missing.length) {
                aviEngines = aviEngines.filter(eng => { if (eng.dead) { try { eng.ff.terminate(); } catch (e) {} } return !eng.dead; });
                aviSetStatus('Retrying ' + missing.length + ' segment' + (missing.length === 1 ? '' : 's') + '…');
                while (aviEngines.length < Math.min(target, missing.length) && !aviStopFlag) {
                    try { aviEngines.push(await aviSpawnEngine()); } catch (e) { break; }
                }
                if (aviStopFlag) return;
                if (!aviEngines.length) aviEngines.push(await aviSpawnEngine());
                let retryDone = 0;
                await aviRunPool(missing, convertInto, () => {
                    retryDone++;
                    aviSetStatus('Retrying segments: ' + retryDone + ' of ' + missing.length + ' done');
                });
                if (aviStopFlag) return;
                missing = [];
                frags.forEach((f, i) => { if (!f) missing.push(i); });
            }
            missing.forEach(i => aviSkipped.push({ name: aviSegs[i].name, reason: failReason[i] || 'could not be converted' }));
            if (aviSkipped.length) console.warn('[avi-convert] segments left out:', aviSkipped);
            const good = frags.filter(Boolean);
            if (!good.length) throw new Error('none of the segments could be converted');
            // parts stay under the wasm heap ceiling; almost every flight fits in one
            const parts = [];
            let cur = [], curBytes = 0;
            for (const fr of good) {
                if (cur.length && curBytes + fr.file.size > AVI_PART_BYTES) { parts.push(cur); cur = []; curBytes = 0; }
                cur.push(fr); curBytes += fr.file.size;
            }
            if (cur.length) parts.push(cur);
            // the combine step gets a fresh engine: its heap must hold the whole output file,
            // and an engine that grew its memory through the segment stage has less headroom
            aviEngines.forEach(eng => { try { eng.ff.terminate(); } catch (e) {} });
            aviEngines = [await aviSpawnEngine()];
            const eng0 = aviEngines[0];
            for (let p = 0; p < parts.length; p++) {
                if (aviStopFlag) return;
                aviSetStatus(parts.length > 1
                    ? 'Combining part ' + (p + 1) + ' of ' + parts.length + ' (' + parts[p].length + ' segments)…'
                    : 'Combining ' + good.length + ' segments…');
                const partDur = parts[p].reduce((s, x) => s + x.dur, 0);
                eng0.onProgress = (e) => {
                    const f = partDur ? Math.min((e.time || 0) / 1e6 / partDur, 1) : 0;
                    aviSetBar(0.85 + (p + f) / parts.length * 0.15);
                };
                const mixed = new Set(parts[p].map(x => x.sig)).size > 1;
                const blob = await aviConcatPart(eng0, parts[p].map(x => x.file), mixed, parts[p][0].res);
                aviResults.push({ name: aviOutName(p, parts.length), blob, url: URL.createObjectURL(blob) });
                eng0.onProgress = null;
            }
            aviSetBar(1);
            aviDone = true;
            aviRenderResults();
            const okCount = aviSegs.length - aviSkipped.length;
            let msg = 'Done in ' + aviFmtDur((performance.now() - t0) / 1000) + ': ' + okCount + ' segments'
                + (durSum ? ', ' + aviFmtDur(durSum) + ' of video' : '')
                + (aviResults.length > 1 ? ', in ' + aviResults.length + ' parts' : '') + '.';
            if (aviSkipped.length) {
                msg += ' These segments could not be read and were left out: ' + aviSkipped.map(s => s.name).join(', ') + '.';
            }
            if (!aviModalOpen()) {
                showToast('MMR video conversion finished. Open the converter to save it or load it into the player.', 8000);
            }
            msg += ' You can save the .mp4 below or load it straight into the MMR player.';
            aviSetStatus(msg);
        } catch (err) {
            if (!aviStopFlag) {
                aviSetStatus('Conversion failed: ' + err.message + '.');
                console.warn('[avi-convert]', err);
            }
        } finally {
            aviRunning = false;
            // one warm engine is kept for the next run; the extra parallel workers release their memory
            while (aviEngines.length > 1) { const eng = aviEngines.pop(); try { eng.ff.terminate(); } catch (e) {} }
            window.removeEventListener('beforeunload', aviBeforeUnload);
            aviUiRunning(false);
            aviUpdatePill();
        }
    }

    function aviStopRun() {
        if (!aviRunning) return;
        aviStopFlag = true;
        // terminate kills every engine worker mid-exec; the run's pending awaits reject and its
        // finally block restores the UI. Terminated engines are dead; the next run loads fresh.
        aviEngines.forEach(eng => { try { eng.ff.terminate(); } catch (e) {} });
        aviEngines = [];
        aviSetBar(0);
        aviSetStatus('Stopped. Your file list is still here, and starting again will run the conversion from the beginning.');
    }

    // Full teardown for Reset All (js/19-bootstrap.js): ends any running conversion and puts the
    // converter back to its fresh state, list and results included.
    function aviResetAll() {
        aviStopFlag = true;
        aviEngines.forEach(eng => { try { eng.ff.terminate(); } catch (e) {} });
        aviEngines = [];
        aviSegs = [];
        aviSegKeys = new Set();
        aviSkipped = [];
        aviDone = false; aviDoneSeen = false;
        aviClearResults();
        aviRenderList();
        aviSetBar(0);
        aviSetStatus('No files added.');
        aviCloseModal();
    }

    function aviBeforeUnload(e) { e.preventDefault(); e.returnValue = ''; }

    // ---------- results ----------

    function aviClearResults() {
        aviResults.forEach(r => { try { URL.revokeObjectURL(r.url); } catch (e) {} });
        aviResults = [];
        const row = document.getElementById('aviResultRow');
        row.innerHTML = '';
        row.classList.add('hidden'); row.classList.remove('flex');
    }

    function aviRenderResults() {
        const row = document.getElementById('aviResultRow');
        row.innerHTML = '';
        aviResults.forEach((res, i) => {
            const tag = aviResults.length > 1 ? ' part ' + (i + 1) : '';
            const save = document.createElement('a');
            save.href = res.url; save.download = res.name;
            save.className = 'px-4 py-2 bg-accent hover:bg-accent text-accent-ink font-bold rounded text-xs transition-colors shadow-sm whitespace-nowrap';
            save.textContent = '↓ Save' + tag + ' (.mp4)';
            const use = document.createElement('button');
            use.className = 'px-4 py-2 bg-panel-strip text-accent border border-hairline hover:bg-accent hover:text-accent-ink rounded text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer';
            use.textContent = 'Load' + tag + ' into the MMR player';
            use.addEventListener('click', () => aviUseAsMmr(res));
            row.append(save, use);
        });
        row.classList.remove('hidden'); row.classList.add('flex');
    }

    // Hands the finished .mp4 to the normal MMR upload path: the converted file lands on
    // #videoInput and its change handler runs the whole existing pipeline (drop zone label,
    // OCR warmup, auto-sync, PiP join).
    function aviUseAsMmr(res) {
        const dt = new DataTransfer();
        dt.items.add(new File([res.blob], res.name, { type: 'video/mp4' }));
        const vi = document.getElementById('videoInput');
        vi.files = dt.files;
        vi.dispatchEvent(new Event('change', { bubbles: true }));
        aviCloseModal();
    }

    // ---------- UI plumbing ----------

    function aviSetStatus(text) { document.getElementById('aviConvertStatus').textContent = text; }

    function aviSetBar(frac) {
        const pct = Math.min(100, Math.max(0, frac * 100));
        document.getElementById('aviConvertFill').style.width = pct.toFixed(1) + '%';
        const pill = document.getElementById('aviConvertPill');
        const pillPct = pill.querySelector('.avi-pill-pct');
        if (pillPct) pillPct.textContent = Math.floor(pct) + '%';
    }

    function aviUiRunning(on) {
        document.getElementById('aviStartBtn').disabled = on || !aviSegs.length;
        document.getElementById('aviClearBtn').disabled = on || !aviSegs.length;
        document.getElementById('aviFileInput').disabled = on;
        document.getElementById('aviAddLabel').classList.toggle('opacity-50', on);
        const stop = document.getElementById('aviStopBtn');
        stop.classList.toggle('hidden', !on);
        aviUpdatePill();
    }

    function aviModalOpen() {
        return document.getElementById('aviConvertModal').style.display === 'flex';
    }

    // Small fixed pill in the page corner while a conversion runs with the modal closed, so the
    // pass stays visible from anywhere in the app; it lingers as "ready" until the finished
    // state has been seen in the modal once.
    function aviUpdatePill() {
        const pill = document.getElementById('aviConvertPill');
        const show = !aviModalOpen() && (aviRunning || (aviDone && !aviDoneSeen));
        pill.classList.toggle('on', show);
        pill.querySelector('.avi-pill-label').textContent = aviRunning ? 'Converting MMR video' : 'MMR video ready';
        pill.querySelector('.avi-pill-spin').style.display = aviRunning ? '' : 'none';
        pill.querySelector('.avi-pill-pct').style.display = aviRunning ? '' : 'none';
    }

    function aviOpenModal() {
        document.getElementById('aviConvertModal').style.display = 'flex';
        if (aviDone) aviDoneSeen = true;
        aviUpdatePill();
    }

    function aviCloseModal() {
        document.getElementById('aviConvertModal').style.display = 'none';
        if (aviDone) aviDoneSeen = true;
        aviUpdatePill();
    }

    function aviClearAll() {
        if (aviRunning) return;
        aviSegs = [];
        aviSegKeys = new Set();
        aviSkipped = [];
        aviDone = false;
        aviClearResults();
        aviRenderList();
        aviSetBar(0);
        aviSetStatus('No files added.');
        aviUpdatePill();
    }

    document.getElementById('aviConvertOpenBtn').addEventListener('click', aviOpenModal);
    document.getElementById('aviConvertCloseX').addEventListener('click', aviCloseModal);
    document.getElementById('aviCloseBtn').addEventListener('click', aviCloseModal);
    document.getElementById('aviConvertPill').addEventListener('click', aviOpenModal);
    document.getElementById('aviStartBtn').addEventListener('click', aviStartRun);
    document.getElementById('aviStopBtn').addEventListener('click', aviStopRun);
    document.getElementById('aviClearBtn').addEventListener('click', aviClearAll);
    document.getElementById('aviFileInput').addEventListener('change', async function(e) {
        const picked = e.target.files;
        aviSetStatus('Reading the picked files…');
        try { await aviAddPicked(picked); } catch (err) { aviSetStatus('Could not read the picked files: ' + err.message + '.'); }
        e.target.value = '';
    });
