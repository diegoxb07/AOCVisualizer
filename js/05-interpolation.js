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

        // --- Micro-motion between the 1 Hz keyframes ---
        // Amplitude scales with vertical wind (the measured turbulence proxy); shape is smooth
        // band-limited noise (a few sub-2 Hz sinusoids) so it reads as gust response, not static.
        // In calm air (vtWnd ~ 0) the plane sits still.
        let turb = 0.10;   // faint baseline only for files with NO vertical-wind channel (never frozen-dead)
        if (d1.vtWnd !== null && d2.vtWnd !== null) turb = Math.min(1, Math.abs(d1.vtWnd + (d2.vtWnd - d1.vtWnd) * t) / 3.0);
        const bandNoise = (ph) => 0.6 * Math.sin(exactSec * 2.3 + ph) + 0.3 * Math.sin(exactSec * 5.9 + ph * 2.1) + 0.1 * Math.sin(exactSec * 11.7 + ph * 3.7);
        let alt_jitter = bandNoise(0.0) * 0.7 * turb;      // metres  (turbulence-scaled; was a fixed 0.15 m white-noise draw)
        let pitch_jitter = bandNoise(1.7) * 0.30 * turb;   // degrees (was fixed 0.20)
        let roll_jitter = bandNoise(3.9) * 0.45 * turb;    // degrees (was fixed 0.10)
        let p_val = cubic(d0.pitch, d1.pitch, d2.pitch, d3.pitch, t);
        let r_val = cubic(d0.roll, d1.roll, d2.roll, d3.roll, t);
        let pa_val = cubic(d0.pAlt, d1.pAlt, d2.pAlt, d3.pAlt, t);
        let ga_val = cubic(d0.gpsAlt, d1.gpsAlt, d2.gpsAlt, d3.gpsAlt, t);
        let ra_val = cubic(d0.radAlt, d1.radAlt, d2.radAlt, d3.radAlt, t);

        return {
            ...d1,
            lat: cubic(d0.lat, d1.lat, d2.lat, d3.lat, t),
            // Longitude gets the same short-way unwrap as headings: a dateline crossing must
            // interpolate -179.99 -> +179.99 as a 0.02deg step, not a sweep around the globe.
            lon: (() => {
                const l0 = unwrap(d0.lon, d1.lon), l2 = unwrap(d2.lon, d1.lon), l3 = unwrap(d3.lon, l2);
                const res = cubic(l0, d1.lon, l2, l3, t);
                return res === null ? null : ((res % 360) + 540) % 360 - 180;
            })(),
            pitch: p_val !== null ? p_val + pitch_jitter : null, roll: r_val !== null ? r_val + roll_jitter : null,
            th: cubicAngle(d0.th, d1.th, d2.th, d3.th, t), gTrack: cubicAngle(d0.gTrack, d1.gTrack, d2.gTrack, d3.gTrack, t),
            pAlt: pa_val !== null ? pa_val + alt_jitter : null, gpsAlt: ga_val !== null ? ga_val + alt_jitter : null, radAlt: ra_val !== null ? ra_val + alt_jitter : null,
            // Linear (not cubic - avoids inventing phantom gust overshoot) so the vertical-wind forcing
            // that drives the Crew Ride's float/hunch is continuous, not a 1 Hz step.
            vtWnd: lerp(d1.vtWnd, d2.vtWnd, t)
        };
    }
