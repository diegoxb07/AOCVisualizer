/* Mission Visualizer - 2D map projection + render engine
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    // Shift a longitude into the flight-centered window [lonDomainCenter-180, lonDomainCenter+180)
    // so a dateline-crossing flight (e.g. Hawaii -> Asia) projects continuously instead of
    // snapping across the whole map. Identity (lonDomainCenter 0) for normal flights.
    function wrapLon(lon) {
        if (!lonDomainCenter) return lon;
        return ((lon - lonDomainCenter) % 360 + 540) % 360 - 180 + lonDomainCenter;
    }

    function calculateMapScales() {
        const rawLons = filteredData.map(d => d.lon); const lats = filteredData.map(d => d.lat);
        // A dateline crosser reads as a ~360-degree raw span "the wrong way round". Re-center
        // the longitude domain on the flight's circular-mean longitude so bounds, zoom, and
        // every layer projected through getX stay continuous.
        lonDomainCenter = 0;
        if (rawLons.length && Math.max(...rawLons) - Math.min(...rawLons) > 180) {
            let sx = 0, sy = 0;
            rawLons.forEach(l => { const r = l * Math.PI / 180; sx += Math.cos(r); sy += Math.sin(r); });
            lonDomainCenter = Math.atan2(sy, sx) * 180 / Math.PI;
        }
        const lons = rawLons.map(wrapLon);
        const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const centerLon = (minLon + maxLon)/2; const centerLat = (minLat + maxLat)/2;
        deltaLon = (maxLon - minLon)*1.6 || 0.2; deltaLat = (maxLat - minLat)*1.6 || 0.2; 
        const cosLat = Math.cos(centerLat * Math.PI/180); const canvasRatio = cssW / cssH; const dataRatio = (deltaLon * cosLat) / deltaLat;
        if (dataRatio > canvasRatio) deltaLat = (deltaLon * cosLat) / canvasRatio; else deltaLon = (deltaLat * canvasRatio) / cosLat;
        plotMinLon = centerLon - deltaLon/2; plotMaxLon = centerLon + deltaLon/2; plotMinLat = centerLat - deltaLat/2; plotMaxLat = centerLat + deltaLat/2;
    }

    // Projection works in LOGICAL css pixels; the renderers apply the DPR base transform.
    function getX(lon) { return ((wrapLon(lon) - plotMinLon) / deltaLon) * cssW; }
    function getY(lat) { return cssH - ((lat - plotMinLat) / deltaLat) * cssH; }

    // Geographic bounds currently visible (depends on pan/zoom). Used to draw the WHOLE world map
    // but only the parts on screen - so Africa etc. appear when you zoom out, with no perf hit when
    // zoomed into the flight.
    function getVisibleGeoBounds() {
        if (!cssW || !cssH || !deltaLon) return null;
        const x0 = (0 - mapOffsetX) / mapScale, x1 = (cssW - mapOffsetX) / mapScale;
        const y0 = (0 - mapOffsetY) / mapScale, y1 = (cssH - mapOffsetY) / mapScale;
        const lonAt = bx => plotMinLon + (bx / cssW) * deltaLon;
        const latAt = by => plotMinLat + ((cssH - by) / cssH) * deltaLat;
        return { minLon: lonAt(Math.min(x0, x1)), maxLon: lonAt(Math.max(x0, x1)),
                 minLat: latAt(Math.max(y0, y1)), maxLat: latAt(Math.min(y0, y1)) };
    }
    function isBoxInView(bbox, lonShift = 0) {
        if (!bbox) return true;
        const v = getVisibleGeoBounds(); if (!v) return true;
        const m = 3;
        return !(bbox[0] + lonShift > v.maxLon + m || bbox[2] + lonShift < v.minLon - m || bbox[1] > v.maxLat + m || bbox[3] < v.minLat - m);
    }

    function getHurricaneColorRGB(spd) {
        if (spd === null || spd === undefined || spd < 0) spd = 0;
        if (spd <= 63) return [0, 0, 0];
        if (spd <= 82) return [1, 1, 0.8];
        if (spd <= 95) return [1, 0.91, 0.46];
        if (spd <= 112) return [1, 0.76, 0.25];
        if (spd <= 136) return [1, 0.56, 0.13];
        return [1, 0.38, 0.38];
    }

    function getBarbColorMode() {
        const el = document.getElementById('barbColorSelect');
        return el && el.value === 'hurricane' ? 'hurricane' : 'wind';
    }

    function getPathColorRGB(d, idx) {
        const mode = document.getElementById('pathColorSelect').value;
        if (mode === 'temp') {
            let t = d.tempr; if (t === null || tempBaseline[idx] === null) return [1, 1, 1];
            let delta = t - tempBaseline[idx]; let f = Math.min(Math.abs(delta) / 3.0, 1);
            if (delta > 0) return [1, 1 - f, 1 - f]; else return [1 - f, 1 - f, 1];
        }
        if (getBarbColorMode() === 'hurricane') return getHurricaneColorRGB(d.windSpd);
        return getSpdColorRGB(d.windSpd);
    }

    function getSpdColorRGB(spd) {
        if (!spd || spd < 0) spd = 0; let r, g, b;
        if (spd < 50) { let f = spd / 50; r = 0; g = 255 * f; b = 255; } 
        else if (spd < 80) { let f = (spd - 50) / 30; r = 0; g = 255; b = 255 - (255 * f); } 
        else if (spd < 100) { let f = (spd - 80) / 20; r = 255 * f; g = 255; b = 0; } 
        else if (spd < 130) { let f = (spd - 100) / 30; r = 255; g = 255 - (127 * f); b = 0; } 
        else { let f = Math.min((spd - 130) / 30, 1); r = 255; g = 128 - (128 * f); b = 0; }
        return [r/255, g/255, b/255];
    }
    
    function getSpdColor(spd) { const [r, g, b] = getSpdColorRGB(spd); return `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`; }

    function getBarbColorRGB(spd) {
        return getBarbColorMode() === 'hurricane' ? getHurricaneColorRGB(spd) : getSpdColorRGB(spd);
    }

    function getBarbColor(spd) { const [r, g, b] = getBarbColorRGB(spd); return `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`; }

    function getBarbSpacingPx() {
        // Screen-px gap between barbs along the track. The zoomed-out cap sets density at
        // low zoom (was 30 - too sparse); zoomed in this converges to the same 8px floor.
        const zoom = Math.max(mapScale, 0.35);
        return Math.min(16, Math.max(8, 30 / zoom));
    }

    function getBarbScale() {
        return 1;
    }

    // Best-track overlay for the storm the loaded mission belongs to (js/12b-recon-archive.js), spanning
    // its whole life - not just the flight's window. Drawn UNDER the flight track/plane so the flight
    // stays the visually dominant element; getX/getY project it exactly like everything else on this
    // map (they're linear in lon/lat, not tied to the flight's own bounds).
    function drawStormTrack2D() {
        if (!showStormTrack || stormTrackPoints.length < 2) return;
        ctx.save();
        ctx.lineWidth = 2 / mapScale; ctx.globalAlpha = 0.85; ctx.setLineDash([6 / mapScale, 4 / mapScale]);
        for (let i = 1; i < stormTrackPoints.length; i++) {
            const a = stormTrackPoints[i - 1], b = stormTrackPoints[i];
            ctx.beginPath(); ctx.strokeStyle = stormWindColor(b.windKt); ctx.moveTo(getX(a.lon), getY(a.lat)); ctx.lineTo(getX(b.lon), getY(b.lat)); ctx.stroke();
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1.0;
        // Each fix is a small tropical-cyclone map symbol: category-colored disc with the
        // category written inside (TD/TS/1-5), spiral arms from TS strength up, drawn
        // slightly translucent so the basemap/satellite stays readable underneath.
        stormTrackPoints.forEach((p, i) => {
            const hovered = i === hoveredStormIdx;
            const col = stormWindColor(p.windKt), lbl = stormCatLabel(p.windKt);
            ctx.save(); ctx.translate(getX(p.lon), getY(p.lat)); ctx.scale(1 / mapScale, 1 / mapScale);
            ctx.globalAlpha = hovered ? 1.0 : 0.82;
            if (!lbl) {   // unknown intensity: keep a plain small fix marker
                ctx.beginPath(); ctx.arc(0, 0, hovered ? 6 : 4, 0, 2 * Math.PI); ctx.fillStyle = col; ctx.fill();
                ctx.strokeStyle = hovered ? '#ffffff' : 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.2; ctx.stroke();
                ctx.restore(); return;
            }
            const r = hovered ? 8 : 6;
            if (p.windKt >= 34) {
                ctx.strokeStyle = col; ctx.lineWidth = r * 0.5; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.quadraticCurveTo(r * 1.9, -r * 1.35, r * 1.55, r * 0.45); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, r * 0.9); ctx.quadraticCurveTo(-r * 1.9, r * 1.35, -r * 1.55, -r * 0.45); ctx.stroke();
            }
            ctx.beginPath(); ctx.arc(0, 0, r, 0, 2 * Math.PI); ctx.fillStyle = col; ctx.fill();
            ctx.strokeStyle = hovered ? '#ffffff' : 'rgba(0,0,0,0.85)'; ctx.lineWidth = hovered ? 2 : 1.2; ctx.stroke();
            ctx.fillStyle = '#111827';
            ctx.font = '700 ' + (lbl.length > 1 ? r : r * 1.25) + 'px Inter, ui-sans-serif, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(lbl, 0, 0.5);
            ctx.restore();
        });
        ctx.restore();
    }

    function getPathColorHex(d, idx) {
        const mode = document.getElementById('pathColorSelect').value;
        if (mode === 'temp') { const [r,g,b] = getPathColorRGB(d, idx); return `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`; }
        const [r,g,b] = getPathColorRGB(d, idx);
        return `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
    }

    function drawWindBarbFrame(x, y, dir, spd, scale, isDynamic = false) {
        const strokeColor = getBarbColor(spd); const barbScale = getBarbScale();
        ctx.save(); ctx.translate(x, y); let mult = isDynamic ? 1.4 : 1; ctx.scale((mult * barbScale) / scale, (mult * barbScale) / scale); ctx.rotate((dir - 90) * Math.PI/180);
        const drawShapes = () => {
            const shaftLength = 18 * barbScale; const featherBase = 6 * barbScale; const featherSpread = 0.85 * barbScale;
            ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(shaftLength, 0); ctx.stroke();
            let k = Math.round(spd/5)*5; let hx = shaftLength; const xa = Math.cos(60*Math.PI/180)*featherBase; const ya = Math.sin(60*Math.PI/180)*featherBase;
            while (k >= 50) { ctx.beginPath(); ctx.moveTo(hx,0); ctx.lineTo(hx-xa,ya); ctx.lineTo(hx-(3 * featherSpread),0); ctx.closePath(); ctx.fill(); ctx.stroke(); hx-=4 * featherSpread; k-=50; }
            while (k >= 10) { ctx.beginPath(); ctx.moveTo(hx,0); ctx.lineTo(hx-xa,ya); ctx.stroke(); hx-=3 * featherSpread; k-=10; }
            if (k >= 5) { ctx.beginPath(); ctx.moveTo(hx,0); ctx.lineTo(hx-xa/2,ya/2); ctx.stroke(); }
        };
        const isBlackBarb = strokeColor === 'rgb(0, 0, 0)';
        if (isBlackBarb) {
            ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.6 * barbScale; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; drawShapes();
        }
        if (isDynamic) { ctx.strokeStyle = '#000000'; ctx.fillStyle = '#000000'; ctx.lineWidth = 2.0 * barbScale; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; drawShapes(); }
        ctx.strokeStyle = strokeColor; ctx.fillStyle = strokeColor; ctx.lineWidth = 1.0 * barbScale; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; drawShapes();
        ctx.restore();
    }
    
    function renderBackground() {
        if (!bgCanvas.width || !bgCanvas.height) return; 
        bgCtx.setTransform(1, 0, 0, 1, 0, 0); bgCtx.fillStyle = '#161b22'; bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
        bgCtx.save(); bgCtx.setTransform(DPR, 0, 0, DPR, 0, 0); bgCtx.translate(mapOffsetX, mapOffsetY); bgCtx.scale(mapScale, mapScale);

        const satSel2 = document.getElementById('satelliteSelect'); const isSatOn = satSel2 && satSel2.value !== 'none';
        if (satImageLoaded && isSatOn && satImage.width > 0) {
            bgCtx.globalAlpha = 0.92;
            if (satImageBox) {
                const dx = getX(satImageBox.minLon), dy = getY(satImageBox.maxLat), dw = getX(satImageBox.maxLon) - getX(satImageBox.minLon), dh = getY(satImageBox.minLat) - getY(satImageBox.maxLat);
                bgCtx.drawImage(satImage, dx, dy, dw, dh);
            } else { bgCtx.drawImage(satImage, 0, 0, cssW, cssH); }
            bgCtx.globalAlpha = 1.0;
        }
        if (mapFeatures.length > 0) {
            bgCtx.fillStyle = isSatOn ? 'rgba(21,128,61,0.25)' : '#15803d'; bgCtx.strokeStyle = isSatOn ? 'rgba(220,220,220,0.7)' : '#000000'; bgCtx.lineWidth = 1.5 / mapScale;
            // Draw the whole world, cull only off-screen - and repeat it once shifted ±360 so a
            // dateline-centered view (or panning past ±180 zoomed out) shows continuous land
            // instead of an empty seam. One copy each way is plenty: even at min zoom the
            // viewport can't span three worlds. The copies are placed explicitly, so this pass
            // projects with the RAW (unwrapped) x - wrapping would cancel the shift.
            const getXShift = (lon, shift) => (((lon + shift) - plotMinLon) / deltaLon) * cssW;
            for (const shift of [0, -360, 360]) {
                mapFeatures.forEach(feature => {
                    if (!isBoxInView(feature.properties.bbox, shift)) return;
                    const geom = feature.geometry; if (!geom) return;
                    const isState = feature.properties && feature.properties.isState === true;
                    if (geom.type === 'Polygon') {
                        bgCtx.beginPath(); geom.coordinates.forEach(ring => { ring.forEach((coord, i) => { const x = getXShift(coord[0], shift); const y = getY(coord[1]); if (i === 0) bgCtx.moveTo(x, y); else bgCtx.lineTo(x, y); }); });
                        if (!isState) bgCtx.fill('evenodd'); bgCtx.stroke();
                    } else if (geom.type === 'MultiPolygon') {
                        geom.coordinates.forEach(poly => { bgCtx.beginPath(); poly.forEach(ring => { ring.forEach((coord, i) => { const x = getXShift(coord[0], shift); const y = getY(coord[1]); if (i === 0) bgCtx.moveTo(x, y); else bgCtx.lineTo(x, y); }); });
                        if (!isState) bgCtx.fill('evenodd'); bgCtx.stroke(); });
                    }
                });
            }
        }
        bgCtx.restore(); bgNeedsUpdate = false;
    }

    function renderMapEngineFrame(idx, visualRow) {
        if (!canvas.width || !canvas.height) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1.0; ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (bgNeedsUpdate) renderBackground();
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(bgCanvas, 0, 0);   // bgCanvas is already device-res
        // Base transform = devicePixelRatio, then the map pan/zoom. Everything below draws in logical px.
        ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.translate(mapOffsetX, mapOffsetY); ctx.scale(mapScale, mapScale);

        drawStormTrack2D();

        ctx.lineWidth = 2.5/mapScale; ctx.globalAlpha = 0.8;
        let lastX = getX(filteredData[0].lon), lastY = getY(filteredData[0].lat);
        for (let i = 1; i <= idx; i++) { 
            let curX = getX(filteredData[i].lon), curY = getY(filteredData[i].lat);
            if (Math.abs(curX - lastX) < 1 && Math.abs(curY - lastY) < 1 && i !== idx) continue;
            ctx.beginPath(); ctx.strokeStyle = getPathColorHex(filteredData[i], i); ctx.moveTo(lastX, lastY); ctx.lineTo(curX, curY); ctx.stroke();
            lastX = curX; lastY = curY;
        }
        
        ctx.beginPath(); ctx.strokeStyle = '#aaaaaa'; ctx.lineWidth = 1.5/mapScale; ctx.globalAlpha = 0.3;
        lastX = getX(filteredData[idx].lon); lastY = getY(filteredData[idx].lat); ctx.moveTo(lastX, lastY);
        for (let i = idx + 1; i < filteredData.length; i++) { 
            let curX = getX(filteredData[i].lon), curY = getY(filteredData[i].lat);
            if (Math.abs(curX - lastX) < 1 && Math.abs(curY - lastY) < 1 && i !== filteredData.length - 1) continue;
            ctx.lineTo(curX, curY); lastX = curX; lastY = curY;
        } 
        ctx.stroke(); ctx.globalAlpha = 1.0;

        const targetSpacing = getBarbSpacingPx();
        let lastBarbIdx = -1;
        let lastBarbX = null;
        let lastBarbY = null;
        for (let i = 0; i <= idx; i++) {
            const d = filteredData[i];
            if (d.windDir === null || d.windSpd === null) continue;
            if (lastBarbIdx < 0) {
                drawWindBarbFrame(getX(d.lon), getY(d.lat), d.windDir, d.windSpd, mapScale);
                lastBarbIdx = i;
                lastBarbX = getX(d.lon);
                lastBarbY = getY(d.lat);
                continue;
            }
            const x = getX(d.lon), y = getY(d.lat);
            const distPx = Math.hypot((x - lastBarbX) * mapScale, (y - lastBarbY) * mapScale);
            if (distPx >= targetSpacing) {
                drawWindBarbFrame(x, y, d.windDir, d.windSpd, mapScale);
                lastBarbIdx = i;
                lastBarbX = x;
                lastBarbY = y;
            }
        }
        if (idx >= 0 && filteredData[idx] && filteredData[idx].windDir !== null && filteredData[idx].windSpd !== null && lastBarbIdx !== idx) {
            const d = filteredData[idx]; drawWindBarbFrame(getX(d.lon), getY(d.lat), d.windDir, d.windSpd, mapScale);
        }

        let dPlane = visualRow || filteredData[idx];
        if (dPlane) { 
            const d = dPlane; ctx.save(); ctx.translate(getX(d.lon), getY(d.lat)); ctx.scale(1/mapScale, 1/mapScale); 
            const zoomFactor = Math.max(1, Math.pow(mapScale, 0.6));
            if (document.getElementById('simpleTrackerIcon').checked) {
                ctx.beginPath(); ctx.arc(0, 0, 3 * zoomFactor, 0, 2 * Math.PI); ctx.fillStyle = '#ef4444'; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5 * zoomFactor; ctx.stroke();
            } else {
                const planeScale = 0.22 * zoomFactor; let t_th = d.th ?? 0; let t_track = d.gTrack ?? 0;
                ctx.save(); ctx.rotate((t_track - 90) * Math.PI/180); 
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(25 * zoomFactor, 0); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2 * zoomFactor; ctx.stroke();
                ctx.beginPath(); ctx.moveTo(32 * zoomFactor, 0); ctx.lineTo(24 * zoomFactor, -3 * zoomFactor); ctx.lineTo(24 * zoomFactor, 3 * zoomFactor); ctx.closePath(); ctx.fillStyle = '#38bdf8'; ctx.fill(); ctx.restore();
                ctx.save(); ctx.rotate((t_th - 90) * Math.PI/180); ctx.scale(planeScale, planeScale); (isGulfstreamFlight() ? drawGulfstreamIV : drawP3Orion)(ctx); ctx.restore();
            }
            ctx.restore(); 

            if (d.windDir !== null && d.windSpd !== null) {
                let headOffset = (d.th !== null ? d.th : (d.gTrack || 0)) * (Math.PI / 180);
                const noseDist = 5.5 * zoomFactor / mapScale; let noseX = getX(d.lon) + Math.sin(headOffset) * noseDist; let noseY = getY(d.lat) - Math.cos(headOffset) * noseDist;
                drawWindBarbFrame(noseX, noseY, d.windDir, d.windSpd, mapScale, true);
            }
        }

        customMarkers.forEach(marker => {
            if (marker.idx <= idx && filteredData[marker.idx]) {
                const mx = getX(filteredData[marker.idx].lon); const my = getY(filteredData[marker.idx].lat);
                ctx.save(); ctx.translate(mx, my); ctx.scale(1/mapScale, 1/mapScale); ctx.beginPath(); ctx.arc(0, 0, 8, 0, 2 * Math.PI); ctx.fillStyle = marker.color; ctx.fill(); ctx.strokeStyle = '#000000'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
            }
        });

        const toScreenPt = (lon, lat) => ({ x: getX(lon) * mapScale + mapOffsetX, y: getY(lat) * mapScale + mapOffsetY });
        const drawCanvasButton = (kind, shapeIndex, sx, sy, label, bg) => {
            const r = 11;
            ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            ctx.beginPath(); ctx.arc(sx, sy, r, 0, 2 * Math.PI); ctx.fillStyle = bg; ctx.fill();
            ctx.lineWidth = 1.5; ctx.strokeStyle = '#0b0e13'; ctx.stroke();
            if (label === '✓') {
                // Vector checkmark - crisper across displays/scales than relying on the system
                // font's rendering of the ✓ glyph at this small a size.
                ctx.beginPath();
                ctx.moveTo(sx - 4.5, sy + 0.5); ctx.lineTo(sx - 1.5, sy + 3.5); ctx.lineTo(sx + 5, sy - 4);
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
            } else {
                ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, sx, sy + 0.5);
            }
            ctx.restore();
            measureButtons.push({ kind, shapeIndex, sx, sy, r: r + 4 });
        };
        const shapeScreenBBox = (type, pts) => {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            pts.forEach(p => { const s = toScreenPt(p.lon, p.lat); minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y); });
            if (type === 'circle' && pts.length === 2) {
                const c = toScreenPt(pts[0].lon, pts[0].lat); const ed = toScreenPt(pts[1].lon, pts[1].lat);
                const rPx = Math.hypot(ed.x - c.x, ed.y - c.y); minX = c.x - rPx; maxX = c.x + rPx; minY = c.y - rPx; maxY = c.y + rPx;
            }
            return { minX, maxX, minY, maxY };
        };
        const statBox = (sx, sy, lines) => {
            ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            const w = 124, h = 14 + lines.length * 15;
            let bx = sx - w - 6, by = sy; if (bx < 4) bx = sx + 6; if (by < 4) by = 4;
            ctx.fillStyle = 'rgba(22, 27, 34, 0.9)'; ctx.fillRect(bx, by, w, h);
            ctx.font = 'bold 11px sans-serif';
            lines.forEach((ln, i) => { ctx.fillStyle = ln.c; ctx.fillText(ln.t, bx + 6, by + 18 + i * 15); });
            ctx.restore();
        };

        const drawShapeGeometry = (type, pts, isActiveShape, shapeIndex, isHovered) => {
            if (pts.length === 0) return;
            const stroke = isHovered ? '#7dd3fc' : '#38bdf8';
            const fill = isHovered ? 'rgba(56, 189, 248, 0.38)' : 'rgba(56, 189, 248, 0.25)';
            // Measurement/preview line widths (original sizes - the DPR transform, not a fatter line, is what keeps them crisp).
            ctx.save(); ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = (type === 'polygon' ? 5 : 3) / mapScale;
            if (type === 'polygon') {
                const P = pts.map(p => ({ x: getX(p.lon), y: getY(p.lat) }));
                // Filled area for a closed polygon (3+ points).
                if (pts.length >= 3) {
                    ctx.setLineDash([]); ctx.beginPath();
                    P.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
                    ctx.closePath(); ctx.fill();
                }
                // Connecting line: build the WHOLE path, THEN stroke once. (Previously the vertex dots
                // were drawn inside this loop and each ctx.beginPath() wiped the line - which is why a
                // plain 2-point distance line, having no fill to mask it, showed nothing.)
                let totalDist = 0, liveSegDist = 0;
                ctx.setLineDash([9 / mapScale, 5 / mapScale]); ctx.beginPath();
                P.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else { ctx.lineTo(p.x, p.y); totalDist += getDistanceNM(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon); }
                });
                if (isActiveShape && isMeasuring && liveMouseGeo) {
                    ctx.lineTo(getX(liveMouseGeo.lon), getY(liveMouseGeo.lat));
                    liveSegDist = getDistanceNM(pts[pts.length-1].lat, pts[pts.length-1].lon, liveMouseGeo.lat, liveMouseGeo.lon);
                    totalDist += liveSegDist;
                }
                ctx.stroke();
                ctx.setLineDash([]);
                // Vertex dots, drawn AFTER the line so their own paths can't clobber it.
                P.forEach(p => {
                    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1/mapScale, 1/mapScale);
                    ctx.beginPath(); ctx.arc(0, 0, 5, 0, 2 * Math.PI); ctx.fillStyle = '#facc15'; ctx.fill();
                    ctx.strokeStyle = '#0b0e13'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
                });
                // Readout boxes.
                if (isActiveShape && isMeasuring && liveMouseGeo) {
                    let maxDiam = 0; const tempPts = [...pts, liveMouseGeo];
                    for (let i = 0; i < tempPts.length; i++) { for (let j = i + 1; j < tempPts.length; j++) { const d = getDistanceNM(tempPts[i].lat, tempPts[i].lon, tempPts[j].lat, tempPts[j].lon); if (d > maxDiam) maxDiam = d; } }
                    const liveX = (getX(liveMouseGeo.lon) * mapScale) + mapOffsetX + 130; const liveY = (getY(liveMouseGeo.lat) * mapScale) + mapOffsetY;
                    statBox(liveX, liveY - 45, [{t:`Seg: ${liveSegDist.toFixed(1)} NM`,c:'#38bdf8'},{t:`Tot: ${totalDist.toFixed(1)} NM`,c:'#fff'},{t:`Diam: ${maxDiam.toFixed(1)} NM`,c:'#facc15'}]);
                } else if (!isMeasuring && isHovered && pts.length >= 3) {
                    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180; let maxDiam = 0;
                    pts.forEach((p, i) => {
                        if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat; if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
                        for (let j = i + 1; j < pts.length; j++) { const d = getDistanceNM(p.lat, p.lon, pts[j].lat, pts[j].lon); if (d > maxDiam) maxDiam = d; }
                    });
                    const widthNM = getDistanceNM(minLat, minLon, minLat, maxLon); const heightNM = getDistanceNM(minLat, minLon, maxLat, minLon);
                    const bb = shapeScreenBBox(type, pts);
                    statBox(bb.minX, bb.minY - 4, [{t:'Bounds:',c:'#38bdf8'},{t:`${widthNM.toFixed(1)} x ${heightNM.toFixed(1)} NM`,c:'#fff'},{t:`Diam: ${maxDiam.toFixed(1)} NM`,c:'#facc15'}]);
                } else if (!isMeasuring && isHovered && pts.length === 2) {
                    const lenNM = getDistanceNM(pts[0].lat, pts[0].lon, pts[1].lat, pts[1].lon);
                    const mid = toScreenPt((pts[0].lon + pts[1].lon) / 2, (pts[0].lat + pts[1].lat) / 2);
                    statBox(mid.x, mid.y - 4, [{t:'Length:',c:'#38bdf8'},{t:`${lenNM.toFixed(1)} NM`,c:'#fff'}]);
                }
            } else if (type === 'circle') {
                const centerGeo = pts[0]; const edgeGeo = pts.length === 2 ? pts[1] : (liveMouseGeo || centerGeo);
                const rNM = getDistanceNM(centerGeo.lat, centerGeo.lon, edgeGeo.lat, edgeGeo.lon);
                const cx = getX(centerGeo.lon), cy = getY(centerGeo.lat); const ex = getX(edgeGeo.lon), ey = getY(edgeGeo.lat); const rPx = Math.sqrt(Math.pow(ex-cx, 2) + Math.pow(ey-cy, 2));
                ctx.beginPath(); ctx.arc(cx, cy, rPx, 0, 2*Math.PI); ctx.fill(); ctx.setLineDash([6 / mapScale, 4 / mapScale]); ctx.stroke();
                ctx.beginPath(); ctx.arc(cx, cy, 4/mapScale, 0, 2 * Math.PI); ctx.fillStyle = '#facc15'; ctx.fill();
                if (rPx > 0) {
                    ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
                    if ((isActiveShape && isMeasuring) || (!isMeasuring && isHovered)) {
                        const anchor = (isActiveShape && isMeasuring) ? toScreenPt(edgeGeo.lon, edgeGeo.lat) : shapeScreenBBox(type, pts);
                        const ax = (isActiveShape && isMeasuring) ? anchor.x + 130 : anchor.minX; const ay = (isActiveShape && isMeasuring) ? anchor.y : anchor.minY - 4;
                        statBox(ax, ay - (isActiveShape ? 50 : 0), [{t:`Radius: ${rNM.toFixed(1)} NM`,c:'#38bdf8'},{t:`Area: ${(Math.PI * rNM * rNM).toFixed(1)} NM²`,c:'#fff'},{t:`Diam: ${(rNM * 2).toFixed(1)} NM`,c:'#facc15'}]);
                    }
                }
            } else if (type === 'rectangle') {
                const p1 = pts[0]; const p2 = pts.length === 2 ? pts[1] : (liveMouseGeo || p1);
                const x1 = getX(p1.lon), y1 = getY(p1.lat); const x2 = getX(p2.lon), y2 = getY(p2.lat); const widthNM = getDistanceNM(p1.lat, p1.lon, p1.lat, p2.lon); const heightNM = getDistanceNM(p1.lat, p1.lon, p2.lat, p1.lon);
                ctx.beginPath(); ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2-x1), Math.abs(y2-y1)); ctx.fill(); ctx.setLineDash([6 / mapScale, 4 / mapScale]); ctx.stroke();
                if (Math.abs(x2-x1) > 0) {
                    if ((isActiveShape && isMeasuring) || (!isMeasuring && isHovered)) {
                        const diamNM = getDistanceNM(p1.lat, p1.lon, p2.lat, p2.lon);
                        const anchor = (isActiveShape && isMeasuring) ? toScreenPt(p2.lon, p2.lat) : shapeScreenBBox(type, pts);
                        const ax = (isActiveShape && isMeasuring) ? anchor.x + 130 : anchor.minX; const ay = (isActiveShape && isMeasuring) ? anchor.y : anchor.minY - 4;
                        statBox(ax, ay - (isActiveShape ? 50 : 0), [{t:`${widthNM.toFixed(1)} x ${heightNM.toFixed(1)} NM`,c:'#38bdf8'},{t:`Area: ${(widthNM * heightNM).toFixed(1)} NM²`,c:'#fff'},{t:`Diam: ${diamNM.toFixed(1)} NM`,c:'#facc15'}]);
                    }
                }
            }
            ctx.restore();

            // On-canvas button: ✓ to finish the active shape (any type, once 2+ points exist). Deletion is via the Clear button.
            if (isActiveShape && isMeasuring && pts.length >= 2) {
                const bb = shapeScreenBBox(type, pts);
                const fx = (bb.minX + bb.maxX) / 2; const fy = bb.minY - 16;
                drawCanvasButton('finish', -1, fx, fy, '✓', '#16a34a');
                // "Click ... to finish" caption around the checkmark.
                ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.font = 'bold 11px sans-serif'; ctx.textBaseline = 'middle';
                ctx.textAlign = 'right'; const lw = ctx.measureText('Click').width;
                ctx.fillStyle = 'rgba(22,27,34,0.9)'; ctx.fillRect(fx - 18 - lw - 4, fy - 9, lw + 8, 18);
                ctx.fillStyle = '#4ade80'; ctx.fillText('Click', fx - 18, fy + 1);
                ctx.textAlign = 'left'; const rw = ctx.measureText('to finish').width;
                ctx.fillStyle = 'rgba(22,27,34,0.9)'; ctx.fillRect(fx + 16, fy - 9, rw + 8, 18);
                ctx.fillStyle = '#4ade80'; ctx.fillText('to finish', fx + 20, fy + 1);
                ctx.restore();
            }
        };

        measureButtons = [];
        drawnShapes.forEach((shape, i) => drawShapeGeometry(shape.type, shape.points, false, i, i === hoveredShapeIndex));
        if (measurePointsGeo.length > 0) drawShapeGeometry(measureShape, measurePointsGeo, true, -1, false);

        ctx.restore();
    }

