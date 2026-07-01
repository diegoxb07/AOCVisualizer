/* Mission Visualizer - 8Hz Catmull-Rom interpolation
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    function getInterpolatedRow() {
        if (!filteredData || filteredData.length === 0) return null;
        let exactSec = videoLoaded ? (videoStartSeconds + video.currentTime) : (filteredData[currentIdx].absSeconds + playbackAccumulator);
        let idx1 = currentIdx;
        if (filteredData[idx1] && filteredData[idx1].absSeconds > exactSec && idx1 > 0) idx1--;
        let d1 = filteredData[idx1]; if (!d1) return null;
        let idx2 = Math.min(idx1 + 1, filteredData.length - 1);
        let d2 = filteredData[idx2];
        let dt = d2.absSeconds - d1.absSeconds;
        let t = 0;
        if (dt > 0) { let tRaw = (exactSec - d1.absSeconds) / dt; t = Math.max(0, Math.min(1, tRaw)); }

        let idx0 = Math.max(idx1 - 1, 0), idx3 = Math.min(idx2 + 1, filteredData.length - 1);
        let d0 = filteredData[idx0], d3 = filteredData[idx3];

        const lerp = (v0, v1, t) => { if (v0 === null || v1 === null) return v0 !== null ? v0 : v1; return v0 + (v1 - v0) * t; };
        const cubic = (v0, v1, v2, v3, t) => {
            if (v0 === null || v1 === null || v2 === null || v3 === null) {
                if (v1 !== null && v2 !== null) return lerp(v1, v2, t); return v1 !== null ? v1 : v2;
            }
            const t2 = t * t, t3 = t2 * t;
            return 0.5 * ((2 * v1) + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
        };
        const unwrap = (val, ref) => {
            if (val === null || ref === null) return val;
            let diff = val - ref; while (diff < -180) diff += 360; while (diff > 180) diff -= 360; return ref + diff;
        };
        const cubicAngle = (a0, a1, a2, a3, t) => {
            if (a1 === null || a2 === null) return a1 !== null ? a1 : a2;
            let a2_u = unwrap(a2, a1); if (a0 === null || a3 === null) return lerp(a1, a2_u, t);
            let a0_u = unwrap(a0, a1), a3_u = unwrap(a3, a2_u);
            let res = cubic(a0_u, a1, a2_u, a3_u, t); return ((res % 360) + 360) % 360;
        };

        const s = Math.round(exactSec * 8); 
        const seededRandom = (seed) => { let x = Math.sin(seed) * 10000; return x - Math.floor(x); };
        let u1 = seededRandom(s), u2 = seededRandom(s + 1); if (u1 < 0.0001) u1 = 0.0001; 
        let z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        let z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

        let alt_jitter = z0 * 0.15, pitch_jitter = z1 * 0.20, roll_jitter = z0 * 0.10; 
        let p_val = cubic(d0.pitch, d1.pitch, d2.pitch, d3.pitch, t);
        let r_val = cubic(d0.roll, d1.roll, d2.roll, d3.roll, t);
        let pa_val = cubic(d0.pAlt, d1.pAlt, d2.pAlt, d3.pAlt, t);
        let ga_val = cubic(d0.gpsAlt, d1.gpsAlt, d2.gpsAlt, d3.gpsAlt, t);
        let ra_val = cubic(d0.radAlt, d1.radAlt, d2.radAlt, d3.radAlt, t);

        return {
            ...d1,
            lat: cubic(d0.lat, d1.lat, d2.lat, d3.lat, t), lon: cubic(d0.lon, d1.lon, d2.lon, d3.lon, t),
            pitch: p_val !== null ? p_val + pitch_jitter : null, roll: r_val !== null ? r_val + roll_jitter : null,
            th: cubicAngle(d0.th, d1.th, d2.th, d3.th, t), gTrack: cubicAngle(d0.gTrack, d1.gTrack, d2.gTrack, d3.gTrack, t),
            pAlt: pa_val !== null ? pa_val + alt_jitter : null, gpsAlt: ga_val !== null ? ga_val + alt_jitter : null, radAlt: ra_val !== null ? ra_val + alt_jitter : null
        };
    }
