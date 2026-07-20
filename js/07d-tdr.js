/* Mission Visualizer, Tail Doppler Radar overlays (3D column stack + 2D layer picker)
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   Progressive TDR reflectivity: the mission's radar analyses are listed from the recon-api
   (/v1/tdr/mission/{id}, each with an HHMM analysis_time), and as the playhead crosses each
   analysis time its full volume is fetched (/v1/tdr/volume). On the 3D tracker every analysis
   renders as a stack of translucent planes, one per altitude level with data (0 to 18 km every
   0.5 km), anchored at that analysis's own storm-center origin, so the radar column reads in
   true 3D; past analyses stay visible like the flown track and the mosaic assembles itself
   under the aircraft, while sliding backward hides analyses the playhead has not reached. On
   the 2D tracker the TDR picker (the satellite picker's sibling) lists every altitude level by
   pressure altitude; picked levels composite over the basemap at a slider opacity, and the
   Cross-section tool turns two map clicks into a /v1/tdr/plane_slice vertical slice.

   Only post-season quality-controlled data is used (level=2 explicit on every request); a
   mission carrying just the aircraft's real-time 1b product shows the TDR control disabled as
   unavailable. Product is 'xy' (ground-relative), not 'xy_rel': each analysis is placed at
   its real-world origin on the earth-fixed map, which is already the ground frame; xy_rel
   (storm motion removed) suits the API's own storm-centered time composites instead.
   Pre-2021 missions use a lat/lon grid the sweep endpoint rejects with a 400; those analyses
   are marked errored and skipped, and a toggle off/on re-arms them for a retry. */

    let tdrAnalyses = [];       // { hhmm, sec, state: 'idle'|'loading'|'ready'|'error', mesh }
    let tdrMissionId = '';      // mission the current analyses belong to, '' = none
    let tdrGeneration = 0;      // bumped by every reset; in-flight async results check it and drop
    let tdrGroup3D = null;      // holds one plane-stack group per fetched analysis
    let tdrFetchActive = false; // one volume request in flight at a time
    let _tdrLastSec = 0;        // last playhead absSeconds seen, for ticks outside playback

    // 2D overlay + picker (the TDR dropdown, the satellite picker's sibling)
    let tdr2DImage = null;         // composited canvas the 2D basemap draws (current analysis, picked levels)
    let tdr2DBox = null;           // { minLat, maxLat, minLon, maxLon } of that canvas
    let tdr2DOpacity = 0.85;       // picker slider
    let tdrSelectedKm = new Set(); // altitude levels picked in the panel, km values
    let tdrCurrent = null;         // analysis record the 2D overlay and panel currently reflect
    let _tdr2DStamp = '';          // analysis + selection fingerprint; recomposite only when it changes
    let tdrSliceArm = 0;           // cross-section picking: 0 off, 1 first point pending, 2 second point pending
    let tdrSlicePtA = null;        // first picked endpoint { lat, lon }
    let tdrLevel2Missing = false;  // mission has TDR but no QC'd level 2: control shown disabled

    const TDR_FIELD = 'reflectivity';
    const TDR_PRODUCT = 'xy';
    const TDR_SCAN_RADIUS_KM = 70;    // swath revealed around the aircraft as it flies the leg
    const TDR_BEAM_H = 18000 / 690;   // the aircraft beam spans the full level stack, sea to 18 km
    const TDR_ZOOM_OUT_DIST = 110;    // camera distance that frames the ~500 km radar box
    let tdrPlaneBeam = null;          // tall white beam marking the aircraft inside the radar volume
    let tdrZoomedOut = false;         // one-shot: the camera pulls back when radar first appears

    // Tear down the overlay (new flight, reset). Meshes and their GPU resources are disposed,
    // the toggle returns to its default checked state, and the label hides until the next
    // mission with TDR coverage.
    function resetTdrOverlay() {
        tdrGeneration++;
        tdrFetchActive = false;
        // meshes may or may not be parented into tdrGroup3D yet (a 2D-only session builds them
        // without a scene), so disposal walks the analyses, not the group
        tdrAnalyses.forEach(a => {
            if (!a.mesh) return;
            a.mesh.traverse(o => {
                if (!o.isMesh) return;
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    if (o.material.map) o.material.map.dispose();
                    if (o.material.alphaMap) o.material.alphaMap.dispose();
                    o.material.dispose();
                }
            });
        });
        if (tdrPlaneBeam) {
            if (tdrPlaneBeam.geometry) tdrPlaneBeam.geometry.dispose();
            if (tdrPlaneBeam.material) tdrPlaneBeam.material.dispose();
            tdrPlaneBeam = null;
        }
        tdrZoomedOut = false;
        if (tdrGroup3D) {
            if (tdrGroup3D.parent) tdrGroup3D.parent.remove(tdrGroup3D);
            tdrGroup3D = null;
        }
        tdrAnalyses = []; tdrMissionId = ''; _tdrLastSec = 0;
        tdrSelectedKm.clear(); tdrCurrent = null; tdr2DImage = null; tdr2DBox = null; _tdr2DStamp = '';
        tdrSliceArm = 0; tdrSlicePtA = null; setTdrSliceHint('');
        tdrLevel2Missing = false;
        bgNeedsUpdate = true;
        const lbl = document.getElementById('tdrToggleLabel'); if (lbl) lbl.style.display = 'none';
        const cb = document.getElementById('toggleTdr'); if (cb) cb.checked = true;
        const grp = document.getElementById('tdrControlGroup'); if (grp) grp.style.display = 'none';
        const pb = document.getElementById('tdrPickerBtn');
        if (pb) {
            pb.disabled = false; pb.classList.remove('opacity-60');
            if (pb.dataset.defaultTitle) pb.title = pb.dataset.defaultTitle;
        }
        const sm = document.getElementById('tdrSliceModal'); if (sm) sm.style.display = 'none';
        closeTdrPicker();
        updateTdrPickerBtn();
    }

    // Probe the archive for TDR coverage of the loaded flight. Runs on every flight load with a
    // valid AOC mission id (archive, preloaded, and manual uploads all carry one via the filename
    // convention); a 404 just means no TDR for this mission and the toggle stays hidden.
    function initTdrForFlight() {
        resetTdrOverlay();
        // flightMetaData.id is the bare mission id for manual uploads but "id (Storm)" for archive
        // and preloaded opens, so take the leading mission-id token rather than full-matching.
        const raw = (typeof flightMetaData !== 'undefined' && flightMetaData && flightMetaData.id) || '';
        const idMatch = String(raw).match(/^(\d{8}[A-Za-z]\d+)/);
        if (!idMatch) return;
        const id = idMatch[1];
        if (typeof RECON_API_BASE === 'undefined' || typeof reconAuthHeaders !== 'function') return;
        const gen = tdrGeneration;
        fetch(`${RECON_API_BASE}/v1/tdr/mission/${encodeURIComponent(id)}`, { headers: reconAuthHeaders() })
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(info => {
                if (gen !== tdrGeneration) return;
                // QC'd level 2 only: a level-1b-only mission surfaces the control disabled
                // instead of quietly rendering the unreviewed real-time product.
                if (!info.has_level2) {
                    tdrLevel2Missing = true;
                    const grp2 = document.getElementById('tdrControlGroup'); if (grp2) grp2.style.display = 'flex';
                    const pb = document.getElementById('tdrPickerBtn');
                    if (pb) {
                        if (!pb.dataset.defaultTitle) pb.dataset.defaultTitle = pb.title;
                        pb.disabled = true; pb.classList.add('opacity-60');
                        pb.title = 'Only the real-time (level 1b) radar exists for this mission; the overlay uses quality-controlled level 2 data only.';
                    }
                    const pl = document.getElementById('tdrPickerBtnLabel'); if (pl) pl.textContent = 'TDR: Unavailable';
                    return;
                }
                // Distinct analysis times from the level-2 xy files (the product this overlay
                // renders), else any level-2 file.
                let files = (info.files || []).filter(f => f.level === '2' && f.product === TDR_PRODUCT);
                if (!files.length) files = (info.files || []).filter(f => f.level === '2');
                const times = [...new Set(files.map(f => f.analysis_time).filter(Boolean))];
                if (!times.length) return;
                // Analysis HHMM onto the flight clock: rows past midnight keep counting beyond
                // 24h (absSeconds), so a time far below the first row's clock wrapped midnight.
                const t0 = (allParsedData[0] && allParsedData[0].absSeconds) || 0;
                const hhmmToSec = hhmm => {
                    let sec = parseInt(hhmm.slice(0, 2), 10) * 3600 + parseInt(hhmm.slice(2), 10) * 60;
                    if (sec < t0 - 21600) sec += 86400;
                    return sec;
                };
                // Leg windows (start/stop per analysis tar, duplicated per level): the analysis
                // scans in across its leg, so each analysis gets the window containing its time.
                const legSeen = new Set(), legs = [];
                (info.legs || []).forEach(l => {
                    if (l.level !== '2' || !l.start_time || !l.stop_time) return;
                    const key = l.start_time + '_' + l.stop_time;
                    if (legSeen.has(key)) return; legSeen.add(key);
                    const s = hhmmToSec(l.start_time); let e = hhmmToSec(l.stop_time);
                    if (e < s) e += 86400;
                    legs.push({ s, e });
                });
                tdrAnalyses = times.map(hhmm => {
                    const sec = hhmmToSec(hhmm);
                    const leg = legs.find(L => sec >= L.s && sec <= L.e);
                    // no matching leg: reveal in full at the analysis time (startSec === stopSec)
                    return { hhmm, sec, startSec: leg ? leg.s : sec, stopSec: leg ? leg.e : sec, state: 'idle', mesh: null };
                }).sort((a, b) => a.sec - b.sec);
                tdrMissionId = id;
                const lbl = document.getElementById('tdrToggleLabel'); if (lbl) lbl.style.display = 'flex';
                const grp = document.getElementById('tdrControlGroup'); if (grp) grp.style.display = 'flex';
                // The flight may already be rendered and paused (shared links seek before this
                // resolves); kick the overlay once so fetching does not wait for a playback tick.
                updateTdr3D();
            })
            .catch(() => {});
    }

    // The API colorscale is [fraction, '#hex'] stops against zmin..zmax.
    function tdrColorStops(colorscale) {
        return (colorscale || []).map(s => {
            const hex = s[1].replace('#', '');
            return { f: s[0], r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
        });
    }

    // Paint one level's grid through the colorscale; null cells stay transparent. data[row][col]
    // has row indexing y (south first), and canvas rows run top-down, so rows are flipped to put
    // north at the texture's top. Returns null for a level with no data at all.
    function tdrCanvasFromGrid(grid, W, H, stops, zmin, zmax) {
        const span = (zmax - zmin) || 1;
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const ctx2 = cv.getContext('2d');
        const img = ctx2.createImageData(W, H);
        let painted = 0;
        for (let row = 0; row < H; row++) {
            const line = grid[row] || [];
            const cy = H - 1 - row;
            for (let col = 0; col < W; col++) {
                const v = line[col];
                if (v === null || v === undefined) continue;
                const f = Math.max(0, Math.min(1, (v - zmin) / span));
                let lo = stops[0], hi = stops[stops.length - 1];
                for (let s = 0; s < stops.length - 1; s++) {
                    if (f >= stops[s].f && f <= stops[s + 1].f) { lo = stops[s]; hi = stops[s + 1]; break; }
                }
                const t = hi.f > lo.f ? (f - lo.f) / (hi.f - lo.f) : 0;
                const o = (cy * W + col) * 4;
                img.data[o] = Math.round(lo.r + (hi.r - lo.r) * t);
                img.data[o + 1] = Math.round(lo.g + (hi.g - lo.g) * t);
                img.data[o + 2] = Math.round(lo.b + (hi.b - lo.b) * t);
                img.data[o + 3] = 235;
                painted++;
            }
        }
        if (!painted) return null;
        ctx2.putImageData(img, 0, 0);
        return cv;
    }

    // One analysis's renderable assets: a 3D group (a stack of translucent planes, one per altitude
    // level with data, each at its true altitude through the same get3DCoord projection the track
    // uses) PLUS the per-level canvases and geometry the 2D picker composites from. km offsets from
    // the storm-center origin become degrees, with lon stretched by 1/cos(lat).
    function buildTdrAssets(vol, idxInMission) {
        const W = vol.x.length, H = vol.y.length;
        const stops = tdrColorStops(vol.colorscale);
        const levels = vol.levels_km || [];
        if (!W || !H || !stops.length || !levels.length) return null;
        const latDegPerKm = 1 / 111.32;
        const lonDegPerKm = 1 / (111.32 * Math.max(0.2, Math.cos(vol.origin_lat * Math.PI / 180)));
        const x0 = vol.x[0], x1 = vol.x[W - 1], y0 = vol.y[0], y1 = vol.y[H - 1];
        const geo = { originLat: vol.origin_lat, originLon: vol.origin_lon, x0, x1, y0, y1, latDegPerKm, lonDegPerKm };
        const width = (x1 - x0) * lonDegPerKm * 20;
        const depth = (y1 - y0) * latDegPerKm * 20;
        const centerLon = vol.origin_lon + ((x0 + x1) / 2) * lonDegPerKm;
        const centerLat = vol.origin_lat + ((y0 + y1) / 2) * latDegPerKm;
        const group = new THREE.Group();
        const levelAssets = [];
        // One reveal mask per analysis, shared by every level as the material alphaMap (THREE
        // reads its green channel): black hides, and updateTdrScan stamps white swath discs
        // along the flown path so the whole column scans in with the aircraft.
        const maskCanvas = document.createElement('canvas'); maskCanvas.width = W; maskCanvas.height = H;
        const maskTex = new THREE.CanvasTexture(maskCanvas);
        maskTex.minFilter = THREE.LinearFilter;
        for (let li = 0; li < levels.length; li++) {
            const cv = tdrCanvasFromGrid(vol.data[li] || [], W, H, stops, vol.zmin, vol.zmax);
            levelAssets.push({ km: levels[li], canvas: cv });   // cv null = empty level (surface and the highest tops usually are)
            if (!cv) continue;
            const tex = new THREE.CanvasTexture(cv);
            tex.minFilter = THREE.LinearFilter;
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(width, depth),
                // Low per-plane opacity: the stacked levels compose into a readable volume
                // instead of the top level whiting out everything beneath it.
                new THREE.MeshBasicMaterial({ map: tex, alphaMap: maskTex, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })
            );
            mesh.rotation.x = -Math.PI / 2;
            mesh.userData.km = levels[li];   // band filtering in updateTdr3D matches on this
            mesh.position.copy(get3DCoord(centerLon, centerLat, levels[li] * 1000));
            // Successive center passes overlap; a small per-analysis lift and render order keep
            // coplanar levels from z-fighting and draw the newest analysis on top of the mosaic.
            mesh.position.y += idxInMission * 0.012;
            mesh.renderOrder = 3 + idxInMission * 0.001 + li * 0.00001;
            group.add(mesh);
        }
        if (!levelAssets.some(l => l.canvas)) return null;
        group.visible = false;
        return { group, levels: levelAssets, geo, maskCanvas, maskTex };
    }

    function fetchTdrAnalysis(a) {
        tdrFetchActive = true;
        a.state = 'loading';
        const gen = tdrGeneration;
        const url = `${RECON_API_BASE}/v1/tdr/volume?mission_id=${encodeURIComponent(tdrMissionId)}` +
            `&level=2&product=${TDR_PRODUCT}&field=${TDR_FIELD}&analysis_time=${encodeURIComponent(a.hhmm)}`;
        fetch(url, { headers: reconAuthHeaders() })
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(vol => {
                if (gen !== tdrGeneration) return;
                const assets = buildTdrAssets(vol, tdrAnalyses.indexOf(a));
                // Parenting into the 3D group happens in updateTdr3D (a 2D-only session has no
                // scene to parent into yet); the panel's level rows can build once data exists.
                if (assets) {
                    a.mesh = assets.group; a.levels = assets.levels; a.geo = assets.geo;
                    a.maskCanvas = assets.maskCanvas; a.maskTex = assets.maskTex;
                    a.maskCtx = assets.maskCanvas.getContext('2d');
                    a.maskStamp = 0; a.maskFull = false; a.lastStampSec = null; a._stampIdx = 0;
                    a.state = 'ready'; buildTdrHero();
                } else a.state = 'error';
            })
            .catch(() => { if (gen === tdrGeneration) { a.state = 'error'; buildTdrHero(); } })
            .finally(() => {
                tdrFetchActive = false;
                // Keep draining the queue and syncing visibility even while paused (the per-frame
                // caller only runs on playback ticks and user interaction).
                if (gen === tdrGeneration) updateTdr3D(_tdrLastSec);
            });
    }

    // The scan-in reveal: while the playhead sits inside an analysis's leg window, white swath
    // discs (TDR_SCAN_RADIUS_KM around the aircraft) stamp onto the analysis's shared mask along
    // the rows actually flown, so the radar paints in with the aircraft rather than popping in
    // complete. Past the leg the mask floods full; sliding backward rebuilds it from the leg
    // start. The row cursor (_stampIdx) keeps forward playback incremental.
    function updateTdrScan(a) {
        if (!a.maskCanvas) return;
        const t = _tdrLastSec;
        if (t < a.startSec) {
            if (a.lastStampSec !== null || a.maskFull) {   // slid back before the leg: hide it all again
                a.maskCtx.clearRect(0, 0, a.maskCanvas.width, a.maskCanvas.height);
                a.maskFull = false; a.lastStampSec = null; a._stampIdx = 0;
                a._scanPrev = null;
                a.maskTex.needsUpdate = true; a.maskStamp++;
            }
            return;
        }
        if (t >= a.stopSec) {
            if (!a.maskFull) {
                a.maskCtx.fillStyle = '#fff';
                a.maskCtx.fillRect(0, 0, a.maskCanvas.width, a.maskCanvas.height);
                a.maskFull = true; a.lastStampSec = t;
                a.maskTex.needsUpdate = true; a.maskStamp++;
            }
            return;
        }
        if (a.maskFull || (a.lastStampSec !== null && t < a.lastStampSec)) {   // slid back inside the leg: rebuild
            a.maskCtx.clearRect(0, 0, a.maskCanvas.width, a.maskCanvas.height);
            a.maskFull = false; a._stampIdx = 0;
            a._scanPrev = null;
        }
        const g = a.geo, ctx2 = a.maskCtx;
        const cellKm = (g.x1 - g.x0) / Math.max(1, a.maskCanvas.width - 1);
        const rCells = TDR_SCAN_RADIUS_KM / Math.max(0.1, cellKm);
        // The TDR scans a vertical plane perpendicular to the track, so the reveal is LINEAR: a
        // butt-capped stroke along the flown path uncovers a flat-ended ribbon +-70 km to each
        // side, its leading edge a straight line through the aircraft, never ahead of it.
        let stamped = false;
        ctx2.strokeStyle = '#fff';
        ctx2.lineWidth = rCells * 2;
        ctx2.lineCap = 'butt';
        ctx2.lineJoin = 'round';
        ctx2.beginPath();
        let prev = a._scanPrev || null;
        if (prev) ctx2.moveTo(prev.col, prev.cy);
        for (let i = a._stampIdx; i < filteredData.length; i++) {
            const row = filteredData[i];
            if (row.absSeconds > t) break;
            a._stampIdx = i;
            if (row.absSeconds < a.startSec || row.lat == null || row.lon == null) continue;
            const px = (row.lon - g.originLon) / g.lonDegPerKm, py = (row.lat - g.originLat) / g.latDegPerKm;
            const col = (px - g.x0) / cellKm, cy = (a.maskCanvas.height - 1) - (py - g.y0) / cellKm;
            if (prev) { ctx2.lineTo(col, cy); stamped = true; }
            else ctx2.moveTo(col, cy);
            prev = { col, cy };
        }
        if (stamped) ctx2.stroke();
        a._scanPrev = prev;
        a.lastStampSec = t;
        if (stamped) { a.maskTex.needsUpdate = true; a.maskStamp++; }
    }

    // Per-frame driver, called from updateVisualComponents with the playhead's absSeconds.
    // Drives BOTH surfaces: the 3D progressive column stack (each analysis appears at its leg
    // start and scans in as the aircraft flies it) and the 2D picker overlay (current analysis,
    // picked levels, same scan mask). Fetching runs one volume at a time, only while something
    // displays TDR or the picker panel is open.
    function updateTdr3D(nowSec) {
        if (nowSec !== undefined) _tdrLastSec = nowSec;
        if (!tdrAnalyses.length || typeof THREE === 'undefined') return;
        const cb = document.getElementById('toggleTdr');
        const on3d = cb && cb.checked;
        const in3d = typeof trackerModeSelect !== 'undefined' && trackerModeSelect.value === '3d';
        if (tdrGroup3D) tdrGroup3D.visible = !!(on3d && in3d);
        if (on3d && in3d && typeof threeDInitialized !== 'undefined' && threeDInitialized && typeof threeMapGroup !== 'undefined') {
            if (!tdrGroup3D) tdrGroup3D = new THREE.Group();
            // build3DScene empties threeMapGroup on every rebuild; re-adopting the group brings
            // the whole accumulated mosaic back with it.
            if (tdrGroup3D.parent !== threeMapGroup) threeMapGroup.add(tdrGroup3D);
            // The picker controls the 3D stack too: picked bands filter which levels draw
            // (nothing picked = the full stack), and the opacity slider scales the planes
            // around their 0.35-at-default baseline.
            const levelFilter = tdrSelectedKm.size > 0;
            const planeOpacity = 0.35 * tdr2DOpacity;
            for (const a of tdrAnalyses) {
                if (a.state === 'ready' && a.mesh) {
                    if (a.mesh.parent !== tdrGroup3D) tdrGroup3D.add(a.mesh);
                    a.mesh.visible = _tdrLastSec >= a.startSec;
                    for (const child of a.mesh.children) {
                        child.visible = !levelFilter || tdrSelectedKm.has(child.userData.km);
                        child.material.opacity = planeOpacity;
                    }
                }
            }
            const anyShown = tdrAnalyses.some(x => x.state === 'ready' && _tdrLastSec >= x.startSec);
            // Tall white beam through the full level stack at the aircraft, so its place inside
            // the radar volume reads at a glance.
            if (!tdrPlaneBeam) {
                tdrPlaneBeam = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.06, 0.06, TDR_BEAM_H, 12, 1, true),
                    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide })
                );
                tdrPlaneBeam.renderOrder = 6;
                tdrGroup3D.add(tdrPlaneBeam);
            }
            if (tdrPlaneBeam.parent !== tdrGroup3D) tdrGroup3D.add(tdrPlaneBeam);
            tdrPlaneBeam.visible = anyShown;
            if (anyShown && typeof planeGroup3D !== 'undefined' && planeGroup3D) {
                tdrPlaneBeam.position.set(planeGroup3D.position.x, TDR_BEAM_H / 2, planeGroup3D.position.z);
            }
            // The first radar appearing pulls the camera back once to frame the whole volume;
            // never zooms in, and the user's own orbiting takes over from there.
            if (!tdrZoomedOut && anyShown && typeof camera3D !== 'undefined' && camera3D && typeof controls3D !== 'undefined' && controls3D) {
                tdrZoomedOut = true;
                const off = camera3D.position.clone().sub(controls3D.target);
                const dist = off.length() || 1;
                if (dist < TDR_ZOOM_OUT_DIST) {
                    off.multiplyScalar(TDR_ZOOM_OUT_DIST / dist);
                    camera3D.position.copy(controls3D.target).add(off);
                    controls3D.update();
                }
            }
        }
        for (const a of tdrAnalyses) { if (a.state === 'ready') updateTdrScan(a); }
        updateTdr2D();
        const panel = document.getElementById('tdrPickerPanel');
        const panelOpen = panel && !panel.classList.contains('hidden');
        const wantData = (on3d && in3d) || (!in3d && tdrSelectedKm.size > 0) || panelOpen;
        if (wantData && !tdrFetchActive) {
            let next = tdrAnalyses.find(x => x.state === 'idle' && _tdrLastSec >= x.startSec);
            // With the panel open before the playhead reaches the radar section, fetch the first
            // analysis anyway so the level rows have data to build from.
            if (!next && panelOpen && !tdrAnalyses.some(x => x.state === 'ready' || x.state === 'loading')) next = tdrAnalyses[0];
            if (next) fetchTdrAnalysis(next);
        }
    }

    // ---- 2D picker overlay -------------------------------------------------------------------
    // The current analysis is the newest one the playhead has crossed (falling back to the first
    // fetched one so the panel works before the radar section); the picked altitude levels
    // composite bottom-up onto one canvas that renderBackground (js/15-map-render.js) draws over
    // the basemap at tdr2DOpacity, boxed by the analysis's own storm-center origin.
    function updateTdr2D() {
        let cur = null;
        for (const a of tdrAnalyses) { if (a.state === 'ready' && _tdrLastSec >= a.sec) cur = a; }
        if (!cur) cur = tdrAnalyses.find(a => a.state === 'ready') || null;
        if (cur !== tdrCurrent) { tdrCurrent = cur; buildTdrHero(); }
        const stamp = (cur ? cur.hhmm + ':' + (cur.maskStamp || 0) : '') + '|' + [...tdrSelectedKm].sort((a, b) => a - b).join(',');
        if (stamp === _tdr2DStamp) return;
        _tdr2DStamp = stamp;
        updateTdrPickerBtn();
        if (!cur || !cur.levels || !tdrSelectedKm.size) {
            if (tdr2DImage) { tdr2DImage = null; tdr2DBox = null; bgNeedsUpdate = true; }
            return;
        }
        const first = cur.levels.find(l => l.canvas);
        if (!first) return;
        const cv = document.createElement('canvas');
        cv.width = first.canvas.width; cv.height = first.canvas.height;
        const c2 = cv.getContext('2d');
        c2.globalAlpha = 0.8;   // combined levels read through each other; the slider scales the whole overlay
        cur.levels.forEach(l => { if (l.canvas && tdrSelectedKm.has(l.km)) c2.drawImage(l.canvas, 0, 0); });
        // Same scan-in as the 3D stack: keep only what the aircraft has painted so far this leg.
        if (cur.maskCanvas && !cur.maskFull) {
            c2.globalAlpha = 1;
            c2.globalCompositeOperation = 'destination-in';
            c2.drawImage(cur.maskCanvas, 0, 0);
            c2.globalCompositeOperation = 'source-over';
        }
        tdr2DImage = cv;
        const g = cur.geo;
        tdr2DBox = {
            minLat: g.originLat + g.y0 * g.latDegPerKm, maxLat: g.originLat + g.y1 * g.latDegPerKm,
            minLon: g.originLon + g.x0 * g.lonDegPerKm, maxLon: g.originLon + g.x1 * g.lonDegPerKm
        };
        bgNeedsUpdate = true;
    }

    // Altitude labels for tooltips and the cross-section info line.
    function tdrFt(km) { return (Math.round(km * 3280.84 / 100) * 100).toLocaleString('en-US') + ' ft'; }
    // Pressure at a level, via the inverse of the standard-atmosphere formula the parser uses
    // for pressure altitude, so the band labels line up with the app's own altitude convention.
    function tdrMb(km) { return 1013.25 * Math.pow(Math.max(0.0001, 1 - (km * 1000) / 44307.69), 1 / 0.190284); }

    // The picker groups the half-km radar levels into standard pressure bands (top of the list
    // is the top of the atmosphere); one row toggles every member level at once.
    const TDR_BANDS = [
        { pMin: 0, pMax: 100, label: 'Under 100 mb' },
        { pMin: 100, pMax: 200, label: '100-200 mb' },
        { pMin: 200, pMax: 300, label: '200-300 mb' },
        { pMin: 300, pMax: 400, label: '300-400 mb' },
        { pMin: 400, pMax: 500, label: '400-500 mb' },
        { pMin: 500, pMax: 600, label: '500-600 mb' },
        { pMin: 600, pMax: 700, label: '600-700 mb' },
        { pMin: 700, pMax: 800, label: '700-800 mb' },
        { pMin: 800, pMax: 900, label: '800-900 mb' },
        { pMin: 900, pMax: 1060, label: '900-1000 mb' }
    ];
    function tdrBandMembers(ref, band) {
        return ref.levels.filter(l => { const p = tdrMb(l.km); return p >= band.pMin && p < band.pMax; });
    }

    function updateTdrPickerBtn() {
        if (tdrLevel2Missing) return;   // the button holds its disabled "TDR: Unavailable" state
        const lbl = document.getElementById('tdrPickerBtnLabel'), btn = document.getElementById('tdrPickerBtn');
        if (!lbl) return;
        if (!tdrSelectedKm.size) { lbl.textContent = 'TDR: Off'; if (btn) btn.classList.remove('sat-on'); return; }
        const ref = tdrCurrent || tdrAnalyses.find(a => a.state === 'ready');
        const onBands = [];
        if (ref && ref.levels) TDR_BANDS.forEach(b => {
            const withData = tdrBandMembers(ref, b).filter(m => m.canvas);
            if (withData.length && withData.every(m => tdrSelectedKm.has(m.km))) onBands.push(b.label);
        });
        lbl.textContent = onBands.length === 1 ? 'TDR: ' + onBands[0] : 'TDR: ' + (onBands.length || 1) + ' bands';
        if (btn) btn.classList.add('sat-on');
    }

    // The panel's level column: the pressure bands laid out top-down (highest altitude first),
    // one clickable row per band, dimmed when the current analysis has no data anywhere in it.
    function buildTdrHero() {
        const list = document.getElementById('tdrLevelHero');
        if (!list) return;
        const ref = tdrCurrent || tdrAnalyses.find(a => a.state === 'ready');
        list.innerHTML = '';
        if (!ref || !ref.levels) {
            if (!tdrAnalyses.length || tdrAnalyses.every(x => x.state === 'error')) {
                const d = document.createElement('div');
                d.className = 'tdr-hero-note';
                d.textContent = tdrAnalyses.length
                    ? 'Radar data failed to load; toggle the TDR Radar checkbox off and on to retry.'
                    : 'No radar analyses for this flight.';
                list.appendChild(d);
                return;
            }
            // First volume still downloading: the standard bands render as spinner placeholders,
            // not clickable, so nothing invites a click that cannot show anything yet.
            TDR_BANDS.forEach(b => {
                const row = document.createElement('div');
                row.className = 'tdr-level-row loading';
                row.title = 'Loading radar data…';
                row.innerHTML = '<span class="tdr-level-ft">' + b.label + '</span><span class="tdr-row-spin"></span>';
                list.appendChild(row);
            });
            return;
        }
        TDR_BANDS.forEach(b => {
            const members = tdrBandMembers(ref, b);
            if (!members.length) return;
            const withData = members.filter(m => m.canvas);
            const on = withData.length > 0 && withData.every(m => tdrSelectedKm.has(m.km));
            const row = document.createElement('div');
            row.className = 'tdr-level-row' + (on ? ' on' : '') + (withData.length ? '' : ' empty');
            const kmLo = members[0].km, kmHi = members[members.length - 1].km;
            row.title = kmLo.toFixed(1) + ' to ' + kmHi.toFixed(1) + ' km (' + tdrFt(kmLo) + ' to ' + tdrFt(kmHi) + ')'
                + (withData.length ? '' : ', no data in the current analysis');
            row.innerHTML = '<span class="tdr-level-ft">' + b.label + '</span><span class="tdr-level-bar"></span>';
            row.addEventListener('click', () => {
                if (!withData.length) return;
                const turnOff = withData.every(m => tdrSelectedKm.has(m.km));
                withData.forEach(m => { if (turnOff) tdrSelectedKm.delete(m.km); else tdrSelectedKm.add(m.km); });
                buildTdrHero();
                updateTdr3D();
                if (typeof renderMapEngineFrame === 'function' && filteredData.length && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
            });
            list.appendChild(row);
        });
    }

    function positionTdrPicker() {
        const panel = document.getElementById('tdrPickerPanel'), btn = document.getElementById('tdrPickerBtn');
        if (!panel || !btn || panel.classList.contains('hidden')) return;
        const r = btn.getBoundingClientRect();
        panel.style.top = (r.bottom + 4) + 'px';
        panel.style.left = 'auto';
        panel.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    }
    function openTdrPicker() {
        const panel = document.getElementById('tdrPickerPanel'); if (!panel) return;
        buildTdrHero();
        panel.classList.remove('hidden');
        panel.scrollTop = 0;
        positionTdrPicker();
        updateTdr3D();   // an open panel is a fetch reason (see wantData), so kick the queue
    }
    function closeTdrPicker() { const p = document.getElementById('tdrPickerPanel'); if (p) p.classList.add('hidden'); }

    // ---- cross-section (top-down pick on the 2D map, rendered by /v1/tdr/plane_slice) --------
    function setTdrSliceHint(t) {
        const el = document.getElementById('tdrSliceHint');
        if (el) { el.textContent = t; el.style.display = t ? 'block' : 'none'; }
    }
    // Consumes 2D map clicks while armed; returns true when the click was taken.
    function tdrSliceMapClick(geo) {
        if (!tdrSliceArm || !geo) return false;
        if (tdrSliceArm === 1) {
            tdrSlicePtA = { lat: geo.lat, lon: geo.lon };
            tdrSliceArm = 2;
            setTdrSliceHint('Cross-section: click the second point.');
            return true;
        }
        tdrSliceArm = 0;
        fetchTdrSlice(tdrSlicePtA, { lat: geo.lat, lon: geo.lon });
        tdrSlicePtA = null;
        return true;
    }
    function fetchTdrSlice(A, B) {
        const cur = tdrCurrent;
        if (!cur || !cur.geo) { setTdrSliceHint(''); return; }
        const g = cur.geo;
        const toKm = p => ({ x: (p.lon - g.originLon) / g.lonDegPerKm, y: (p.lat - g.originLat) / g.latDegPerKm });
        const a = toKm(A), b = toKm(B);
        const url = `${RECON_API_BASE}/v1/tdr/plane_slice?mission_id=${encodeURIComponent(tdrMissionId)}` +
            `&level=2&product=${TDR_PRODUCT}&field=${TDR_FIELD}&analysis_time=${encodeURIComponent(cur.hhmm)}` +
            `&x0=${a.x.toFixed(1)}&y0=${a.y.toFixed(1)}&x1=${b.x.toFixed(1)}&y1=${b.y.toFixed(1)}&n=220`;
        setTdrSliceHint('Building cross-section…');
        const gen = tdrGeneration;
        fetch(url, { headers: reconAuthHeaders() })
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(sl => { if (gen !== tdrGeneration) return; setTdrSliceHint(''); showTdrSliceModal(sl); })
            .catch(() => {
                if (gen !== tdrGeneration) return;
                setTdrSliceHint('Cross-section failed; pick two points inside the radar footprint.');
                setTimeout(() => { if (gen === tdrGeneration && !tdrSliceArm) setTdrSliceHint(''); }, 4000);
            });
    }
    function showTdrSliceModal(sl) {
        const modal = document.getElementById('tdrSliceModal'), cv = document.getElementById('tdrSliceCanvas'), info = document.getElementById('tdrSliceInfo');
        if (!modal || !cv) return;
        // The slice grid is along-line distance (x, km) by altitude (y, km); the shared painter's
        // row flip puts the lowest level at the canvas bottom, which is what a section wants.
        const painted = tdrCanvasFromGrid(sl.data || [], sl.x.length, sl.y.length, tdrColorStops(sl.colorscale), sl.zmin, sl.zmax);
        const c2 = cv.getContext('2d');
        cv.width = sl.x.length; cv.height = sl.y.length;
        c2.clearRect(0, 0, cv.width, cv.height);
        if (painted) c2.drawImage(painted, 0, 0);
        const lenKm = Math.abs(sl.x[sl.x.length - 1] - sl.x[0]);
        const topKm = sl.y[sl.y.length - 1];
        if (info) info.textContent = (sl.storm_name ? sl.storm_name + ' · ' : '') + 'analysis ' + sl.analysis_time +
            'Z · ' + Math.round(lenKm) + ' km across · surface to ' + topKm.toFixed(0) + ' km (' + tdrFt(topKm) + ') · ' + sl.units +
            (painted ? '' : ' · no radar data along this line');
        modal.style.display = 'flex';
    }

    (function wireTdrUi() {
        const cb = document.getElementById('toggleTdr');
        if (cb) cb.addEventListener('change', () => {
            // Re-arm errored analyses so an off/on cycle retries transient failures.
            if (cb.checked) tdrAnalyses.forEach(a => { if (a.state === 'error') a.state = 'idle'; });
            updateTdr3D(_tdrLastSec);
        });

        const btn = document.getElementById('tdrPickerBtn');
        if (btn) btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = document.getElementById('tdrPickerPanel');
            if (panel && panel.classList.contains('hidden')) openTdrPicker(); else closeTdrPicker();
        });
        document.addEventListener('mousedown', (e) => {
            const panel = document.getElementById('tdrPickerPanel');
            if (!panel || panel.classList.contains('hidden')) return;
            if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
            // Sliding the timeline (or any slider) is not a dismissal.
            if (e.target.closest && e.target.closest('input[type="range"]')) return;
            closeTdrPicker();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            closeTdrPicker();
            if (tdrSliceArm) { tdrSliceArm = 0; tdrSlicePtA = null; setTdrSliceHint(''); }
        });
        window.addEventListener('resize', positionTdrPicker);
        window.addEventListener('scroll', positionTdrPicker, true);

        const sl = document.getElementById('tdrOpacitySlider'), sv = document.getElementById('tdrOpacityVal');
        if (sl) sl.addEventListener('input', () => {
            tdr2DOpacity = (parseInt(sl.value, 10) || 85) / 100;
            if (sv) sv.textContent = sl.value + '%';
            bgNeedsUpdate = true;
            updateTdr3D();   // the slider also scales the 3D planes
            if (typeof renderMapEngineFrame === 'function' && filteredData.length && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
        });

        const allBtn = document.getElementById('tdrLevelsAll'), noneBtn = document.getElementById('tdrLevelsNone');
        if (allBtn) allBtn.addEventListener('click', () => {
            const ref = tdrCurrent || tdrAnalyses.find(a => a.state === 'ready');
            if (!ref || !ref.levels) return;
            ref.levels.forEach(l => { if (l.canvas) tdrSelectedKm.add(l.km); });
            buildTdrHero(); updateTdr3D();
        });
        if (noneBtn) noneBtn.addEventListener('click', () => {
            tdrSelectedKm.clear();
            buildTdrHero(); updateTdr3D();
            if (typeof renderMapEngineFrame === 'function' && filteredData.length && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
        });

        const sliceBtn = document.getElementById('tdrSliceBtn');
        if (sliceBtn) sliceBtn.addEventListener('click', () => {
            if (!tdrCurrent) { setTdrSliceHint('Radar data is still loading; try again in a moment.'); setTimeout(() => { if (!tdrSliceArm) setTdrSliceHint(''); }, 3000); return; }
            tdrSliceArm = 1; tdrSlicePtA = null;
            closeTdrPicker();
            setTdrSliceHint('Cross-section: click the first point on the 2D map (Esc cancels).');
        });
        ['tdrSliceCloseX', 'tdrSliceCloseBtn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.addEventListener('click', () => { const m = document.getElementById('tdrSliceModal'); if (m) m.style.display = 'none'; });
        });
    })();
