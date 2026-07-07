/* Mission Visualizer, Verlet ragdoll physics for the crew dummies
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   A lightweight position-based rigid-body engine: point masses integrated with Verlet (velocity
   is implicit in the last two positions, so momentum carries through every interaction for free)
   bound by distance constraints solved by iterative projection. Each crew dummy is a ragdoll of
   13 particles (pelvis, chest, head, shoulders, elbows, hands, knees, feet) whose bones are rigid
   rods, with three softer elements making it a seated human rather than a loose chain: weak
   "muscle tone" pins pulling every particle toward its seated rest pose, a lap-belt rope that
   only engages when the pelvis floats past its slack, and the seat cushion / cabin floor as
   one-sided contacts. Forcing is the SAME flight-metric field the cabin sim always used
   (cabinForcing() in js/21-cabin.js: lateral slip-imbalance g, vertical load factor from the
   measured vertical wind, turbulence buzz), applied as the apparent-gravity acceleration of the
   seat frame, so calm air keeps the crew planted and only real data moves them. The solver runs
   through verletStepCabin(dt), which stepCabin() delegates to and which writes the resulting
   joint angles back into cabinSim.occ, so the 2D cutaway and the 3D dummies render unchanged.
   The airframe itself is NOT part of the system: no plane constraints, nothing breaks. */

    // --- engine core -----------------------------------------------------------------------

    function VerletBody() {
        this.parts = [];   // { x,y,z, px,py,pz, im } (im = inverse mass; 0 pins a particle outright)
        this.bones = [];   // { a, b, rest, k } distance constraints, k = stiffness 0..1
        this.ropes = [];   // { a, ax,ay,az, len } one-sided: engages only past len (the lap belt)
        this.tones = [];   // { a, tx,ty,tz, k, below } acceleration springs toward a rest pose
                           // (muscle tone; k in 1/s^2 so the response is dt-independent; below
                           // restricts it to compression, the seat cushion)
    }
    VerletBody.prototype.addPart = function (x, y, z, im) {
        this.parts.push({ x, y, z, px: x, py: y, pz: z, im: im == null ? 1 : im });
        return this.parts.length - 1;
    };
    VerletBody.prototype.addBone = function (a, b, k) {
        const A = this.parts[a], B = this.parts[b];
        this.bones.push({ a, b, rest: Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z), k: k == null ? 1 : k });
    };
    // One Verlet step: integrate under the acceleration field, then relax all constraints.
    // floorAt(p) returns the floor height under a particle (seat cushion vs cabin floor).
    VerletBody.prototype.step = function (dt, ax, ay, az, damp, iters, floorAt) {
        const dt2 = dt * dt;
        this.parts.forEach(p => {
            if (!p.im) return;
            const vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp, vz = (p.z - p.pz) * damp;
            p.px = p.x; p.py = p.y; p.pz = p.z;
            p.x += vx + ax * dt2; p.y += vy + ay * dt2; p.z += vz + az * dt2;
        });
        this.tones.forEach(t => {
            const p = this.parts[t.a]; if (!p.im) return;
            if (t.below && p.y >= t.ty) return;   // a cushion pushes back only while compressed
            const s = t.k * dt2;
            p.x += (t.tx - p.x) * s; p.y += (t.ty - p.y) * s; p.z += (t.tz - p.z) * s;
        });
        for (let it = 0; it < iters; it++) {
            this.bones.forEach(c => {
                const A = this.parts[c.a], B = this.parts[c.b];
                const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
                const d = Math.hypot(dx, dy, dz) || 1e-9;
                const w = A.im + B.im; if (!w) return;
                const corr = c.k * (d - c.rest) / (d * w);
                A.x += dx * corr * A.im; A.y += dy * corr * A.im; A.z += dz * corr * A.im;
                B.x -= dx * corr * B.im; B.y -= dy * corr * B.im; B.z -= dz * corr * B.im;
            });
            this.ropes.forEach(r => {
                const p = this.parts[r.a]; if (!p.im) return;
                const dx = p.x - r.ax, dy = p.y - r.ay, dz = p.z - r.az;
                const d = Math.hypot(dx, dy, dz);
                if (d > r.len) { const s = r.len / d; p.x = r.ax + dx * s; p.y = r.ay + dy * s; p.z = r.az + dz * s; }
            });
        }
        if (floorAt) this.parts.forEach(p => {
            if (!p.im) return;
            const fy = floorAt(p);
            if (p.y < fy) { p.y = fy; p.px = p.x + (p.px - p.x) * 0.5; p.pz = p.z + (p.pz - p.z) * 0.5; }   // contact + friction
        });
    };

    // --- seated dummy ragdoll ---------------------------------------------------------------
    // Built in the seat frame (y up, x lateral, z aft; nose is -z), in figure-local units
    // matching the 3D dummy's proportions. The chest rest pose leans a hair forward, so a
    // vertical load factor has a real moment arm: +G hunches the torso forward, -G extends it,
    // with no scripted posture targets.

    const RAG_POSE = {
        pelvis: [0, 0.15, 0.02], chest: [0, 0.425, -0.005], head: [0, 0.545, -0.01],
        shL: [-0.105, 0.395, -0.01], elL: [-0.105, 0.245, 0.01], haL: [-0.105, 0.105, 0.03],
        shR: [0.105, 0.395, -0.01], elR: [0.105, 0.245, 0.01], haR: [0.105, 0.105, 0.03],
        knL: [-0.06, 0.14, -0.17], ftL: [-0.06, 0.012, -0.205],
        knR: [0.06, 0.14, -0.17], ftR: [0.06, 0.012, -0.205]
    };

    function buildSeatedRag(o) {
        const body = new VerletBody();
        const id = {};
        Object.keys(RAG_POSE).forEach(k => { const p = RAG_POSE[k]; id[k] = body.addPart(p[0], p[1], p[2]); });
        // bones: spine and neck, shoulder girdle, arms, legs
        body.addBone(id.pelvis, id.chest, 1);
        body.addBone(id.chest, id.head, 0.95);
        body.addBone(id.chest, id.shL, 1); body.addBone(id.chest, id.shR, 1);
        body.addBone(id.shL, id.shR, 1);
        body.addBone(id.pelvis, id.shL, 0.8); body.addBone(id.pelvis, id.shR, 0.8);   // torso triangulation
        body.addBone(id.shL, id.elL, 0.9); body.addBone(id.elL, id.haL, 0.9);
        body.addBone(id.shR, id.elR, 0.9); body.addBone(id.elR, id.haR, 0.9);
        body.addBone(id.pelvis, id.knL, 0.95); body.addBone(id.knL, id.ftL, 0.95);
        body.addBone(id.pelvis, id.knR, 0.95); body.addBone(id.knR, id.ftR, 0.95);
        // lap belt: slack rope from the seat anchor, engaging only when the body floats up
        body.ropes.push({ a: id.pelvis, ax: RAG_POSE.pelvis[0], ay: RAG_POSE.pelvis[1], az: RAG_POSE.pelvis[2], len: o.beltCap });
        // muscle tone (k in 1/s^2). The seated pose is an inverted pendulum, so upper-body
        // tone must beat each segment's gravity-destabilization rate (gApp/length, ~45/s^2 for
        // the neck at peak G) or the dummy topples; the margin above it sets how far real G
        // leans the segment. Hanging parts (arms) are gravity-stable and stay nearly free.
        const tone = (k, part, below) => body.tones.push({ a: id[part], tx: RAG_POSE[part][0], ty: RAG_POSE[part][1], tz: RAG_POSE[part][2], k, below: !!below });
        tone(210, 'pelvis', true);   // the seat cushion: compresses under +G, lets -G float the body into the belt
        tone(55 / o.gain, 'chest'); tone(108 / o.gain, 'head');
        tone(32, 'shL'); tone(32, 'shR');
        tone(6, 'elL'); tone(6, 'elR');
        tone(2.5 / o.gain, 'haL'); tone(2.5 / o.gain, 'haR');
        tone(60, 'knL'); tone(60, 'knR'); tone(60, 'ftL'); tone(60, 'ftR');
        body.ragIds = id;
        return body;
    }

    let _ragBodies = null;   // one VerletBody per cabinSim occupant
    const RAG_G = 9.81 * 0.55;   // gravity scaled to figure units, so each limb's pendulum period matches a human's despite the shrunken skeleton

    // Lateral swing of segment a->b measured from straight-down, matching the pendulum
    // convention the renderers expect (0 = hanging, + = toward starboard).
    function _swingLat(A, B) { return Math.atan2(B.x - A.x, -(B.y - A.y)); }
    function _wrapPi(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
    function _clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    // Skeleton -> the joint-angle vocabulary the renderers read.
    function _ragExtract(body) {
        const id = body.ragIds;
        const P = body.parts[id.pelvis], C = body.parts[id.chest], H = body.parts[id.head];
        return {
            torso: Math.atan2(C.x - P.x, C.y - P.y),
            head: Math.atan2(H.x - C.x, H.y - C.y),
            torsoP: Math.atan2(-(C.z - P.z), C.y - P.y),
            arm: (_swingLat(body.parts[id.shL], body.parts[id.elL]) + _swingLat(body.parts[id.shR], body.parts[id.elR])) / 2,
            fore: (_swingLat(body.parts[id.elL], body.parts[id.haL]) + _swingLat(body.parts[id.elR], body.parts[id.haR])) / 2,
            pelY: P.y - RAG_POSE.pelvis[1]
        };
    }

    // The integrator stepCabin() delegates to: step every dummy's ragdoll under the current
    // flight-metric field, then express the skeleton back as the joint angles cabinSim.occ
    // carries, so renderCabin2D and updateCabin3D stay untouched.
    function verletStepCabin(dt) {
        if (typeof cabinSim === 'undefined' || !cabinSim) return;
        const f = cabinForcing();
        if (!_ragBodies || _ragBodies.length !== cabinSim.occ.length) {
            _ragBodies = cabinSim.occ.map(o => {
                const body = buildSeatedRag(o);
                const seatY = RAG_POSE.pelvis[1] - o.cushMax;
                body.floorAt = p => (p === body.parts[body.ragIds.pelvis] ? seatY : 0);
                // settle under plain 1 g and take that as the zero pose, so calm air reads as
                // exactly the seated rest the renderers were built around
                for (let n = 0; n < 180; n++) body.step(1 / 60, 0, -RAG_G, 0, 0.96, 5, body.floorAt);
                body.base = _ragExtract(body);
                return body;
            });
        }
        const sub = Math.min(6, Math.max(1, Math.ceil(dt / 0.02)));
        const h = dt / sub;
        const ts = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        cabinSim.occ.forEach((o, i) => {
            const body = _ragBodies[i];
            const jitL = f.turb * (0.6 * Math.sin(ts * 11.0 * Math.PI + o.jphase) + 0.4 * Math.sin(ts * 17.3 * Math.PI + o.jphase * 2.1));
            const jitV = f.turb * (0.5 * Math.sin(ts * 9.5 * Math.PI + o.jphase * 1.7) + 0.5 * Math.sin(ts * 15.1 * Math.PI + o.jphase * 0.9));
            const aLat = (f.lat * o.gain + jitL * 0.12) * RAG_G;
            // apparent gravity in the seat frame: negative-G data genuinely points it upward,
            // which is what lifts the body into the belt and the limbs off their rests
            const aVert = -(1 + f.gz * o.gain + jitV * 0.12) * RAG_G;
            for (let n = 0; n < sub; n++) body.step(h, aLat, aVert, 0, 0.99, 5, body.floorAt);
            // write the skeleton back as the renderers' joint angles, relative to the settled
            // pose and bounded to the articulation the meshes can express (a floating arm may
            // sweep overhead in the sim; the elbow bend it hands the renderer stays sane)
            const raw = _ragExtract(body), b = body.base;
            o.torso = _clamp(raw.torso - b.torso, -1.0, 1.0);
            o.head = _clamp(raw.head - b.head, -0.9, 0.9);
            o.torsoP = _clamp(raw.torsoP - b.torsoP, -0.30, 0.16);   // forward bow capped low; +G slumps vertically, not forward
            o.arm = _clamp(raw.arm - b.arm, -1.25, 1.25);
            o.fore = o.arm + _clamp(_wrapPi(raw.fore - raw.arm - (b.fore - b.arm)), -1.4, 1.4);
            o.pelY = _clamp(raw.pelY - b.pelY, -o.cushMax, o.beltCap);
        });
        cabinSim.roll = f.valid ? f.roll : 0;
        cabinSim.valid = f.valid;
    }
