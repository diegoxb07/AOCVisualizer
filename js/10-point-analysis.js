/* Mission Visualizer, point analysis modal + report download
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    function processPointAnalysisPlotting(dataRow) {
        document.getElementById('pointAnalysisModal').style.display = 'flex'; currentPointAnalysisData = dataRow; 
        const targetPr = dataRow.pressure !== null ? dataRow.pressure : (dataRow.sfcPr !== null ? dataRow.sfcPr : 850);
        const isImperial = !document.getElementById('toggleSI').checked; const useGps = !document.getElementById('toggleGpsAlt').checked;
        
        let rhCalc = null;
        if (dataRow.tempr !== null && dataRow.dewpt !== null) {
            const targetAirC = dataRow.tempr, targetDewC = dataRow.dewpt;
            rhCalc = Math.min(100, Math.max(0, ((6.11 * Math.exp((17.625 * targetDewC) / (243.04 + targetDewC))) / (6.11 * Math.exp((17.625 * targetAirC) / (243.04 + targetAirC)))) * 100));
        }

        const reqTime = new Date().toLocaleString();
        document.getElementById('pointAnalysisMeta').innerHTML = `<strong>Flight ID:</strong> ${flightMetaData.id} | <strong>Aircraft:</strong> ${flightMetaData.aircraft} | <strong>Date:</strong> ${flightMetaData.date} | <strong>Request Time:</strong> ${reqTime}`;

        const sf = (val, dec=1) => val !== null && val !== undefined ? val.toFixed(dec) : 'N/A';
        let statsHTML = `
            <div style="color:#38bdf8; font-weight:bold; font-size:15px; border-bottom:1px solid #20262f; padding-bottom:8px; margin-bottom:14px; font-family:monospace; margin-top:12px;">STATION REPORT [${dataRow.time.slice(0,2)}:${dataRow.time.slice(2,4)}:${dataRow.time.slice(4)} UTC]</div>
            <div style="font-family:monospace; font-size:14px; display:grid; grid-template-columns: 1fr 1fr; gap:12px; line-height: 1.5;">
                <p>COORD LAT   : <span style="color:#fff; font-weight:bold;">${sf(dataRow.lat, 3)}° N</span></p>
                <p>COORD LON   : <span style="color:#fff; font-weight:bold;">${sf(Math.abs(dataRow.lon), 3)}° W</span></p>`;
                
        if (targetPr !== 850 || availableMetrics.has('pressure') || availableMetrics.has('sfcPr')) { statsHTML += `<p>BARO LEVEL  : <span style="color:#7dd3fc; font-weight:bold;">${sf(targetPr, 1)} mb</span></p>`; }
        
        let pAltDisp = dataRow.pAlt !== null ? sf(isImperial ? dataRow.pAlt * 3.28084 : dataRow.pAlt, 0) + (isImperial ? ' ft' : ' m') : 'N/A';
        let gAltDisp = dataRow.gpsAlt !== null ? sf(isImperial ? dataRow.gpsAlt * 3.28084 : dataRow.gpsAlt, 0) + (isImperial ? ' ft' : ' m') : 'N/A';
        let dValueDisp = dataRow.dValue !== null ? sf(isImperial ? dataRow.dValue * 3.28084 : dataRow.dValue, 0) + (isImperial ? ' ft' : ' m') : 'N/A';
        
        if (useGps) { if (availableMetrics.has('gpsAlt')) statsHTML += `<p>GPS ALTITUDE: <span style="color:#38bdf8; font-weight:bold;">${gAltDisp}</span></p>`; } 
        else { if (availableMetrics.has('pAlt')) statsHTML += `<p>PRESS ALT   : <span style="color:#7c93ff; font-weight:bold;">${pAltDisp}</span></p>`; }

        if (availableMetrics.has('tempr') || availableMetrics.has('dewpt')) {
            let tDisp = dataRow.tempr !== null ? sf(isImperial ? (dataRow.tempr * 9/5 + 32) : dataRow.tempr, 1) + (isImperial ? '°F' : '°C') : 'N/A';
            let tdDisp = dataRow.dewpt !== null ? sf(isImperial ? (dataRow.dewpt * 9/5 + 32) : dataRow.dewpt, 1) + (isImperial ? '°F' : '°C') : 'N/A';
            statsHTML += `<p>ENVIRONMENT : <span style="color:#ef4444; font-weight:bold;">${tDisp}</span> / <span style="color:#7dd3fc; font-weight:bold;">${tdDisp}</span></p>`;
        }
        
        if (rhCalc !== null) statsHTML += `<p>COMPUTED RH : <span style="color:#9aa1ad; font-weight:bold;">${sf(rhCalc, 1)}%</span></p>`;
        if (availableMetrics.has('windDir') || availableMetrics.has('windSpd')) statsHTML += `<p>WIND VECTOR : <span style="color:#fbbf24; font-weight:bold;">${sf(dataRow.windDir, 0)}° @ ${sf(dataRow.windSpd, 1)} kt</span></p>`;
        if (availableMetrics.has('accZ')) statsHTML += `<p>VERT ACCEL  : <span style="color:#aeb4bf; font-weight:bold;">${sf(dataRow.accZ, 2)} m/s²</span></p>`;
        if (availableMetrics.has('pitch') || availableMetrics.has('roll')) statsHTML += `<p>PITCH / ROLL: <span style="color:#38bdf8; font-weight:bold;">${sf(dataRow.pitch, 1)}° / ${sf(dataRow.roll, 1)}°</span></p>`;
        if (availableMetrics.has('driftAngle')) statsHTML += `<p>DRIFT ANGLE : <span style="color:#7ad9ff; font-weight:bold;">${sf(dataRow.driftAngle, 1)}°</span></p>`;
        if (availableMetrics.has('tas')) statsHTML += `<p>TRUE AIRSPD : <span style="color:#fbbf24; font-weight:bold;">${sf(dataRow.tas, 1)} kt</span></p>`;
        if (availableMetrics.has('ias')) statsHTML += `<p>IND AIRSPD  : <span style="color:#7dd3fc; font-weight:bold;">${sf(dataRow.ias, 1)} kt</span></p>`;
        if (availableMetrics.has('vtWnd')) { let vtWndDisp = dataRow.vtWnd !== null ? sf(isImperial ? dataRow.vtWnd * 2.23694 : dataRow.vtWnd, 1) + (isImperial ? ' mph' : ' m/s') : 'N/A'; statsHTML += `<p>VERT WIND   : <span style="color:#ff3d71; font-weight:bold;">${vtWndDisp}</span></p>`; }
        if (availableMetrics.has('dValue')) statsHTML += `<p>D-VALUE     : <span style="color:#7c93ff; font-weight:bold;">${dValueDisp}</span></p>`;
        
        statsHTML += `</div>`; document.getElementById('pointAnalysisStats').innerHTML = statsHTML;
    }

    function downloadPointAnalysis() {
        if (!currentPointAnalysisData) return;
        const d = currentPointAnalysisData, isImperial = !document.getElementById('toggleSI').checked, useGps = !document.getElementById('toggleGpsAlt').checked;
        const targetPr = d.pressure !== null ? d.pressure : (d.sfcPr !== null ? d.sfcPr : 850);
        const sf = (val, dec=1) => val !== null && val !== undefined ? val.toFixed(dec) : 'N/A';

        let report = `NOAA RECONNAISSANCE POINT ANALYSIS REPORT\n=========================================\nFlight ID    : ${flightMetaData.id}\nAircraft     : ${flightMetaData.aircraft}\nFlight Date  : ${flightMetaData.date}\nRequest Time : ${new Date().toLocaleString()}\n=========================================\nTime (UTC)   : ${d.time.slice(0,2)}:${d.time.slice(2,4)}:${d.time.slice(4)}\nLatitude     : ${sf(d.lat, 3)} N\nLongitude    : ${sf(Math.abs(d.lon), 3)} W\n`;
        if (targetPr !== 850 || availableMetrics.has('pressure') || availableMetrics.has('sfcPr')) report += `Baro Level   : ${sf(targetPr, 1)} mb\n`;
        
        let pAltDisp = d.pAlt !== null ? sf(isImperial ? d.pAlt * 3.28084 : d.pAlt, 0) + (isImperial ? ' ft' : ' m') : 'N/A';
        let gAltDisp = d.gpsAlt !== null ? sf(isImperial ? d.gpsAlt * 3.28084 : d.gpsAlt, 0) + (isImperial ? ' ft' : ' m') : 'N/A';
        let dValueDisp = d.dValue !== null ? sf(isImperial ? d.dValue * 3.28084 : d.dValue, 0) + (isImperial ? ' ft' : ' m') : 'N/A';
        
        if (useGps) { if (availableMetrics.has('gpsAlt')) report += `GPS Altitude : ${gAltDisp}\n`; } 
        else { if (availableMetrics.has('pAlt')) report += `Press Altitude : ${pAltDisp}\n`; }
        
        if (availableMetrics.has('tempr')) report += `Ambient Temp     : ${d.tempr !== null ? sf(isImperial ? (d.tempr * 9/5 + 32) : d.tempr, 1) + (isImperial ? ' F' : ' C') : 'N/A'}\n`;
        if (availableMetrics.has('dewpt')) report += `Dew Point    : ${d.dewpt !== null ? sf(isImperial ? (d.dewpt * 9/5 + 32) : d.dewpt, 1) + (isImperial ? ' F' : ' C') : 'N/A'}\n`;
        if (availableMetrics.has('windDir') || availableMetrics.has('windSpd')) report += `Wind Vector  : ${sf(d.windDir, 0)} deg @ ${sf(d.windSpd, 1)} kt\n`;
        if (availableMetrics.has('accZ')) report += `Vert Accel   : ${sf(d.accZ, 2)} m/s²\n`;
        if (availableMetrics.has('pitch') || availableMetrics.has('roll')) report += `Pitch / Roll : ${sf(d.pitch, 1)} deg / ${sf(d.roll, 1)} deg\n`;
        if (availableMetrics.has('driftAngle')) report += `Drift Angle  : ${sf(d.driftAngle, 1)} deg\n`;
        if (availableMetrics.has('tas')) report += `True Airspd  : ${sf(d.tas, 1)} kt\n`;
        if (availableMetrics.has('ias')) report += `Ind Airspd   : ${sf(d.ias, 1)} kt\n`;
        if (availableMetrics.has('vtWnd')) report += `Vert Wind    : ${d.vtWnd !== null ? sf(isImperial ? d.vtWnd * 2.23694 : d.vtWnd, 1) + (isImperial ? ' mph' : ' m/s') : 'N/A'}\n`;
        if (availableMetrics.has('dValue')) report += `D-Value      : ${dValueDisp}\n`;
        
        report += `=========================================\nGenerated by Universal NOAA Recon Dashboard`;
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([report], { type: 'text/plain' }));
        a.download = `NOAA_PointAnalysis_${flightMetaData.id}_${d.time}.txt`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
