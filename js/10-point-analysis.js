/* Mission Visualizer, point analysis modal + report download
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    // the on-screen modal and the downloaded .txt report describe the same sample, so they share
    // these three formatters and differ only in wording and markup.

    const pointFixed = (val, dec = 1) => val !== null && val !== undefined ? val.toFixed(dec) : 'NaN';

    // hemisphere comes from the sign, never assumed: a southern or eastern-hemisphere flight must
    // not read as N/W. matches js/17-charts.js and js/18b-flight-search.js. the modal carries the
    // degree sign; the .txt report stays plain ascii.
    const pointHemi = (v, pos, neg, degreeMark) => v !== null && v !== undefined
        ? `${pointFixed(Math.abs(v), 3)}${degreeMark} ${v >= 0 ? pos : neg}`
        : 'NaN';

    function processPointAnalysisPlotting(dataRow) {
        document.getElementById('pointAnalysisModal').style.display = 'flex';
        currentPointAnalysisData = dataRow;

        // baro level is READ or it is absent: null when this row carries neither a static nor a
        // surface pressure. there is no default level; a placeholder here would print as a
        // measured value.
        const targetPr = dataRow.pressure !== null ? dataRow.pressure : (dataRow.sfcPr !== null ? dataRow.sfcPr : null);
        const isImperial = !document.getElementById('toggleSI').checked;
        const useGps = !document.getElementById('toggleGpsAlt').checked;

        let rhCalc = null;
        if (dataRow.tempr !== null && dataRow.dewpt !== null) {
            const targetAirC = dataRow.tempr, targetDewC = dataRow.dewpt;
            rhCalc = Math.min(100, Math.max(0, ((6.11 * Math.exp((17.625 * targetDewC) / (243.04 + targetDewC))) / (6.11 * Math.exp((17.625 * targetAirC) / (243.04 + targetAirC)))) * 100));
        }

        const reqTime = new Date().toLocaleString();
        document.getElementById('pointAnalysisMeta').innerHTML = `<strong>Flight ID:</strong> ${flightMetaData.id} | <strong>Aircraft:</strong> ${flightMetaData.aircraft} | <strong>Date:</strong> ${flightMetaData.date} | <strong>Request Time:</strong> ${reqTime}`;

        let statsHTML = `
            <div style="color:var(--accent); font-weight:bold; font-size:15px; border-bottom:1px solid var(--border); padding-bottom:8px; margin-bottom:14px; font-family:monospace; margin-top:12px;">STATION REPORT [${dataRow.time.slice(0,2)}:${dataRow.time.slice(2,4)}:${dataRow.time.slice(4)} UTC]</div>
            <div style="font-family:monospace; font-size:14px; display:grid; grid-template-columns: 1fr 1fr; gap:12px; line-height: 1.5;">
                <p>COORD LAT   : <span style="color:var(--text); font-weight:bold;">${pointHemi(dataRow.lat, 'N', 'S', '°')}</span></p>
                <p>COORD LON   : <span style="color:var(--text); font-weight:bold;">${pointHemi(dataRow.lon, 'E', 'W', '°')}</span></p>`;

        if (targetPr !== null) statsHTML += `<p>BARO LEVEL  : <span style="color:var(--val-cool); font-weight:bold;">${pointFixed(targetPr, 1)} mb</span></p>`;

        const gAltDisp = formatReading(dataRow.gpsAlt, 'gpsAlt', 0, isImperial, [' m', ' ft']);
        const pAltDisp = formatReading(dataRow.pAlt, 'pAlt', 0, isImperial, [' m', ' ft']);
        const dValueDisp = formatReading(dataRow.dValue, 'dValue', 0, isImperial, [' m', ' ft']);

        if (useGps) { if (availableMetrics.has('gpsAlt')) statsHTML += `<p>GPS ALTITUDE: <span style="color:var(--accent); font-weight:bold;">${gAltDisp}</span></p>`; }
        else { if (availableMetrics.has('pAlt')) statsHTML += `<p>PRESS ALT   : <span style="color:var(--val-alt); font-weight:bold;">${pAltDisp}</span></p>`; }

        if (availableMetrics.has('tempr') || availableMetrics.has('dewpt')) {
            const tDisp = formatReading(dataRow.tempr, 'tempr', 1, isImperial, ['°C', '°F']);
            const tdDisp = formatReading(dataRow.dewpt, 'dewpt', 1, isImperial, ['°C', '°F']);
            statsHTML += `<p>ENVIRONMENT : <span style="color:#ef4444; font-weight:bold;">${tDisp}</span> / <span style="color:var(--val-cool); font-weight:bold;">${tdDisp}</span></p>`;
        }

        if (rhCalc !== null) statsHTML += `<p>COMPUTED RH : <span style="color:var(--text-muted); font-weight:bold;">${pointFixed(rhCalc, 1)}%</span></p>`;
        if (availableMetrics.has('windSpd')) statsHTML += `<p>WIND VECTOR : <span style="color:var(--val-warm); font-weight:bold;">${pointFixed(dataRow.windDir, 0)}° @ ${pointFixed(dataRow.windSpd, 1)} kt</span></p>`;
        if (availableMetrics.has('accZ')) statsHTML += `<p>VERT ACCEL  : <span style="color:var(--text-muted); font-weight:bold;">${pointFixed(dataRow.accZ, 2)} m/s²</span></p>`;
        if (availableMetrics.has('pitch') || availableMetrics.has('roll')) statsHTML += `<p>PITCH / ROLL: <span style="color:var(--accent); font-weight:bold;">${pointFixed(dataRow.pitch, 1)}° / ${pointFixed(dataRow.roll, 1)}°</span></p>`;
        if (availableMetrics.has('driftAngle')) statsHTML += `<p>DRIFT ANGLE : <span style="color:var(--val-cool); font-weight:bold;">${pointFixed(dataRow.driftAngle, 1)}°</span></p>`;
        if (availableMetrics.has('tas')) statsHTML += `<p>TRUE AIRSPD : <span style="color:var(--val-warm); font-weight:bold;">${pointFixed(dataRow.tas, 1)} kt</span></p>`;
        if (availableMetrics.has('ias')) statsHTML += `<p>IND AIRSPD  : <span style="color:var(--val-cool); font-weight:bold;">${pointFixed(dataRow.ias, 1)} kt</span></p>`;
        if (availableMetrics.has('vtWnd')) statsHTML += `<p>VERT WIND   : <span style="color:#ff3d71; font-weight:bold;">${formatReading(dataRow.vtWnd, 'vtWnd', 1, isImperial, [' m/s', ' mph'])}</span></p>`;
        if (availableMetrics.has('dValue')) statsHTML += `<p>D-VALUE     : <span style="color:var(--val-alt); font-weight:bold;">${dValueDisp}</span></p>`;

        statsHTML += `</div>`;
        document.getElementById('pointAnalysisStats').innerHTML = statsHTML;
    }

    function downloadPointAnalysis() {
        if (!currentPointAnalysisData) return;

        const d = currentPointAnalysisData;
        const isImperial = !document.getElementById('toggleSI').checked;
        const useGps = !document.getElementById('toggleGpsAlt').checked;
        const targetPr = d.pressure !== null ? d.pressure : (d.sfcPr !== null ? d.sfcPr : null);

        let report = `RECONNAISSANCE POINT ANALYSIS REPORT\n=========================================\nFlight ID    : ${flightMetaData.id}\nAircraft     : ${flightMetaData.aircraft}\nFlight Date  : ${flightMetaData.date}\nRequest Time : ${new Date().toLocaleString()}\n=========================================\nTime (UTC)   : ${d.time.slice(0,2)}:${d.time.slice(2,4)}:${d.time.slice(4)}\nLatitude     : ${pointHemi(d.lat, 'N', 'S', '')}\nLongitude    : ${pointHemi(d.lon, 'E', 'W', '')}\n`;
        if (targetPr !== null) report += `Baro Level   : ${pointFixed(targetPr, 1)} mb\n`;

        const gAltDisp = formatReading(d.gpsAlt, 'gpsAlt', 0, isImperial, [' m', ' ft']);
        const pAltDisp = formatReading(d.pAlt, 'pAlt', 0, isImperial, [' m', ' ft']);

        if (useGps) { if (availableMetrics.has('gpsAlt')) report += `GPS Altitude : ${gAltDisp}\n`; }
        else { if (availableMetrics.has('pAlt')) report += `Press Altitude : ${pAltDisp}\n`; }

        if (availableMetrics.has('tempr')) report += `Ambient Temp     : ${formatReading(d.tempr, 'tempr', 1, isImperial, [' C', ' F'])}\n`;
        if (availableMetrics.has('dewpt')) report += `Dew Point    : ${formatReading(d.dewpt, 'dewpt', 1, isImperial, [' C', ' F'])}\n`;
        if (availableMetrics.has('windSpd')) report += `Wind Vector  : ${pointFixed(d.windDir, 0)} deg @ ${pointFixed(d.windSpd, 1)} kt\n`;
        if (availableMetrics.has('accZ')) report += `Vert Accel   : ${pointFixed(d.accZ, 2)} m/s²\n`;
        if (availableMetrics.has('pitch') || availableMetrics.has('roll')) report += `Pitch / Roll : ${pointFixed(d.pitch, 1)} deg / ${pointFixed(d.roll, 1)} deg\n`;
        if (availableMetrics.has('driftAngle')) report += `Drift Angle  : ${pointFixed(d.driftAngle, 1)} deg\n`;
        if (availableMetrics.has('tas')) report += `True Airspd  : ${pointFixed(d.tas, 1)} kt\n`;
        if (availableMetrics.has('ias')) report += `Ind Airspd   : ${pointFixed(d.ias, 1)} kt\n`;
        if (availableMetrics.has('vtWnd')) report += `Vert Wind    : ${formatReading(d.vtWnd, 'vtWnd', 1, isImperial, [' m/s', ' mph'])}\n`;
        if (availableMetrics.has('dValue')) report += `D-Value      : ${formatReading(d.dValue, 'dValue', 0, isImperial, [' m', ' ft'])}\n`;

        report += `=========================================\nGenerated by Mission Visualizer`;

        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([report], { type: 'text/plain' }));
        a.download = `PointAnalysis_${flightMetaData.id}_${d.time}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
