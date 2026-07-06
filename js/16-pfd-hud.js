/* Mission Visualizer, PFD attitude indicator + HUD text
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    // Slip/skid ball deflection in [-1, 1] (full scale = the G1000 trapezoid's travel), or null.
    // Prefers the gust probe's measured sideslip angle (beta); without it, estimates lateral
    // balance from the coordinated-turn relation g*tan(roll) = V*(heading rate) using the
    // neighboring 1Hz samples, a skidding turn deflects the ball to the outside, a slipping
    // one to the low side, exactly like the real instrument.
    function pfdSlipDeflection(d) {
        if (availableMetrics.has('beta') && d.beta !== null && d.beta !== undefined) return Math.max(-1, Math.min(1, d.beta / 6));
        if (d.roll === null || !filteredData.length || filteredData.length < 3) return null;
        const i = Math.max(1, Math.min(currentIdx, filteredData.length - 2));
        const p = filteredData[i - 1], n = filteredData[i + 1];
        if (!p || !n || p.th === null || n.th === null) return null;
        const dt = n.absSeconds - p.absSeconds; if (dt <= 0 || dt > 30) return null;
        let dPsi = n.th - p.th; if (dPsi > 180) dPsi -= 360; if (dPsi < -180) dPsi += 360;
        const psiDot = dPsi * Math.PI / 180 / dt;
        const spdKt = d.tas !== null ? d.tas : d.ias; if (spdKt === null || spdKt < 30) return null;
        const V = spdKt * 0.514444;
        const latG = (9.81 * Math.tan(d.roll * Math.PI / 180) - V * psiDot) / 9.81;
        return Math.max(-1, Math.min(1, latG / 0.15));
    }

    // Ground speed (kt) from the neighboring position samples, the log has no GS channel.
    function pfdGroundSpeedKt() {
        if (!filteredData.length || filteredData.length < 3) return null;
        const i = Math.max(1, Math.min(currentIdx, filteredData.length - 2));
        const p = filteredData[i - 1], n = filteredData[i + 1];
        if (!p || !n) return null;
        const dt = n.absSeconds - p.absSeconds; if (dt <= 0 || dt > 30) return null;
        return getDistanceNM(p.lat, p.lon, n.lat, n.lon) / (dt / 3600);
    }

    function renderPFD(d) {
        const c = document.getElementById('pfdCanvas'); if (!c || !c.getContext) return; const ctx = c.getContext('2d');
        const w = c.width; const h = c.height; const cx = w / 2; const cy = h / 2;
        ctx.clearRect(0, 0, w, h);
        const isImperial = document.getElementById('toggleImperial').checked, useGps = document.getElementById('toggleGpsAlt').checked;
        // The tape prefers IAS like a real G1000 (TAS gets its own data strip below); falls back to TAS.
        const hasAttitude = d.pitch !== null || d.roll !== null, pitch = d.pitch || 0, roll = d.roll || 0;
        const iasVal = (availableMetrics.has('ias') && d.ias !== null) ? d.ias : null;
        const spd = iasVal !== null ? iasVal : (d.tas !== null ? d.tas : null);
        let rawAlt = useGps ? (d.gpsAlt !== null ? d.gpsAlt : (d.pAlt !== null ? d.pAlt : (d.radAlt !== null ? d.radAlt : null))) : (d.pAlt !== null ? d.pAlt : (d.gpsAlt !== null ? d.gpsAlt : (d.radAlt !== null ? d.radAlt : null)));
        const alt = rawAlt !== null ? (isImperial ? rawAlt * 3.28084 : rawAlt) : null;
        let rawVsi = d.computedVsi !== null ? d.computedVsi : 0; const vsi = isImperial ? rawVsi * 2.23694 : rawVsi; 
        const hdg = d.th !== null ? d.th : (d.gTrack !== null ? d.gTrack : null);
        const altUnit = isImperial ? 'FT' : 'M', vsiUnitChars = isImperial ? ['M','P','H'] : ['M','/','S'], altPxPerUnit = isImperial ? (h / 1600) : (h / 400), altStep = isImperial ? 100 : 20, altMajorStep = isImperial ? 500 : 100, vsiMax = isImperial ? 25 : 10; 
        const leftW = Math.max(32, Math.floor(w * 0.18)), rightW = Math.max(32, Math.floor(w * 0.18)), vsiW = Math.max(8, Math.floor(w * 0.05)), rightX = w - rightW - vsiW, vsiX = w - vsiW, botY = h - Math.max(26, Math.floor(h * 0.14));
        const fSize = w > 200 ? 12 : 9, fSizeLg = w > 200 ? 13 : 10, bugH = w > 200 ? 24 : 18;
        const pitchRatio = h / 50, spdPxPerKt = h / 80, hdgPxPerDeg = w / 71;

        ctx.save(); ctx.rect(leftW, 0, w - leftW - rightW - vsiW, botY); ctx.clip();
        ctx.translate(cx, cy); if (hasAttitude) { ctx.rotate(-roll * Math.PI / 180); ctx.translate(0, pitch * pitchRatio); }
        ctx.fillStyle = '#1c75bc'; ctx.fillRect(-w, -h*2, w*2, h*2); ctx.fillStyle = '#6a4724'; ctx.fillRect(-w, 0, w*2, h*2);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(w, 0); ctx.stroke();

        if (hasAttitude) {
            // G1000-style ladder: 10° majors with labels both sides, 5° mediums, 2.5° minors
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.font = fSize + 'px sans-serif';
            const ladderStep = w > 180 ? 2.5 : 5;
            for (let i = -90; i <= 90; i += ladderStep) {
                if (i === 0) continue;
                const y = -i * pitchRatio;
                let pWidth, lw;
                if (i % 10 === 0) { pWidth = w * 0.15; lw = 2; } else if (i % 5 === 0) { pWidth = w * 0.085; lw = 1.5; } else { pWidth = w * 0.04; lw = 1; }
                ctx.lineWidth = lw;
                ctx.beginPath(); ctx.moveTo(-pWidth, y); ctx.lineTo(pWidth, y); ctx.stroke();
                if (i % 10 === 0) { ctx.fillText('' + Math.abs(i), -pWidth - 13, y); ctx.fillText('' + Math.abs(i), pWidth + 13, y); }
            }
            ctx.lineWidth = 2;
        }
        ctx.restore();

        // --- Fixed bank scale + roll pointer riding the horizon + slip/skid trapezoid (G1000 style) ---
        const ww = w - leftW - rightW - vsiW;
        const bankR = Math.min(ww * 0.42, botY * 0.42), k = Math.max(0.7, Math.min(1.5, w / 250));
        ctx.save(); ctx.rect(leftW, 0, ww, botY); ctx.clip(); ctx.translate(cx, cy);
        ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
        [[-60, 12], [-45, 7], [-30, 12], [-20, 7], [-10, 7], [10, 7], [20, 7], [30, 12], [45, 7], [60, 12]].forEach(([a, len]) => {
            const rad = (a - 90) * Math.PI / 180;
            ctx.lineWidth = (a % 30 === 0) ? 2 : 1.5;
            ctx.beginPath(); ctx.moveTo(Math.cos(rad) * bankR, Math.sin(rad) * bankR); ctx.lineTo(Math.cos(rad) * (bankR + len * k), Math.sin(rad) * (bankR + len * k)); ctx.stroke();
        });
        // fixed zero-reference triangle at the scale's apex, pointing down
        ctx.beginPath(); ctx.moveTo(0, -bankR); ctx.lineTo(-5 * k, -bankR - 9 * k); ctx.lineTo(5 * k, -bankR - 9 * k); ctx.closePath(); ctx.fill();
        if (hasAttitude) {
            ctx.rotate(-roll * Math.PI / 180);
            ctx.fillStyle = '#facc15';
            ctx.beginPath(); ctx.moveTo(0, -bankR + 2); ctx.lineTo(-6 * k, -bankR + 13 * k); ctx.lineTo(6 * k, -bankR + 13 * k); ctx.closePath(); ctx.fill();
            // slip/skid indicator: the trapezoid under the pointer slides laterally; full-scale
            // deflection turns it red (grossly uncoordinated / data limit)
            const ball = pfdSlipDeflection(d);
            if (ball !== null) {
                const off = ball * 13 * k;
                ctx.fillStyle = Math.abs(ball) > 0.99 ? '#f87171' : '#facc15';
                ctx.beginPath();
                ctx.moveTo(off - 6 * k, -bankR + 16 * k); ctx.lineTo(off + 6 * k, -bankR + 16 * k);
                ctx.lineTo(off + 8 * k, -bankR + 22 * k); ctx.lineTo(off - 8 * k, -bankR + 22 * k);
                ctx.closePath(); ctx.fill();
            }
        }
        ctx.restore();

        // Wind data box over the horizon's lower-left (the G1000's wind display):
        // arrow shows where the wind is blowing in the nose-up frame, digits are speed.
        if (availableMetrics.has('windSpd') && d.windSpd !== null && d.windDir !== null && hdg !== null) {
            const bx = leftW + 5, bw = 56 * k, bh = 24 * k, by = botY - bh - 5;
            ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx, by, bw, bh);
            ctx.save(); ctx.translate(bx + 12 * k, by + bh / 2);
            ctx.rotate((d.windDir + 180 - hdg) * Math.PI / 180);
            ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(0, 7 * k); ctx.lineTo(0, -3 * k); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, -8 * k); ctx.lineTo(-3.5 * k, -2 * k); ctx.lineTo(3.5 * k, -2 * k); ctx.closePath(); ctx.fill();
            ctx.restore();
            ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = 'bold ' + fSize + 'px monospace';
            ctx.fillText(d.windSpd.toFixed(0) + 'KT', bx + 22 * k, by + bh / 2);
        }

        ctx.save(); ctx.strokeStyle = '#facc15'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - w*0.16, cy); ctx.lineTo(cx - w*0.06, cy); ctx.lineTo(cx, cy + w*0.04); ctx.lineTo(cx + w*0.06, cy); ctx.lineTo(cx + w*0.16, cy); ctx.stroke(); ctx.fillStyle = '#facc15'; ctx.fillRect(cx - 2, cy - 2, 4, 4); ctx.restore();
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, leftW, botY); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(leftW, 0); ctx.lineTo(leftW, botY); ctx.stroke();
        
        ctx.save(); ctx.rect(0, 0, leftW, botY); ctx.clip(); ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = fSize + 'px monospace';
        if (spd !== null) {
            let startSpd = Math.floor((spd - (cy / spdPxPerKt)) / 10) * 10; let endSpd = Math.ceil((spd + (cy / spdPxPerKt)) / 10) * 10;
            for (let s = startSpd; s <= endSpd; s += 10) { if (s < 0) continue; let y = cy - (s - spd) * spdPxPerKt; ctx.beginPath(); ctx.moveTo(leftW - 8, y); ctx.lineTo(leftW, y); ctx.stroke(); if (s % 20 === 0) ctx.fillText(s, leftW - 10, y); }
        }
        ctx.fillStyle = '#38bdf8'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = 'bold ' + (fSize) + 'px sans-serif'; ctx.fillText(iasVal !== null ? 'IAS' : 'TAS', leftW / 2, 4); ctx.restore();
        
        ctx.fillStyle = '#000'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.fillRect(4, cy - bugH/2, leftW - 4, bugH); ctx.strokeRect(4, cy - bugH/2, leftW - 4, bugH); ctx.fillStyle = spd !== null ? '#fff' : '#888'; ctx.textAlign = 'center'; ctx.font = 'bold ' + fSizeLg + 'px monospace'; ctx.fillText(spd !== null ? spd.toFixed(0) : '---', leftW / 2 + 2, cy + 1);

        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(rightX, 0, rightW, botY); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(rightX, 0); ctx.lineTo(rightX, botY); ctx.stroke();
        
        ctx.save(); ctx.rect(rightX, 0, rightW, botY); ctx.clip(); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = fSize + 'px monospace';
        if (alt !== null) {
            let startAlt = Math.floor((alt - (cy / altPxPerUnit)) / altStep) * altStep; let endAlt = Math.ceil((alt + (cy / altPxPerUnit)) / altStep) * altStep;
            for (let a = startAlt; a <= endAlt; a += altStep) { let y = cy - (a - alt) * altPxPerUnit; ctx.beginPath(); ctx.moveTo(rightX, y); ctx.lineTo(rightX + 8, y); ctx.stroke(); if (a % altMajorStep === 0) ctx.fillText(a, rightX + 12, y); }
        }
        ctx.fillStyle = '#38bdf8'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = 'bold ' + (fSize) + 'px sans-serif'; ctx.fillText(altUnit, rightX + rightW / 2, 4); ctx.restore();
        
        ctx.fillStyle = '#000'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.fillRect(rightX, cy - bugH/2, rightW - 4, bugH); ctx.strokeRect(rightX, cy - bugH/2, rightW - 4, bugH); ctx.fillStyle = alt !== null ? '#fff' : '#888'; ctx.textAlign = 'center'; ctx.font = 'bold ' + fSizeLg + 'px monospace'; ctx.fillText(alt !== null ? alt.toFixed(0) : '---', rightX + rightW / 2 - 2, cy + 1);

        // Radar-altimeter readout under the altitude box when low (like the G1000's RA on approach)
        if (availableMetrics.has('radAlt') && d.radAlt !== null && d.radAlt * 3.28084 < 2500) {
            const raVal = isImperial ? d.radAlt * 3.28084 : d.radAlt;
            ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(rightX, cy + bugH / 2 + 3, rightW - 4, 14 * k);
            ctx.fillStyle = '#38bdf8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold ' + Math.max(8, fSize - 2) + 'px monospace';
            ctx.fillText('RA ' + raVal.toFixed(0), rightX + (rightW - 4) / 2, cy + bugH / 2 + 3 + 7 * k);
        }

        ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(vsiX, 0, vsiW, botY); ctx.beginPath(); ctx.moveTo(vsiX, cy); ctx.lineTo(w, cy); ctx.strokeStyle = '#888'; ctx.stroke();
        ctx.fillStyle = '#38bdf8'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; let vsiFontSize = Math.max(8, fSize - 3); ctx.font = 'bold ' + vsiFontSize + 'px sans-serif';
        vsiUnitChars.forEach((char, i) => { ctx.fillText(char, vsiX + vsiW/2, 2 + vsiFontSize * i); });

        if (alt !== null && vsi !== 0) {
            let maxDeflectionPx = (botY - 20) / 2; let vsiHeight = Math.max(-maxDeflectionPx, Math.min(maxDeflectionPx, (vsi / vsiMax) * maxDeflectionPx));
            ctx.fillStyle = vsi > 0 ? '#7dd3fc' : '#ef4444';
            ctx.beginPath(); ctx.moveTo(vsiX + vsiW/2, cy); ctx.lineTo(vsiX + vsiW/2, cy - vsiHeight); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = Math.max(2, vsiW * 0.25); ctx.stroke();
            ctx.beginPath(); let arrowOffset = vsi > 0 ? 5 : -5; ctx.moveTo(vsiX + 2, cy - vsiHeight + arrowOffset); ctx.lineTo(vsiX + vsiW - 2, cy - vsiHeight + arrowOffset); ctx.lineTo(vsiX + vsiW/2, cy - vsiHeight); ctx.fill();
        }

        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(leftW, botY, w - leftW - rightW - vsiW, h - botY); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(leftW, botY); ctx.lineTo(w - rightW - vsiW, botY); ctx.stroke();
        ctx.save(); ctx.rect(leftW, botY, w - leftW - rightW - vsiW, h - botY); ctx.clip(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = fSize + 'px monospace';
        const hdgWidth = w - leftW - rightW - vsiW; const centerHdgX = leftW + hdgWidth / 2;

        if (hdg !== null) {
            let startHdg = Math.floor(hdg - (hdgWidth / 2 / hdgPxPerDeg)); let endHdg = Math.ceil(hdg + (hdgWidth / 2 / hdgPxPerDeg));
            for (let h_idx = startHdg; h_idx <= endHdg; h_idx++) {
                if (h_idx % 5 === 0) {
                    let x = centerHdgX + (h_idx - hdg) * hdgPxPerDeg; let displayHdg = (h_idx % 360 + 360) % 360; let isMajor = h_idx % 10 === 0;
                    ctx.beginPath(); ctx.moveTo(x, botY); ctx.lineTo(x, botY + (isMajor ? 8 : 4)); ctx.stroke();
                    if (isMajor) { let text = displayHdg.toString(); if (displayHdg === 0) text = 'N'; else if (displayHdg === 90) text = 'E'; else if (displayHdg === 180) text = 'S'; else if (displayHdg === 270) text = 'W'; else text = (displayHdg / 10).toString(); ctx.fillText(text, x, botY + 10); }
                }
            }
            // Ground-track diamond on the tape (the HSI's track indicator)
            if (d.gTrack !== null && d.th !== null) {
                let dTrk = d.gTrack - hdg; while (dTrk > 180) dTrk -= 360; while (dTrk < -180) dTrk += 360;
                const tx = centerHdgX + dTrk * hdgPxPerDeg;
                ctx.fillStyle = '#9aa1ad';
                ctx.beginPath(); ctx.moveTo(tx, botY + 1); ctx.lineTo(tx + 4, botY + 7); ctx.lineTo(tx, botY + 13); ctx.lineTo(tx - 4, botY + 7); ctx.closePath(); ctx.fill();
                ctx.fillStyle = '#fff';
            }
        }
        ctx.restore();
        
        ctx.fillStyle = '#000'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.fillRect(centerHdgX - 22, botY, 44, bugH); ctx.strokeRect(centerHdgX - 22, botY, 44, bugH); ctx.fillStyle = hdg !== null ? '#fff' : '#888'; ctx.font = 'bold ' + fSizeLg + 'px monospace';
        ctx.fillText(hdg !== null ? ((hdg % 360 + 360) % 360).toFixed(0) + '°' : '---', centerHdgX, botY + 4);

        // G1000-style data strips in the bottom corners: OAT + GS on the left, TAS (+IAS) on the right.
        const cornerF = Math.max(8, fSize - 1), pad = 4, half = (h - botY) / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, botY, leftW, h - botY); ctx.fillRect(rightX, botY, rightW + vsiW, h - botY);
        ctx.font = 'bold ' + cornerF + 'px monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const oat = d.tempr !== null ? (isImperial ? d.tempr * 9 / 5 + 32 : d.tempr).toFixed(0) + '°' : '---';
        ctx.fillStyle = '#38bdf8'; ctx.fillText('OAT', pad, botY + half * 0.7);
        ctx.fillStyle = '#fff'; ctx.fillText(oat, pad + cornerF * 2.6, botY + half * 0.7);
        const gs = pfdGroundSpeedKt();
        ctx.fillStyle = '#38bdf8'; ctx.fillText('GS', pad, botY + half * 1.6);
        ctx.fillStyle = '#9aa1ad'; ctx.fillText(gs !== null ? gs.toFixed(0) + 'KT' : '---', pad + cornerF * 2.6, botY + half * 1.6);
        ctx.fillStyle = '#38bdf8'; ctx.fillText('TAS', rightX + pad, botY + half * 0.7);
        ctx.fillStyle = '#fff'; ctx.fillText(d.tas !== null ? d.tas.toFixed(0) + 'KT' : '---', rightX + pad + cornerF * 2.6, botY + half * 0.7);
        if (iasVal !== null) {
            ctx.fillStyle = '#38bdf8'; ctx.fillText('IAS', rightX + pad, botY + half * 1.6);
            ctx.fillStyle = '#fff'; ctx.fillText(iasVal.toFixed(0) + 'KT', rightX + pad + cornerF * 2.6, botY + half * 1.6);
        }
    }

    function renderHUD(d) {
        const sf = (val, dec) => val !== null && val !== undefined ? val.toFixed(dec) : 'N/A';
        const addHUD = (label, valStr, isTemp=false) => `<d>${label.padEnd(13, ' ')}: <span${isTemp?' class="temp-val"':''}>${valStr}</span></d>`;
        
        const isImperial = document.getElementById('toggleImperial').checked;

        let h = addHUD('TIME (UTC)', `${d.time.slice(0,2)}:${d.time.slice(2,4)}:${d.time.slice(4)}`);
        h += addHUD('LATITUDE', `${sf(d.lat, 3)}°N`);
        h += addHUD('LONGITUDE', `${sf(Math.abs(d.lon), 3)}°W`);
        
        let pAltDisp = d.pAlt !== null ? sf(isImperial ? d.pAlt * 3.28084 : d.pAlt, 0) + (isImperial ? ' ft' : ' m') : 'N/A';
        let gAltDisp = d.gpsAlt !== null ? sf(isImperial ? d.gpsAlt * 3.28084 : d.gpsAlt, 0) + (isImperial ? ' ft' : ' m') : 'N/A';
        let rAltDisp = d.radAlt !== null ? sf(isImperial ? d.radAlt * 3.28084 : d.radAlt, 0) + (isImperial ? ' ft' : ' m') : 'N/A';
        let dValueDisp = d.dValue !== null ? sf(isImperial ? d.dValue * 3.28084 : d.dValue, 0) + (isImperial ? ' ft' : ' m') : 'N/A';
        
        let tDisp = d.tempr !== null ? sf(isImperial ? (d.tempr * 9/5 + 32) : d.tempr, 1) + (isImperial ? ' °F' : ' °C') : 'N/A';
        let tdDisp = d.dewpt !== null ? sf(isImperial ? (d.dewpt * 9/5 + 32) : d.dewpt, 1) + (isImperial ? ' °F' : ' °C') : 'N/A';
        
        // Core altitude line prefers pressure altitude; GPS altitude is always relegated to the extra
        // metrics below (it only surfaces here as a fallback when there is no pressure altitude at all).
        if (availableMetrics.has('pAlt')) h += addHUD('PRESS ALT', pAltDisp);
        else if (availableMetrics.has('gpsAlt')) h += addHUD('GPS ALT', gAltDisp);
        
        if (availableMetrics.has('sfcPr')) h += addHUD('SFC PRESS', `${d.sfcPr !== null ? sf(d.sfcPr, 1) + ' mb' : 'N/A'}`);
        if (availableMetrics.has('windSpd')) h += addHUD('WIND SPEED', `${d.windSpd !== null ? sf(d.windSpd, 1) + ' kt' : 'N/A'}`);
        if (availableMetrics.has('tempr')) h += addHUD('AMBIENT TEMP', tDisp, true);
        if (availableMetrics.has('dewpt')) h += addHUD('DEW POINT', tdDisp, true);
        
        // Core metrics end here. Extra metrics are ALWAYS shown now (no toggle); they live below the
        // fold and scroll into view, so the HUD stays pinned to its core size and never covers content above.
        let coreHtml = h;
        let extraHtml = `<div style="border-top:1px solid #38bdf8; margin:6px 0; padding-top:4px; opacity:0.6; font-size:9px;">EXTRA EXTRACTED METRICS</div>`;
        const addExtra = (label, valStr, isTemp=false) => { extraHtml += addHUD(label, valStr, isTemp); };

        // GPS altitude always lives in the extra metrics (skipped only if it was the core fallback above).
        if (availableMetrics.has('gpsAlt') && availableMetrics.has('pAlt')) addExtra('GPS ALT', gAltDisp);

        if (availableMetrics.has('pitch')) addExtra('PITCH', `${d.pitch !== null ? sf(d.pitch, 1) + '°' : 'N/A'}`);
        if (availableMetrics.has('roll')) addExtra('ROLL', `${d.roll !== null ? sf(d.roll, 1) + '°' : 'N/A'}`);
        if (availableMetrics.has('driftAngle')) addExtra('DRIFT ANGLE', `${d.driftAngle !== null ? sf(d.driftAngle, 1) + '°' : 'N/A'}`);
        if (availableMetrics.has('alpha')) addExtra('ALPHA (AOA)', `${d.alpha !== null ? sf(d.alpha, 2) + '°' : 'N/A'}`);
        if (availableMetrics.has('beta')) addExtra('BETA (SLIP)', `${d.beta !== null ? sf(d.beta, 2) + '°' : 'N/A'}`);
        if (availableMetrics.has('accZ')) addExtra('VERT ACCEL', `${d.accZ !== null ? sf(d.accZ, 2) + ' m/s²' : 'N/A'}`);
        if (availableMetrics.has('radAlt')) addExtra('RADAR ALT', rAltDisp);
        if (availableMetrics.has('dValue')) addExtra('D-VALUE', dValueDisp);
        if (availableMetrics.has('tas')) addExtra('TRUE AIRSPD', `${d.tas !== null ? sf(d.tas, 1) + ' kt' : 'N/A'}`);
        if (availableMetrics.has('ias')) addExtra('IND AIRSPD', `${d.ias !== null ? sf(d.ias, 1) + ' kt' : 'N/A'}`);
        if (availableMetrics.has('th')) addExtra('TRUE HEADING', `${d.th !== null ? sf(d.th, 1) + '°' : 'N/A'}`);
        if (availableMetrics.has('gTrack')) addExtra('GROUND TRACK', `${d.gTrack !== null ? sf(d.gTrack, 1) + '°' : 'N/A'}`);
        if (availableMetrics.has('vtWnd')) addExtra('VERT WIND', `${d.vtWnd !== null ? sf(isImperial ? d.vtWnd * 2.23694 : d.vtWnd, 1) + (isImperial ? ' mph' : ' m/s') : 'N/A'}`);
        if (availableMetrics.has('mixRate')) addExtra('MIXING RATIO', `${d.mixRate !== null ? sf(d.mixRate, 2) + ' g/kg' : 'N/A'}`);
        if (availableMetrics.has('thetaE')) addExtra('THETA E', `${d.thetaE !== null ? sf(d.thetaE, 1) + ' K' : 'N/A'}`, true);
        if (availableMetrics.has('pressure')) addExtra('FL PRESS', `${d.pressure !== null ? sf(d.pressure, 1) + ' mb' : 'N/A'}`);

        const prevScroll = hud.scrollTop;
        hud.innerHTML = `<div id="hudCore">${coreHtml}</div><div id="hudExtra">${extraHtml}</div>`;
        const coreEl = document.getElementById('hudCore');
        if (coreEl) hud.style.maxHeight = (coreEl.offsetHeight + 28) + 'px';  // pin to core height; extra scrolls below
        hud.scrollTop = prevScroll;
    }

