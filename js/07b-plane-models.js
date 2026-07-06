/* Mission Visualizer, 3D aircraft models (WP-3D Orion + Gulfstream IV-SP)
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   Builds the tracker's 3D airframe procedurally (lofted fuselage, airfoil wing panels, nacelles,
   props) with the NOAA livery painted onto canvas textures: white top, navy belly, sky cheatline,
   navy tail with the white swoosh and tail registration. The WP-3D carries its mission hardware
   (black nose radome, chin + belly radomes, tail Doppler boom, four turboprops); the G-IV carries
   winglets, aft fuselage nacelles, the T-tail, and its tail Doppler tube. setPlaneModel3D() picks
   the airframe from the loaded flight id (isGulfstreamFlight) and swaps it inside planeGroup3D.

   Conventions: nose at -Z, tail +Z, up +Y, span along X, all sizes in plane-local units
   (planeGroup3D applies the world scale). Fuselage textures map u around the hull (0 = belly,
   0.5 = top) and v along it (0 = nose, 1 = tail). */

    let planeModelGroup3D = null;    // airframe-only group inside planeGroup3D (crew and arrows live outside it)
    let planeModelType3D = null;     // 'p3' | 'giv'
    let planeSpinners3D = [];        // propeller groups, spun by the 3D render loop

    const NOAA_LIV = { white: '#f2f5f7', navy: '#1b4a94', sky: '#7ec8ec', black: '#1d2126', dark: '#2b3540', metal: '#aab4bd', prop: '#23272c' };

    // Cabin geometry the crew view sizes itself from, per airframe (plane-local units).
    const PLANE_CABIN_SPECS = {
        p3:  { floorY: -0.10, halfW: 0.20, figScale: 0.62, seatsZ: [-1.30, -0.70, -0.05, 0.60] },
        giv: { floorY: -0.08, halfW: 0.16, figScale: 0.50, seatsZ: [-0.85, -0.35, 0.15, 0.65] }
    };
    function activeCabinSpec() { return PLANE_CABIN_SPECS[planeModelType3D] || PLANE_CABIN_SPECS.p3; }

    // Tail registration for the fin decal: NOAA42/43 are the two WP-3Ds, NOAA49 the G-IV.
    function noaaTailReg(type) {
        if (type === 'giv') return 'N49RF';
        const s = ((typeof flightMetaData !== 'undefined' && flightMetaData) ? (flightMetaData.aircraft + ' ' + flightMetaData.id) : '');
        return (/noaa43/i.test(s) || /\d{8}I\d/i.test(s)) ? 'N43RF' : 'N42RF';
    }

    // ---------------------------------------------------------------------------------------
    // Geometry helpers

    // Skin a list of same-length 3D point loops into one closed surface with end caps.
    // uv: u = section fraction (spanwise), v = loop fraction, or the chord fraction folded onto
    // both surfaces when foldV is set (used by textured fins so a decal reads on either side).
    function loftGeometry(sections, opts) {
        opts = opts || {};
        const P = sections[0].length, S = sections.length, row = P + 1;
        const pos = [], uvs = [], idx = [];
        for (let s = 0; s < S; s++) {
            for (let p = 0; p <= P; p++) {
                const v = sections[s][p % P];
                pos.push(v.x, v.y, v.z);
                let vv = p / P;
                if (opts.foldV) vv = vv <= 0.5 ? vv * 2 : 2 - vv * 2;
                uvs.push(s / (S - 1), vv);
            }
        }
        for (let s = 0; s < S - 1; s++) for (let p = 0; p < P; p++) {
            const a = s * row + p, b = a + 1, c = a + row + 1, d = a + row;
            idx.push(a, b, d, b, c, d);
        }
        [0, S - 1].forEach((s, capI) => {
            const start = pos.length / 3;
            for (let p = 0; p < P; p++) { const v = sections[s][p]; pos.push(v.x, v.y, v.z); uvs.push(capI, p / P); }
            for (let p = 1; p < P - 1; p++) {
                if (capI === 0) idx.push(start, start + p + 1, start + p);
                else idx.push(start, start + p, start + p + 1);
            }
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        return geo;
    }

    // Closed airfoil outline: [chordwise 0..chord, thickness +up/-down], leading edge first,
    // around the trailing edge and back along the underside. Slightly cambered (flatter bottom).
    function airfoilLoop(chord, thick) {
        const ts = [0, 0.03, 0.09, 0.18, 0.32, 0.5, 0.7, 0.88, 1];
        const pts = ts.map(t => [t * chord, chord * thick * 2.4 * Math.sqrt(t) * (1 - t)]);
        for (let i = ts.length - 2; i >= 1; i--) { const t = ts[i]; pts.push([t * chord, -chord * thick * 1.6 * Math.sqrt(t) * (1 - t)]); }
        return pts;
    }

    // One horizontal lifting-surface panel (half a wing or stabilizer). root = leading edge of the
    // root section; side +1/-1 mirrors it.
    function wingPanel(o) {
        const tanS = Math.tan((o.sweepDeg || 0) * Math.PI / 180), tanD = Math.tan((o.dihedralDeg || 0) * Math.PI / 180);
        const segs = o.segs || 3, sections = [];
        for (let s = 0; s <= segs; s++) {
            const f = s / segs, dist = o.halfSpan * f, chord = o.rootChord + (o.tipChord - o.rootChord) * f;
            sections.push(airfoilLoop(chord, o.thick || 0.10).map(([cw, th]) => new THREE.Vector3(
                o.root.x + o.side * dist,
                o.root.y + tanD * dist + th,
                o.root.z + tanS * dist + cw
            )));
        }
        return new THREE.Mesh(loftGeometry(sections), o.mat);
    }

    // Vertical surface (fin/winglet) built at the origin, leading edge of the base at (0,0,0),
    // span along +Y; the caller positions and cants the mesh.
    function finPanel(o) {
        const tanS = Math.tan((o.sweepDeg || 0) * Math.PI / 180);
        const segs = o.segs || 3, sections = [];
        for (let s = 0; s <= segs; s++) {
            const f = s / segs, h = o.height * f, chord = o.rootChord + (o.tipChord - o.rootChord) * f;
            sections.push(airfoilLoop(chord, o.thick || 0.09).map(([cw, th]) => new THREE.Vector3(th, h, tanS * h + cw)));
        }
        return new THREE.Mesh(loftGeometry(sections, { foldV: !!o.foldV }), o.mat);
    }

    // Body of revolution along Z from stations [{ z, r, y }], y = centerline offset (nose droop /
    // tail upsweep). uv.y is remapped to the z fraction so textures paint in station space.
    function bodyLathe(stations, mat, radial) {
        const pts = stations.map(s => new THREE.Vector2(Math.max(0.008, s.r), s.z));
        const geo = new THREE.LatheGeometry(pts, radial || 24);
        geo.rotateX(Math.PI / 2);
        const pos = geo.attributes.position, uv = geo.attributes.uv;
        const z0 = stations[0].z, z1 = stations[stations.length - 1].z;
        for (let i = 0; i < pos.count; i++) {
            const j = Math.round(uv.getY(i) * (stations.length - 1));
            pos.setY(i, pos.getY(i) + (stations[j].y || 0));
            uv.setY(i, (pos.getZ(i) - z0) / (z1 - z0));
        }
        geo.computeVertexNormals();
        return new THREE.Mesh(geo, mat);
    }

    // Four-blade propeller facing -Z: spinner cone, pitched paddle blades, and a faint spin disc.
    // The render loop spins everything in planeSpinners3D about Z.
    function buildProp(o, mats) {
        const grp = new THREE.Group();
        const spinner = new THREE.Mesh(new THREE.ConeGeometry(o.spinnerR, o.spinnerLen, 16), o.spinnerMat || mats.metal);
        spinner.rotation.x = -Math.PI / 2; spinner.position.z = -o.spinnerLen / 2;
        grp.add(spinner);
        // black paddle blades with the red/white/blue tip bands NOAA's props carry
        const bandMats = ['#d23b2f', '#f2f5f7', '#1b4a94'].map(c => new THREE.MeshPhongMaterial({ color: c, shininess: 30 }));
        for (let i = 0; i < 4; i++) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(o.bladeW, o.bladeLen, 0.012), mats.prop);
            blade.position.y = o.spinnerR * 0.4 + o.bladeLen / 2;
            blade.rotation.y = 0.5;
            const bandH = o.bladeLen * 0.055;
            bandMats.forEach((bm, bi) => {
                const band = new THREE.Mesh(new THREE.BoxGeometry(o.bladeW + 0.003, bandH, 0.014), bm);
                band.position.y = o.bladeLen / 2 - bandH / 2 - bi * bandH;
                blade.add(band);
            });
            const holder = new THREE.Group(); holder.add(blade); holder.rotation.z = i * Math.PI / 2 + 0.3;
            grp.add(holder);
        }
        const disc = new THREE.Mesh(
            new THREE.CircleGeometry(o.spinnerR * 0.4 + o.bladeLen + 0.01, 28),
            new THREE.MeshBasicMaterial({ color: 0x30343a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
        disc.userData.noDim = true;   // stays translucent; the crew-ride dim pass must not touch it
        grp.add(disc);
        return grp;
    }

    // ---------------------------------------------------------------------------------------
    // Livery textures (canvas painted, so the whole app stays asset-free)

    function makePlaneTexture(cv) {
        const tex = new THREE.CanvasTexture(cv);
        tex.flipY = false;   // canvas row 0 = v 0, so texture v tracks the painted station fraction directly
        if (typeof renderer3D !== 'undefined' && renderer3D && renderer3D.capabilities) tex.anisotropy = renderer3D.capabilities.getMaxAnisotropy();
        return tex;
    }

    // Navy keel band around u=0/u=1 whose half-width follows widthFn(v), with the sky cheatline
    // riding its upper edge.
    function paintBellyAndCheat(g, W, H, widthFn, v0, v1) {
        [0, 1].forEach(side => {
            g.fillStyle = NOAA_LIV.navy;
            g.beginPath();
            g.moveTo(side === 0 ? 0 : W, v0 * H);
            for (let i = 0; i <= 64; i++) {
                const v = v0 + (v1 - v0) * i / 64, x = W * widthFn(v);
                g.lineTo(side === 0 ? x : W - x, v * H);
            }
            g.lineTo(side === 0 ? 0 : W, v1 * H);
            g.closePath(); g.fill();
            // double cheatline riding the keel edge: sky stripe with a thin navy pinline above it
            [[NOAA_LIV.sky, 0.014, 5], [NOAA_LIV.navy, 0.034, 2]].forEach(([color, off, lw]) => {
                g.strokeStyle = color; g.lineWidth = lw;
                g.beginPath();
                for (let i = 0; i <= 64; i++) {
                    const v = v0 + (v1 - v0) * i / 64, x = W * (widthFn(v) + off);
                    g[i ? 'lineTo' : 'moveTo'](side === 0 ? x : W - x, v * H);
                }
                g.stroke();
            });
        });
    }

    // Registration or title text on both hull sides at height band u (right side; left mirrors to
    // 1-u), each side through its own reflection so the letters run nose-to-tail and stay upright.
    function paintHullTextPair(g, W, H, u, y, text, color, px, hs) {
        hs = hs || 1;   // letter-height stretch around the hull, so narrow tail sections don't squeeze the glyphs
        g.fillStyle = color; g.font = 'bold ' + px + 'px sans-serif'; g.textBaseline = 'middle';
        [[u, -1, 1, 'right'], [1 - u, 1, -1, 'left']].forEach(([uu, sx, sy, align]) => {
            g.save(); g.translate(W * uu, y);
            g.rotate(Math.PI / 2); g.scale(sx, sy * hs); g.textAlign = align;
            g.fillText(text, 0, 0); g.restore();
        });
    }

    // Fuselage hull texture. spec: { len, z0, radomeEndZ (black nose, or null), windshield {z0,z1},
    // windows [{ z }], windowOval, bellyWidthFn, bellyV0, bellyV1, emblemZ, titleZ,
    // tailWrap { zTop, slope } (navy tail paint sweeping down onto the aft fuselage),
    // reg { text, z, u, color } (tail registration painted on the hull sides) }
    function fuselageTexture(spec) {
        const W = 512, H = 1024;
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const g = cv.getContext('2d');
        const vOf = z => (z - spec.z0) / spec.len;
        g.fillStyle = NOAA_LIV.white; g.fillRect(0, 0, W, H);
        paintBellyAndCheat(g, W, H, spec.bellyWidthFn, spec.bellyV0, spec.bellyV1);
        // navy tail paint flowing off the fin down over the aft fuselage: highest at the crown,
        // sloping aft as it wraps down the sides toward the belly
        if (spec.tailWrap) {
            const wrapZ = u => spec.tailWrap.zTop + Math.pow(Math.abs(u - 0.5) * 2, 1.5) * spec.tailWrap.slope * 0.5;
            g.fillStyle = NOAA_LIV.navy;
            g.beginPath(); g.moveTo(0, H);
            for (let i = 0; i <= 64; i++) { const u = i / 64; g.lineTo(W * u, vOf(wrapZ(u)) * H); }
            g.lineTo(W, H); g.closePath(); g.fill();
            g.strokeStyle = NOAA_LIV.sky; g.lineWidth = 4;
            g.beginPath();
            for (let i = 0; i <= 64; i++) { const u = i / 64; g[i ? 'lineTo' : 'moveTo'](W * u, vOf(wrapZ(u) - 0.05) * H); }
            g.stroke();
        }
        if (spec.radomeEndZ != null) {
            g.fillStyle = NOAA_LIV.black;
            g.fillRect(0, 0, W, vOf(spec.radomeEndZ) * H);
            // anti-glare wedge running from the radome back to the windshield, top of the nose
            g.beginPath();
            g.moveTo(W * 0.40, vOf(spec.radomeEndZ) * H); g.lineTo(W * 0.60, vOf(spec.radomeEndZ) * H);
            g.lineTo(W * 0.57, vOf(spec.windshield.z1) * H); g.lineTo(W * 0.43, vOf(spec.windshield.z1) * H);
            g.closePath(); g.fill();
        }
        // cockpit glass: a wide band wrapped over the crown, reaching down both sides so the
        // windshield reads from a side view, framed by white posts
        const wsY0 = vOf(spec.windshield.z0) * H, wsY1 = vOf(spec.windshield.z1) * H;
        g.fillStyle = NOAA_LIV.black;
        g.fillRect(W * 0.31, wsY0, W * 0.38, wsY1 - wsY0);
        g.strokeStyle = '#e8ecef'; g.lineWidth = 3;
        [0.385, 0.46, 0.54, 0.615].forEach(u => { g.beginPath(); g.moveTo(W * u, wsY0); g.lineTo(W * u, wsY1); g.stroke(); });
        g.strokeRect(W * 0.31, wsY0, W * 0.38, wsY1 - wsY0);
        // cabin windows on both sides, just above the side line
        g.fillStyle = NOAA_LIV.black;
        spec.windows.forEach(z => {
            const y = vOf(z) * H;
            [0.285, 0.715].forEach(u => {
                g.beginPath();
                if (spec.windowOval) g.ellipse(W * u, y, 5, 8, 0, 0, Math.PI * 2);
                else g.arc(W * u, y, 4.5, 0, Math.PI * 2);
                g.fill();
            });
        });
        // No fuselage titles (the real livery carries none): just the small tail registration
        // wherever this airframe's livery puts it, and the roundel above the window line.
        if (spec.reg) paintHullTextPair(g, W, H, spec.reg.u, vOf(spec.reg.z) * H, spec.reg.text, spec.reg.color, spec.reg.px || 18, spec.reg.hs || 1.8);
        // roundel rides the window line, beside the first window rather than above the row
        const sideXf = [[0.285, -1, 1], [0.715, 1, -1]];
        const tex = makePlaneTexture(cv);
        // roundel ahead of the titles: the app's own NOAA logo, drawn through each side's
        // orientation transform so it sits upright on the hull; texture refreshes when it loads.
        // Fetched and drawn via a Blob URL so the canvas never taints (a file://-loaded image
        // would poison the WebGL texture upload); under file:// the fetch fails and the plain
        // livery stands without the roundel.
        fetch('assets/noaa-logo.svg').then(r => r.ok ? r.text() : null).then(svg => {
            if (!svg) return;
            const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
            const logo = new Image();
            logo.onload = () => {
                const r = 20;
                sideXf.forEach(([u, sx, sy]) => {
                    g.save(); g.translate(W * u, vOf(spec.emblemZ) * H);
                    g.rotate(Math.PI / 2); g.scale(sx, sy);
                    g.drawImage(logo, -r, -r, r * 2, r * 2); g.restore();
                });
                tex.needsUpdate = true;
                URL.revokeObjectURL(url);
            };
            logo.src = url;
        }).catch(() => {});
        return tex;
    }

    // Fin decal texture: navy field, the large white swoosh, and the US flag above it. Canvas x =
    // height fraction (root to tip), y = the loft's loop fraction: the +X face maps to y [0, H/2]
    // (LE to TE) and the -X face to y [H, H/2], so each face is painted separately.
    function finTexture() {
        const W = 256, H = 256;
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const g = cv.getContext('2d');
        g.fillStyle = NOAA_LIV.navy; g.fillRect(0, 0, W, H);
        g.strokeStyle = NOAA_LIV.sky; g.lineWidth = 5;
        g.beginPath(); g.moveTo(W * 0.04, 0); g.lineTo(W * 0.04, H); g.stroke();
        [{ cy: c => c * H * 0.5 }, { cy: c => H - c * H * 0.5 }].forEach(f => {
            const P = (hx, c) => [W * hx, f.cy(c)];   // (height fraction, chord fraction) -> canvas
            // the NOAA seagull: two thick upswept wings meeting at a small body with a beak,
            // wingtips toward the fin tip. Local frame: x across the chord, y up the fin; the
            // y-shear leans the decal forward against the fin's sweep so it reads upright.
            const B = (x, y) => P(0.22 + y * 0.50, 0.24 + x * 0.68 - y * 0.22);
            const bez = (x1, y1, x2, y2, x3, y3) => { const a = B(x1, y1), b = B(x2, y2), c = B(x3, y3); g.bezierCurveTo(a[0], a[1], b[0], b[1], c[0], c[1]); };
            const lin = (x, y) => { const p = B(x, y); g.lineTo(p[0], p[1]); };
            g.fillStyle = '#ffffff';
            g.beginPath();
            const s = B(0.02, 0.97); g.moveTo(s[0], s[1]);
            bez(0.13, 0.83, 0.28, 0.42, 0.47, 0.13);   // left wing inner edge, sagging into the valley
            lin(0.53, 0.07);                            // across the body top
            lin(0.68, 0.10);                            // beak tip
            lin(0.58, 0.17);                            // beak underside back to body
            bez(0.68, 0.30, 0.80, 0.60, 0.97, 0.97);   // right wing inner edge up to tip
            bez(0.92, 0.48, 0.78, 0.18, 0.60, 0.10);   // right wing outer edge, bowed outward
            lin(0.46, -0.02);                           // tail point
            lin(0.42, 0.10);                            // tail notch
            bez(0.22, 0.12, 0.05, 0.45, 0.02, 0.97);   // left wing outer edge, bowed outward, back to tip
            g.closePath(); g.fill();
        });
        return makePlaneTexture(cv);
    }

    // Tiny US flag texture for the fin-tip decal quads (stripes horizontal, canton upper left).
    // Plain quads use the standard flipY texture convention, unlike the hull's station-mapped
    // textures, so this one is NOT built through makePlaneTexture.
    function usFlagTexture() {
        const cv = document.createElement('canvas'); cv.width = 66; cv.height = 40;
        const g = cv.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, 66, 40);
        g.fillStyle = '#b22234';
        for (let s = 0; s < 4; s++) g.fillRect(0, s * 2 * 40 / 7, 66, 40 / 7);
        g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, 28, 20);
        const tex = new THREE.CanvasTexture(cv);
        if (typeof renderer3D !== 'undefined' && renderer3D && renderer3D.capabilities) tex.anisotropy = renderer3D.capabilities.getMaxAnisotropy();
        return tex;
    }

    // A flat flag quad on each side of the fin near its tip; screen-aligned rectangles, so the
    // fin's sweep cannot shear the stripes.
    function addFinFlags(grp, pos) {
        const mat = new THREE.MeshBasicMaterial({ map: usFlagTexture(), side: THREE.DoubleSide });
        [1, -1].forEach(side => {
            const quad = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.09), mat);
            quad.rotation.y = side * Math.PI / 2;
            quad.position.set(side * pos.halfThick, pos.y, pos.z);
            grp.add(quad);
        });
    }

    // Framed windshield glass for the visor panes: dark glass split into panes by white posts,
    // so the visor carries the livery instead of reading as a plain black slab.
    let _visorTex = null;
    function visorTexture() {
        if (_visorTex) return _visorTex;
        const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
        const c = cv.getContext('2d');
        c.fillStyle = NOAA_LIV.black; c.fillRect(0, 0, 128, 64);
        c.strokeStyle = '#e8ecef'; c.lineWidth = 7;
        c.strokeRect(3, 3, 122, 58);
        c.beginPath(); c.moveTo(64, 0); c.lineTo(64, 64); c.stroke();
        _visorTex = new THREE.CanvasTexture(cv);
        return _visorTex;
    }

    // Raked cockpit glass: a near-vertical center pane and two side panes hugging the forehead,
    // each textured with framed window panes, so the windshield reads as real sloped glass.
    function addCockpitVisor(grp, o) {
        const mat = new THREE.MeshPhongMaterial({ map: visorTexture(), shininess: 85 });
        const mk = (yaw, dx, dy, dz) => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, 0.012), mat);
            p.rotation.order = 'YXZ'; p.rotation.y = yaw; p.rotation.x = -o.rake;
            p.position.set(dx, o.y + dy, o.z + dz);
            grp.add(p);
        };
        mk(0, 0, 0, 0);
        mk(o.yaw, -o.side, -o.drop, o.back);
        mk(-o.yaw, o.side, -o.drop, o.back);
    }

    function planeMats(fuselageTex, finTex) {
        return {
            hull: new THREE.MeshPhongMaterial({ map: fuselageTex, shininess: 55 }),
            fin: new THREE.MeshPhongMaterial({ map: finTex, shininess: 45, side: THREE.DoubleSide }),
            white: new THREE.MeshPhongMaterial({ color: NOAA_LIV.white, shininess: 45, side: THREE.DoubleSide }),
            navy: new THREE.MeshPhongMaterial({ color: NOAA_LIV.navy, shininess: 40, side: THREE.DoubleSide }),
            black: new THREE.MeshPhongMaterial({ color: NOAA_LIV.black, shininess: 25 }),
            dark: new THREE.MeshPhongMaterial({ color: NOAA_LIV.dark, shininess: 20 }),
            metal: new THREE.MeshPhongMaterial({ color: NOAA_LIV.metal, shininess: 80 }),
            prop: new THREE.MeshPhongMaterial({ color: NOAA_LIV.prop, shininess: 30 })
        };
    }

    // Thin blade antennas along the spine, a small recognizable AOC detail.
    function addAntennas(grp, mat, spots) {
        spots.forEach(([z, y, up]) => {
            const a = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.038, 0.055), mat);
            a.position.set(0, y + (up ? 0.012 : -0.012), z);
            grp.add(a);
        });
    }

    // ---------------------------------------------------------------------------------------
    // WP-3D Orion (NOAA42/NOAA43): four turboprops, black nose radome, chin + belly radomes,
    // tall fin with dorsal fillet, and the tail Doppler radar boom.
    function buildP3Model(reg) {
        const grp = new THREE.Group();
        const L = 5.2, Z0 = -2.6;
        const tex = fuselageTexture({
            len: L, z0: Z0, radomeEndZ: -2.04,
            windshield: { z0: -2.02, z1: -1.84 },
            windows: [-0.95, -0.65, 0.55, 0.75], windowOval: false,
            bellyWidthFn: v => v < 0.60 ? 0.17 : Math.max(0.05, 0.17 - (v - 0.60) * 0.40),
            bellyV0: 0.028, bellyV1: 0.92,
            emblemZ: -1.72,
            tailWrap: { zTop: 1.45, slope: 1.5 },
            reg: { text: reg, z: 1.76, u: 0.235, color: '#ffffff', px: 14 }
        });
        const mats = planeMats(tex, finTexture());

        // hull starts behind the radome; the crown climbs steeply between -2.06 and -1.90 (the
        // forehead face), with the windshield band and visor panes riding that slope
        grp.add(bodyLathe([
            { z: -2.30, r: 0.155, y: -0.03 }, { z: -2.18, r: 0.17, y: -0.022 }, { z: -2.06, r: 0.215, y: -0.008 },
            { z: -1.95, r: 0.242, y: 0 }, { z: -1.55, r: 0.25, y: 0 }, { z: -0.60, r: 0.25, y: 0 },
            { z: 0.60, r: 0.25, y: 0 }, { z: 1.20, r: 0.22, y: 0.02 }, { z: 1.80, r: 0.15, y: 0.07 },
            { z: 2.25, r: 0.08, y: 0.11 }, { z: 2.55, r: 0.032, y: 0.135 }
        ], mats.hull, 48));

        // the bulbous glossy black radome is its own body, hanging below the nose line and
        // tucking back into the hull, like the real airframe's search-radar nose
        const radomeMat = new THREE.MeshPhongMaterial({ color: 0x121417, shininess: 95 });
        grp.add(bodyLathe([
            { z: -2.64, r: 0.025, y: -0.075 }, { z: -2.57, r: 0.10, y: -0.072 }, { z: -2.44, r: 0.155, y: -0.062 },
            { z: -2.28, r: 0.172, y: -0.05 }, { z: -2.12, r: 0.145, y: -0.035 }, { z: -2.00, r: 0.09, y: -0.025 }
        ], radomeMat, 32));

        // raked cockpit glass hugging the forehead
        addCockpitVisor(grp, { y: 0.160, z: -2.00, rake: 0.62, w: 0.13, h: 0.10, yaw: 0.75, side: 0.11, drop: 0.03, back: 0.05 });

        // instrumented nose boom (gust probe): finely candy-striped, exiting slightly off-center
        // from the radome's upper shoulder with a touch of up-tilt
        const boomGrp = new THREE.Group();
        boomGrp.position.set(0.05, -0.03, -2.50); boomGrp.rotation.x = 0.05;
        const boomRed = new THREE.MeshPhongMaterial({ color: 0xd23b2f, shininess: 40 });
        const boomSegs = 14, boomLen = 0.60, segLen = boomLen / boomSegs;
        for (let bi = 0; bi < boomSegs; bi++) {
            const f0 = bi / boomSegs, f1 = (bi + 1) / boomSegs;
            const seg = new THREE.Mesh(
                new THREE.CylinderGeometry(0.009 + 0.005 * (1 - f1), 0.009 + 0.005 * (1 - f0), segLen, 10),
                bi % 2 ? mats.white : boomRed);
            seg.rotation.x = Math.PI / 2;
            seg.position.set(0, 0, -(bi + 0.5) * segLen);
            boomGrp.add(seg);
        }
        grp.add(boomGrp);

        // wings, low mounted with slight sweep and dihedral
        const wing = { rootChord: 0.68, tipChord: 0.30, halfSpan: 2.22, sweepDeg: 5, dihedralDeg: 5.5, thick: 0.11, mat: mats.white };
        grp.add(wingPanel({ ...wing, side: 1, root: { x: 0, y: -0.17, z: -0.55 } }));
        grp.add(wingPanel({ ...wing, side: -1, root: { x: 0, y: -0.17, z: -0.55 } }));

        // horizontal stabilizer
        const htail = { rootChord: 0.50, tipChord: 0.22, halfSpan: 0.80, sweepDeg: 8, dihedralDeg: 0, thick: 0.09, mat: mats.white };
        grp.add(wingPanel({ ...htail, side: 1, root: { x: 0, y: 0.12, z: 2.02 } }));
        grp.add(wingPanel({ ...htail, side: -1, root: { x: 0, y: 0.12, z: 2.02 } }));

        // fin with NOAA decal + dorsal fillet
        const fin = finPanel({ height: 0.88, rootChord: 0.78, tipChord: 0.34, sweepDeg: 35, thick: 0.07, mat: mats.fin });
        fin.position.set(0, 0.14, 1.72); grp.add(fin);
        addFinFlags(grp, { halfThick: 0.033, y: 0.86, z: 2.39 });
        const dorsal = finPanel({ height: 0.16, rootChord: 0.42, tipChord: 0.06, sweepDeg: 62, thick: 0.05, mat: mats.navy });
        dorsal.position.set(0, 0.16, 1.38); grp.add(dorsal);

        // tail Doppler radar boom off the tail cone
        const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.62, 14), mats.white);
        boom.rotation.x = Math.PI / 2; boom.position.set(0, 0.135, 2.72); grp.add(boom);
        const boomCap = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), mats.white);
        boomCap.position.set(0, 0.135, 3.03); grp.add(boomCap);

        // lower-fuselage C-band radome (the big belly dome) + chin radome, both dark sensor hardware
        const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 18), mats.dark);
        belly.scale.set(0.22, 0.085, 0.40); belly.position.set(0, -0.235, 0.15); grp.add(belly);
        const chin = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), mats.dark);
        chin.scale.set(0.10, 0.07, 0.14); chin.position.set(0, -0.185, -2.05); grp.add(chin);

        // four turboprops: nacelles hang forward of and below the wing, inners longer (gear bays)
        [[0.55, 1.0], [1.08, 0.78]].forEach(([xs, lenF]) => {
            [1, -1].forEach(side => {
                const x = xs * side, wingY = -0.17 + Math.tan(5.5 * Math.PI / 180) * xs;
                const nac = bodyLathe([
                    { z: 0, r: 0.068 }, { z: 0.05, r: 0.095 }, { z: 0.42, r: 0.10 },
                    { z: 0.42 + 0.30 * lenF, r: 0.078 }, { z: 0.42 + 0.53 * lenF, r: 0.028 }
                ], mats.white, 20);
                nac.position.set(x, wingY - 0.03, -0.98);
                grp.add(nac);
                const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.16), mats.dark);
                scoop.position.set(x, wingY + 0.075, -0.86); grp.add(scoop);
                // exhaust stack raked back off the nacelle's upper outboard shoulder
                const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.10, 8), mats.dark);
                stack.rotation.x = 1.15; stack.position.set(x + side * 0.05, wingY + 0.05, -0.30);
                grp.add(stack);
                const prop = buildProp({ bladeLen: 0.26, bladeW: 0.055, spinnerR: 0.055, spinnerLen: 0.14, spinnerMat: mats.black }, mats);
                prop.position.set(x, wingY - 0.03, -1.00);
                grp.add(prop); planeSpinners3D.push(prop);
            });
        });

        // dark walkway strips over the inner wing panels
        [1, -1].forEach(side => {
            const walk = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.004, 0.42), mats.dark);
            walk.position.set(side * 0.36, -0.122, -0.22); grp.add(walk);
        });
        // red anti-collision beacon on the spine
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), new THREE.MeshBasicMaterial({ color: 0xd23b2f }));
        beacon.position.set(0, 0.255, -0.15); grp.add(beacon);

        // bubble observation windows protruding from the hull sides: two forward, one aft
        [-1.55, -1.25, 0.95].forEach(z => {
            [1, -1].forEach(side => {
                const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), mats.black);
                bubble.scale.set(0.55, 1, 1);
                bubble.position.set(side * 0.245, 0.055, z);
                grp.add(bubble);
            });
        });

        addAntennas(grp, mats.white, [[-1.2, 0.25, true], [-0.4, 0.25, true], [0.8, 0.24, true]]);
        return grp;
    }

    // ---------------------------------------------------------------------------------------
    // Gulfstream IV-SP (NOAA49): swept wings with winglets, twin aft nacelles, T-tail, and the
    // tail Doppler radar tube out the tail cone.
    function buildGIVModel(reg) {
        const grp = new THREE.Group();
        const L = 4.6, Z0 = -2.3;
        const tex = fuselageTexture({
            len: L, z0: Z0, radomeEndZ: null,
            windshield: { z0: -2.10, z1: -1.82 },
            windows: [-1.45, -1.20, -0.95, -0.70, -0.45, -0.20], windowOval: true,
            bellyWidthFn: v => v < 0.60 ? 0.19 : 0.19 + (v - 0.60) * 0.70,
            bellyV0: 0.015, bellyV1: 0.995,
            emblemZ: -1.68,
            reg: { text: reg, z: 0.90, u: 0.36, color: NOAA_LIV.navy, px: 15 }
        });
        const mats = planeMats(tex, finTexture());

        // gentler forehead than the WP-3D: low pointed nose easing up into the windshield band
        grp.add(bodyLathe([
            { z: -2.30, r: 0.030, y: -0.06 }, { z: -2.16, r: 0.09, y: -0.05 }, { z: -1.98, r: 0.135, y: -0.035 },
            { z: -1.76, r: 0.175, y: -0.015 }, { z: -1.50, r: 0.198, y: 0 }, { z: -1.00, r: 0.205, y: 0 }, { z: 0.70, r: 0.205, y: 0 },
            { z: 1.30, r: 0.17, y: 0.03 }, { z: 1.80, r: 0.10, y: 0.075 }, { z: 2.15, r: 0.05, y: 0.10 }, { z: 2.30, r: 0.022, y: 0.11 }
        ], mats.hull, 48));

        // raked cockpit glass on the forehead slope, shallower and lower-set than the WP-3D's
        addCockpitVisor(grp, { y: 0.094, z: -1.92, rake: 0.95, w: 0.11, h: 0.06, yaw: 0.8, side: 0.086, drop: 0.02, back: 0.05 });

        // swept wings + winglets
        const wing = { rootChord: 0.78, tipChord: 0.20, halfSpan: 2.03, sweepDeg: 30, dihedralDeg: 3, thick: 0.09, mat: mats.white };
        grp.add(wingPanel({ ...wing, side: 1, root: { x: 0, y: -0.14, z: -0.50 } }));
        grp.add(wingPanel({ ...wing, side: -1, root: { x: 0, y: -0.14, z: -0.50 } }));
        [1, -1].forEach(side => {
            const wl = finPanel({ height: 0.26, rootChord: 0.20, tipChord: 0.09, sweepDeg: 42, thick: 0.06, mat: mats.white });
            wl.position.set(side * 2.03, -0.14 + Math.tan(3 * Math.PI / 180) * 2.03, -0.50 + Math.tan(30 * Math.PI / 180) * 2.03);
            wl.rotation.z = side * -0.32;   // canted outboard
            grp.add(wl);
        });

        // wing-to-body fairing painted into the navy belly
        const fair = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 14), mats.navy);
        fair.scale.set(0.15, 0.07, 0.55); fair.position.set(0, -0.165, 0.05); grp.add(fair);

        // twin aft-fuselage nacelles on stub pylons
        [1, -1].forEach(side => {
            const nac = bodyLathe([
                { z: 0, r: 0.062 }, { z: 0.03, r: 0.098 }, { z: 0.10, r: 0.112 },
                { z: 0.42, r: 0.115 }, { z: 0.64, r: 0.085 }, { z: 0.80, r: 0.045 }
            ], mats.white, 22);
            nac.position.set(side * 0.325, 0.05, 0.98);
            grp.add(nac);
            const inlet = new THREE.Mesh(new THREE.CircleGeometry(0.088, 22), mats.black);
            inlet.position.set(side * 0.325, 0.05, 0.985); inlet.rotation.y = Math.PI; grp.add(inlet);
            const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.085, 0.30), mats.white);
            pylon.position.set(side * 0.235, 0.06, 1.32); grp.add(pylon);
        });

        // T-tail: fin decal, bullet fairing, stabilizer across the top
        const fin = finPanel({ height: 0.78, rootChord: 0.66, tipChord: 0.38, sweepDeg: 38, thick: 0.07, mat: mats.fin });
        fin.position.set(0, 0.13, 1.72); grp.add(fin);
        addFinFlags(grp, { halfThick: 0.031, y: 0.75, z: 2.35 });
        const finTipZ = 1.72 + Math.tan(38 * Math.PI / 180) * 0.78, finTipY = 0.13 + 0.78;
        const htail = { rootChord: 0.36, tipChord: 0.16, halfSpan: 0.72, sweepDeg: 25, dihedralDeg: 0, thick: 0.08, mat: mats.white };
        grp.add(wingPanel({ ...htail, side: 1, root: { x: 0, y: finTipY, z: finTipZ } }));
        grp.add(wingPanel({ ...htail, side: -1, root: { x: 0, y: finTipY, z: finTipZ } }));
        const bullet = bodyLathe([{ z: -0.10, r: 0.012 }, { z: 0.02, r: 0.038 }, { z: 0.30, r: 0.036 }, { z: 0.46, r: 0.012 }], mats.white, 14);
        bullet.position.set(0, finTipY, finTipZ - 0.04); grp.add(bullet);

        // tail Doppler radar tube out the tail cone
        const tdr = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.031, 0.48, 14), mats.white);
        tdr.rotation.x = Math.PI / 2; tdr.position.set(0, 0.105, 2.42); grp.add(tdr);
        const tdrCap = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), mats.white);
        tdrCap.position.set(0, 0.105, 2.66); grp.add(tdrCap);

        addAntennas(grp, mats.white, [[-1.1, 0.20, true], [0.2, 0.205, true]]);
        return grp;
    }

    // ---------------------------------------------------------------------------------------

    function disposePlaneObject3D(root) {
        root.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
        });
    }

    // Build (or swap) the airframe inside planeGroup3D to match the loaded flight. No-ops when the
    // right model is already up. Crew figures are sized to the airframe, so a swap tears them down;
    // the cabin loop rebuilds them on its next frame if the Crew Ride toggle is on.
    function setPlaneModel3D() {
        if (typeof planeGroup3D === 'undefined' || !planeGroup3D || typeof THREE === 'undefined') return;
        const type = (typeof isGulfstreamFlight === 'function' && isGulfstreamFlight()) ? 'giv' : 'p3';
        const reg = noaaTailReg(type);
        if (planeModelGroup3D && planeModelType3D === type && planeModelGroup3D.userData.reg === reg) return;
        if (planeModelGroup3D) { planeGroup3D.remove(planeModelGroup3D); disposePlaneObject3D(planeModelGroup3D); }
        planeSpinners3D = [];
        planeModelType3D = type;
        planeModelGroup3D = type === 'giv' ? buildGIVModel(reg) : buildP3Model(reg);
        planeModelGroup3D.userData.reg = reg;
        planeGroup3D.add(planeModelGroup3D);
        if (typeof crewGroup3D !== 'undefined' && crewGroup3D) {
            planeGroup3D.remove(crewGroup3D); disposePlaneObject3D(crewGroup3D);
            crewGroup3D = null; _planeBodyMeshes = [];
        }
    }
