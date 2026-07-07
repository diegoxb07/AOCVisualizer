/* Mission Visualizer, Cabin crew ride physics (2D cutaway + 3D figures)
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   Opt-in "Crew Ride" view. Each seated, belted occupant is simulated as an ARTICULATED BODY,
   a small pendulum chain (torso hinged at the belted pelvis, head hinged on the torso, arms
   hinged at the shoulders) responding to the cabin's apparent-gravity field. That field is the
   real physics: in the seat frame the body feels gravity plus the negative of the cabin's own
   acceleration. Its LATERAL component (the skid/slip imbalance the PFD ball shows) tilts the
   apparent-gravity vector so each limb swings toward it, and its VERTICAL component (the load
   factor, >1 g in an updraft/pull-up, <1 g in a downdraft) scales how heavy every limb feels.
   The response is G-relative: only vertical G past a deadband produces a visible posture change,
   the pelvis floats up against the seatbelt in sustained negative-G and the torso hunches forward
   (pushed down into the seat) in sustained positive-G; small bumps do nothing. Forward dynamics is
   integrated with substepped semi-implicit Euler off the real flight accelerations, always read
   from the smoothly interpolated row (independent of the 8 Hz toggle) so the ride is fluid, not a
   1 Hz step that makes the crew teleport. Calm air keeps them still; rough air tosses them,
   communicating ride quality, not random flail. One sim feeds a 2D rear-view cutaway (2D tracker)
   and slim figures inside a hollowed plane (the whole airframe dims to a translucent shell) in the
   3D scene. Off by default; nothing runs unless the toggle is on. */

    const CABIN_CREW = 4;
    let cabinSim = null;
    let cabinRaf = null;
    let cabinLastMs = 0;
    let crewGroup3D = null;
    let _planeBodyMeshes = [];   // the 3D plane's body meshes, all dimmed to a shell while crew are shown

    function initCabinSim(n) {
        const occ = [];
        for (let i = 0; i < (n || CABIN_CREW); i++) {
            const j = Math.sin((i + 1) * 12.9898) * 43758.5453; const r = j - Math.floor(j);  // deterministic per-seat variation
            occ.push({
                // articulated-body joint angles (rad, 0 = upright rel. to the seat) + velocities
                torso: 0, torsoV: 0, head: 0, headV: 0, arm: 0, armV: 0, fore: 0, foreV: 0, torsoP: 0, torsoPV: 0, pelY: 0, pelVy: 0,
                // natural frequencies: wG = gravity-torque coupling, wP = muscle/posture stiffness
                wG: 2 * Math.PI * (0.82 + 0.18 * r), wP: 2 * Math.PI * (0.70 + 0.15 * r), zT: 0.30,     // torso lateral
                wGH: 2 * Math.PI * (1.25 + 0.3 * r), wPH: 2 * Math.PI * (1.5 + 0.3 * r), zH: 0.33,      // head/neck
                wGA: 2 * Math.PI * (0.95 + 0.25 * r), wPA: 2 * Math.PI * (0.45 + 0.1 * r), zA: 0.20,    // upper arms (floppier)
                wGF: 2 * Math.PI * (1.15 + 0.3 * r), wPF: 2 * Math.PI * (0.85 + 0.2 * r), zF: 0.24,     // forearms (follow the arm with lag)
                wPfa: 2 * Math.PI * (0.85 + 0.2 * r), zPfa: 0.62,                                       // torso fore-aft (hunch, well-damped)
                wV: 2 * Math.PI * (2.8 + 0.5 * r), zV: 0.26,                                            // seat cushion (vertical)
                jphase: r * Math.PI * 2,                                                                // per-seat phase for the shared airframe jitter
                beltCap: 0.09 + 0.02 * r, cushMax: 0.16, gain: 0.85 + 0.3 * r
            });
        }
        cabinSim = { occ, roll: 0, valid: false };
    }

    // Forcing from the current playback frame: lateral specific force (g, signed), the vertical
    // load-factor deviation (g), and the roll the cabin banks by. ALWAYS read from the smoothly
    // interpolated row (not gated on the 8 Hz toggle) so the crew get a continuous input, not a
    // 1 Hz step that makes them teleport/jerk each second.
    function cabinForcing() {
        if (!filteredData.length || !filteredData[currentIdx]) return { lat: 0, gz: 0, roll: 0, valid: false };
        let d = (typeof getInterpolatedRow === 'function' && getInterpolatedRow()) || filteredData[currentIdx];
        const rollRad = (d.roll != null ? d.roll : 0) * Math.PI / 180;
        let lat = 0;
        const ball = (typeof pfdSlipDeflection === 'function') ? pfdSlipDeflection(d) : null;
        if (ball !== null) lat = ball * 0.15;   // PFD ball is latG / 0.15g -> back to g
        // Vertical load-factor deviation (g): updraft -> heavier (+G, pressed down), downdraft ->
        // lighter (-G, float). Derived from the measured vertical wind, the actual felt vertical G.
        let gz = 0;
        if (d.vtWnd != null) gz = Math.max(-1.35, Math.min(1.5, d.vtWnd * 0.09));   // strong downdrafts reach true negative G, which floats the ragdolls into their belts
        // Turbulence intensity (0..1), the SAME |vtWnd|/3 proxy the airframe's 8Hz micro-motion uses,
        // so the crew buzz/jitter in step with the plane, not just the slow hunch/float postural modes.
        let turb = (d.vtWnd != null) ? Math.min(1, Math.abs(d.vtWnd) / 3.0) : 0;
        return { lat, gz, turb, roll: rollRad, valid: true };
    }

    // Crew physics step. The Verlet ragdoll engine (js/22-verlet.js) integrates the dummies as
    // particle skeletons under the same flight-metric field; the pendulum chain below is the
    // fallback when that file fails to load, keeping the crew alive per the split-file design.
    function stepCabin(dt) {
        if (!cabinSim) initCabinSim();
        if (typeof verletStepCabin === 'function') { verletStepCabin(dt); return; }
        const f = cabinForcing();
        const sub = Math.min(6, Math.max(1, Math.ceil(dt / 0.02)));
        const h = dt / sub;
        // G-relative deadband: only vertical G beyond +/-0.15 g moves anyone (small bumps -> no
        // visible float/hunch, so calm air keeps the crew planted).
        const db = (v, thr) => (v > thr ? v - thr : (v < -thr ? v + thr : 0));
        const gzEff = db(f.gz, 0.15);
        // shared airframe jitter: a few-Hz band-limited buzz scaled by turbulence, so the crew shake
        // WITH the plane on top of the slow hunch/float. Zero in calm air (turb = 0).
        const ts = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        for (let n = 0; n < sub; n++) {
            cabinSim.occ.forEach(o => {
                const jitL = f.turb * (0.6 * Math.sin(ts * 11.0 * Math.PI + o.jphase) + 0.4 * Math.sin(ts * 17.3 * Math.PI + o.jphase * 2.1));
                const jitV = f.turb * (0.5 * Math.sin(ts * 9.5 * Math.PI + o.jphase * 1.7) + 0.5 * Math.sin(ts * 15.1 * Math.PI + o.jphase * 0.9));
                const aLat = f.lat * o.gain + jitL * 0.05;
                const aVert = Math.max(0.15, 1 + f.gz * o.gain + jitV * 0.05);   // apparent vertical g (load factor): heavier limbs in +G, lighter in -G, plus buzz
                const alpha = Math.atan2(aLat, aVert);   // apparent-gravity tilt from seat-up
                const gApp = Math.hypot(aLat, aVert);    // apparent-gravity magnitude (g)
                // torso lateral: gravity torque toward apparent-gravity direction + muscle spring to upright + damping
                o.torsoV += (-o.wG * o.wG * gApp * Math.sin(o.torso - alpha) - o.wP * o.wP * o.torso - 2 * o.zT * o.wG * o.torsoV) * h;
                o.torso  += o.torsoV * h;
                // head: pendulum in apparent gravity, held toward the torso line by the neck
                o.headV += (-o.wGH * o.wGH * gApp * Math.sin(o.head - alpha) - o.wPH * o.wPH * (o.head - o.torso) - 2 * o.zH * o.wGH * o.headV) * h;
                o.head  += o.headV * h;
                // upper arms: floppier pendulum toward apparent gravity, weak return to hanging (0)
                o.armV += (-o.wGA * o.wGA * gApp * Math.sin(o.arm - alpha) - o.wPA * o.wPA * o.arm - 2 * o.zA * o.wGA * o.armV) * h;
                o.arm  += o.armV * h;
                // forearms: a second pendulum hinged at the elbow, pulled toward apparent gravity and
                // sprung toward the upper-arm line, so the arm articulates instead of swinging rigid
                o.foreV += (-o.wGF * o.wGF * gApp * Math.sin(o.fore - alpha) - o.wPF * o.wPF * (o.fore - o.arm) - 2 * o.zF * o.wGF * o.foreV) * h;
                o.fore  += o.foreV * h;
                // torso fore-aft: hunch FORWARD under sustained +G (pushed down), extend slightly under -G (kept gentle)
                const pTarget = gzEff > 0 ? Math.min(0.42, gzEff * 0.8 * o.gain) : Math.max(-0.13, gzEff * 0.28 * o.gain);
                o.torsoPV += (-o.wPfa * o.wPfa * (o.torsoP - pTarget) - 2 * o.zPfa * o.wPfa * o.torsoPV) * h;
                o.torsoP  += o.torsoPV * h;
                // pelvis vertical: -G floats up against the belt, +G compresses into the cushion (G-relative
                // target), plus a small turbulence bob so the whole body shakes with the seat
                const vTarget = -gzEff * 0.16 * o.gain + jitV * 0.025;
                o.pelVy += (-o.wV * o.wV * (o.pelY - vTarget) - 2 * o.zV * o.wV * o.pelVy) * h;
                o.pelY  += o.pelVy * h;
                if (o.pelY > o.beltCap) { o.pelY = o.beltCap; if (o.pelVy > 0) o.pelVy *= -0.15; }   // belt caps upward float
                if (o.pelY < -o.cushMax) { o.pelY = -o.cushMax; if (o.pelVy < 0) o.pelVy *= -0.15; }  // cushion bottoms out
            });
        }
        cabinSim.roll = f.valid ? f.roll : 0;
        cabinSim.valid = f.valid;
    }

    // --- 2D rear-view cutaway: jointed crash-test dummy, belted to the seat ---
    function drawSeated2D(ctx, x, seatY, s, torsoLen, o) {
        const beltLift = o.pelY * 55 * s;                         // + = float against the belt (-G),, = compress into seat (+G)
        const hunch = Math.max(0, o.torsoP);                      // fore-aft forward hunch (+G); in rear view it foreshortens + drops the torso
        const hipY = seatY - s * 3 - beltLift;
        const L = torsoLen * (1 - 0.16 * hunch);                  // hunch foreshortens the torso
        const shX = x + Math.sin(o.torso) * L, shY = hipY - Math.cos(o.torso) * L + hunch * s * 2.0;   // shoulders drop when hunched
        const nl = L * 0.4;
        const headX = shX + Math.sin(o.head) * nl, headY = shY - Math.cos(o.head) * nl;
        const jointDot = (jx, jy) => { ctx.fillStyle = '#23262b'; ctx.beginPath(); ctx.arc(jx, jy, s * 1.3, 0, Math.PI * 2); ctx.fill(); };
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        // seat: cushion + short back (fixed, grounding the figure)
        ctx.fillStyle = 'rgba(66,88,112,0.55)';
        ctx.fillRect(x - L * 0.4, seatY, L * 0.8, s * 4);
        ctx.fillRect(x - L * 0.42, seatY - L * 0.5, s * 2.3, L * 0.5);
        // legs: knee and foot rise off the floor when negative G floats the body against the belt
        const lift = Math.max(0, o.pelY / o.beltCap);
        const floorY = seatY + s * 4;
        const kneeX = x + L * 0.34, kneeY = hipY + s * 1.4 - lift * L * 0.30;
        const footY = floorY - lift * (floorY - kneeY) * 0.85;
        ctx.strokeStyle = '#c9761f'; ctx.lineWidth = s * 2.6;
        ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(kneeX + s * 0.6, footY); ctx.stroke();
        jointDot(kneeX, kneeY);
        // arm: upper arm from the shoulder, forearm hinged at the elbow with its own swing
        const armAng = o.torso + o.arm, foreAng = o.torso + o.fore, al = L * 0.5;
        const elbX = shX + Math.sin(armAng) * al * 0.55, elbY = shY + s * 0.5 + Math.cos(armAng) * al;
        const handX = elbX + Math.sin(foreAng) * al * 0.5, handY = elbY + Math.cos(foreAng) * al * 0.95;
        ctx.strokeStyle = '#d07f28'; ctx.lineWidth = s * 2.1;
        ctx.beginPath(); ctx.moveTo(shX, shY + s * 0.5); ctx.lineTo(elbX, elbY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(elbX, elbY); ctx.lineTo(handX, handY); ctx.stroke();
        jointDot(elbX, elbY);
        // torso segment
        ctx.strokeStyle = '#df8a30'; ctx.lineWidth = s * 3.4;
        ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(shX, shY); ctx.stroke();
        jointDot(x, hipY); jointDot(shX, shY + s * 0.3);
        // lap belt across the hips
        ctx.strokeStyle = 'rgba(232,184,84,0.95)'; ctx.lineWidth = s * 1.6;
        ctx.beginPath(); ctx.moveTo(x - L * 0.26, hipY + s * 0.5); ctx.lineTo(x + L * 0.26, hipY + s * 0.5); ctx.stroke();
        // neck + dummy head with its side calibration target
        ctx.strokeStyle = '#df8a30'; ctx.lineWidth = s * 2.1;
        ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(headX, headY); ctx.stroke();
        jointDot(shX, shY - s * 1.1);
        ctx.fillStyle = '#e29a3f';
        ctx.beginPath(); ctx.arc(headX, headY, s * 3.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#23262b';
        ctx.beginPath(); ctx.arc(headX + s * 1.4, headY - s * 0.4, s * 1.0, 0, Math.PI * 2); ctx.fill();
    }

    function renderCabin2D() {
        const c = document.getElementById('cabinCanvas'); if (!c || !c.getContext) return;
        const host = c.parentElement; const rect = host.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return;
        // Size the backing store to the rendered size (rect already includes the --hud-scale transform)
        // times devicePixelRatio, then draw in CSS pixels, so the crew view stays sharp on HiDPI.
        const DPR = window.devicePixelRatio || 1;
        const w = Math.round(rect.width), h = Math.round(rect.height);
        const bw = Math.round(w * DPR), bh = Math.round(h * DPR);
        if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
        const ctx = c.getContext('2d'); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        const cx = w / 2, cy = h * 0.52;
        const s = Math.max(0.7, Math.min(1.4, w / 200));
        ctx.clearRect(0, 0, w, h);
        if (!cabinSim || !cabinSim.valid) {
            ctx.fillStyle = 'rgba(150,165,180,0.6)'; ctx.font = (11 * s) + 'px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Crew ride: load a flight', cx, cy); return;
        }
        // world-level horizon behind the cabin (stays level while the cabin banks -> shows the bank)
        ctx.save(); ctx.strokeStyle = 'rgba(90,130,170,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(8, cy + h * 0.16); ctx.lineTo(w - 8, cy + h * 0.16); ctx.stroke(); ctx.restore();

        ctx.save(); ctx.translate(cx, cy); ctx.rotate(cabinSim.roll);   // cabin banks with roll
        const halfW = Math.min(w, h) * 0.44, halfH = halfW * 0.62;
        ctx.fillStyle = 'rgba(20,28,38,0.9)'; ctx.strokeStyle = 'rgba(120,140,160,0.8)'; ctx.lineWidth = 2 * s;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-halfW, -halfH, halfW * 2, halfH * 2, halfH * 0.7); else ctx.rect(-halfW, -halfH, halfW * 2, halfH * 2);
        ctx.fill(); ctx.stroke();
        const floorY = halfH * 0.62;
        ctx.strokeStyle = 'rgba(120,140,160,0.5)'; ctx.lineWidth = 1.5 * s;
        ctx.beginPath(); ctx.moveTo(-halfW * 0.9, floorY); ctx.lineTo(halfW * 0.9, floorY); ctx.stroke();
        // rear-view cutaway shows a readable row of four, however many seats the 3D cabin holds
        const occs = cabinSim.occ.slice(0, 4);
        const n = occs.length, span = halfW * 1.5, torsoLen = halfH * 0.6;
        occs.forEach((o, i) => drawSeated2D(ctx, -span / 2 + span * (i + 0.5) / n, floorY, s, torsoLen, o));
        ctx.restore();
        ctx.fillStyle = 'rgba(150,170,190,0.75)'; ctx.font = 'bold ' + (8.5 * s) + 'px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('CREW RIDE (rear view)', 7, 6);
    }

    // --- WP-3D interior furnishings. Every seat comes with its crew figure (spec.seats), so
    // this builds only the flight computers and fixtures: a computer RACK standing between
    // each seat row (its screen facing the operator seated behind it), the flight-deck
    // instrument panel and throttle pedestal, and the head / dinette table / galley aft.
    // Sizes are real-scale against the hull (about 6.9 plane-units per meter of WP-3D). ---
    function buildP3Interior(grp, spec) {
        const deskMat = new THREE.MeshPhongMaterial({ color: 0x2a3442, shininess: 25 });
        const screenMat = new THREE.MeshPhongMaterial({ color: 0x223140, emissive: 0x11293c, shininess: 60 });
        const surfMat = new THREE.MeshPhongMaterial({ color: 0x39434f, shininess: 30 });
        const floorY = spec.floorY;
        // flight-computer rack between rows: cabinet on the seat column with its screen aft
        const rackAt = (x, z, w) => {
            const rack = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, 0.09), deskMat);
            rack.position.set(x, floorY + 0.09, z); grp.add(rack);
            const scr = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 0.09, 0.012), screenMat);
            scr.position.set(x, floorY + 0.115, z + 0.048); grp.add(scr);
        };
        // every working seat gets the SAME standard computer, one rack directly ahead of it
        // (the aft-facing seat 12 gets its rack aft, screen turned forward toward the sitter):
        // the post-cockpit row, 7-8-9, 10-11, 15, and 16-17. The jumpseat, 13, and 18 have none.
        [[-0.105, -1.38, 0.10], [0.105, -1.38, 0.10],
         [0.060, -0.98, 0.10], [0.162, -0.98, 0.10], [-0.105, -0.98, 0.10],
         [-0.060, -0.71, 0.10], [-0.162, -0.71, 0.10],
         [0.105, -0.06, 0.10],
         [0.060, 0.665, 0.10], [0.155, 0.665, 0.10]].forEach(([x, z, w]) => rackAt(x, z, w));
        const rack12 = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.18, 0.09), deskMat);
        rack12.position.set(-0.105, floorY + 0.09, -0.255); grp.add(rack12);
        const scr12 = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.012), screenMat);
        scr12.position.set(-0.105, floorY + 0.115, -0.303); grp.add(scr12);
        // flight deck: instrument panel across the nose, throttle pedestal between the pilots
        // reaching back to the flight engineer's seat
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.05), deskMat);
        panel.position.set(0, -0.02, -2.00); grp.add(panel);
        const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.14), deskMat);
        pedestal.position.set(0, -0.085, -1.81); grp.add(pedestal);
        // dropsonde launcher: a slim tube in the gap behind seat 15, its raised end pointing
        // FORWARD at the seat and its lower end punching down-outboard through the starboard
        // hull into the air, where the sondes drop out
        const sonde = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.30, 10), new THREE.MeshPhongMaterial({ color: 0xaab4bd, shininess: 70 }));
        sonde.position.set(0.15, -0.15, 0.30);
        sonde.rotation.x = -0.65; sonde.rotation.z = 0.25;
        grp.add(sonde);
        // aft compartments: bathroom on the starboard side behind seats 16-17, then the galley
        // at the tail (kitchen counter port, bench seating starboard) with its own floor strip
        const bath = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 0.20), surfMat);
        bath.position.set(0.10, floorY + 0.13, 1.05); grp.add(bath);
        const kitchen = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.26), surfMat);
        kitchen.position.set(-0.10, floorY + 0.07, 1.30); grp.add(kitchen);
        const bench = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.26), deskMat);
        bench.position.set(0.10, floorY + 0.045, 1.30); grp.add(bench);
        // sits a hair below the main cabin floor plane, coplanar strips z-fight and flicker
        const aftFloor = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.03, 0.52), surfMat);
        aftFloor.position.set(0, floorY - 0.021, 1.26); grp.add(aftFloor);
    }

    // --- 3D crew: jointed crash-test dummies belted into a hollow cabin trough. Figure layout is
    // sized per airframe from activeCabinSpec() (js/07b-plane-models.js). Fig-local units put the
    // cabin floor at y=0; spec.figScale fits the dummies inside the active fuselage. ---
    function build3DCrew() {
        if (crewGroup3D || typeof planeGroup3D === 'undefined' || !planeGroup3D || typeof THREE === 'undefined') return;
        const spec = (typeof activeCabinSpec === 'function') ? activeCabinSpec()
            : { floorY: -0.10, halfW: 0.20, figScale: 0.40, seats: [{ x: 0, z: -1.15 }, { x: 0, z: -0.42 }, { x: 0, z: 0.32 }, { x: 0, z: 1.02 }] };
        const seats = spec.seats;
        // one occupant per seat: the sim resizes when the airframe (and so the seat map) changes
        if (!cabinSim || cabinSim.occ.length !== seats.length) initCabinSim(seats.length);
        crewGroup3D = new THREE.Group();
        const shell = new THREE.MeshPhongMaterial({ color: 0x141c26, side: THREE.DoubleSide });
        const seg = new THREE.MeshPhongMaterial({ color: 0xdf8a30 });     // dummy rubber skin
        const joint = new THREE.MeshPhongMaterial({ color: 0x23262b });   // joint hardware + head targets
        const beltMat = new THREE.MeshPhongMaterial({ color: 0xe8b854 });
        // no cabin shell or walls: just a floor strip under the seats, so the whole interior
        // (crew, seats, consoles) reads clearly through the dimmed hull from any angle
        const zc = (seats[0].z + seats[seats.length - 1].z) / 2, floorLen = seats[seats.length - 1].z - seats[0].z + 0.55;
        const floor = new THREE.Mesh(new THREE.BoxGeometry(spec.halfW * 2, 0.03, floorLen), shell);
        floor.position.set(0, spec.floorY - 0.015, zc);
        crewGroup3D.add(floor);
        if (spec.interior) buildP3Interior(crewGroup3D, spec);
        const figs = [];
        for (let i = 0; i < seats.length; i++) {
            const fig = new THREE.Group();
            const seat = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.04, 0.30), shell); seat.position.set(0, 0.085, 0.05);
            const back = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.34, 0.05), shell); back.position.set(0, 0.27, 0.17);
            const upper = new THREE.Group();
            const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.10, 0.16), seg); pelvis.position.set(0, 0.135, 0.02);
            const belt = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.026, 0.07), beltMat); belt.position.set(0, 0.16, -0.055);
            upper.add(pelvis, belt);
            // legs hang from hip joints; hip/knee groups articulate so feet can leave the floor
            const mkLeg = (sx) => {
                const hip = new THREE.Group(); hip.position.set(sx, 0.14, 0);
                const hipBall = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), joint); hip.add(hipBall);
                const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.030, 0.17, 8), seg);
                thigh.rotation.x = Math.PI / 2; thigh.position.set(0, 0, -0.085); hip.add(thigh);
                const knee = new THREE.Group(); knee.position.set(0, 0, -0.17); hip.add(knee);
                const kneeBall = new THREE.Mesh(new THREE.SphereGeometry(0.030, 10, 8), joint); knee.add(kneeBall);
                const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.115, 8), seg);
                shin.position.set(0, -0.062, -0.008); shin.rotation.x = 0.10; knee.add(shin);
                const foot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.022, 0.10), joint);
                foot.position.set(0, -0.128, -0.035); knee.add(foot);
                return { hip, knee };
            };
            const legL = mkLeg(-0.06), legR = mkLeg(0.06);
            upper.add(legL.hip, legR.hip);
            // torso chain: lumbar + chest segments, ball joints at shoulders and neck
            const torso = new THREE.Group(); torso.position.set(0, 0.15, 0);
            const lumbar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.062, 0.11, 10), seg); lumbar.position.y = 0.055; torso.add(lumbar);
            const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.075, 0.15, 10), seg); chest.position.y = 0.185; torso.add(chest);
            const mkArm = (sx) => {
                const shoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), joint); shoulderBall.position.set(sx, 0.245, 0); torso.add(shoulderBall);
                const arm = new THREE.Group(); arm.position.set(sx, 0.245, 0);
                const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.15, 8), seg); upperArm.position.y = -0.075; arm.add(upperArm);
                const elbow = new THREE.Group(); elbow.position.y = -0.15; arm.add(elbow);
                const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), joint); elbow.add(elbowBall);
                const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.020, 0.14, 8), seg); forearm.position.y = -0.07; elbow.add(forearm);
                const hand = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), seg); hand.position.y = -0.145; elbow.add(hand);
                torso.add(arm);
                return { arm, elbow };
            };
            const armL = mkArm(-0.105), armR = mkArm(0.105);
            const neckBall = new THREE.Mesh(new THREE.SphereGeometry(0.030, 10, 8), joint); neckBall.position.set(0, 0.275, 0); torso.add(neckBall);
            const neck = new THREE.Group(); neck.position.set(0, 0.275, 0);
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 12), seg); head.position.y = 0.085; neck.add(head);
            [-0.075, 0.075].forEach(hx => {   // the dummy head's side calibration targets
                const target = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.004, 12), joint);
                target.rotation.z = Math.PI / 2; target.position.set(hx, 0.085, 0); neck.add(target);
            });
            torso.add(neck);
            upper.add(torso);
            fig.add(seat, back, upper);
            fig.userData = { upper, torso, neck, armL: armL.arm, armR: armR.arm, elbowL: armL.elbow, elbowR: armR.elbow, hipL: legL.hip, hipR: legR.hip, kneeL: legL.knee, kneeR: legR.knee };
            fig.position.set(seats[i].x, spec.floorY, seats[i].z);
            fig.rotation.y = seats[i].rot || 0;
            fig.scale.set(spec.figScale, spec.figScale, spec.figScale);
            crewGroup3D.add(fig); figs.push(fig);
        }
        crewGroup3D.userData.figs = figs;
        planeGroup3D.add(crewGroup3D);   // inherits the plane's position + bank + pitch
        // every airframe mesh dims to a translucent shell while crew are shown so they read as
        // INSIDE the plane; meshes flagged noDim (prop discs) keep their own transparency
        _planeBodyMeshes = [];
        if (typeof planeModelGroup3D !== 'undefined' && planeModelGroup3D) {
            planeModelGroup3D.traverse(o => { if (o.isMesh && !o.userData.noDim) _planeBodyMeshes.push(o); });
        } else {
            _planeBodyMeshes = planeGroup3D.children.filter(ch => ch.isMesh && ch.material);
        }
    }

    function updateCabin3D() {
        if (!crewGroup3D || !cabinSim || !crewGroup3D.userData.figs) return;
        cabinSim.occ.forEach((o, i) => {
            const fig = crewGroup3D.userData.figs[i]; if (!fig) return;
            const u = fig.userData;
            u.torso.rotation.z = o.torso;                        // lateral lean (plane local frame)
            u.torso.rotation.x = -o.torsoP - o.pelY * 0.25;      // hunch FORWARD (toward nose) under +G; slight float flex
            u.neck.rotation.z = o.head - o.torso;                // head lags/leads the torso on its own hinge
            u.armL.rotation.z = o.arm; u.armR.rotation.z = o.arm;
            const bend = o.fore - o.arm;                         // forearm swings about the elbow relative to the upper arm
            u.elbowL.rotation.z = bend; u.elbowR.rotation.z = bend;
            u.upper.position.y = o.pelY > 0 ? o.pelY * 0.5 : o.pelY * 0.22;
            // negative G floats the body against the belt AND lifts the legs: knees rise about the
            // hips, shins dangle, and the feet leave the floor
            const lift = Math.max(0, o.pelY / o.beltCap);
            u.hipL.rotation.x = lift * 0.6; u.hipR.rotation.x = lift * 0.6;
            u.kneeL.rotation.x = -lift * 0.35; u.kneeR.rotation.x = -lift * 0.35;
        });
    }

    function cabinModeVisibility() {
        const on = document.getElementById('toggleCabin') && document.getElementById('toggleCabin').checked;
        const in3D = trackerModeSelect.value === '3d';
        const overlay = document.getElementById('cabinOverlay');
        if (overlay) overlay.style.display = (on && !in3D) ? 'block' : 'none';
        const show3D = !!(on && in3D);
        if (crewGroup3D) crewGroup3D.visible = show3D;
        // dim every body mesh (not just the fuselage) to a translucent shell so the crew read as inside it
        (_planeBodyMeshes || []).forEach(m => {
            m.material.transparent = show3D;
            m.material.opacity = show3D ? 0.2 : 1;
            m.material.needsUpdate = true;
        });
    }

    function cabinLoop(nowMs) {
        if (!(document.getElementById('toggleCabin') && document.getElementById('toggleCabin').checked)) { cabinRaf = null; return; }
        let dt = (nowMs - cabinLastMs) / 1000; cabinLastMs = nowMs;
        if (!(dt > 0) || dt > 0.1) dt = 1 / 60;   // clamp first frame / tab-switch gaps
        stepCabin(dt);
        const in3D = trackerModeSelect.value === '3d';
        if (in3D) { build3DCrew(); updateCabin3D(); }
        else renderCabin2D();
        cabinModeVisibility();
        cabinRaf = requestAnimationFrame(cabinLoop);
    }

    function startCabin() {
        cabinModeVisibility();
        if (cabinRaf === null) { cabinLastMs = performance.now(); cabinRaf = requestAnimationFrame(cabinLoop); }
    }
    function stopCabin() {
        if (cabinRaf !== null) { cancelAnimationFrame(cabinRaf); cabinRaf = null; }
        const overlay = document.getElementById('cabinOverlay'); if (overlay) overlay.style.display = 'none';
        if (crewGroup3D) crewGroup3D.visible = false;
        (_planeBodyMeshes || []).forEach(m => { m.material.transparent = false; m.material.opacity = 1; m.material.needsUpdate = true; });
    }

    (function wireCabin() {
        const cb = document.getElementById('toggleCabin'); if (!cb) return;
        cb.addEventListener('change', () => { if (cb.checked) startCabin(); else stopCabin(); });
        const modeSel = document.getElementById('trackerModeSelect');
        if (modeSel) modeSel.addEventListener('change', () => { if (cb.checked) cabinModeVisibility(); });
    })();
