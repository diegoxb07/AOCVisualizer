/* Mission Visualizer, DOM refs, sync-mode, 3D scene, control wiring
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    // --- Fullscreen-Friendly Drag & Drop Logic ---
    ['dataDropZone', 'videoDropZone'].forEach(zoneId => {
        const zone = document.getElementById(zoneId);
        if (!zone) return;
        const input = zone.querySelector('input[type="file"]');
        
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('border-blue-500', 'bg-slate-700');
        });
        
        zone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            zone.classList.remove('border-blue-500', 'bg-slate-700');
        });
        
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('border-blue-500', 'bg-slate-700');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                input.files = e.dataTransfer.files;
                const event = new Event('change', { bubbles: true });
                input.dispatchEvent(event);
            }
        });
    });

    const canvas = document.getElementById('mapCanvas'), ctx = canvas.getContext('2d'), video = document.getElementById('radarVideo'), hud = document.getElementById('hudOverlay'), mapPlaceholder = document.getElementById('mapPlaceholder'), playPauseBtn = document.getElementById('playPauseBtn'), timelineSlider = document.getElementById('timelineSlider'), timelineTimeDisplay = document.getElementById('timelineTimeDisplay'), speedDownBtn = document.getElementById('speedDownBtn'), speedDisplayBtn = document.getElementById('speedDisplayBtn'), speedUpBtn = document.getElementById('speedUpBtn'), replayBtn = document.getElementById('replayBtn'), videoSyncMode = document.getElementById('videoSyncMode'), ocrIndicator = document.getElementById('ocrIndicator'), fullscreenBtn = document.getElementById('fullscreenBtn'), fullscreenMapBtn = document.getElementById('fullscreenMapBtn'), fullscreenVideoBtn = document.getElementById('fullscreenVideoBtn'), mapPanel = document.getElementById('mapPanel'), videoPanel = document.getElementById('videoPanel'), trackerModeSelect = document.getElementById('trackerModeSelect'), threeDContainer = document.getElementById('threeDContainer'), attitudeHud = document.getElementById('attitudeHud'), stickyBottomBar = document.getElementById('stickyBottomBar'), pathColorSelect = document.getElementById('pathColorSelect'), barbColorSelect = document.getElementById('barbColorSelect');

    function applySyncModeLock() {
        // On Auto-Sync the timeline window is driven by the video clock, so the user must NOT type start/end times.
        const isAuto = videoSyncMode.value === 'auto';
        const dataLoaded = allParsedData.length > 0;
        const startEl = document.getElementById('startTimeInput');
        const endEl = document.getElementById('endTimeInput');
        if (startEl) { startEl.disabled = isAuto || !dataLoaded; startEl.title = isAuto ? 'Disabled during Auto-Sync (timeline follows the MMR video clock)' : ''; }
        if (endEl) { endEl.disabled = isAuto || !dataLoaded; endEl.title = isAuto ? 'Disabled during Auto-Sync (timeline follows the MMR video clock)' : ''; }
    }

    function evaluateAutoSyncDefault() {
        if (videoLoaded && allParsedData.length > 0) {
            videoSyncMode.value = 'auto'; ocrIndicator.style.display = 'block'; document.getElementById('videoStartInput').disabled = true; document.getElementById('forceSyncBtn').style.display = 'inline-block';
            applySyncModeLock();
            forceOcrSyncNextTick = true; isManualSyncRequest = true;
            refreshSyncingIndicator();
            setTimeout(() => { if (!isPlaying) syncTelemetryToVideoClock(); }, 800);
        }
    }

    function showToast(message, duration = 8000) {
        const toast = document.getElementById('toastNotification'); document.getElementById('toastMessage').innerText = message; toast.classList.add('show'); setTimeout(() => { toast.classList.remove('show'); }, duration);
    }
    function flashAutoSyncLabel() {
        const label = document.getElementById('autosyncLabel'); label.classList.add('show'); setTimeout(() => { label.classList.remove('show'); }, 4000);
    }

    function updateMissionHeader() {
        const set = (id, val) => {
            const el = document.getElementById(id); if (!el) return;
            const ok = val && val !== 'Unknown' && val !== ''; el.textContent = ok ? val : '-'; el.classList.toggle('on', !!ok);
            const chip = el.closest('.status-chip'); if (chip) chip.classList.toggle('lit', !!ok);
        };
        set('hdrFlightId', flightMetaData.id);
        let ac = flightMetaData.aircraft; const acEl = document.getElementById('hdrAircraft');
        if (acEl) acEl.title = (ac && ac !== 'Unknown') ? ac : '';
        if (ac && ac !== 'Unknown') { const m = ac.match(/^(NOAA\d+)/); ac = m ? m[1] : ac; }
        set('hdrAircraft', ac); set('hdrDate', flightMetaData.date);
        let range = '';
        if (allParsedData && allParsedData.length) { const a = allParsedData[0].time, b = allParsedData[allParsedData.length-1].time; range = `${a.slice(0,2)}:${a.slice(2,4)} → ${b.slice(0,2)}:${b.slice(2,4)}Z`; }
        set('hdrRange', range);
        const sub = document.getElementById('missionSubline');
        if (sub) {
            const rawId = (flightMetaData.id && flightMetaData.id !== 'Unknown') ? flightMetaData.id : '';
            const idPart = rawId.replace(/\s*\([^)]*\)\s*$/, '');
            // Storm name: archive metadata when available, else the "(NAME)" an archive
            // load bakes into flightMetaData.id (reconArchiveMeta is set after parse).
            let storm = (reconArchiveMeta && reconArchiveMeta.stormName) || (rawId.match(/\(([^)]+)\)/) || [])[1] || '';
            if (/unknown|training/i.test(storm)) storm = '';
            if (storm) storm = storm.charAt(0).toUpperCase() + storm.slice(1).toLowerCase();
            // Aircraft designator from the tail number, NOAA name, or the mission-id letter (H/I/N).
            const acId = ((flightMetaData.aircraft || '') + ' ' + rawId).toUpperCase();
            let plane = '';
            if (/N?42 ?RF|NOAA ?42|\d{8}H\d/.test(acId)) plane = 'NOAA42';
            else if (/N?43 ?RF|NOAA ?43|\d{8}I\d/.test(acId)) plane = 'NOAA43';
            else if (/N?49 ?RF|NOAA ?49|GULFSTREAM|\bG-?IV\b|\d{8}N\d/.test(acId)) plane = 'NOAA49';
            const parts = [idPart, storm, plane].filter(Boolean);
            sub.textContent = parts.join(' · ');
            sub.classList.toggle('hidden', parts.length === 0);
            document.title = (idPart ? idPart + ' · ' : '') + 'AOC Mission Visualizer';
        }
        // Share links need an archive mission id; a manually uploaded file has none.
        const shareBtn = document.getElementById('shareLinkBtn');
        if (shareBtn) shareBtn.disabled = !reconArchiveMeta;
    }
    
    function getConvertedVal(val, key, isImperial) {
        if (val === null || val === undefined) return null; if (!isImperial) return val;
        if (['vtWnd', 'accZ'].includes(key)) return val * 2.23694; 
        if (['gpsAlt', 'radAlt', 'pAlt', 'dValue'].includes(key)) return val * 3.28084;
        if (['tempr', 'dewpt'].includes(key)) return (val * 9/5) + 32; return val;
    }
    
    function getMetricLabel(key, isImperial) {
        let label = METRIC_DEFS[key].label; if (!isImperial) return label;
        if (['vtWnd', 'accZ'].includes(key)) return label.replace('(m/s)', '(mph)').replace('(m/s²)', '(mph/s)');
        if (['gpsAlt', 'radAlt', 'pAlt', 'dValue'].includes(key)) return label.replace('(m)', '(ft)');
        if (['tempr', 'dewpt'].includes(key)) return label.replace('(°C)', '(°F)'); return label;
    }

    function drawP3Orion(c) {
        c.fillStyle = '#ffffff'; c.strokeStyle = '#222222'; c.lineWidth = 2.5; c.beginPath();
        c.moveTo(22, 0); c.quadraticCurveTo(22, -3.5, 14, -3.5); c.lineTo(4, -3.5); c.lineTo(0, -25); c.lineTo(-4, -25); c.lineTo(-6, -3.5); c.lineTo(-16, -2.5); c.lineTo(-18, -10); c.lineTo(-21, -10); c.lineTo(-21, -1.5); c.lineTo(-30, -0.5); c.lineTo(-30, 0.5); c.lineTo(-21, 1.5); c.lineTo(-21, 10); c.lineTo(-18, 10); c.lineTo(-16, 2.5); c.lineTo(-6, 3.5); c.lineTo(-4, 25); c.lineTo(0, 25); c.lineTo(4, 3.5); c.lineTo(14, 3.5); c.quadraticCurveTo(22, 3.5, 22, 0); c.closePath(); c.fill(); c.stroke();
        const drawEngine = (cx, cy) => { c.beginPath(); c.ellipse(cx, cy, 6, 1.5, 0, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill(); c.stroke(); c.beginPath(); c.moveTo(cx + 6, cy - 1); c.lineTo(cx + 10, cy); c.lineTo(cx + 6, cy + 1); c.fillStyle = '#cccccc'; c.fill(); };
        drawEngine(1.5, -9); drawEngine(-0.5, -16); drawEngine(1.5, 9); drawEngine(-0.5, 16);
        const drawProps = (cx, cy) => { c.beginPath(); c.ellipse(cx, cy, 0.5, 5, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(200, 230, 255, 0.7)'; c.fill(); c.beginPath(); c.moveTo(cx, cy - 5); c.lineTo(cx, cy + 5); c.strokeStyle = '#aaaaaa'; c.lineWidth = 1; c.stroke(); };
        drawProps(11.5, -9); drawProps(9.5, -16); drawProps(11.5, 9); drawProps(9.5, 16);
        c.beginPath(); c.moveTo(17, -1.5); c.lineTo(19, -1); c.lineTo(19, 1); c.lineTo(17, 1.5); c.lineTo(16, 0); c.closePath(); c.fillStyle = '#222222'; c.fill();
    }

    // G-IV (NOAA49) glyph for the 2D tracker, same coordinate frame as drawP3Orion
    // (nose at +X, drawn white with a dark outline). Swept wings, two aft-fuselage
    // nacelles, T-tail; picked over the P-3 by isGulfstreamFlight().
    function drawGulfstreamIV(c) {
        c.fillStyle = '#ffffff'; c.strokeStyle = '#222222'; c.lineWidth = 2.5; c.beginPath();
        c.moveTo(24, 0); c.quadraticCurveTo(23, -2.6, 17, -2.8); c.lineTo(5, -2.8);
        c.lineTo(-11, -21); c.lineTo(-14, -21); c.lineTo(-9, -2.8);
        c.lineTo(-21, -2.2); c.lineTo(-26.5, -9.5); c.lineTo(-28.5, -9.5); c.lineTo(-29.5, -1.2);
        c.lineTo(-30.5, 0);
        c.lineTo(-29.5, 1.2); c.lineTo(-28.5, 9.5); c.lineTo(-26.5, 9.5); c.lineTo(-21, 2.2);
        c.lineTo(-9, 2.8); c.lineTo(-14, 21); c.lineTo(-11, 21);
        c.lineTo(5, 2.8); c.lineTo(17, 2.8); c.quadraticCurveTo(23, 2.6, 24, 0);
        c.closePath(); c.fill(); c.stroke();
        const nacelle = (cy) => {
            c.beginPath(); c.ellipse(-13.5, cy, 4.4, 1.8, 0, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill(); c.stroke();
            c.beginPath(); c.moveTo(-9.4, cy - 1.2); c.lineTo(-8.2, cy); c.lineTo(-9.4, cy + 1.2); c.fillStyle = '#cccccc'; c.fill();
        };
        nacelle(-4.8); nacelle(4.8);
        c.beginPath(); c.moveTo(-11, -21); c.lineTo(-9.8, -19.4); c.moveTo(-11, 21); c.lineTo(-9.8, 19.4); c.lineWidth = 1.5; c.stroke();  // winglets
        c.beginPath(); c.moveTo(-21, 0); c.lineTo(-29.5, 0); c.strokeStyle = '#999999'; c.lineWidth = 1; c.stroke();  // fin seen from above
        c.beginPath(); c.moveTo(19, -1.4); c.lineTo(21, -0.8); c.lineTo(21, 0.8); c.lineTo(19, 1.4); c.lineTo(18, 0); c.closePath(); c.fillStyle = '#222222'; c.fill();
    }

    // True when the loaded flight is the Gulfstream: aircraft letter N in the AOC
    // mission id (e.g. 20240826N1), or an archive aircraft/tail string naming it.
    function isGulfstreamFlight() {
        const id = flightMetaData.id || '', ac = flightMetaData.aircraft || '';
        return /\d{8}N\d/i.test(id) || /gulfstream|\bg-?iv\b|\bn49/i.test(ac + ' ' + id);
    }

    // White tropical-cyclone symbol (disc + spiral arms above depression strength) carrying its
    // dark category label, cached per label; the mesh material tints the white per intensity
    // while the label stays dark and readable. Drawn flat on the sea, never billboarded or spun.
    let _stormSymTex = {};
    function stormSymbolTex(label) {
        if (_stormSymTex[label]) return _stormSymTex[label];
        const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
        const c = cv.getContext('2d');
        c.strokeStyle = '#ffffff'; c.fillStyle = '#ffffff'; c.lineCap = 'round';
        c.beginPath(); c.arc(64, 64, 34, 0, Math.PI * 2); c.fill();
        if (label !== 'TD') {
            c.lineWidth = 13;
            c.beginPath(); c.arc(64, 64, 44, -0.3, 1.5); c.stroke();
            c.beginPath(); c.arc(64, 64, 44, Math.PI - 0.3, Math.PI + 1.5); c.stroke();
        }
        c.fillStyle = '#0b1220'; c.font = '700 36px sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(label, 64, 66);
        _stormSymTex[label] = new THREE.CanvasTexture(cv);
        return _stormSymTex[label];
    }

    // Home camera offset from the aircraft (the orbit target): close enough that the airframe
    // fills the view on open. The per-frame follow keeps whatever offset the user orbits to;
    // reset3DView() snaps back to this one.
    const CAM3D_HOME = { x: 0, y: 0.35, z: 0.85 };
    function reset3DView() {
        if (!threeDInitialized || !controls3D) return;
        camera3D.position.set(controls3D.target.x + CAM3D_HOME.x, controls3D.target.y + CAM3D_HOME.y, controls3D.target.z + CAM3D_HOME.z);
        controls3D.update();
    }

    function init3D() {
        if (threeDInitialized) return;
        const w = threeDContainer.clientWidth || canvas.width, h = threeDContainer.clientHeight || canvas.height, aspect = w / (h || 1);
        scene3D = new THREE.Scene(); scene3D.background = new THREE.Color(0x171122);
        camera3D = new THREE.PerspectiveCamera(45, aspect, 0.1, 50000);
        camera3D.position.set(CAM3D_HOME.x, CAM3D_HOME.y, CAM3D_HOME.z);   // starts zoomed into the aircraft, no scroll-in needed
        renderer3D = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer3D.setSize(w, h); threeDContainer.insertBefore(renderer3D.domElement, threeDContainer.firstChild);
        controls3D = new THREE.OrbitControls(camera3D, renderer3D.domElement); controls3D.enableDamping = true;
        scene3D.add(new THREE.AmbientLight(0xffffff, 0.6)); const dirLight = new THREE.DirectionalLight(0xffffff, 0.8); dirLight.position.set(10, 20, 10); scene3D.add(dirLight);
        planeGroup3D = new THREE.Group(); planeGroup3D.scale.set(0.06, 0.06, 0.06); scene3D.add(planeGroup3D);
        // the airframe itself (WP-3D or G-IV per the loaded flight) is built by js/07b-plane-models.js
        if (typeof setPlaneModel3D === 'function') setPlaneModel3D();
        // Direction arrow: shaft + a cone HEAD whose apex points forward (-Z, this model's nose
        // direction). The cone's local apex is at +Y, so it needs a NEGATIVE X rotation to face -Z.
        const buildDirectionArrow = (color, scale, standoff, opacity) => {
            const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.2, 8), mat); shaft.rotation.x = Math.PI / 2; shaft.position.z = -standoff - 0.6;
            const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 8), mat); head.rotation.x = -Math.PI / 2; head.position.z = -standoff - 1.4;
            const group = new THREE.Group(); group.add(shaft, head); group.scale.set(scale, scale, scale);
            return group;
        };
        // Ground track: blue, standing out ahead of the airframe so it never overlaps it.
        trackArrow3D = buildDirectionArrow(0x3da5ff, 0.17, 2.3, 1); scene3D.add(trackArrow3D);
        // True heading: yellow and slightly smaller, nested inside the track arrow's world-space
        // span, so it hides within the blue when the two agree and appears only when they
        // diverge; scene-level (not planeGroup3D) so the crew-ride dim pass never touches it.
        headingArrow3D = buildDirectionArrow(0xffd400, 0.145, 2.76, 0.8); scene3D.add(headingArrow3D);
        scene3D.add(threeMapGroup); scene3D.add(threeMarkersGroup);
        function animate3D() {
            requestAnimationFrame(animate3D); if (controls3D) controls3D.update();
            // props spin only while playback runs; pausing freezes them with everything else
            if (typeof planeSpinners3D !== 'undefined' && isPlaying) for (let i = 0; i < planeSpinners3D.length; i++) planeSpinners3D[i].rotation.z += 0.3;
            renderer3D.render(scene3D, camera3D);
        }
        animate3D(); threeDInitialized = true;
    }

    function get3DCoord(lon, lat, altMeters) {
        if (isNaN(lon) || isNaN(lat)) return new THREE.Vector3(0,0,0);
        const centerLon = (plotMinLon + plotMaxLon) / 2 || 0, centerLat = (plotMinLat + plotMaxLat) / 2 || 0, scaleMult = 20;
        // wrapLon (js/15-map-render.js) keeps dateline-crossing flights continuous here too;
        // safe because build3DScene only renders flight-adjacent features (never the far seam).
        const x = (wrapLon(lon) - centerLon) * scaleMult, z = -(lat - centerLat) * scaleMult, y = (altMeters || 0) / 250; return new THREE.Vector3(x, y, z);
    }

    // Altitude source for the 3D map's vertical dimension (track, plane, markers). Its OWN control
    // (#trackAltSelect, defaults to GPS), independent of the PFD's Press->GPS filter (#toggleGpsAlt),
    // which still only governs the PFD altitude tape / point analysis.
    function track3DAltMeters(d) {
        if (!d) return 0;
        const sel = document.getElementById('trackAltSelect');
        const useGps = !sel || sel.value !== 'press';   // default GPS
        return useGps ? (d.gpsAlt != null ? d.gpsAlt : (d.pAlt != null ? d.pAlt : 0))
                      : (d.pAlt != null ? d.pAlt : (d.gpsAlt != null ? d.gpsAlt : 0));
    }

    // 3D waypoints: each point-analysis marker gets a dotted plumb line from the sea surface up to
    // the flagged sample, a ground ring anchoring it, and a glowing beacon at altitude, so a mark
    // reads as a surveyed position in space rather than a floating dot.
    function sync3DMarkers() {
        if (!threeDInitialized) return;
        while (threeMarkersGroup.children.length > 0) {
            const c = threeMarkersGroup.children[0]; threeMarkersGroup.remove(c);
            if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose();
        }
        customMarkers.forEach(marker => {
            const d = filteredData[marker.idx];
            if (!d) return;
            const top = get3DCoord(d.lon, d.lat, track3DAltMeters(d));
            const col = new THREE.Color(marker.color);
            const line = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(top.x, 0, top.z), top]),
                new THREE.LineDashedMaterial({ color: col, dashSize: 0.06, gapSize: 0.045, transparent: true, opacity: 0.9 }));
            line.computeLineDistances();
            threeMarkersGroup.add(line);
            const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.075, 24),
                new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.75 }));
            ring.rotation.x = -Math.PI / 2; ring.position.set(top.x, 0.012, top.z);
            threeMarkersGroup.add(ring);
            const bead = new THREE.Mesh(new THREE.OctahedronGeometry(0.055),
                new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 }));
            bead.position.copy(top); bead.userData = { dataPoint: d };
            threeMarkersGroup.add(bead);
        });
    }

    function isBoxInFlightBounds(bbox) {
        if (!bbox) return true;
        const expandDeg = 15, viewMinLon = plotMinLon - expandDeg, viewMaxLon = plotMaxLon + expandDeg, viewMinLat = plotMinLat - expandDeg, viewMaxLat = plotMaxLat + expandDeg;
        if (bbox[1] > viewMaxLat || bbox[3] < viewMinLat) return false;
        // Also test the bbox shifted ±360: a dateline-centered flight's plot window sits outside
        // [-180,180], where every raw feature bbox would otherwise miss it.
        return [0, -360, 360].some(s => !(bbox[0] + s > viewMaxLon || bbox[2] + s < viewMinLon));
    }

    function build3DScene() {
        if (!threeDInitialized) init3D();
        // a newly loaded flight may be the other airframe; no-ops when the right model is up
        if (typeof setPlaneModel3D === 'function') setPlaneModel3D();
        while(threeMapGroup.children.length > 0) threeMapGroup.remove(threeMapGroup.children[0]); 
        const landMat = new THREE.MeshBasicMaterial({ color: 0x0d4a22, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }); const borderMat = new THREE.LineBasicMaterial({ color: 0x000000 });
        const processPolygon = (poly, isState) => {
            const shape = new THREE.Shape();
            poly.forEach((ring, ringIdx) => {
                const pts = []; ring.forEach(c => pts.push(get3DCoord(c[0], c[1], 5)));
                const lineGeom = new THREE.BufferGeometry().setFromPoints(pts); threeMapGroup.add(new THREE.Line(lineGeom, borderMat));
                if (!isState) {
                    if (ringIdx === 0) { ring.forEach((c, i) => { const pt = get3DCoord(c[0], c[1], 0); if (i === 0) shape.moveTo(pt.x, -pt.z); else shape.lineTo(pt.x, -pt.z); }); } 
                    else { const hole = new THREE.Path(); ring.forEach((c, i) => { const pt = get3DCoord(c[0], c[1], 0); if (i === 0) hole.moveTo(pt.x, -pt.z); else hole.lineTo(pt.x, -pt.z); }); shape.holes.push(hole); }
                }
            });
            if (!isState) { const shapeGeom = new THREE.ShapeGeometry(shape); shapeGeom.rotateX(-Math.PI / 2); shapeGeom.translate(0, 5 / 200, 0); threeMapGroup.add(new THREE.Mesh(shapeGeom, landMat)); }
        };
        mapFeatures.forEach(feature => {
            if (!isBoxInFlightBounds(feature.properties.bbox)) return; 
            const geom = feature.geometry; if (!geom) return;
            const isState = feature.properties && feature.properties.isState === true;
            if (geom.type === 'Polygon') processPolygon(geom.coordinates, isState); else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly => processPolygon(poly, isState));
        });
        if(filteredData.length > 0) {
            const pathPts = []; const colors = [];
            filteredData.forEach((d, idx) => {
                pathPts.push(get3DCoord(d.lon, d.lat, track3DAltMeters(d))); const [r, g, b] = getPathColorRGB(d, idx); colors.push(r, g, b);
            });
            const pathGeom = new THREE.BufferGeometry().setFromPoints(pathPts); pathGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            const trackMat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 3 }); const coloredTrack3D = new THREE.Line(pathGeom, trackMat); threeMapGroup.add(coloredTrack3D);
        }
        // Storm best-track overlay (js/12b-recon-archive.js), same points as the 2D layer, flattened to
        // sea level (get3DCoord's altitude term stays 0) since it spans the storm's whole life, not the
        // flight's altitude profile.
        if (showStormTrack && stormTrackPoints.length > 1) {
            const stormPts = [];
            stormTrackPoints.forEach(p => stormPts.push(get3DCoord(p.lon, p.lat, 0)));
            // flat dashed ribbon laid on the sea surface, one strip per fix-to-fix leg
            // (shortened to leave the gap), intensity-colored like the 2D layer; the width
            // scales with the track's own extent so it stays readable at the zoom that frames it
            const bb = new THREE.Box3().setFromPoints(stormPts);
            const span = bb.getSize(new THREE.Vector3()).length();
            const ribbonW = Math.max(0.2, span * 0.0022);
            for (let i = 0; i < stormPts.length - 1; i++) {
                const a = stormPts[i], b = stormPts[i + 1];
                const dx = b.x - a.x, dz = b.z - a.z;
                const legLen = Math.hypot(dx, dz) * 0.72;
                if (legLen < 0.01) continue;
                const geo = new THREE.PlaneGeometry(ribbonW, legLen);
                geo.rotateX(-Math.PI / 2);   // lay the strip flat; its length axis runs along z
                const strip = new THREE.Mesh(geo,
                    new THREE.MeshBasicMaterial({ color: new THREE.Color(stormWindColor(stormTrackPoints[i].windKt)), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
                strip.position.copy(a).lerp(b, 0.5); strip.position.y = 0.03;
                strip.rotation.y = Math.atan2(dx, dz);
                strip.renderOrder = 1;   // symbols draw after the ribbon, whatever the camera angle
                threeMapGroup.add(strip);
            }
            // flat, static cyclone symbol at each fix with its category printed on it
            const symSize = Math.max(0.45, ribbonW * 1.7);
            stormTrackPoints.forEach((p, i) => {
                const geo = new THREE.PlaneGeometry(symSize, symSize);
                geo.rotateX(-Math.PI / 2);
                const sym = new THREE.Mesh(geo,
                    new THREE.MeshBasicMaterial({ map: stormSymbolTex(stormCatLabel(p.windKt)), color: new THREE.Color(stormWindColor(p.windKt)), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
                sym.position.copy(stormPts[i]); sym.position.y = 0.06;
                sym.renderOrder = 2;
                threeMapGroup.add(sym);
            });
            // vertical dotted column rising to the flight path's altitude from each fix NEAR
            // the flight, so those observations read directly against the track flying above
            // them (far-away fixes stay clean); stacked thin cylinders make the dashes, since
            // WebGL lines cannot be thick
            let colTop = 0;
            const flightXZ = [];
            for (let i = 0; i < filteredData.length; i += 50) {
                const d = filteredData[i];
                colTop = Math.max(colTop, track3DAltMeters(d) / 250);
                const c = get3DCoord(d.lon, d.lat, 0);
                flightXZ.push([c.x, c.z]);
            }
            if (colTop < 4) colTop = 4;
            const fb = new THREE.Box3().setFromPoints(flightXZ.map(([x, z]) => new THREE.Vector3(x, 0, z)));
            const nearDist = Math.max(6, fb.getSize(new THREE.Vector3()).length() * 0.35);
            const dashLen = colTop / 15, dashR = Math.max(0.03, ribbonW * 0.06);
            stormTrackPoints.forEach((p, i) => {
                const near = flightXZ.some(([fx, fz]) => (fx - stormPts[i].x) * (fx - stormPts[i].x) + (fz - stormPts[i].z) * (fz - stormPts[i].z) < nearDist * nearDist);
                if (!near) return;
                const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(stormWindColor(p.windKt)), transparent: true, opacity: 0.45, depthWrite: false });
                for (let d = 0; d < 15; d += 2) {
                    const dash = new THREE.Mesh(new THREE.CylinderGeometry(dashR, dashR, dashLen, 6, 1), mat);
                    dash.position.set(stormPts[i].x, (d + 0.5) * dashLen, stormPts[i].z);
                    threeMapGroup.add(dash);
                }
            });
            // name tag floating over the first fix
            if (stormTrackMeta && stormTrackMeta.name) {
                const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
                const c2 = cv.getContext('2d');
                c2.font = '700 40px Inter, ui-sans-serif, sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
                c2.lineWidth = 8; c2.strokeStyle = 'rgba(0,0,0,0.85)';
                const tag = stormTrackMeta.name.toUpperCase() + ' BEST TRACK';
                c2.strokeText(tag, 256, 32); c2.fillStyle = '#e2e8f0'; c2.fillText(tag, 256, 32);
                const lblSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
                lblSpr.scale.set(Math.max(1.6, ribbonW * 4.5), Math.max(0.2, ribbonW * 0.56), 1);
                lblSpr.position.copy(stormPts[0]); lblSpr.position.y = Math.max(0.22, ribbonW * 0.9);
                threeMapGroup.add(lblSpr);
            }
        }
        sync3DMarkers();
    }

    function update3DFrame(idx, visualRow) {
        if (!threeDInitialized || !filteredData[idx]) return;
        const d = visualRow || filteredData[idx];
        const pos = get3DCoord(d.lon, d.lat, track3DAltMeters(d));
        planeGroup3D.position.copy(pos);
        let t_pitch = d.pitch ?? 0, t_th = d.th ?? 0, t_roll = d.roll ?? 0, t_track = d.gTrack ?? 0;
        planeGroup3D.rotation.set(THREE.MathUtils.degToRad(t_pitch), THREE.MathUtils.degToRad(-t_th), THREE.MathUtils.degToRad(-t_roll), 'YXZ');
        trackArrow3D.position.copy(pos); trackArrow3D.rotation.set(0, THREE.MathUtils.degToRad(-t_track), 0);
        // True-heading arrow: same scene-level convention as the ground-track arrow (world position,
        // Y-only rotation, not banked/pitched with the airframe), so it reads as a clean compass pointer.
        // It fades in only as heading diverges from ground track (hidden below 3 deg of drift, full by 8)
        // so a no-drift leg shows a single arrow instead of two overlapping, z-fighting ones.
        if (headingArrow3D) {
            headingArrow3D.position.copy(pos); headingArrow3D.rotation.set(0, THREE.MathUtils.degToRad(-t_th), 0);
            const drift = Math.abs(((t_track - t_th + 540) % 360) - 180);
            const op = Math.max(0, Math.min(1, (drift - 3) / 5));
            headingArrow3D.visible = op > 0.02;
            const hmat = headingArrow3D.children[0].material;
            hmat.transparent = true; hmat.opacity = op;
        }
        camera3D.position.x += (pos.x - controls3D.target.x); camera3D.position.y += (pos.y - controls3D.target.y); camera3D.position.z += (pos.z - controls3D.target.z);
        controls3D.target.copy(pos); controls3D.update();
        attitudeHud.innerHTML = `PITCH: ${t_pitch.toFixed(1)}°<br>ROLL: ${t_roll.toFixed(1)}°<br>HDG: ${t_th.toFixed(1)}°<br>TRK: ${t_track.toFixed(1)}°`;
    }

    // Real fullscreen is page-level ONLY. The panel ⛶ buttons "fake" fullscreen instead: pin the
    // panel over the whole viewport (.fake-fs, styled like :fullscreen via :is()) and take the page
    // fullscreen too if it isn't already, so panel/page switches are a single click.
    const refreshAfterViewChange = () => setTimeout(() => { resizeCanvasLayout(); if (filteredData.length > 0) { if (trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]); if (document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]); } }, 100);
    const setFakePanel = (panel) => {
        mapPanel.classList.toggle('fake-fs', panel === mapPanel);
        videoPanel.classList.toggle('fake-fs', panel === videoPanel);
        // The main top-right button sits exactly on the pinned panel's own ⛶ and would steal its
        // clicks, so hide it while a panel is pinned; Esc still exits real fullscreen.
        fullscreenBtn.style.display = panel ? 'none' : '';
        refreshAfterViewChange();
    };
    fullscreenBtn.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(err => { });
    });
    const togglePanelFullscreen = (panel) => {
        if (panel.classList.contains('fake-fs')) { setFakePanel(null); return; }
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(err => { });
        setFakePanel(panel);
    };
    fullscreenMapBtn.addEventListener('click', () => togglePanelFullscreen(mapPanel));
    fullscreenVideoBtn.addEventListener('click', () => togglePanelFullscreen(videoPanel));

    document.addEventListener('fullscreenchange', () => {
        fullscreenBtn.innerText = !document.fullscreenElement ? "⛶ Fullscreen" : "⛶ Exit Fullscreen";
        // Leaving real fullscreen (Esc or the main button) unpins any fake-fullscreened panel too.
        if (!document.fullscreenElement) setFakePanel(null);
        else refreshAfterViewChange();
    });

    trackerModeSelect.addEventListener('change', (e) => {
        const measureBtn = document.getElementById('measureBtn');
        const clearMeasureBtn = document.getElementById('clearMeasureBtn');
        const satSelect = document.getElementById('satelliteSelect');
        const satBandSelect = document.getElementById('satBandSelect');

        // Keep the early-boot FOUC guard (index.html <head>) in sync with the live mode: its CSS
        // rule hides the 2D-only controls, and clearing an inline display cannot override it.
        document.documentElement.classList.toggle('pref-tracker-3d', e.target.value === '3d');

        if (e.target.value === '3d') {
            canvas.style.display = 'none'; threeDContainer.style.display = 'block';
            if (isMeasuring) stopMeasuringState();
            document.getElementById('measureCluster').style.display = 'none';

            if (satSelect) satSelect.style.display = 'none';
            if (satBandSelect) satBandSelect.style.display = 'none';
            buildSatDayStepper();   
            const satBadge = document.getElementById('satTimeBadge');
            if (satBadge) satBadge.classList.add('hidden');

            setTimeout(() => { resizeCanvasLayout(); if (filteredData.length > 0) { if (!threeDInitialized) build3DScene(); updateVisualComponents(currentIdx); } }, 50);
        } else {
            canvas.style.display = 'block'; threeDContainer.style.display = 'none';
            document.getElementById('measureCluster').style.display = 'flex';
            measureBtn.style.display = 'inline-block';
            updateMeasureUI();

            if (satSelect) satSelect.style.display = '';
            if (satBandSelect && satSelect.value !== 'none') satBandSelect.style.display = '';
            buildSatDayStepper();   

            setTimeout(() => { resizeCanvasLayout(); if (filteredData.length > 0) { updateVisualComponents(currentIdx); } }, 50);
        }
    });

    document.getElementById('satelliteSelect').addEventListener('change', () => {
        updateBandOptions();
        satImageLoaded = false; lastSatFetchTime = ''; bgNeedsUpdate = true; resetSatPreload();
        satLoadedInfo = null; satImageBox = null;
        satDayOffset = 0;            
        buildSatDayStepper();
        updateSatTimeBadge();
        if (filteredData.length > 0 && trackerModeSelect.value === '2d') {
            // Archive-GOES layers reset satBandSelect to a blank placeholder, so fetchSatelliteImage/
            // maybeAutoPrecacheSatellite no-op until a product is picked. Polar (MODIS/VIIRS) layers
            // have no placeholder and fetch their daily image immediately.
            fetchSatelliteImage(filteredData[currentIdx].absSeconds);
            maybeAutoPrecacheSatellite();
            renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
        }
    });

    document.getElementById('satBandSelect').addEventListener('change', () => {
        satImageLoaded = false; lastSatFetchTime = ''; bgNeedsUpdate = true; resetSatPreload();
        if (filteredData.length > 0 && trackerModeSelect.value === '2d') {
            // Archived (recon-api) satellites stream a tile per 10-min scan from the API, which can
            // pause playback, so picking a bbox-capable product auto-builds its whole timeframe up
            // front (maybeAutoPrecacheSatellite) instead of trickling in during playback. A full-disk-
            // only composite (sandwich/geocolor) skips that and just streams per-frame like a polar layer.
            fetchSatelliteImage(filteredData[currentIdx].absSeconds);
            maybeAutoPrecacheSatellite();
            renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
        }
    });

    pathColorSelect.addEventListener('change', () => { if (filteredData.length > 0) { if (threeDInitialized) build3DScene(); renderMapEngineFrame(currentIdx, filteredData[currentIdx]); } });
    barbColorSelect.addEventListener('change', () => { if (filteredData.length > 0) { if (threeDInitialized) build3DScene(); renderMapEngineFrame(currentIdx, filteredData[currentIdx]); } });
    document.getElementById('trackAltSelect').addEventListener('change', () => { if (filteredData.length > 0 && threeDInitialized) { build3DScene(); updateVisualComponents(currentIdx); } });
    document.getElementById('toggle8Hz').addEventListener('change', () => { if (filteredData.length > 0) updateVisualComponents(currentIdx); });

    document.getElementById('markBtn').addEventListener('click', () => {
        if (!customMarkers.find(m => m.idx === currentIdx)) {
            const palette = ['#fbbf24', '#ef4444', '#38bdf8', '#7dd3fc', '#9aa1ad', '#7ad9ff', '#22d0ee']; const assignedColor = palette[customMarkers.length % palette.length];
            customMarkers.push({ idx: currentIdx, color: assignedColor }); if (threeDInitialized) sync3DMarkers(); updateVisualComponents(currentIdx);
        }
    });
    document.getElementById('clearMarksBtn').addEventListener('click', () => { customMarkers = []; if (threeDInitialized) sync3DMarkers(); updateVisualComponents(currentIdx); });
    document.getElementById('simpleTrackerIcon').addEventListener('change', () => { if (filteredData.length > 0 && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]); });

    document.getElementById('togglePfd').addEventListener('change', (e) => {
        // Reveal the Press->GPS Alt sub-option in its reserved slot (elbow-connected under PFD),
        // rather than inserting a cell that reflows the other filters.
        const gpsContainer = document.getElementById('gpsAltContainer');
        gpsContainer.classList.toggle('child-off', !e.target.checked);
        if (!e.target.checked) document.getElementById('toggleGpsAlt').checked = false;
        if (filteredData.length > 0) { const pfd = document.getElementById('pfdOverlay'); pfd.style.display = e.target.checked ? 'block' : 'none'; resizeCanvasLayout(); updateVisualComponents(currentIdx); }
    });

    document.getElementById('toggleImperial').addEventListener('change', () => { if (filteredData.length > 0) { buildChartLayout(); updateVisualComponents(currentIdx); } });
    document.getElementById('toggleGpsAlt').addEventListener('change', () => { if (filteredData.length > 0) { if (trackerModeSelect.value === '3d') build3DScene(); updateVisualComponents(currentIdx); } });
    
    videoSyncMode.addEventListener('change', (e) => {
        if (e.target.value === 'auto') { ocrIndicator.style.display = 'block'; document.getElementById('videoStartInput').disabled = true; document.getElementById('forceSyncBtn').style.display = 'inline-block'; } 
        else { ocrIndicator.style.display = 'none'; if (videoLoaded) document.getElementById('videoStartInput').disabled = false; document.getElementById('forceSyncBtn').style.display = 'none'; }
        applySyncModeLock();
        refreshSyncingIndicator();  // hide the badge immediately when leaving Auto-Sync
    });
