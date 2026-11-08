/* Mission Visualizer, Tail Doppler Radar overlays (3D column stack + 2D layer picker)
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   Progressive TDR reflectivity: the mission's radar analyses are listed from the recon-api
   (/v1/tdr/mission/{id}, each with an HHMM analysis_time), and as the playhead crosses each
   analysis time its full volume is fetched (/v1/tdr/volume). On the 3D tracker every analysis
   renders as a stack of translucent planes, one per altitude level with data (0 to 18 km every
   0.5 km), anchored at that analysis's own storm-center origin, so the radar column reads in
   true 3D; past analyses stay visible like the flown track and the mosaic assembles itself
   under the aircraft, while sliding backward hides analyses the playhead has not reached. The TDR
   section of the Overlays dropdown (the satellite section's sibling) lists every altitude level, grouped
   into bands labelled by their STANDARD-ATMOSPHERE pressure (see tdrMb: the grid is geometric km, the
   millibars are a label for it, not an analysed pressure). Picked levels draw on whichever tracker is
   showing, beside the MMR video: composited over the 2D basemap at the TDR opacity, or as the 3D plane
   stack. On the 2D map the Cross-Section button turns two clicks into a /v1/tdr/plane_slice slice.

   Only post-season quality-controlled data is used (level=2 explicit on every request); a
   mission carrying just the aircraft's real-time 1b product shows the TDR control disabled as
   unavailable. Product is 'xy' (ground-relative), not 'xy_rel': each analysis is placed at
   its real-world origin on the earth-fixed map, which is already the ground frame; xy_rel
   (storm motion removed) suits the API's own storm-centered time composites instead.
   Pre-2021 missions use a lat/lon grid the sweep endpoint rejects with a 400; those analyses
   are marked errored and skipped, and the panel's failed-load note retries on click. */

    let tdrAnalyses = [];       // { hhmm, sec, state: 'idle'|'loading'|'ready'|'error', mesh }
    let tdrMissionId = '';      // mission the current analyses belong to, '' = none
    let tdrGeneration = 0;      // bumped by every reset; in-flight async results check it and drop
    let tdrGroup3D = null;      // holds one plane-stack group per fetched analysis
    let tdrFetchActive = false; // one volume request in flight at a time
    let _tdrLastSec = 0;        // last playhead absSeconds seen, for ticks outside playback

    // 2D overlay + picker (the TDR dropdown, the satellite picker's sibling)
    let tdr2DImage = null;         // composited canvas the 2D basemap draws (current analysis, picked levels)
    let tdr2DBox = null;           // { minLat, maxLat, minLon, maxLon } of that canvas
    let tdr2DOpacity = 0.85;       // opacity the 2D basemap draws the overlay at; the section's TDR opacity slider moves it
    let tdrSelectedKm = new Set(); // altitude levels picked in the panel, km values
    let tdrCurrent = null;         // analysis record the 2D overlay and panel currently reflect
    let _tdr2DStamp = '';          // analysis + selection fingerprint; recomposite only when it changes
    let tdrSliceArm = 0;           // cross-section picking: 0 off, 1 first point pending, 2 second point pending
    let tdrSlicePtA = null;        // first picked endpoint { lat, lon }
    let tdrLevel2Missing = false;  // mission has TDR but no QC'd level 2: control shown disabled

    const TDR_FIELD = 'reflectivity';
    const TDR_PRODUCT = 'xy';
    const TDR_SCAN_RADIUS_KM = 70;    // swath revealed around the aircraft as it flies the leg
    const TDR_BEAM_H = 26000 / 690;   // the aircraft beam rises well past the 18 km stack top
    const TDR_ZOOM_OUT_DIST = 110;    // camera distance that frames the ~500 km radar box
    let tdrPlaneBeam = null;          // tall white beam marking the aircraft inside the radar volume
    let tdrScratch = null;            // work canvas: ribbon intersected with footprint for the rescan erase
    let tdrAnyFetched = false;        // once TDR is in use, every remaining leg keeps preloading
    let tdrSliceMouse = null;         // live cursor geo while the cross-section pick is armed
    let tdrSliceLine = null;          // committed { A, B } endpoints, drawn while the modal is up
    let _tdrSliceRaf = false;         // one queued redraw at a time for the live pick line
    let tdrSectionOpen = false;       // the Overlays TDR section is unfolded: its rows need data, so fetching starts
    let tdrIntroDone = false;         // the once-per-flight fly-through over every leg has run
    let tdrAutoPicked = false;        // the first volume of this flight has preselected the view's layers
    let tdrSelectionIsAuto = false;   // the picked layers are still that automatic pick (no row, All, or None click since)
    let tdrCamFixed = false;          // the 3D camera is parked zoomed out over the radar's center
    let tdrCamReadyCount = 0;         // ready analyses the parked camera's center was computed from
    let tdrIntroRaf = 0;              // its animation frame handle, cancelled on a new flight
    let tdrLegPick = null;            // leg button pick: that analysis displays ALONE; null = all crossed legs
    let tdrEyeActive = false;         // within the picked leg: true shows its eye pass, false its whole span
    let tdrScanWall = null;           // vertical section wall riding the reveal frontier at the aircraft
    let _tdrScanWallSec = -1;         // last playhead second the wall painted for

    // tear down the overlay (new flight). meshes and their GPU resources are disposed, the picked
    // layers clear, and the TDR section hides until the next mission with TDR coverage.
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
        if (tdrCamFixed && typeof followAircraft3D !== 'undefined') followAircraft3D = true;
        tdrCamFixed = false; tdrCamReadyCount = 0;
        if (tdrPlaneBeam) {
            if (tdrPlaneBeam.geometry) tdrPlaneBeam.geometry.dispose();
            if (tdrPlaneBeam.material) tdrPlaneBeam.material.dispose();
            tdrPlaneBeam = null;
        }
        if (tdrGroup3D) {
            if (tdrGroup3D.parent) tdrGroup3D.parent.remove(tdrGroup3D);
            tdrGroup3D = null;
        }
        tdrAnalyses = []; tdrMissionId = ''; _tdrLastSec = 0;
        tdrSelectedKm.clear(); tdrCurrent = null; tdr2DImage = null; tdr2DBox = null; _tdr2DStamp = '';
        tdrSliceArm = 0; tdrSlicePtA = null; tdrSliceMouse = null; tdrSliceLine = null; setTdrSliceHint('');
        tdr2DOpacity = 0.85;
        const opSlReset = document.getElementById('tdr2dOpacitySlider'); if (opSlReset) opSlReset.value = 85;
        const opValReset = document.getElementById('tdr2dOpacityVal'); if (opValReset) opValReset.textContent = '85%';
        tdrLevel2Missing = false; tdrLegPick = null; tdrEyeActive = false;
        tdrAnyFetched = false;
        if (tdrIntroRaf) cancelAnimationFrame(tdrIntroRaf);
        tdrIntroDone = false; tdrAutoPicked = false; tdrSelectionIsAuto = false;
        if (tdrScanWall) {
            if (tdrScanWall.geometry) tdrScanWall.geometry.dispose();
            if (tdrScanWall.material) { if (tdrScanWall.material.map) tdrScanWall.material.map.dispose(); tdrScanWall.material.dispose(); }
            tdrScanWall = null;
        }
        _tdrScanWallSec = -1;
        bgNeedsUpdate = true;
        const grp = document.getElementById('tdrControlGroup'); if (grp) grp.style.display = 'none';
        const sk = document.getElementById('tdrPickerSkel'); if (sk) sk.style.display = 'none';
        const pb = document.getElementById('tdrPickerBtn');
        if (pb) {
            pb.disabled = false; pb.classList.remove('opacity-60'); pb.style.display = '';
            if (pb.dataset.defaultTitle) pb.title = pb.dataset.defaultTitle;
        }
        const sm = document.getElementById('tdrSliceModal'); if (sm) sm.style.display = 'none';
        tdrUpdateSliceButtons();
        updateTdrPickerBtn();
    }

    // folds the Overlays TDR section shut, for a mission whose radar is unavailable (its greyed
    // button cannot be clicked to fold it).
    function tdrFoldSection() {
        tdrSectionOpen = false;
        const body = document.getElementById('tdrExpandBody'); if (body) body.classList.add('hidden');
        const b = document.getElementById('tdrPickerBtn'); if (b) b.setAttribute('aria-expanded', 'false');
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
        // the section shimmers in the Overlays dropdown while the probe runs, resolving to its
        // button, instead of a button popping in from nowhere when the archive answers.
        const grp0 = document.getElementById('tdrControlGroup'); if (grp0) grp0.style.display = 'block';
        const skel0 = document.getElementById('tdrPickerSkel'); if (skel0) skel0.style.display = '';
        const pb0 = document.getElementById('tdrPickerBtn'); if (pb0) pb0.style.display = 'none';
        const tdrProbeResolve = hasTdr => {
            const sk = document.getElementById('tdrPickerSkel'); if (sk) sk.style.display = 'none';
            const pb = document.getElementById('tdrPickerBtn'); if (pb) pb.style.display = '';
            if (!hasTdr) {
                // No TDR for this mission: the button greys out instead of vanishing, so the
                // control reads as answered rather than missing.
                tdrLevel2Missing = true;   // holds the disabled state against updateTdrPickerBtn repaints
                tdrFoldSection();
                if (pb) {
                    if (!pb.dataset.defaultTitle) pb.dataset.defaultTitle = pb.title;
                    pb.disabled = true; pb.classList.add('opacity-60');
                    pb.title = 'No Tail Doppler Radar data exists for this mission.';
                }
                const pl = document.getElementById('tdrPickerBtnLabel'); if (pl) pl.textContent = 'TDR Unavailable';
            }
        };
        const gen = tdrGeneration;
        fetch(`${RECON_API_BASE}/v1/tdr/mission/${encodeURIComponent(id)}`, { headers: reconAuthHeaders() })
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(info => {
                if (gen !== tdrGeneration) return;
                tdrProbeResolve(true);
                // QC'd level 2 only: a level-1b-only mission surfaces the control disabled
                // instead of quietly rendering the unreviewed real-time product.
                if (!info.has_level2) {
                    tdrLevel2Missing = true;
                    tdrFoldSection();
                    const grp2 = document.getElementById('tdrControlGroup'); if (grp2) grp2.style.display = 'block';
                    const pb = document.getElementById('tdrPickerBtn');
                    if (pb) {
                        if (!pb.dataset.defaultTitle) pb.dataset.defaultTitle = pb.title;
                        pb.disabled = true; pb.classList.add('opacity-60');
                        pb.title = 'Only the real-time (level 1b) radar exists for this mission; the overlay uses quality-controlled level 2 data only.';
                    }
                    const pl = document.getElementById('tdrPickerBtnLabel'); if (pl) pl.textContent = 'TDR Unavailable';
                    return;
                }
                // Distinct analysis times from the level-2 xy files (the product this overlay
                // renders), else any level-2 file.
                let files = (info.files || []).filter(f => f.level === '2' && f.product === TDR_PRODUCT);
                if (!files.length) files = (info.files || []).filter(f => f.level === '2');
                const times = [...new Set(files.map(f => f.analysis_time).filter(Boolean))];
                if (!times.length) { tdrProbeResolve(false); return; }
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
                    legs.push({ s, e, label: tdrClock(l.start_time) + '-' + tdrClock(l.stop_time) + 'Z' });
                });
                tdrAnalyses = times.map(hhmm => {
                    const sec = hhmmToSec(hhmm);
                    const leg = legs.find(L => sec >= L.s && sec <= L.e);
                    // no matching leg: reveal in full at the analysis time (startSec === stopSec)
                    return { hhmm, sec, startSec: leg ? leg.s : sec, stopSec: leg ? leg.e : sec, legLabel: leg ? leg.label : tdrClock(hhmm) + 'Z', state: 'idle', mesh: null };
                }).sort((a, b) => a.sec - b.sec);
                // Legs abut exactly (leg 1 stops the second leg 2 starts), so landing on a leg's
                // end would immediately start the next leg's scan-and-erase and bite into the
                // finished analysis; a one-minute grace keeps each leg's end clean to inspect.
                for (let i = 1; i < tdrAnalyses.length; i++) {
                    if (tdrAnalyses[i].startSec <= tdrAnalyses[i - 1].stopSec) tdrAnalyses[i].startSec = tdrAnalyses[i - 1].stopSec + 60;
                }
                tdrMissionId = id;
                const grp = document.getElementById('tdrControlGroup'); if (grp) grp.style.display = 'block';
                // The flight may already be rendered and paused (shared links seek before this
                // resolves); kick the overlay once so fetching does not wait for a playback tick.
                updateTdr3D();
            })
            .catch(() => { if (gen === tdrGeneration) tdrProbeResolve(false); });
    }

    // an analysis HHMM as an HH:MM clock, for the leg time labels
    function tdrClock(hhmm) { return String(hhmm).slice(0, 2) + ':' + String(hhmm).slice(2, 4); }

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
        // Quantized copy of the whole volume (0 = no data, 1..255 across zmin..zmax) kept for
        // the scan wall, plus the horizontal any-data footprint the rescan erase clips to.
        const volU8 = new Uint8Array(levels.length * W * H);
        const spanZ = (vol.zmax - vol.zmin) || 1;
        const anyData = new Uint8Array(W * H);
        for (let li = 0; li < levels.length; li++) {
            const grid = vol.data[li] || [];
            for (let row = 0; row < H; row++) {
                const line = grid[row] || [];
                for (let col = 0; col < W; col++) {
                    const v = line[col];
                    if (v === null || v === undefined) continue;
                    const f = Math.max(0, Math.min(1, (v - vol.zmin) / spanZ));
                    volU8[li * W * H + row * W + col] = 1 + Math.round(f * 254);
                    anyData[row * W + col] = 1;
                }
            }
        }
        const footprint = document.createElement('canvas'); footprint.width = W; footprint.height = H;
        {
            const fctx = footprint.getContext('2d');
            const fimg = fctx.createImageData(W, H);
            for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
                if (!anyData[row * W + col]) continue;
                const o = (((H - 1 - row) * W) + col) * 4;
                fimg.data[o] = 255; fimg.data[o + 1] = 255; fimg.data[o + 2] = 255; fimg.data[o + 3] = 255;
            }
            fctx.putImageData(fimg, 0, 0);
        }
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
            // Nearest magnification keeps every 2 km radar cell a crisp cell instead of a smear.
            tex.magFilter = THREE.NearestFilter;
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
        return { group, levels: levelAssets, geo, maskCanvas, maskTex, volU8, footprint, stops, levelsKm: levels.slice(), gridW: W, gridH: H };
    }

    // The reveal frontier's section wall: a vertical plane at the aircraft, perpendicular to its
    // motion, painted with the just-revealed material a few km behind the frontier (nearest cell,
    // nothing derived), so the open edge of the scan reads as the volume's solid inside.
    function tdrEnsureScanWall(a) {
        if (tdrScanWall) return;
        const cv = document.createElement('canvas'); cv.width = 160; cv.height = a.levelsKm.length * 8;
        const tex = new THREE.CanvasTexture(cv);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.NearestFilter;
        const stepKm = a.levelsKm.length > 1 ? a.levelsKm[1] - a.levelsKm[0] : 0.5;
        const h = (a.levelsKm[a.levelsKm.length - 1] - a.levelsKm[0] + stepKm) * 1000 / 690;
        const w = (2 * TDR_SCAN_RADIUS_KM / 111.32) * 20;
        tdrScanWall = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide })
        );
        tdrScanWall.userData.cv = cv;
        tdrScanWall.userData.baseY = (a.levelsKm[0] - stepKm / 2) * 1000 / 690 + h / 2;
        tdrScanWall.userData.baseW = w;
        tdrScanWall.renderOrder = 6;
        tdrScanWall.visible = false;
    }
    function tdrPaintScanWall(a) {
        const row0 = filteredData[Math.max(0, currentIdx - 3)], row1 = filteredData[currentIdx];
        if (!row0 || !row1 || row1.lat == null || row1.lon == null || row0.lat == null || row0.lon == null) return false;
        const g = a.geo, W = a.gridW, H = a.gridH, L = a.levelsKm.length;
        const cellKm = (g.x1 - g.x0) / Math.max(1, W - 1);
        let mE = (row1.lon - row0.lon) / g.lonDegPerKm, mN = (row1.lat - row0.lat) / g.latDegPerKm;
        const mLen = Math.hypot(mE, mN);
        if (mLen < 0.01) return false;
        mE /= mLen; mN /= mLen;
        const pE = -mN, pN = mE;   // along the frontier, perpendicular to the motion
        const cE = (row1.lon - g.originLon) / g.lonDegPerKm, cN = (row1.lat - g.originLat) / g.latDegPerKm;
        const cv = tdrScanWall.userData.cv;
        const ctx2 = cv.getContext('2d');
        ctx2.clearRect(0, 0, cv.width, cv.height);
        const img = ctx2.createImageData(cv.width, L);
        let painted = false;
        for (let px = 0; px < cv.width; px++) {
            const s = (px / (cv.width - 1) - 0.5) * 2 * TDR_SCAN_RADIUS_KM;
            for (let li = 0; li < L; li++) {
                if (!tdrSelectedKm.has(a.levelsKm[li])) continue;
                let q = 0;
                for (let back = 1; back <= 9; back += 2) {   // just-revealed cells behind the frontier
                    const eK = cE + s * pE - back * mE, nK = cN + s * pN - back * mN;
                    const col = Math.round((eK - g.x0) / cellKm), rw = Math.round((nK - g.y0) / cellKm);
                    if (col < 0 || col >= W || rw < 0 || rw >= H) continue;
                    const qq = a.volU8[li * W * H + rw * W + col];
                    if (qq) { q = qq; break; }
                }
                if (!q) continue;
                const f = (q - 1) / 254;
                let lo = a.stops[0], hi = a.stops[a.stops.length - 1];
                for (let si = 0; si < a.stops.length - 1; si++) {
                    if (f >= a.stops[si].f && f <= a.stops[si + 1].f) { lo = a.stops[si]; hi = a.stops[si + 1]; break; }
                }
                const t2 = hi.f > lo.f ? (f - lo.f) / (hi.f - lo.f) : 0;
                const o = ((L - 1 - li) * cv.width + px) * 4;
                img.data[o] = Math.round(lo.r + (hi.r - lo.r) * t2);
                img.data[o + 1] = Math.round(lo.g + (hi.g - lo.g) * t2);
                img.data[o + 2] = Math.round(lo.b + (hi.b - lo.b) * t2);
                img.data[o + 3] = 245;
                painted = true;
            }
        }
        const tmp = document.createElement('canvas'); tmp.width = cv.width; tmp.height = L;
        tmp.getContext('2d').putImageData(img, 0, 0);
        ctx2.imageSmoothingEnabled = false;
        ctx2.drawImage(tmp, 0, 0, cv.width, cv.height);
        tdrScanWall.material.map.needsUpdate = true;
        // face the wall along the motion so its span lies on the frontier line
        tdrScanWall.userData.az = Math.atan2((row1.lon - row0.lon) * 20, -(row1.lat - row0.lat) * 20);
        // The painted content spans exactly +-TDR_SCAN_RADIUS_KM along the frontier; world units
        // per km depend on the frontier's direction (lon is stretched by 1/cos lat), so the mesh
        // scales to that direction's true ground span and lines up with the ribbon it fronts.
        const worldPerKm = 20 * Math.hypot(pE * g.lonDegPerKm, pN * g.latDegPerKm);
        tdrScanWall.userData.widthScale = (2 * TDR_SCAN_RADIUS_KM * worldPerKm) / tdrScanWall.userData.baseW;
        return painted;
    }

    function fetchTdrAnalysis(a) {
        tdrFetchActive = true;
        tdrAnyFetched = true;
        a.state = 'loading';
        updateTdrPickerBtn();
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
                    a.volU8 = assets.volU8; a.footprint = assets.footprint; a.stops = assets.stops;
                    a.levelsKm = assets.levelsKm; a.gridW = assets.gridW; a.gridH = assets.gridH;
                    a.maskStamp = 0; a.maskFull = false; a.lastStampSec = null; a._stampIdx = 0;
                    a.state = 'ready';
                    let autoPicked = false;
                    if (!tdrSelectedKm.size && !tdrAutoPicked) {
                        // the flight's first volume with nothing picked selects the view's default
                        // layers (tdrDefaultLevels), so the radar shows (and the fly-through can run)
                        // without a pick first. once per flight: a later None stays off as legs arrive.
                        tdrDefaultLevels(a.levels).forEach(km => tdrSelectedKm.add(km));
                        tdrAutoPicked = true; tdrSelectionIsAuto = true; autoPicked = true;
                    } else if (tdrSelectionIsAuto) {
                        // the automatic pick extends to the levels this leg adds
                        tdrDefaultLevels(a.levels).forEach(km => tdrSelectedKm.add(km));
                    } else if (tdrSelectedKm.size) {
                        // A later volume can carry data at levels the earlier analyses lacked
                        // (usually the very top of the column). While the selection still covers
                        // every data level seen so far, the new analysis's levels join it, so
                        // "all layers" stays all layers, keeping the top band selected once this
                        // analysis becomes current. A hand-trimmed selection covers only some levels,
                        // so it is left alone.
                        const others = tdrAnalyses.filter(x => x !== a && x.state === 'ready' && x.levels);
                        if (others.every(x => x.levels.every(l => !l.canvas || tdrSelectedKm.has(l.km))))
                            a.levels.forEach(l => { if (l.canvas) tdrSelectedKm.add(l.km); });
                    }
                    // a fresh auto-pick repaints the paused 2D map too, through the same path as a row click
                    if (autoPicked) tdrSelectionChanged(); else buildTdrHero();
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
                a.maskFull = false; a.floodedOnce = false; a.lastStampSec = null; a._stampIdx = 0;
                a._scanPath = null; a._scanGeo = null;
                a.maskTex.needsUpdate = true; a.maskStamp++;
                // This leg's rescan had punched holes in every EARLIER analysis; with the leg
                // now uncrossed those holes are stale, so earlier masks reset and reflood clean
                // on the next pass instead of showing a bitten-up analysis.
                for (const b of tdrAnalyses) {
                    if (b === a || b.state !== 'ready' || !b.maskCanvas || b.sec >= a.sec) continue;
                    b.maskCtx.clearRect(0, 0, b.maskCanvas.width, b.maskCanvas.height);
                    b.maskFull = false; b.floodedOnce = false; b.lastStampSec = null; b._stampIdx = 0;
                    b._scanPath = null; b._scanGeo = null;
                    b.maskTex.needsUpdate = true; b.maskStamp++;
                }
            }
            return;
        }
        if (t >= a.stopSec) {
            // floodedOnce, not maskFull, guards the flood: a LATER leg's rescan erases holes in
            // this mask (clearing maskFull), and those holes must not reflood back to white.
            if (!a.floodedOnce) {
                a.maskCtx.fillStyle = '#fff';
                a.maskCtx.fillRect(0, 0, a.maskCanvas.width, a.maskCanvas.height);
                a.maskFull = true; a.floodedOnce = true; a.lastStampSec = t;
                a.maskTex.needsUpdate = true; a.maskStamp++;
            }
            return;
        }
        if (a.maskFull || a.floodedOnce || (a.lastStampSec !== null && t < a.lastStampSec)) {   // slid back inside the leg: rebuild
            a.maskCtx.clearRect(0, 0, a.maskCanvas.width, a.maskCanvas.height);
            a.maskFull = false; a.floodedOnce = false; a._stampIdx = 0;
            a._scanPath = null; a._scanGeo = null;
        }
        const g = a.geo, ctx2 = a.maskCtx;
        const cellKm = (g.x1 - g.x0) / Math.max(1, a.maskCanvas.width - 1);
        const rCells = TDR_SCAN_RADIUS_KM / Math.max(0.1, cellKm);
        // The TDR scans a vertical plane perpendicular to the track, so the reveal is LINEAR: a
        // butt-capped stroke along the flown path uncovers a flat-ended ribbon +-70 km to each
        // side, its leading edge a straight line through the aircraft, never ahead of it.
        // The WHOLE flown path restrokes as ONE stroke every tick (cheap on a 250px mask):
        // stroking only the new segment left a butt-cap seam at every tick boundary, which read
        // as hairline missing lines across the crisp 2D composite.
        if (!a._scanPath) { a._scanPath = []; a._scanGeo = []; }
        let stamped = false;
        for (let i = a._stampIdx; i < filteredData.length; i++) {
            const row = filteredData[i];
            if (row.absSeconds > t) break;
            a._stampIdx = i;
            if (row.absSeconds < a.startSec || row.lat == null || row.lon == null) continue;
            const px = (row.lon - g.originLon) / g.lonDegPerKm, py = (row.lat - g.originLat) / g.latDegPerKm;
            a._scanPath.push({ col: (px - g.x0) / cellKm, cy: (a.maskCanvas.height - 1) - (py - g.y0) / cellKm });
            a._scanGeo.push({ lat: row.lat, lon: row.lon });
            stamped = true;
        }
        a.lastStampSec = t;
        if (stamped && a._scanPath.length > 1) {
            ctx2.strokeStyle = '#fff';
            ctx2.lineWidth = rCells * 2;
            ctx2.lineCap = 'butt';
            ctx2.lineJoin = 'round';
            ctx2.beginPath();
            a._scanPath.forEach((p, i2) => { if (i2 === 0) ctx2.moveTo(p.col, p.cy); else ctx2.lineTo(p.col, p.cy); });
            ctx2.stroke();
            a.maskTex.needsUpdate = true; a.maskStamp++;
        }
        // A re-flown area holds only the LATEST radar, but old data is punched out ONLY where
        // the new analysis actually has data (otherwise the old leg vanishes before anything
        // replaces it): the ribbon is intersected with the new volume's footprint on a scratch
        // canvas, then mapped into each earlier analysis's grid (same 2 km cells, different
        // origin, so one affine drawImage) and erased there. The full path erases every tick for
        // the same seam-free reason as the reveal; repeating a destination-out is idempotent.
        if (stamped && a._scanGeo.length > 1) {
            const W2 = a.maskCanvas.width, H2 = a.maskCanvas.height;
            if (!tdrScratch) tdrScratch = document.createElement('canvas');
            tdrScratch.width = W2; tdrScratch.height = H2;   // re-assigning also clears it
            const sctx = tdrScratch.getContext('2d');
            sctx.strokeStyle = '#fff';
            sctx.lineWidth = rCells * 2;
            sctx.lineCap = 'butt';
            sctx.lineJoin = 'round';
            sctx.beginPath();
            a._scanGeo.forEach((p, i2) => {
                const sx = ((p.lon - g.originLon) / g.lonDegPerKm - g.x0) / cellKm;
                const sy = (H2 - 1) - ((p.lat - g.originLat) / g.latDegPerKm - g.y0) / cellKm;
                if (i2 === 0) sctx.moveTo(sx, sy); else sctx.lineTo(sx, sy);
            });
            sctx.stroke();
            if (a.footprint) {
                sctx.globalCompositeOperation = 'destination-in';
                sctx.drawImage(a.footprint, 0, 0);
                sctx.globalCompositeOperation = 'source-over';
            }
            for (const b of tdrAnalyses) {
                if (b === a || b.state !== 'ready' || !b.maskCanvas || b.sec >= a.sec) continue;
                const bg = b.geo, bctx = b.maskCtx;
                const cellB = (bg.x1 - bg.x0) / Math.max(1, b.maskCanvas.width - 1);
                const sxr = (cellKm * g.lonDegPerKm) / (cellB * bg.lonDegPerKm);
                const dx = ((g.originLon - bg.originLon) / bg.lonDegPerKm + g.x0 * (g.lonDegPerKm / bg.lonDegPerKm) - bg.x0) / cellB;
                const syr = cellKm / cellB;
                const dy = (b.maskCanvas.height - 1) * (1 - syr) - ((g.originLat - bg.originLat) / bg.latDegPerKm + g.y0 - bg.y0) / cellB;
                bctx.save();
                bctx.globalCompositeOperation = 'destination-out';
                bctx.drawImage(tdrScratch, dx, dy, tdrScratch.width * sxr, tdrScratch.height * syr);
                bctx.restore();
                b.maskFull = false;
                b.maskTex.needsUpdate = true; b.maskStamp++;
            }
        }
    }

    // Per-frame driver, called from updateVisualComponents with the playhead's absSeconds.
    // Drives BOTH surfaces: the 3D progressive column stack (each analysis appears at its leg
    // start and scans in as the aircraft flies it) and the 2D picker overlay (current analysis,
    // picked levels, same scan mask). Fetching runs one volume at a time, once layers are picked or
    // the TDR section is unfolded.
    // geographic and world-space centers of everything the radar recorded so far
    function tdrCenterGeo() {
        const ready = tdrAnalyses.filter(x => x.state === 'ready' && x.geo);
        if (!ready.length) return null;
        let sLon = 0, sLat = 0;
        ready.forEach(x => {
            const g = x.geo;
            sLon += g.originLon + ((g.x0 + g.x1) / 2) * g.lonDegPerKm;
            sLat += g.originLat + ((g.y0 + g.y1) / 2) * g.latDegPerKm;
        });
        return { lon: sLon / ready.length, lat: sLat / ready.length };
    }
    function tdrCenterWorld() {
        const c = tdrCenterGeo();
        return c ? get3DCoord(c.lon, c.lat, 0) : null;
    }
    // moves the orbit target over the radar's center. the first move looks nearly straight down
    // from overhead (the slight lateral offset keeps the orbit controls stable at the pole); later
    // moves, as more legs load, shift the target but keep the user's view direction.
    function tdrCamPark(overhead) {
        if (typeof camera3D === 'undefined' || !camera3D || typeof controls3D === 'undefined' || !controls3D) return;
        const c = tdrCenterWorld();
        if (!c) return;
        // target the stack's mid altitude (9 of 18 km), not the ground, so the upper layers stay
        // in frame instead of clipping off the top of the view
        c.y = 9000 / 690;
        if (overhead) {
            camera3D.position.set(c.x, c.y + TDR_ZOOM_OUT_DIST * 0.96, c.z + TDR_ZOOM_OUT_DIST * 0.28);
        } else {
            const off = camera3D.position.clone().sub(controls3D.target);
            const dist = off.length() || 1;
            if (dist < TDR_ZOOM_OUT_DIST) off.multiplyScalar(TDR_ZOOM_OUT_DIST / dist);
            camera3D.position.copy(c).add(off);
        }
        controls3D.target.copy(c);
        controls3D.update();
        tdrCamReadyCount = tdrAnalyses.filter(x => x.state === 'ready').length;
    }

    function updateTdr3D(nowSec) {
        if (nowSec !== undefined) _tdrLastSec = nowSec;
        if (!tdrAnalyses.length || typeof THREE === 'undefined') return;
        const in3d = typeof trackerModeSelect !== 'undefined' && trackerModeSelect.value === '3d';
        // the radar draws only while layers are picked, on whichever tracker is showing.
        const show3D = in3d && tdrSelectedKm.size > 0;
        if (tdrGroup3D) tdrGroup3D.visible = show3D;
        if (show3D && typeof threeDInitialized !== 'undefined' && threeDInitialized && typeof threeMapGroup !== 'undefined') {
            if (!tdrGroup3D) tdrGroup3D = new THREE.Group();
            // build3DScene empties threeMapGroup on every rebuild; re-adopting the group brings
            // the whole accumulated mosaic back with it.
            if (tdrGroup3D.parent !== threeMapGroup) threeMapGroup.add(tdrGroup3D);
            // The picker is the ONE control: only picked bands draw, in 3D as in 2D, and None
            // shows nothing. A large stack goes near-transparent per plane so the middle of the
            // volume reads through; a small selection draws denser.
            const planeOpacity = tdrSelectedKm.size > 6 ? 0.2 : 0.5;
            for (const a of tdrAnalyses) {
                if (a.state === 'ready' && a.mesh) {
                    if (a.mesh.parent !== tdrGroup3D) tdrGroup3D.add(a.mesh);
                    a.mesh.visible = tdrSelectedKm.size > 0 && _tdrLastSec >= a.startSec && (!tdrLegPick || tdrLegPick === a);
                    for (const child of a.mesh.children) {
                        child.visible = tdrSelectedKm.has(child.userData.km);
                        child.material.opacity = planeOpacity;
                    }
                }
            }
            const anyShown = tdrSelectedKm.size > 0 && tdrAnalyses.some(x => x.state === 'ready' && _tdrLastSec >= x.startSec);
            // Section wall on the scan frontier: while a leg actively scans, its open edge at the
            // aircraft draws the volume's inside instead of exposing the stacked planes.
            const scanning = tdrSelectedKm.size ? tdrAnalyses.find(x => x.state === 'ready' && _tdrLastSec >= x.startSec && _tdrLastSec < x.stopSec && (!tdrLegPick || tdrLegPick === x)) : null;
            if (scanning) {
                tdrEnsureScanWall(scanning);
                if (tdrScanWall.parent !== tdrGroup3D) tdrGroup3D.add(tdrScanWall);
                let ok = tdrScanWall.visible;
                if (_tdrScanWallSec !== _tdrLastSec) {
                    ok = tdrPaintScanWall(scanning);
                    _tdrScanWallSec = _tdrLastSec;
                }
                tdrScanWall.visible = !!ok;
                if (ok && typeof planeGroup3D !== 'undefined' && planeGroup3D) {
                    tdrScanWall.position.set(planeGroup3D.position.x, tdrScanWall.userData.baseY, planeGroup3D.position.z);
                    if (tdrScanWall.userData.az !== undefined) tdrScanWall.rotation.y = tdrScanWall.userData.az;
                    tdrScanWall.scale.x = tdrScanWall.userData.widthScale || 1;
                }
            } else if (tdrScanWall) tdrScanWall.visible = false;
            // Tall white beam through the full level stack at the aircraft, so its place inside
            // the radar volume reads at a glance.
            if (!tdrPlaneBeam) {
                tdrPlaneBeam = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.06, 0.06, TDR_BEAM_H, 12, 1, true),
                    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide })
                );
                tdrPlaneBeam.renderOrder = 6;
                tdrGroup3D.add(tdrPlaneBeam);
            }
            if (tdrPlaneBeam.parent !== tdrGroup3D) tdrGroup3D.add(tdrPlaneBeam);
            tdrPlaneBeam.visible = anyShown;
            if (anyShown && typeof planeGroup3D !== 'undefined' && planeGroup3D) {
                tdrPlaneBeam.position.set(planeGroup3D.position.x, TDR_BEAM_H / 2, planeGroup3D.position.z);
            }
            // camera: while the radar shows in 3D the view moves zoomed out over the radar's center,
            // looking down, with aircraft follow off. as more legs load the view re-centers, keeping
            // the user's orbit direction, unless Recenter put the view back on the aircraft.
            const anyReady = tdrAnalyses.some(x => x.state === 'ready');
            if (anyReady && !tdrCamFixed) {
                tdrCamFixed = true;
                if (typeof followAircraft3D !== 'undefined') followAircraft3D = false;
                tdrCamPark(true);
                if (typeof updateFollowButton === 'function') updateFollowButton();
            } else if (anyReady && tdrCamFixed && !(typeof followAircraft3D !== 'undefined' && followAircraft3D)
                       && tdrAnalyses.filter(x => x.state === 'ready').length !== tdrCamReadyCount) {
                tdrCamPark(false);
            }
        } else if (tdrCamFixed) {
            // the radar went off (None) or the view left 3D: back to the normal view following the aircraft
            tdrCamFixed = false; tdrCamReadyCount = 0;
            if (typeof reset3DView === 'function') reset3DView();
            if (typeof followAircraft3D !== 'undefined') followAircraft3D = true;
            if (typeof updateFollowButton === 'function') updateFollowButton();
        }
        // Scan masks update NEWEST leg first: a backward jump makes a later leg's uncross reset
        // wipe every earlier mask, and the earlier legs must decide their reflood AFTER that
        // wipe. In flight order the flood ran first and the wipe left the mask blank until the
        // next tick, which never came while paused (a leg-button pick needed a second click).
        for (let i = tdrAnalyses.length - 1; i >= 0; i--) { if (tdrAnalyses[i].state === 'ready') updateTdrScan(tdrAnalyses[i]); }
        updateTdr2D();
        // Once TDR is in use every remaining leg keeps preloading even if the selection is
        // cleared mid-flight, so the next leg's data is always in hand when the aircraft
        // reaches it.
        const wantData = tdrSectionOpen || tdrSelectedKm.size > 0 || tdrAnyFetched;
        if (wantData && !tdrFetchActive) {
            // Every leg preloads: the current one first, then the rest in flight order, so a
            // leg transition never waits on a download.
            let next = tdrAnalyses.find(x => x.state === 'idle' && _tdrLastSec >= x.startSec);
            if (!next) next = tdrAnalyses.find(x => x.state === 'idle');
            if (next) fetchTdrAnalysis(next);
        }
        if (!tdrIntroDone) tdrIntroSweep();
    }

    // 2D picker overlay
    // The current analysis is the newest one the playhead has crossed (falling back to the first
    // fetched one so the panel works before the radar section); the picked altitude levels
    // composite bottom-up onto one canvas that renderBackground (js/15-map-render.js) draws over
    // the basemap at tdr2DOpacity, boxed by the analysis's own storm-center origin.
    function updateTdr2D() {
        let cur = null;
        for (const a of tdrAnalyses) { if (a.state === 'ready' && _tdrLastSec >= a.sec) cur = a; }
        if (!cur) cur = tdrAnalyses.find(a => a.state === 'ready') || null;
        if (tdrLegPick && tdrLegPick.state === 'ready') cur = tdrLegPick;   // a picked leg is THE analysis everywhere
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
        c2.globalAlpha = 0.8;   // combined levels read through each other
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
    // NOMINAL pressure for a level, via the inverse of the standard-atmosphere formula the parser
    // uses for pressure altitude, so the band labels line up with the app's own altitude convention.
    //
    // IMPORTANT: the radar levels are GEOMETRIC altitudes (km MSL) on the analysis grid, not pressure
    // surfaces. This maps them through the ISA with a fixed 1013.25 mb sea level, which is exactly the
    // atmosphere a tropical cyclone is not: a warm core and a depressed central pressure displace the
    // real surfaces off this mapping, by more the deeper the storm. So the mb figures are a
    // standard-atmosphere LABEL for a geometric level, never a measured or analysed pressure. Every
    // place they are shown says so (the band rows carry the level's km span and a std-atm note), and
    // tdrFt above stays the honest primary label.
    function tdrMb(km) { return 1013.25 * Math.pow(Math.max(0.0001, 1 - (km * 1000) / 44307.69), 1 / 0.190284); }

    // The picker groups the half-km radar levels into standard-atmosphere pressure bands (top of the
    // list is the top of the atmosphere); one row toggles every member level at once. `label` is the
    // band's nominal pressure span, `alt` the geometric altitude span it actually selects, which is
    // what the grid is really indexed by. The bottom band runs to 1060 so a level at or below sea
    // level (1013.25 mb at 0 km) still lands in it; its label says so rather than reading 900-1000.
    const TDR_BANDS = [
        { pMin: 0, pMax: 100, label: 'Under 100 mb', alt: 'above 15.8 km' },
        { pMin: 100, pMax: 200, label: '100-200 mb', alt: '11.8-15.8 km' },
        { pMin: 200, pMax: 300, label: '200-300 mb', alt: '9.2-11.8 km' },
        { pMin: 300, pMax: 400, label: '300-400 mb', alt: '7.2-9.2 km' },
        { pMin: 400, pMax: 500, label: '400-500 mb', alt: '5.6-7.2 km' },
        { pMin: 500, pMax: 600, label: '500-600 mb', alt: '4.2-5.6 km' },
        { pMin: 600, pMax: 700, label: '600-700 mb', alt: '3.0-4.2 km' },
        { pMin: 700, pMax: 800, label: '700-800 mb', alt: '2.0-3.0 km' },
        { pMin: 800, pMax: 900, label: '800-900 mb', alt: '1.0-2.0 km' },
        { pMin: 900, pMax: 1060, label: '900 mb and below', alt: '0-1.0 km' }
    ];
    // One row's hover text. Names what the band actually selects (geometric radar levels) and that the
    // millibars are a standard-atmosphere label for them, not an analysed pressure.
    function tdrBandTitle(b) {
        return b.label + ': radar levels at ' + b.alt + ' geometric altitude. Millibar figures are a '
             + 'standard-atmosphere (1013.25 mb sea level) label for those altitudes, not a measured or '
             + 'analysed pressure; a storm' + '\u2019' + 's actual pressure surfaces are at different heights.';
    }

    // the automatic layer pick for the view showing: every layer with data in 3D, and on the 2D map
    // only 500 mb and below (about 0 to 5.6 km), the lower layers where storm centers read clearly
    function tdrDefaultLevels(levels) {
        const in2d = typeof trackerModeSelect !== 'undefined' && trackerModeSelect.value === '2d';
        return (levels || []).filter(l => l.canvas && (!in2d || tdrMb(l.km) >= 500)).map(l => l.km);
    }
    // re-applies that pick across every loaded leg, after a switch between 2D and 3D
    function tdrApplyDefaultSelection() {
        tdrSelectedKm.clear();
        tdrAnalyses.forEach(x => { if (x.state === 'ready') tdrDefaultLevels(x.levels).forEach(km => tdrSelectedKm.add(km)); });
    }

    function tdrBandMembers(ref, band) {
        return ref.levels.filter(l => { const p = tdrMb(l.km); return p >= band.pMin && p < band.pMax; });
    }

    function updateTdrPickerBtn() {
        if (tdrLevel2Missing) return;   // the button holds its disabled "TDR Unavailable" state
        const lbl = document.getElementById('tdrPickerBtnLabel'), btn = document.getElementById('tdrPickerBtn');
        if (!lbl) return;
        // while the first volume downloads the section header shows TDR Loading..., so its rows never
        // read as ready before any layer can display.
        const loading = !tdrAnalyses.some(x => x.state === 'ready') && (tdrFetchActive || tdrAnyFetched);
        lbl.textContent = loading ? 'TDR Loading...' : 'TDR';
        if (btn) btn.classList.toggle('opacity-60', loading);
        // the loading ring over the skeleton layer rows shows while that first volume downloads
        const grp = document.getElementById('tdrControlGroup'); if (grp) grp.classList.toggle('tdr-is-loading', loading);
        // the Overlays button lights while any overlay draws, the radar included
        if (typeof updateSatPickerButton === 'function') updateSatPickerButton();
    }

    // The closest approach to the storm center on a leg: the single frame where the aircraft is nearest
    // it, and only when that leg comes near at all (not a distant transit leg). Nearest is not
    // necessarily an eye penetration; the 55 km gate below is an eye/eyewall-scale bound, not proof. The center is the radar
    // volume's storm-relative origin once the leg is loaded (precise), else the interpolated best-track
    // position. Returns a 0-or-1 element array of { idx } (one leg, at most one pass).
    function tdrLegEyePasses(a) {
        if (!a || !filteredData.length) return [];
        const staticC = (a.geo && isFinite(a.geo.originLat) && isFinite(a.geo.originLon)) ? { lat: a.geo.originLat, lon: a.geo.originLon } : null;
        const haveTrack = typeof interpStormCenter === 'function' && typeof flightMetaData !== 'undefined' && flightMetaData.date !== 'Unknown';
        if (!staticC && !haveTrack) return [];
        const dayMs = staticC ? 0 : new Date(flightMetaData.date + 'T00:00:00Z').getTime();
        let bestIdx = -1, bestKm = Infinity;
        for (let i = 0; i < filteredData.length; i++) {
            const r = filteredData[i];
            if (r.absSeconds < a.startSec || r.absSeconds > a.stopSec) continue;
            let cLat, cLon;
            if (staticC) { cLat = staticC.lat; cLon = staticC.lon; }
            else { const est = interpStormCenter(dayMs + r.absSeconds * 1000); if (!est) continue; cLat = est.lat; cLon = est.lon; }
            const dN = (r.lat - cLat) * 111.32;
            const dE = (r.lon - cLon) * 111.32 * Math.cos(cLat * Math.PI / 180);
            const km = Math.sqrt(dN * dN + dE * dE);
            if (km < bestKm) { bestKm = km; bestIdx = i; }
        }
        return (bestIdx >= 0 && bestKm <= 55) ? [{ idx: bestIdx }] : [];   // 55 km: a pass through the eye/eyewall
    }

    // The panel's level column: the pressure bands laid out top-down (highest altitude first),
    // one clickable row per band, dimmed when the current analysis has no data anywhere in it.
    function buildTdrHero() {
        // Leg picker: one row per analysis, each carrying any of its eye-pass buttons (jumps to where
        // the aircraft crossed the storm center) linked to the leg by a connector line.
        const legRow = document.getElementById('tdrLegRow');
        if (legRow) {
            legRow.innerHTML = '';
            // Show only legs the radar covers: an analysis that errored out, or that finished loading
            // with no drawable level, is dropped. Legs still loading stay (their coverage is still
            // pending), and the shown legs renumber contiguously so they run in sequence.
            const shownLegs = tdrAnalyses.filter(a => a.state !== 'error' && !(a.state === 'ready' && !(a.levels && a.levels.some(l => l.canvas))));
            // on the 2D map exactly one analysis is on screen, so its leg button highlights even
            // without an explicit pick (tdrCurrent is what draws).
            const in2dNow = tdrSelectedKm.size > 0 && typeof trackerModeSelect !== 'undefined' && trackerModeSelect.value === '2d';
            shownLegs.forEach((a, i) => {
                const group = document.createElement('div');
                group.className = 'tdr-leg-group';
                const passes = tdrLegEyePasses(a);
                const legBtn = document.createElement('button');
                legBtn.className = 'tdr-leg-btn';
                // the leg's number and time window, so a leg reads against the playback clock
                legBtn.textContent = 'Leg ' + (i + 1) + ' \u00b7 ' + a.legLabel;
                legBtn.title = (tdrLegPick === a ? 'Click again to show all legs' : 'Show only this leg, at its end') + (a.state === 'ready' ? '' : ' (loads on jump)');
                // The leg button lights while its whole span is shown; the eye-pass button lights while
                // its pass is shown. In the 2D display the on-screen analysis lights even without a pick.
                const legOn = (tdrLegPick === a && !tdrEyeActive) || (in2dNow && !tdrLegPick && tdrCurrent === a);
                if (legOn) legBtn.classList.add('on');
                legBtn.addEventListener('click', () => {
                    if (!filteredData.length || (typeof syncLockActive === 'function' && syncLockActive())) return;
                    if (tdrLegPick === a && !tdrEyeActive) { tdrLegPick = null; buildTdrHero(); updateTdr3D(); return; }
                    tdrLegPick = a; tdrEyeActive = false;   // show this leg's whole span
                    let idx = filteredData.findIndex(r => r.absSeconds >= a.stopSec);   // its end, where its radar is complete
                    if (idx < 0) idx = filteredData.length - 1;
                    currentIdx = idx;
                    tdrSeekVideo(true);
                    if (typeof updateVisualComponents === 'function') updateVisualComponents(currentIdx);
                    buildTdrHero();
                });
                group.appendChild(legBtn);
                // the eye jump is its own action at the row's right end, styled apart from the time
                // button, so it reads as a separate control rather than part of the leg
                if (passes.length) {
                    passes.forEach((p) => {
                        const eb = document.createElement('button');
                        eb.className = 'tdr-eye-btn';
                        eb.textContent = 'Jump to Eye';
                        eb.title = "Jump to this leg's closest approach to the storm center (within 55 km). "
                                 + "The center is the radar volume's own origin once the leg has loaded, otherwise a "
                                 + 'position interpolated between the 6-hourly best-track fixes.';
                        if (tdrLegPick === a && tdrEyeActive) eb.classList.add('on');
                        eb.addEventListener('click', () => {
                            if (!filteredData.length || (typeof syncLockActive === 'function' && syncLockActive())) return;
                            tdrLegPick = a; tdrEyeActive = true;   // show this leg, parked on its eye pass
                            currentIdx = p.idx;
                            tdrSeekVideo(true);
                            if (typeof updateVisualComponents === 'function') updateVisualComponents(currentIdx);
                            buildTdrHero();
                        });
                        group.appendChild(eb);
                    });
                }
                legRow.appendChild(group);
            });
        }
        const list = document.getElementById('tdrLevelHero');
        if (!list) return;
        const ref = tdrCurrent || tdrAnalyses.find(a => a.state === 'ready');
        list.innerHTML = '';
        if (!ref || !ref.levels) {
            if (!tdrAnalyses.length || tdrAnalyses.every(x => x.state === 'error')) {
                const d = document.createElement('div');
                d.className = 'tdr-hero-note';
                if (tdrAnalyses.length) {
                    d.textContent = 'Radar data failed to load. Click here to retry.';
                    d.style.cursor = 'pointer';
                    d.addEventListener('click', () => {
                        tdrAnalyses.forEach(x => { if (x.state === 'error') x.state = 'idle'; });
                        buildTdrHero();
                        updateTdr3D();
                    });
                } else d.textContent = 'No radar analyses for this flight.';
                list.appendChild(d);
                return;
            }
            // first volume still downloading: one gray pulsing skeleton row per standard band, not
            // clickable, so nothing invites a click that cannot show anything yet
            TDR_BANDS.forEach(() => {
                const row = document.createElement('div');
                row.className = 'tdr-level-row tdr-skel-row';
                row.title = 'Loading radar data...';
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
            row.title = tdrBandTitle(b);
            row.innerHTML = '<span class="tdr-level-ft">' + b.label + '<span class="tdr-level-alt">' + b.alt + '</span></span><span class="tdr-level-bar"></span>';
            row.addEventListener('click', () => {
                if (!withData.length) return;
                const turnOff = withData.every(m => tdrSelectedKm.has(m.km));
                withData.forEach(m => { if (turnOff) tdrSelectedKm.delete(m.km); else tdrSelectedKm.add(m.km); });
                tdrSelectionIsAuto = false;
                tdrSelectionChanged();
            });
            list.appendChild(row);
        });
    }

    // after any change to the picked layers (a row, All, None): rebuild the section's rows, the radar
    // (3D stack and 2D composite), and repaint the 2D map, which otherwise waits for the next frame
    // and shows nothing new while playback is paused
    function tdrSelectionChanged() {
        buildTdrHero();
        updateTdr3D();
        if (typeof renderMapEngineFrame === 'function' && filteredData.length && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
    }

    // moves the MMR video to the playhead the way the timeline does (js/09-interaction.js): a
    // continuous move pumps seeks so the picture keeps up, and the end of a move or a jump also has
    // Auto-Sync recheck the burned-in clock there.
    function tdrSeekVideo(final) {
        if (typeof videoLoaded === 'undefined' || !videoLoaded || !filteredData[currentIdx]) return;
        let vt = Math.max(0, filteredData[currentIdx].absSeconds - videoStartSeconds);
        if (video.duration) vt = Math.min(vt, video.duration);
        if (typeof pumpScrubSeek === 'function') pumpScrubSeek(vt); else video.currentTime = vt;
        if (final && typeof scheduleOcrRecheck === 'function') scheduleOcrRecheck();
    }

    // A 4-second fly-through over every radar leg, once per flight, the first time the radar shows
    // with every leg downloaded: the radar scans in as the playhead crosses each leg, so the loaded
    // data is visible at once. Playback pauses for it. The MMR video follows through tdrSeekVideo and
    // the satellite through updateVisualComponents. Scrubbing, playing, picking a leg, or None stops
    // it; while an MMR sync has the timeline locked, it starts only once that sync finishes.
    function tdrIntroSweep() {
        if (tdrIntroDone || !tdrSelectedKm.size || !tdrAnalyses.length || !filteredData.length) return;
        if (tdrAnalyses.some(x => x.state === 'idle' || x.state === 'loading')) return;   // every leg downloads first
        if (!tdrAnalyses.some(x => x.state === 'ready')) return;
        if (typeof isScrubbing !== 'undefined' && isScrubbing) return;
        if ((typeof syncLockActive === 'function' && syncLockActive()) || (typeof isOcrRunning !== 'undefined' && isOcrRunning)) return;
        tdrIntroDone = true;
        if (typeof isPlaying !== 'undefined' && isPlaying) {
            isPlaying = false;
            if (typeof videoLoaded !== 'undefined' && videoLoaded) video.pause();
            if (typeof playPauseBtn !== 'undefined' && playPauseBtn) playPauseBtn.innerText = 'Play';
        }
        const t0 = tdrAnalyses[0].startSec;
        const tEnd = tdrAnalyses[tdrAnalyses.length - 1].stopSec + 60;
        const begun = performance.now();
        const gen = tdrGeneration;
        let cursor = 0;
        const step = now => {
            if (gen !== tdrGeneration) return;
            if ((typeof isScrubbing !== 'undefined' && isScrubbing) || (typeof isPlaying !== 'undefined' && isPlaying) || tdrLegPick || !tdrSelectedKm.size) return;
            const f = Math.min(1, (now - begun) / 4000);
            const target = t0 + (tEnd - t0) * f;
            while (cursor < filteredData.length - 1 && filteredData[cursor].absSeconds < target) cursor++;
            if (cursor !== currentIdx) {
                currentIdx = cursor;
                tdrSeekVideo(false);
                if (typeof updateVisualComponents === 'function') updateVisualComponents(currentIdx);
            }
            if (f < 1) tdrIntroRaf = requestAnimationFrame(step);
            else tdrSeekVideo(true);
        };
        tdrIntroRaf = requestAnimationFrame(step);
    }

    // cross-section (top-down pick on the 2D map, rendered by /v1/tdr/plane_slice)
    function setTdrSliceHint(t) {
        const el = document.getElementById('tdrSliceHint');
        if (el) { el.textContent = t; el.style.display = t ? 'block' : 'none'; }
    }

    // the section's 2D-only controls: the cross-section button reads Draw a Cross-Section, or Cancel
    // Cross-Section while a pick is armed, and greys out in 3D; the TDR opacity row (the slider only
    // affects the 2D composite) hides in 3D.
    function tdrUpdateSliceButtons() {
        const in2d = typeof trackerModeSelect !== 'undefined' && trackerModeSelect.value === '2d';
        const ab = document.getElementById('tdrSliceAgainBtn');
        if (ab) {
            ab.disabled = !in2d;
            ab.textContent = tdrSliceArm ? 'Cancel Cross-Section' : 'Draw a Cross-Section';
            ab.title = in2d ? 'Click two points on the 2D map to draw a vertical cross-section of the radar'
                            : 'Draw a cross-section (only 2D)';
        }
        const or = document.getElementById('tdrOpacityRow');
        if (or) or.style.display = in2d ? '' : 'none';
    }
    // drops an armed pick (the button or the Esc key) and clears its feedback from the map.
    function tdrCancelSlicePick() {
        tdrSliceArm = 0; tdrSlicePtA = null; tdrSliceMouse = null;
        setTdrSliceHint('');
        tdrUpdateSliceButtons();
        if (typeof renderMapEngineFrame === 'function' && filteredData.length && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
    }
    // A section endpoint only counts where the radar has scanned in: sample the current
    // analysis's reveal mask at the picked spot (a flooded mask short-circuits).
    function tdrRevealedAt(geo) {
        const cur = tdrCurrent;
        if (!cur || !cur.geo || !cur.maskCtx || !cur.maskCanvas) return false;
        if (cur.maskFull) return true;
        const g = cur.geo;
        const cellKm = (g.x1 - g.x0) / Math.max(1, cur.maskCanvas.width - 1);
        const eK = (geo.lon - g.originLon) / g.lonDegPerKm, nK = (geo.lat - g.originLat) / g.latDegPerKm;
        const col = Math.round((eK - g.x0) / cellKm), row = Math.round((nK - g.y0) / cellKm);
        if (col < 0 || col >= cur.maskCanvas.width || row < 0 || row >= cur.maskCanvas.height) return false;
        try { return cur.maskCtx.getImageData(col, (cur.maskCanvas.height - 1) - row, 1, 1).data[3] >= 128; } catch (e) { return false; }
    }

    // Consumes 2D map clicks while armed; returns true when the click was taken.
    function tdrSliceMapClick(geo) {
        if (!tdrSliceArm || !geo) return false;
        if (!tdrRevealedAt(geo)) {
            setTdrSliceHint('The radar has not scanned that spot yet. Play further into the leg, or pick inside the shown radar.');
            setTimeout(() => { if (tdrSliceArm) setTdrSliceHint('Click two points to draw a cross-section. Drag to move the map.'); }, 3500);
            return true;   // consumed; the pick stays armed
        }
        if (tdrSliceArm === 1) {
            tdrSlicePtA = { lat: geo.lat, lon: geo.lon };
            tdrSliceArm = 2;
            return true;
        }
        tdrSliceArm = 0;
        const B = { lat: geo.lat, lon: geo.lon };
        tdrSliceLine = { A: tdrSlicePtA, B };   // stays drawn on the map while the modal is up
        fetchTdrSlice(tdrSlicePtA, B);
        tdrSlicePtA = null;
        tdrSliceMouse = null;
        tdrUpdateSliceButtons();   // pick done: the button reads Draw a Cross-Section again
        return true;
    }

    // Pick feedback on the 2D map, drawn by renderMapEngineFrame like the measure shapes: the
    // first point's dot, a dashed line chasing the cursor, and the committed line while the
    // cross-section modal is open.
    function drawTdrSliceOverlay() {
        if (typeof ctx === 'undefined' || typeof getX !== 'function') return;
        const a = tdrSlicePtA, line = tdrSliceLine;
        if (!line && !a) return;
        const dot = p => {
            ctx.beginPath(); ctx.arc(getX(p.lon), getY(p.lat), 4 / mapScale, 0, 2 * Math.PI);
            ctx.fillStyle = '#38bdf8'; ctx.fill();
            ctx.lineWidth = 1.5 / mapScale; ctx.strokeStyle = '#0b0e13'; ctx.stroke();
        };
        ctx.save();
        ctx.setLineDash([6 / mapScale, 4 / mapScale]);
        ctx.lineWidth = 2 / mapScale;
        // dark on the light basemap
        ctx.strokeStyle = '#0b0e13';
        if (line) {
            ctx.beginPath(); ctx.moveTo(getX(line.A.lon), getY(line.A.lat)); ctx.lineTo(getX(line.B.lon), getY(line.B.lat)); ctx.stroke();
            dot(line.A); dot(line.B);
        } else {
            if (tdrSliceMouse) {
                ctx.beginPath(); ctx.moveTo(getX(a.lon), getY(a.lat)); ctx.lineTo(getX(tdrSliceMouse.lon), getY(tdrSliceMouse.lat)); ctx.stroke();
            }
            dot(a);
        }
        ctx.restore();
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
        setTdrSliceHint('Building cross-section...');
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
        // Upscaled nearest-neighbor (4x across, 12x up) so the cells stay crisp and the vertical
        // axis gets a readable exaggeration instead of 37 squished pixel rows.
        const painted = tdrCanvasFromGrid(sl.data || [], sl.x.length, sl.y.length, tdrColorStops(sl.colorscale), sl.zmin, sl.zmax);
        cv.width = sl.x.length * 4; cv.height = sl.y.length * 12;
        const c2 = cv.getContext('2d');
        c2.imageSmoothingEnabled = false;
        c2.clearRect(0, 0, cv.width, cv.height);
        if (painted) c2.drawImage(painted, 0, 0, cv.width, cv.height);
        // Compass labels at the section's ends, from the picked line's bearing: the plot runs
        // A (left edge) to B (right edge), so each end is labelled with the direction it lies in.
        if (tdrSliceLine && tdrSliceLine.A && tdrSliceLine.B) {
            const A = tdrSliceLine.A, B = tdrSliceLine.B;
            const dE = (B.lon - A.lon) * Math.cos(((A.lat + B.lat) / 2) * Math.PI / 180);
            const brg = Math.atan2(dE, B.lat - A.lat) * 180 / Math.PI;   // bearing A to B, 0 = N
            const dir8 = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((d % 360) + 360) % 360) / 45) % 8];
            const fs = Math.max(13, Math.round(cv.height * 0.055));
            c2.font = '700 ' + fs + 'px Inter, ui-sans-serif, sans-serif';
            c2.textBaseline = 'top';
            c2.lineWidth = Math.max(2, fs / 6); c2.strokeStyle = 'rgba(5,12,20,0.85)'; c2.fillStyle = '#fff';
            c2.textAlign = 'left';
            c2.strokeText(dir8(brg + 180), 8, 8); c2.fillText(dir8(brg + 180), 8, 8);
            c2.textAlign = 'right';
            c2.strokeText(dir8(brg), cv.width - 8, 8); c2.fillText(dir8(brg), cv.width - 8, 8);
        }
        const lenKm = Math.abs(sl.x[sl.x.length - 1] - sl.x[0]);
        const topKm = sl.y[sl.y.length - 1];
        if (info) info.textContent = (sl.storm_name ? sl.storm_name + ' · ' : '') + 'analysis ' + sl.analysis_time +
            'Z · ' + Math.round(lenKm) + ' km across · surface to ' + topKm.toFixed(0) + ' km (' + tdrFt(topKm) + ') · ' + sl.units +
            (painted ? '' : ' · no radar data along this line');
        modal.style.display = 'flex';
    }

    (function wireTdrUi() {
        // the TDR button folds and unfolds the section, like the Satellite button below it. an
        // unfolded section starts fetching so its leg and layer rows can fill.
        const btn = document.getElementById('tdrPickerBtn');
        if (btn) btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const body = document.getElementById('tdrExpandBody');
            if (!body) return;
            tdrSectionOpen = !body.classList.toggle('hidden');
            btn.setAttribute('aria-expanded', String(tdrSectionOpen));
            tdrUpdateSliceButtons();
            buildTdrHero();
            updateTdr3D();
            if (typeof positionSatPicker === 'function') positionSatPicker();
        });
        // the Esc key cancels an armed cross-section pick.
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && tdrSliceArm) tdrCancelSlicePick();
        });
        // Live pick line: track the cursor while the second point is pending, redrawing the map
        // one frame at a time.
        if (typeof canvas !== 'undefined' && canvas) canvas.addEventListener('mousemove', (e) => {
            if (tdrSliceArm !== 2 || typeof screenToGeo !== 'function') return;
            tdrSliceMouse = screenToGeo(e.clientX, e.clientY);
            if (!_tdrSliceRaf && typeof renderMapEngineFrame === 'function' && filteredData.length && trackerModeSelect.value === '2d') {
                _tdrSliceRaf = true;
                requestAnimationFrame(() => { _tdrSliceRaf = false; renderMapEngineFrame(currentIdx, filteredData[currentIdx]); });
            }
        });
        const allBtn = document.getElementById('tdrLevelsAll'), noneBtn = document.getElementById('tdrLevelsNone');
        if (allBtn) allBtn.addEventListener('click', () => {
            const ref = tdrCurrent || tdrAnalyses.find(a => a.state === 'ready');
            if (!ref || !ref.levels) return;
            ref.levels.forEach(l => { if (l.canvas) tdrSelectedKm.add(l.km); });
            tdrSelectionIsAuto = false;
            tdrSelectionChanged();
        });
        if (noneBtn) noneBtn.addEventListener('click', () => {
            tdrSelectedKm.clear();
            tdrSelectionIsAuto = false;
            tdrSelectionChanged();
        });
        // 2D-only radar opacity: fades the composite so satellite imagery reads through it.
        const opSl = document.getElementById('tdr2dOpacitySlider');
        if (opSl) opSl.addEventListener('input', () => {
            const v = Math.max(20, Math.min(100, parseFloat(opSl.value) || 85));
            tdr2DOpacity = v / 100;
            const ov = document.getElementById('tdr2dOpacityVal'); if (ov) ov.textContent = Math.round(v) + '%';
            bgNeedsUpdate = true;
            if (typeof renderMapEngineFrame === 'function' && filteredData.length && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
        });

        // leaving the 2D map drops a pick in progress (it needs map clicks); either way the section's
        // 2D-only controls, the leg highlight, and the radar follow the new view, and a still
        // automatic layer pick switches to the new view's default (tdrDefaultLevels).
        if (typeof trackerModeSelect !== 'undefined' && trackerModeSelect) trackerModeSelect.addEventListener('change', () => {
            if (trackerModeSelect.value !== '2d' && (tdrSliceArm || tdrSliceLine)) {
                tdrSliceArm = 0; tdrSlicePtA = null; tdrSliceMouse = null; tdrSliceLine = null;
                setTdrSliceHint('');
            }
            tdrUpdateSliceButtons();
            if (tdrSelectionIsAuto) { tdrApplyDefaultSelection(); tdrSelectionChanged(); }
            else { buildTdrHero(); updateTdr3D(); }
        });
        // Draw a Cross-Section arms the two-click pick and closes the Overlays dropdown so the clicks
        // reach the map; while armed the same button cancels.
        const againBtn = document.getElementById('tdrSliceAgainBtn');
        if (againBtn) againBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tdrSliceArm) { tdrCancelSlicePick(); return; }
            tdrSliceLine = null;
            tdrSliceArm = 1; tdrSlicePtA = null; tdrSliceMouse = null;
            setTdrSliceHint('Click two points to draw a cross-section. Drag to move the map.');
            tdrUpdateSliceButtons();
            if (typeof closeSatPicker === 'function') closeSatPicker();
            if (typeof renderMapEngineFrame === 'function' && filteredData.length && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
        });
        ['tdrSliceCloseX', 'tdrSliceCloseBtn'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.addEventListener('click', () => {
                const m = document.getElementById('tdrSliceModal'); if (m) m.style.display = 'none';
                tdrSliceLine = null;
                tdrUpdateSliceButtons();
                if (typeof renderMapEngineFrame === 'function' && filteredData.length && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
            });
        });
    })();
