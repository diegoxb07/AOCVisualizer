/* Mission Visualizer, bundled low-res terrain (ETOPO) for the 3D basemap
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   data/etopo-heightmap.png is a 721x361 (0.5 deg) global ETOPO elevation grid, source NOAA NCEI via
   the CoastWatch ERDDAP (etopo180). Elevation in metres is packed into the R and G channels:
   elev = (R*256 + G) - 11000. Row 0 is the north edge (+90 lat), columns run west (-180) to east.
   It gives the 3D basemap real land height and tells land from sea, so a flight over high ground sits
   at the correct height relative to the terrain. */

    const TERRAIN_OFFSET = 11000;   // packed value = elev + this; see data/etopo-heightmap.png
    let _terrain = null;            // { w, h, data: Float32Array } once the png decodes, else null

    function isTerrainLoaded() { return !!_terrain; }

    // Bilinearly sampled ground elevation (metres) at a lat/lon; 0 until the grid loads.
    function terrainElevationMeters(lat, lon) {
        if (!_terrain) return 0;
        const w = _terrain.w, h = _terrain.h, data = _terrain.data;
        const L = ((lon + 180) % 360 + 360) % 360 - 180;   // wrap to -180..180
        const fx = (L + 180) / 360 * (w - 1);
        const fy = (90 - lat) / 180 * (h - 1);             // row 0 = north (+90)
        const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
        const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        const e00 = data[y0 * w + x0], e10 = data[y0 * w + x1], e01 = data[y1 * w + x0], e11 = data[y1 * w + x1];
        return (e00 * (1 - tx) + e10 * tx) * (1 - ty) + (e01 * (1 - tx) + e11 * tx) * ty;
    }

    // Color (0..1 rgb): one flat ocean below sea level, green->tan->snow above it. Depth is not
    // shaded, the sea floor's shape being no part of what this map is read for, so water carries a
    // single tone per theme, pitched to hold against the 3D scene background (scene3DBgColor in
    // js/07-ui-controls.js) rather than against the 2D basemap's darker ocean, which the water here
    // would sink into. Land keeps one ramp across themes: its mid-tones hold against both.
    function terrainColorRGB(e) {
        if (e < 0) {
            return (document.documentElement.dataset.theme === 'light')
                ? [0.58, 0.72, 0.85]
                : [0.07, 0.20, 0.32];
        }
        const t = Math.max(0, Math.min(1, e / 4000));
        if (t < 0.5) { const s = t / 0.5; return [0.17 + 0.36 * s, 0.42 - 0.05 * s, 0.20 - 0.01 * s]; }   // green -> tan
        const s = (t - 0.5) / 0.5; return [0.53 + 0.30 * s, 0.37 + 0.34 * s, 0.18 + 0.55 * s];             // tan -> snow
    }

    // How far from an end the ground is pulled toward the aircraft, and how far off the grid may be
    // before that end is taken as airborne rather than on a field.
    const TERRAIN_PIN_DEG = 1.5;
    const TERRAIN_PIN_MAX_M = 300;

    // The ends of the track, each with the gap between the aircraft there and the grid's idea of the
    // ground under it. The grid samples ETOPO every 0.5 degrees, about 55 km, so a field's own
    // elevation is averaged into its surroundings and the aircraft can sit tens of metres under or
    // over the rendered ground at exactly the two moments it should be touching it.
    // An end whose gap is larger than TERRAIN_PIN_MAX_M is left alone: the aircraft is genuinely
    // airborne there (the parser drops rows under 20 kt, so a track can open already climbing), and
    // it should read that way rather than drag a plateau up under itself.
    function terrainPins() {
        if (typeof filteredData === 'undefined' || filteredData.length < 2) return [];
        if (typeof track3DAltMeters !== 'function') return [];
        const out = [];
        [filteredData[0], filteredData[filteredData.length - 1]].forEach(d => {
            if (!d || d.lat == null || d.lon == null) return;
            const delta = track3DAltMeters(d) - terrainElevationMeters(d.lat, d.lon);
            if (Math.abs(delta) > TERRAIN_PIN_MAX_M) return;
            out.push({ lat: d.lat, lon: d.lon, delta });
        });
        return out;
    }

    // The pins in force for the current scene. Refreshed by refreshTerrainPins() at each build, so
    // the surface and everything draped on it read one ground.
    let _terrainPins = [];
    function refreshTerrainPins() { _terrainPins = terrainPins(); }

    // Ground elevation with the ends pinned to the aircraft, fading out over TERRAIN_PIN_DEG. Only
    // the nearest pin applies, so a there-and-back mission that starts and ends on the same field
    // corrects once rather than twice. This is the raw ground, which runs below sea level over
    // water; terrainSurfaceMeters below is what the map is drawn at.
    function terrainGroundMeters(lat, lon) {
        const e = terrainElevationMeters(lat, lon);
        if (!_terrainPins.length) return e;
        let best = null, bestD = Infinity;
        for (let i = 0; i < _terrainPins.length; i++) {
            const p = _terrainPins[i], dLon = (lon - p.lon) * Math.cos(lat * Math.PI / 180), dLat = lat - p.lat;
            const d = Math.hypot(dLon, dLat);
            if (d < bestD) { bestD = d; best = p; }
        }
        if (!best || bestD >= TERRAIN_PIN_DEG) return e;
        const t = bestD / TERRAIN_PIN_DEG;
        return e + best.delta * (1 - t * t * (3 - 2 * t));   // smoothstep out to the radius
    }

    // The height the map is drawn at: land carries relief and water lies flat at sea level, but for
    // a pin's reach of a field, where the ground rides up to meet the aircraft. Anything laid on the
    // surface reads this rather than the raw ground, or it would sink under the sea wherever the
    // grid puts the ground below it.
    function terrainSurfaceMeters(lat, lon) { return Math.max(0, terrainGroundMeters(lat, lon)); }

    // A terrain surface over the flight's horizontal extent (plus margin), sampled from the grid and
    // placed with the SAME mapping as the track (get3DCoord). Returns a THREE.Group, or null if the
    // grid has not loaded or three.js / plot bounds are not ready.
    function buildTerrainMesh3D() {
        if (!_terrain || typeof THREE === 'undefined' || typeof get3DCoord !== 'function') return null;
        if (typeof plotMinLon === 'undefined' || plotMinLon == null) return null;
        // This mesh is the colored surface in 3D (the flat land fills only build when the grid is
        // absent), so the pad is what decides how much ground the map shows. Kept close to the
        // flight: relief far from it carries no information about the mission and competes with the
        // track for the eye. The grid stays finer than the source's own 0.5 degree spacing at a
        // typical storm's span, so the sampling costs no detail.
        const spanLon = (plotMaxLon - plotMinLon) || 1, spanLat = (plotMaxLat - plotMinLat) || 1, pad = 0.4;
        const lon0 = plotMinLon - spanLon * pad, lon1 = plotMaxLon + spanLon * pad;
        const lat0 = plotMinLat - spanLat * pad, lat1 = plotMaxLat + spanLat * pad;
        const NX = 120, NY = 120;
        const grp = new THREE.Group();
        const verts = [], colors = [], idx = [];
        for (let iy = 0; iy < NY; iy++) {
            for (let ix = 0; ix < NX; ix++) {
                const lon = lon0 + (lon1 - lon0) * ix / (NX - 1);
                const lat = lat0 + (lat1 - lat0) * iy / (NY - 1);
                // Height reads the drawn surface, colour the raw ground. A pin reaches 300 m, enough
                // to carry a shallow coastal cell over sea level, and colouring off it would paint
                // the pin's whole radius as land out into the water.
                const p = get3DCoord(lon, lat, terrainSurfaceMeters(lat, lon));
                verts.push(p.x, p.y, p.z);
                const c = terrainColorRGB(terrainElevationMeters(lat, lon));
                colors.push(c[0], c[1], c[2]);
            }
        }
        for (let iy = 0; iy < NY - 1; iy++) {
            for (let ix = 0; ix < NX - 1; ix++) {
                const a = iy * NX + ix, b = a + 1, c = a + NX, d = c + 1;
                idx.push(a, c, b, b, c, d);
            }
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geom.setIndex(idx);
        const terrain = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
        terrain.renderOrder = -2;   // draw under the track, storm ribbon and plane
        grp.add(terrain);
        return grp;
    }

    // Decode the packed elevation png into a Float32Array once, on window load (so assetVer and the
    // 3D scene helpers exist). Rebuilds a live 3D flight so the terrain shows without a manual nudge.
    function loadTerrainGrid() {
        const img = new Image();
        img.onload = () => {
            try {
                const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
                const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
                const id = c.getImageData(0, 0, img.width, img.height).data;
                const w = img.width, h = img.height, data = new Float32Array(w * h);
                for (let i = 0; i < w * h; i++) data[i] = (id[i * 4] * 256 + id[i * 4 + 1]) - TERRAIN_OFFSET;
                _terrain = { w, h, data };
                // if a flight is already up in 3D, rebuild so the terrain appears immediately.
                if (typeof threeDInitialized !== 'undefined' && threeDInitialized && typeof filteredData !== 'undefined'
                    && filteredData.length && typeof build3DScene === 'function') build3DScene();
            } catch (e) { _terrain = null; }
        };
        img.onerror = () => { _terrain = null; };
        img.src = 'data/etopo-heightmap.png' + (typeof assetVer === 'function' ? assetVer() : '');
    }
    window.addEventListener('load', loadTerrainGrid);
