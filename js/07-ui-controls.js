/* Mission Visualizer - DOM refs, sync-mode, 3D scene, control wiring
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

    const canvas = document.getElementById('mapCanvas'), ctx = canvas.getContext('2d'), video = document.getElementById('radarVideo'), hud = document.getElementById('hudOverlay'), mapPlaceholder = document.getElementById('mapPlaceholder'), playPauseBtn = document.getElementById('playPauseBtn'), timelineSlider = document.getElementById('timelineSlider'), timelineTimeDisplay = document.getElementById('timelineTimeDisplay'), speedDownBtn = document.getElementById('speedDownBtn'), speedDisplayBtn = document.getElementById('speedDisplayBtn'), speedUpBtn = document.getElementById('speedUpBtn'), replayBtn = document.getElementById('replayBtn'), videoSyncMode = document.getElementById('videoSyncMode'), ocrIndicator = document.getElementById('ocrIndicator'), fullscreenBtn = document.getElementById('fullscreenBtn'), fullscreenMapBtn = document.getElementById('fullscreenMapBtn'), fullscreenVideoBtn = document.getElementById('fullscreenVideoBtn'), mapPanel = document.getElementById('mapPanel'), videoPanel = document.getElementById('videoPanel'), trackerModeSelect = document.getElementById('trackerModeSelect'), threeDContainer = document.getElementById('threeDContainer'), attitudeHud = document.getElementById('attitudeHud'), stickyBottomBar = document.getElementById('stickyBottomBar');

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

    // G-IV (NOAA49) glyph for the 2D tracker - same coordinate frame as drawP3Orion
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

    function init3D() {
        if (threeDInitialized) return;
        const w = threeDContainer.clientWidth || canvas.width, h = threeDContainer.clientHeight || canvas.height, aspect = w / (h || 1);
        scene3D = new THREE.Scene(); scene3D.background = new THREE.Color(0x0f172a);
        camera3D = new THREE.PerspectiveCamera(45, aspect, 0.1, 50000); camera3D.position.set(0, 10, 20);
        renderer3D = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer3D.setSize(w, h); threeDContainer.insertBefore(renderer3D.domElement, threeDContainer.firstChild);
        controls3D = new THREE.OrbitControls(camera3D, renderer3D.domElement); controls3D.enableDamping = true;
        scene3D.add(new THREE.AmbientLight(0xffffff, 0.6)); const dirLight = new THREE.DirectionalLight(0xffffff, 0.8); dirLight.position.set(10, 20, 10); scene3D.add(dirLight);
        planeGroup3D = new THREE.Group(); const matWhite = new THREE.MeshPhongMaterial({color: 0xffffff}), matBlue = new THREE.MeshPhongMaterial({color: 0x3da5ff});
        const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 16), matWhite); fuselage.rotation.x = Math.PI / 2; const wings = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.1, 0.8), matBlue); const tail = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.5), matBlue); tail.position.set(0, 0, 1.8); const vTail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.6), matBlue); vTail.position.set(0, 0.5, 1.8); const noseMat = new THREE.MeshPhongMaterial({ color: 0xffffff }); const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 16), noseMat); nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0, -2.4);
        planeGroup3D.add(fuselage, wings, tail, vTail, nose); planeGroup3D.scale.set(0.15, 0.15, 0.15); scene3D.add(planeGroup3D);
        const arrowGroup = new THREE.Group(); const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8), new THREE.MeshBasicMaterial({color: 0x3da5ff})); shaft.rotation.x = Math.PI / 2; shaft.position.z = -1.8; const head = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 8), new THREE.MeshBasicMaterial({color: 0x3da5ff})); head.rotation.x = Math.PI / 2; head.position.z = -2.7; arrowGroup.add(shaft, head); arrowGroup.scale.set(0.7, 0.7, 0.7);
        trackArrow3D = arrowGroup; scene3D.add(trackArrow3D); scene3D.add(threeMapGroup); scene3D.add(threeMarkersGroup);
        function animate3D() { requestAnimationFrame(animate3D); if (controls3D) controls3D.update(); renderer3D.render(scene3D, camera3D); }
        animate3D(); threeDInitialized = true;
    }

    function get3DCoord(lon, lat, altMeters) {
        if (isNaN(lon) || isNaN(lat)) return new THREE.Vector3(0,0,0);
        const centerLon = (plotMinLon + plotMaxLon) / 2 || 0, centerLat = (plotMinLat + plotMaxLat) / 2 || 0, scaleMult = 20;
        // wrapLon (js/15-map-render.js) keeps dateline-crossing flights continuous here too;
        // safe because build3DScene only renders flight-adjacent features (never the far seam).
        const x = (wrapLon(lon) - centerLon) * scaleMult, z = -(lat - centerLat) * scaleMult, y = (altMeters || 0) / 250; return new THREE.Vector3(x, y, z);
    }

    function sync3DMarkers() {
        if (!threeDInitialized) return;
        while(threeMarkersGroup.children.length > 0) threeMarkersGroup.remove(threeMarkersGroup.children[0]);
        const markerGeo = new THREE.SphereGeometry(0.08, 16, 16), useGps = document.getElementById('toggleGpsAlt').checked;
        customMarkers.forEach(marker => {
            const d = filteredData[marker.idx];
            if(d) {
                const markerMat = new THREE.MeshPhongMaterial({color: marker.color}); const mesh = new THREE.Mesh(markerGeo, markerMat);
                const altM = useGps ? (d.gpsAlt !== null ? d.gpsAlt : (d.pAlt !== null ? d.pAlt : 0)) : (d.pAlt !== null ? d.pAlt : (d.gpsAlt !== null ? d.gpsAlt : 0));
                mesh.position.copy(get3DCoord(d.lon, d.lat, altM)); mesh.userData = { dataPoint: d }; threeMarkersGroup.add(mesh);
            }
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
            const useGps = document.getElementById('toggleGpsAlt').checked; const pathPts = []; const colors = [];
            filteredData.forEach((d, idx) => {
                const altM = useGps ? (d.gpsAlt !== null ? d.gpsAlt : (d.pAlt !== null ? d.pAlt : 0)) : (d.pAlt !== null ? d.pAlt : (d.gpsAlt !== null ? d.gpsAlt : 0));
                pathPts.push(get3DCoord(d.lon, d.lat, altM)); const [r, g, b] = getPathColorRGB(d, idx); colors.push(r, g, b);
            });
            const pathGeom = new THREE.BufferGeometry().setFromPoints(pathPts); pathGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            const trackMat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 3 }); const coloredTrack3D = new THREE.Line(pathGeom, trackMat); threeMapGroup.add(coloredTrack3D);
        }
        // Storm best-track overlay (js/12b-recon-archive.js) - same points as the 2D layer, flattened to
        // sea level (get3DCoord's altitude term stays 0) since it spans the storm's whole life, not the
        // flight's altitude profile.
        if (showStormTrack && stormTrackPoints.length > 1) {
            const stormPts = [], stormColors = [];
            stormTrackPoints.forEach(p => {
                stormPts.push(get3DCoord(p.lon, p.lat, 0));
                const hex = stormWindColor(p.windKt); const c = new THREE.Color(hex); stormColors.push(c.r, c.g, c.b);
            });
            const stormGeom = new THREE.BufferGeometry().setFromPoints(stormPts); stormGeom.setAttribute('color', new THREE.Float32BufferAttribute(stormColors, 3));
            const stormMat = new THREE.LineDashedMaterial({ vertexColors: true, linewidth: 2, dashSize: 0.3, gapSize: 0.2 });
            const stormTrack3D = new THREE.Line(stormGeom, stormMat); stormTrack3D.computeLineDistances(); threeMapGroup.add(stormTrack3D);
        }
        sync3DMarkers();
    }

    function update3DFrame(idx, visualRow) {
        if (!threeDInitialized || !filteredData[idx]) return;
        const d = visualRow || filteredData[idx], useGps = document.getElementById('toggleGpsAlt').checked;
        const altM = useGps ? (d.gpsAlt !== null ? d.gpsAlt : (d.pAlt !== null ? d.pAlt : 0)) : (d.pAlt !== null ? d.pAlt : (d.gpsAlt !== null ? d.gpsAlt : 0));
        const pos = get3DCoord(d.lon, d.lat, altM);
        planeGroup3D.position.copy(pos);
        let t_pitch = d.pitch ?? 0, t_th = d.th ?? 0, t_roll = d.roll ?? 0, t_track = d.gTrack ?? 0;
        planeGroup3D.rotation.set(THREE.MathUtils.degToRad(t_pitch), THREE.MathUtils.degToRad(-t_th), THREE.MathUtils.degToRad(-t_roll), 'YXZ');
        trackArrow3D.position.copy(pos); trackArrow3D.rotation.set(0, THREE.MathUtils.degToRad(-t_track), 0);
        camera3D.position.x += (pos.x - controls3D.target.x); camera3D.position.y += (pos.y - controls3D.target.y); camera3D.position.z += (pos.z - controls3D.target.z);
        controls3D.target.copy(pos); controls3D.update();
        attitudeHud.innerHTML = `PITCH: ${t_pitch.toFixed(1)}°<br>ROLL: ${t_roll.toFixed(1)}°<br>HDG: ${t_th.toFixed(1)}°<br>TRK: ${t_track.toFixed(1)}°`;
    }

    // Real fullscreen is page-level ONLY. The panel ⛶ buttons "fake" fullscreen instead:
    // pin the panel over the whole viewport (.fake-fs, styled by the same CSS as :fullscreen
    // via :is()) and take the page fullscreen too if it isn't already. Switching panel <->
    // page view is then a single click - nested element fullscreen forced an exit-then-
    // re-enter (and needed the sticky bottom bar re-parented into the panel; the fixed
    // z-2000 bar now just stays above the z-1500 fake panel).
    const refreshAfterViewChange = () => setTimeout(() => { resizeCanvasLayout(); if (filteredData.length > 0) { if (trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]); if (document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]); } }, 100);
    const setFakePanel = (panel) => {
        mapPanel.classList.toggle('fake-fs', panel === mapPanel);
        videoPanel.classList.toggle('fake-fs', panel === videoPanel);
        // The main top-right button (z-9999, fixed) sits exactly on the pinned panel's own ⛶
        // and would steal its clicks (real element-fullscreen used to hide it via the top
        // layer) - hide it while a panel is pinned; Esc still exits real fullscreen.
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
            // For archive-GOES layers, updateBandOptions() just reset satBandSelect to its blank
            // "Choose a product…" placeholder - fetchSatelliteImage/maybeAutoPrecacheSatellite both
            // no-op on an empty product, so nothing fetches or builds until the satBandSelect handler
            // below fires with an actual pick. Polar (MODIS/VIIRS) layers have no placeholder and fetch
            // their single daily image immediately, same as always.
            fetchSatelliteImage(filteredData[currentIdx].absSeconds);
            maybeAutoPrecacheSatellite();
            renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
        }
    });

    document.getElementById('satBandSelect').addEventListener('change', () => {
        satImageLoaded = false; lastSatFetchTime = ''; bgNeedsUpdate = true; resetSatPreload();
        if (filteredData.length > 0 && trackerModeSelect.value === '2d') {
            // Archived (recon-api) satellites stream a tile per 10-min scan from the API, which can
            // pause playback - so picking a bbox-capable product auto-builds its whole timeframe up
            // front (maybeAutoPrecacheSatellite) instead of trickling in during playback. A full-disk-
            // only composite (sandwich/geocolor) skips that and just streams per-frame like a polar layer.
            fetchSatelliteImage(filteredData[currentIdx].absSeconds);
            maybeAutoPrecacheSatellite();
            renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
        }
    });

    document.getElementById('pathColorSelect').addEventListener('change', () => { if (filteredData.length > 0) { if (threeDInitialized) build3DScene(); renderMapEngineFrame(currentIdx, filteredData[currentIdx]); } });
    document.getElementById('barbColorSelect').addEventListener('change', () => { if (filteredData.length > 0) { if (threeDInitialized) build3DScene(); renderMapEngineFrame(currentIdx, filteredData[currentIdx]); } });
    document.getElementById('toggle8Hz').addEventListener('change', () => { if (filteredData.length > 0) updateVisualComponents(currentIdx); });

    document.getElementById('markBtn').addEventListener('click', () => {
        if (!customMarkers.find(m => m.idx === currentIdx)) {
            const palette = ['#fbbf24', '#ef4444', '#38bdf8', '#10b981', '#a855f7', '#f472b6', '#0ea5e9']; const assignedColor = palette[customMarkers.length % palette.length];
            customMarkers.push({ idx: currentIdx, color: assignedColor }); if (threeDInitialized) sync3DMarkers(); updateVisualComponents(currentIdx);
        }
    });
    document.getElementById('clearMarksBtn').addEventListener('click', () => { customMarkers = []; if (threeDInitialized) sync3DMarkers(); updateVisualComponents(currentIdx); });
    document.getElementById('simpleTrackerIcon').addEventListener('change', () => { if (filteredData.length > 0 && trackerModeSelect.value === '2d') renderMapEngineFrame(currentIdx, filteredData[currentIdx]); });

    document.getElementById('togglePfd').addEventListener('change', (e) => { 
        const gpsContainer = document.getElementById('gpsAltContainer');
        if (e.target.checked) { gpsContainer.classList.remove('hidden'); gpsContainer.classList.add('flex'); } 
        else { gpsContainer.classList.add('hidden'); gpsContainer.classList.remove('flex'); document.getElementById('toggleGpsAlt').checked = false; }
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
