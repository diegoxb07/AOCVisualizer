/* Mission Visualizer - Chart.js layout + per-frame fan-out
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    function createDatasetConfig(metricKey, hidden = false) { 
        const isImp = document.getElementById('toggleImperial').checked;
        const def = METRIC_DEFS[metricKey]; 
        let label = getMetricLabel(metricKey, isImp);
        return { 
            label: label, 
            data: [], 
            borderColor: def.color, 
            borderWidth: 1.5, 
            pointRadius: 0, 
            fill: false, 
            yAxisID: def.yAxisID, 
            hidden: hidden, 
            metricKey: metricKey, 
            spanGaps: false
        }; 
    }

    function getBaseChartOptions(titleText, config = {}) {
        const enforceIntegers = config.enforceIntegers || false; const minRange = config.minRange || 0;
        const limitCallback = (scale) => { if (minRange > 0) { const range = scale.max - scale.min; if (range < minRange) { const mid = (scale.max + scale.min) / 2; scale.max = mid + (minRange / 2); scale.min = mid - (minRange / 2); } } };
        const tickConfig = { color: '#999' }; if (enforceIntegers) tickConfig.precision = 0; const tickConfigY1 = { color: '#ff7777' }; if (enforceIntegers) tickConfigY1.precision = 0;
        return {
            responsive: true, maintainAspectRatio: false, animation: false,
            onHover: (e, elements, chart) => {
                if (filteredData.length === 0) return;
                const xAxis = chart.scales.x;
                const xPixel = e.native ? e.native.offsetX : e.offsetX;
                const playheadPx = xAxis.getPixelForValue(currentIdx);
                if (Math.abs(xPixel - playheadPx) < 15) chart.canvas.style.cursor = 'ew-resize';
                else chart.canvas.style.cursor = 'crosshair';
            },
            scales: { x: { grid: { color: 'rgba(255,255,255,0.02)' }, ticks: { color: '#666', maxTicksLimit: 8 } }, y: { type: 'linear', position: 'left', display: 'auto', grid: { color: 'rgba(255,255,255,0.03)' }, ticks: tickConfig, title: { display: true, text: titleText, color: '#999' }, afterDataLimits: limitCallback }, y1: { type: 'linear', position: 'right', display: 'auto', grid: { drawOnChartArea: false }, ticks: tickConfigY1, afterDataLimits: limitCallback } },
            plugins: { zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, pan: { enabled: true, mode: 'x' } }, legend: { display: !config.isMaster, labels: { color: '#e0e0e0', font: { size: 10 }, boxWidth: 10 }, onClick: function(e, legendItem, legend) { const ci = legend.chart; const isVisible = ci.isDatasetVisible(legendItem.datasetIndex); ci.setDatasetVisibility(legendItem.datasetIndex, !isVisible); ci.update('none'); if (ci.canvas.id !== 'parameterChart') buildDropdownMenus(); } } }
        };
    }

    const markerPlugin = { 
        id: 'markerPlugin', 
        afterDraw: (chart) => { 
            if (filteredData.length === 0) return; 
            const ctx = chart.ctx; const xAxis = chart.scales.x; 
            ctx.save(); ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); 
            customMarkers.forEach(marker => { 
                const x = xAxis.getPixelForValue(marker.idx); 
                if (x >= xAxis.left && x <= xAxis.right) { 
                    ctx.strokeStyle = marker.color; ctx.beginPath(); ctx.moveTo(x, chart.chartArea.top); ctx.lineTo(x, chart.chartArea.bottom); ctx.stroke(); 
                } 
            }); 
            if (currentIdx >= 0 && currentIdx < filteredData.length) {
                const px = xAxis.getPixelForValue(currentIdx);
                if (px >= xAxis.left && px <= xAxis.right) {
                    ctx.strokeStyle = '#ffffff'; 
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]);
                    ctx.beginPath(); ctx.moveTo(px, chart.chartArea.top); ctx.lineTo(px, chart.chartArea.bottom); ctx.stroke();
                }
            }
            ctx.restore(); 
        } 
    };

    function buildChartLayout() {
        if (masterChartInstance) masterChartInstance.destroy(); Object.values(customCharts).forEach(c => c.destroy()); customCharts = {};
        const labelsTimeline = filteredData.map(d => `${d.time.slice(0,2)}:${d.time.slice(2,4)}:${d.time.slice(4)}`);
        const isImp = document.getElementById('toggleImperial').checked;

        masterChartInstance = new Chart(document.getElementById('parameterChart').getContext('2d'), { type: 'line', data: { labels: labelsTimeline, datasets: [] }, options: getBaseChartOptions('Master Scale Comparison', { enforceIntegers: false, minRange: 2, isMaster: true }), plugins: [markerPlugin] });
        buildMasterMenu();

        const buildSubChart = (id, keys, title, config) => { 
            const activeKeys = keys.filter(k => availableMetrics.has(k.key));
            const chartCanvas = document.getElementById(id);
            const panel = chartCanvas.closest('.min-h-\\[240px\\]');
            
            if (activeKeys.length === 0) {
                if (panel) panel.style.display = 'none';
                return;
            } else {
                if (panel) panel.style.display = 'flex';
                document.getElementById(`title-${id}`).childNodes[0].nodeValue = title + " ";
            }
            
            const datasets = activeKeys.map(k => {
                const ds = createDatasetConfig(k.key, k.hidden);
                ds.data = filteredData.map(d => getConvertedVal(d[k.key], k.key, isImp));
                return ds;
            });

            customCharts[id] = new Chart(chartCanvas.getContext('2d'), { 
                type: 'line', 
                data: { labels: labelsTimeline, datasets: datasets }, 
                options: getBaseChartOptions(title, config), 
                plugins: [markerPlugin] 
            }); 
        };
        
        buildSubChart('tempChart', [{key:'tempr'}, {key:'dewpt'}], `Temperature (${isImp ? '°F' : '°C'})`, { enforceIntegers: true, minRange: 5 });
        buildSubChart('navChart', [{key:'driftAngle', hidden:false}, {key:'th', hidden:true}, {key:'gTrack', hidden:true}], 'Angles (Deg)', { enforceIntegers: true, minRange: 10 });
        buildSubChart('attChart', [{key:'pitch'}, {key:'roll'}, {key:'alpha', hidden:true}, {key:'beta', hidden:true}], 'Flow Angles (°)', { enforceIntegers: true, minRange: 5 });
        buildSubChart('altChart', [{key:'pAlt'}, {key:'gpsAlt', hidden:true}, {key:'dValue', hidden:true}, {key:'radAlt', hidden:true}], `Altitude Profile (${isImp ? 'ft' : 'm'})`, { enforceIntegers: true, minRange: 100 });
        buildSubChart('tasChart', [{key:'tas'}, {key:'windSpd'}, {key:'ias'}], 'Speed Profiles (kt)', { enforceIntegers: true, minRange: 20 });
        buildSubChart('vertWindChart', [{key:'vtWnd'}, {key:'accZ', hidden:true}], `Vertical Speeds & Accel (${isImp ? 'mph' : 'm/s'})`, { enforceIntegers: false, minRange: 2 });
        buildSubChart('sfcChart', [{key:'sfcPr'}, {key:'pressure', hidden:true}], 'Pressure Profiles (mb)', { enforceIntegers: false, minRange: 1 });
        buildSubChart('thermoChart', [{key:'thetaE'}, {key:'mixRate', hidden:true}], 'Thermodynamics & Moisture', { enforceIntegers: false, minRange: 2 });
        buildDropdownMenus();
        updateMasterGraphVisibility();
    }

    function buildDropdownMenus() {
        const isImp = document.getElementById('toggleImperial').checked;
        Object.keys(customCharts).forEach(id => {
            const menu = document.getElementById(`menu-${id}`); if(!menu) return; menu.innerHTML = ''; const chart = customCharts[id]; if(!chart) return;
            const activeKeys = chart.data.datasets.map(ds => ds.metricKey);
            
            const unselectAllItem = document.createElement('div'); unselectAllItem.className = 'dropdown-item'; unselectAllItem.style.color = '#ef4444'; unselectAllItem.style.fontWeight = 'bold'; unselectAllItem.innerText = '✕ Unselect All';
            unselectAllItem.onclick = (e) => { e.stopPropagation(); chart.data.datasets = []; chart.update('none'); buildDropdownMenus(); }; menu.appendChild(unselectAllItem);
            const breakHr = document.createElement('div'); breakHr.style.borderTop = '1px solid #20262f'; breakHr.style.margin = '4px 0'; menu.appendChild(breakHr);
            
            Object.keys(METRIC_DEFS).forEach(key => { 
                const isAvail = availableMetrics.has(key);
                const div = document.createElement('div'); 
                div.className = `dropdown-item ${activeKeys.includes(key) ? 'active' : ''}`; 
                div.innerText = getMetricLabel(key, isImp); 
                div.style.color = mutedMetricColor(METRIC_DEFS[key].color);
                if (isAvail) {
                    div.onclick = (e) => { e.stopPropagation(); toggleMetricInSubChart(id, key); }; 
                } else {
                    div.style.opacity = '0.3';
                    div.style.cursor = 'not-allowed';
                }
                menu.appendChild(div); 
            });
        });
    }

    function toggleMetricInSubChart(chartId, metricKey) {
        const isImp = document.getElementById('toggleImperial').checked;
        const chart = customCharts[chartId]; const existIdx = chart.data.datasets.findIndex(ds => ds.metricKey === metricKey);
        if (existIdx > -1) chart.data.datasets.splice(existIdx, 1); 
        else { 
            const newDs = createDatasetConfig(metricKey); 
            newDs.data = filteredData.map(d => getConvertedVal(d[metricKey], metricKey, isImp));
            chart.data.datasets.push(newDs); 
        }
        chart.update('none'); buildDropdownMenus(); 
    }

    function updateVisualComponents(idx, skipCharts = false) {
        const currentRow = filteredData[idx]; if (!currentRow) return;
        
        let visualRow = currentRow;
        if (document.getElementById('toggle8Hz') && document.getElementById('toggle8Hz').checked) {
            const tempRow = getInterpolatedRow();
            if (tempRow) visualRow = tempRow;
        }

        if (trackerModeSelect.value === '2d') renderMapEngineFrame(idx, visualRow); else update3DFrame(idx, visualRow);
        renderHUD(currentRow);
        
        if (document.getElementById('togglePfd').checked) renderPFD(visualRow);
        if (!isScrubbing) timelineSlider.value = idx; 

        let displayStr = `${currentRow.time.slice(0,2)}:${currentRow.time.slice(2,4)}:${currentRow.time.slice(4)} UTC`;
        if (flightMetaData.date !== 'Unknown') {
            let d = new Date(flightMetaData.date + "T00:00:00Z");
            d.setUTCSeconds(currentRow.absSeconds);
            let yyyy = d.getUTCFullYear(); let mm = String(d.getUTCMonth()+1).padStart(2, '0'); let dd = String(d.getUTCDate()).padStart(2, '0');
            let hh = String(d.getUTCHours()).padStart(2, '0'); let min = String(d.getUTCMinutes()).padStart(2, '0'); let ss = String(d.getUTCSeconds()).padStart(2, '0');
            displayStr = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} UTC`;
        }
        timelineTimeDisplay.innerText = displayStr;

        const satSel = document.getElementById('satelliteSelect');
        if (satSel && satSel.value !== 'none' && trackerModeSelect.value === '2d' && !isResizingMedia) {
            fetchSatelliteImage(currentRow.absSeconds);
            updateSatTimeBadge();
        } else {
            const b = document.getElementById('satTimeBadge');
            if (b) b.classList.add('hidden');
        }

        if (masterChartInstance) masterChartInstance.draw(); 
        Object.values(customCharts).forEach(c => {
            if(c) c.draw();
        });
    }
