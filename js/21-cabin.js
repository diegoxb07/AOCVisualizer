/* Mission Visualizer - Cabin crew ride physics (2D cutaway + 3D figures)
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   Opt-in "Crew Ride" view. Each seated, belted occupant is simulated as an ARTICULATED BODY -
   a small pendulum chain (torso hinged at the belted pelvis, head hinged on the torso, arms
   hinged at the shoulders) responding to the cabin's apparent-gravity field. That field is the
   real physics: in the seat frame the body feels gravity plus the negative of the cabin's own
   acceleration. Its LATERAL component (the skid/slip imbalance the PFD ball shows) tilts the
   apparent-gravity vector so each limb swings toward it, and its VERTICAL component (the load
   factor - >1 g in an updraft/pull-up, <1 g in a downdraft) scales how heavy every limb feels.
   The response is G-relative: only vertical G past a deadband produces a visible posture change -
   the pelvis floats up against the seatbelt in sustained negative-G and the torso hunches forward
   (pushed down into the seat) in sustained positive-G; small bumps do nothing. Forward dynamics is
   integrated with substepped semi-implicit Euler off the real flight accelerations, always read
   from the smoothly interpolated row (independent of the 8 Hz toggle) so the ride is fluid, not a
   1 Hz step that makes the crew teleport. Calm air keeps them still; rough air tosses them -
   communicating ride quality, not random flail. One sim feeds a 2D rear-view cutaway (2D tracker)
   and slim figures inside a hollowed plane (the whole airframe dims to a translucent shell) in the
   3D scene. Off by default; nothing runs unless the toggle is on. */

    const CABIN_CREW = 4;
    let cabinSim = null;
    let cabinRaf = null;
    let cabinLastMs = 0;
    let crewGroup3D = null;
    let _planeBodyMeshes = [];   // the 3D plane's body meshes - all dimmed to a shell while crew are shown

    function initCabinSim() {
        const occ = [];
        for (let i = 0; i < CABIN_CREW; i++) {
            const j = Math.sin((i + 1) * 12.9898) * 43758.5453; const r = j - Math.floor(j);  // deterministic per-seat variation
            occ.push({
                // articulated-body joint angles (rad, 0 = upright rel. to the seat) + velocities
                torso: 0, torsoV: 0, head: 0, headV: 0, arm: 0, armV: 0, torsoP: 0, torsoPV: 0, pelY: 0, pelVy: 0,
                // natural frequencies: wG = gravity-torque coupling, wP = muscle/posture stiffness
                wG: 2 * Math.PI * (0.82 + 0.18 * r), wP: 2 * Math.PI * (0.70 + 0.15 * r), zT: 0.30,     // torso lateral
                wGH: 2 * Math.PI * (1.25 + 0.3 * r), wPH: 2 * Math.PI * (1.5 + 0.3 * r), zH: 0.33,      // head/neck
                wGA: 2 * Math.PI * (0.95 + 0.25 * r), wPA: 2 * Math.PI * (0.45 + 0.1 * r), zA: 0.20,    // arms (floppier)
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
        // lighter (-G, float). Derived from the measured vertical wind - the actual felt vertical G.
        let gz = 0;
        if (d.vtWnd != null) gz = Math.max(-0.85, Math.min(1.2, d.vtWnd * 0.09));
        // Turbulence intensity (0..1) - the SAME |vtWnd|/3 proxy the airframe's 8Hz micro-motion uses,
        // so the crew buzz/jitter in step with the plane, not just the slow hunch/float postural modes.
        let turb = (d.vtWnd != null) ? Math.min(1, Math.abs(d.vtWnd) / 3.0) : 0;
        return { lat, gz, turb, roll: rollRad, valid: true };
    }

    // Forward dynamics of the pendulum chain in the cabin's apparent-gravity field. Substepped so
    // it stays stable even when a fast playback speed hands us a large frame dt.
    function stepCabin(dt) {
        if (!cabinSim) initCabinSim();
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
                // arms: floppier pendulum toward apparent gravity, weak return to hanging (0)
                o.armV += (-o.wGA * o.wGA * gApp * Math.sin(o.arm - alpha) - o.wPA * o.wPA * o.arm - 2 * o.zA * o.wGA * o.armV) * h;
                o.arm  += o.armV * h;
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

    // --- 2D rear-view cutaway: slim seated human with arms, planted on a belted seat ---
    function drawSeated2D(ctx, x, seatY, s, torsoLen, o) {
        const beltLift = o.pelY * 55 * s;                         // + = float against the belt (-G), - = compress into seat (+G)
        const hunch = Math.max(0, o.torsoP);                      // fore-aft forward hunch (+G); in rear view it foreshortens + drops the torso
        const hipY = seatY - s * 3 - beltLift;
        const L = torsoLen * (1 - 0.16 * hunch);                  // hunch foreshortens the torso
        const shX = x + Math.sin(o.torso) * L, shY = hipY - Math.cos(o.torso) * L + hunch * s * 2.0;   // shoulders drop when hunched
        const hl = L * 0.4;
        const headX = shX + Math.sin(o.head) * hl, headY = shY - Math.cos(o.head) * hl;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        // seat: cushion + short back (fixed, grounding the figure)
        ctx.fillStyle = 'rgba(66,88,112,0.55)';
        ctx.fillRect(x - L * 0.4, seatY, L * 0.8, s * 4);
        ctx.fillRect(x - L * 0.42, seatY - L * 0.5, s * 2.3, L * 0.5);
        // thigh resting on the cushion (fixed) - reads as seated
        ctx.strokeStyle = '#4a90d9'; ctx.lineWidth = s * 3.0;
        ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(x + L * 0.34, seatY - s * 0.5); ctx.stroke();
        // arms hanging from the shoulders, swinging with the apparent gravity (drawn behind the torso)
        const armAng = o.torso + o.arm, al = L * 0.85;
        const handX = shX + Math.sin(armAng) * al * 0.5, handY = shY + Math.cos(armAng) * al;
        ctx.strokeStyle = '#5aa8e6'; ctx.lineWidth = s * 2.1;
        ctx.beginPath(); ctx.moveTo(shX, shY + s * 0.5); ctx.lineTo(handX, handY); ctx.stroke();
        // torso (slim)
        ctx.strokeStyle = '#5eb0ef'; ctx.lineWidth = s * 3.4;
        ctx.beginPath(); ctx.moveTo(x, hipY); ctx.lineTo(shX, shY); ctx.stroke();
        // lap belt across the hips
        ctx.strokeStyle = 'rgba(232,184,84,0.95)'; ctx.lineWidth = s * 1.6;
        ctx.beginPath(); ctx.moveTo(x - L * 0.26, hipY + s * 0.5); ctx.lineTo(x + L * 0.26, hipY + s * 0.5); ctx.stroke();
        // neck + head
        ctx.strokeStyle = '#8bd0ff'; ctx.lineWidth = s * 2.1;
        ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(headX, headY); ctx.stroke();
        ctx.fillStyle = '#e8f4ff';
        ctx.beginPath(); ctx.arc(headX, headY, s * 3.6, 0, Math.PI * 2); ctx.fill();
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
            ctx.fillText('Crew ride — load a flight', cx, cy); return;
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
        const n = cabinSim.occ.length, span = halfW * 1.5, torsoLen = halfH * 0.6;
        cabinSim.occ.forEach((o, i) => drawSeated2D(ctx, -span / 2 + span * (i + 0.5) / n, floorY, s, torsoLen, o));
        ctx.restore();
        ctx.fillStyle = 'rgba(150,170,190,0.75)'; ctx.font = 'bold ' + (8.5 * s) + 'px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('CREW RIDE (rear view)', 7, 6);
    }

    // --- 3D crew: slim figures with arms, seated inside a hollowed, opaque cabin trough ---
    function build3DCrew() {
        if (crewGroup3D || typeof planeGroup3D === 'undefined' || !planeGroup3D || typeof THREE === 'undefined') return;
        crewGroup3D = new THREE.Group();
        const shell = new THREE.MeshPhongMaterial({ color: 0x141c26, side: THREE.DoubleSide });
        const body = new THREE.MeshPhongMaterial({ color: 0x5eb0ef }), skin = new THREE.MeshPhongMaterial({ color: 0xe6f2ff }), beltMat = new THREE.MeshPhongMaterial({ color: 0xe8b854 });
        // hollow opaque cabin trough (floor + a LOW lip, open top) so the crew sit INSIDE it with
        // their lower halves still visible
        const floor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 2.7), shell); floor.position.set(0, -0.2, -0.05);
        const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.13, 2.7), shell); wallL.position.set(-0.23, -0.15, -0.05);
        const wallR = wallL.clone(); wallR.position.x = 0.23;
        crewGroup3D.add(floor, wallL, wallR);
        const zPos = [-1.15, -0.42, 0.32, 1.02];   // all within the cabin; clear of nose (-2.4) and tail (1.8)
        for (let i = 0; i < CABIN_CREW; i++) {
            const fig = new THREE.Group();
            const seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.32), shell); seat.position.y = -0.16;
            const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.12, 10), body); hips.position.y = -0.06;
            // lap belt: a thin strap across the tops of the thighs (not a slab over the belly)
            const belt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.07), beltMat); belt.position.set(0, -0.075, -0.055);
            const torso = new THREE.Group();
            const tMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.095, 0.3, 10), body); tMesh.position.y = 0.15; torso.add(tMesh);
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), skin); head.position.y = 0.36; torso.add(head);
            const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.28, 8), body); armL.position.set(-0.1, 0.12, 0); torso.add(armL);
            const armR = armL.clone(); armR.position.x = 0.1; torso.add(armR);
            torso.position.y = 0.0; torso.userData.armL = armL; torso.userData.armR = armR;
            // Legs stay planted on the cabin floor: thigh on the seat top running forward, shin to the
            // floor, foot flat. Decoupled from the cushion bob (only the upper body springs).
            const legs = new THREE.Group();
            [-0.055, 0.055].forEach(sx => {
                const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.19, 8), body);
                thigh.rotation.x = Math.PI * 0.46; thigh.position.set(sx, -0.10, -0.08);
                const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.1, 8), body);
                shin.rotation.x = 0.14; shin.position.set(sx, -0.135, -0.185);
                const foot = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.028, 0.11), skin);
                foot.position.set(sx, -0.178, -0.205);   // foot bottom sits on the floor top (~-0.18 plane-local)
                legs.add(thigh, shin, foot);
            });
            // upper body (hips + lap belt + torso) - the only part that springs on the cushion / rises
            // against the belt; the seat and legs stay fixed to the figure.
            const upper = new THREE.Group(); upper.add(hips, belt, torso);
            fig.add(seat, legs, upper);
            fig.userData.torso = torso; fig.userData.upper = upper; fig.userData.baseY = -0.02;
            fig.position.set(0, -0.02, zPos[i]); fig.scale.set(0.82, 0.82, 0.82);
            crewGroup3D.add(fig);
        }
        planeGroup3D.add(crewGroup3D);   // inherits the plane's position + bank + pitch
        // every body mesh (fuselage, wings, tail, vTail, nose) - dimmed to a translucent shell while
        // crew are shown so they read as INSIDE the plane (crewGroup3D is a Group, so it's excluded)
        _planeBodyMeshes = planeGroup3D.children.filter(ch => ch.isMesh && ch.material);
    }

    function updateCabin3D() {
        if (!crewGroup3D || !cabinSim) return;
        cabinSim.occ.forEach((o, i) => {
            const fig = crewGroup3D.children[i + 3]; if (!fig || !fig.userData.torso) return;   // +3: skip floor + 2 walls
            const torso = fig.userData.torso, upper = fig.userData.upper;
            torso.rotation.z = o.torso;                          // lateral lean (plane local frame)
            torso.rotation.x = -o.torsoP - o.pelY * 0.25;        // hunch FORWARD (toward nose) under +G; slight float flex
            // Only the UPPER body springs (feet stay planted): rises against the belt in -G, presses a
            // little into the cushion in +G. Realistic modest travel, so nothing clips the floor.
            if (upper) upper.position.y = o.pelY > 0 ? o.pelY * 0.5 : o.pelY * 0.22;
            if (torso.userData.armL) { torso.userData.armL.rotation.z = o.arm * 0.8; torso.userData.armR.rotation.z = o.arm * 0.8; }
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
