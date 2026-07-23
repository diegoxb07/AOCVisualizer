/* Mission Visualizer, "Create Your Own Graph" + temp baseline
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    function toggleMasterMetric(metricKey, isChecked) {
        if (isChecked) {
            const isImp = !document.getElementById('toggleSI').checked; const newDs = createDatasetConfig(metricKey, false); 
            newDs.data = filteredData.map(d => getConvertedVal(d[metricKey], metricKey, isImp));
            masterChartInstance.data.datasets.push(newDs);
        } else {
            const idx = masterChartInstance.data.datasets.findIndex(ds => ds.metricKey === metricKey); 
            if (idx > -1) masterChartInstance.data.datasets.splice(idx, 1);
        }
        updateMasterGraphVisibility(); masterChartInstance.update('none'); buildMasterMenu();
    }

    function mutedMetricColor(hex) {
        const light = document.documentElement.dataset.theme === 'light';
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || ''); if (!m) return light ? '#5b6472' : '#aab4be';
        const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16), mix = 0.42;
        const t = (c, target) => Math.round(c * (1 - mix) + target * mix);
        // Blend each metric hue toward the menu background's tone: a pale slate for the dark menu,
        // a dark slate for the near-white light menu, so the label keeps contrast either way.
        return light
            ? `rgb(${t(r, 0x33)}, ${t(g, 0x3a)}, ${t(b, 0x45)})`
            : `rgb(${t(r, 0xc9)}, ${t(g, 0xd2)}, ${t(b, 0xdc)})`;
    }

    function buildMasterMenu() {
        const menu = document.getElementById('menu-masterChart'); if (!menu) return;
        menu.innerHTML = ''; const isImp = !document.getElementById('toggleSI').checked;
        const activeKeys = masterChartInstance ? masterChartInstance.data.datasets.map(ds => ds.metricKey) : [];

        const clearAllItem = document.createElement('div'); clearAllItem.className = 'dropdown-item'; clearAllItem.style.color = '#ef4444'; clearAllItem.style.fontWeight = 'bold'; clearAllItem.innerText = '✕ Clear All';
        clearAllItem.onclick = (e) => { e.stopPropagation(); if (masterChartInstance) { masterChartInstance.data.datasets = []; masterChartInstance.update('none'); } updateMasterGraphVisibility(); buildMasterMenu(); };
        menu.appendChild(clearAllItem);

        const breakHr = document.createElement('div'); breakHr.style.borderTop = '1px solid #20262f'; breakHr.style.margin = '4px 0'; menu.appendChild(breakHr);

        Object.keys(METRIC_DEFS).forEach(key => {
            const isAvail = availableMetrics.has(key); const div = document.createElement('div');
            div.className = `dropdown-item ${activeKeys.includes(key) ? 'active' : ''}`; div.innerText = getMetricLabel(key, isImp); div.style.color = mutedMetricColor(METRIC_DEFS[key].color);
            if (isAvail) { div.onclick = (e) => { e.stopPropagation(); toggleMasterMetric(key, !activeKeys.includes(key)); }; } 
            else { div.style.opacity = '0.3'; div.style.cursor = 'not-allowed'; }
            menu.appendChild(div);
        });
    }

    // Card title for a Create Your Own Graph: the picked variables (units stripped, joined with
    // "vs"), or the default prompt when empty. Shared by the master card and every spawned extra
    // card so they read alike.
    function setCustomGraphTitle(titleEl, chart) {
        if (!titleEl) return;
        const labels = chart ? chart.data.datasets.map(ds => (ds.label || '').replace(/\s*\([^)]*\)\s*$/, '').trim()).filter(Boolean) : [];
        if (!labels.length) titleEl.innerHTML = 'Create Your Own Graph <span class="text-faint font-normal normal-case">: You can use this to compare any variables you\'d like!</span>';
        else titleEl.textContent = labels.length <= 3 ? labels.join(' vs ') : labels.slice(0, 3).join(', ') + ' +' + (labels.length - 3) + ' more';
    }

    function updateMasterGraphVisibility() {
        const wrapper = document.getElementById('masterGraphWrapper'), prompt = document.getElementById('masterCreatePrompt');
        const hasData = masterChartInstance && masterChartInstance.data.datasets.length > 0;
        if (hasData) { wrapper.classList.remove('hidden'); wrapper.classList.add('block'); if (prompt) prompt.classList.add('hidden'); masterChartInstance.resize(); }
        else { wrapper.classList.remove('block'); wrapper.classList.add('hidden'); if (prompt) prompt.classList.remove('hidden'); }
        setCustomGraphTitle(document.querySelector('#title-masterChart > span'), masterChartInstance);
        ensureExtraCreateBox();
    }

    // ---- Additional custom graphs -------------------------------------------------------------
    // Creating a graph always leaves a fresh Create Graph box below it, so custom comparisons
    // stack downward without a cap. Each card owns its own Chart in extraMasterCharts, frame-
    // drawn beside the master (js/17-charts.js) and torn down by layout rebuilds and Reset All.
    let extraMasterCharts = {};
    let extraGraphSeq = 0;

    function extraChartsEach(fn) { Object.values(extraMasterCharts).forEach(c => { if (c) fn(c); }); }

    // One trailing box, only once the master graph exists (before that, the master card's own
    // prompt is the create box), kept at the bottom of the stack.
    function ensureExtraCreateBox() {
        const host = document.getElementById('extraGraphsHost'); if (!host) return;
        const masterHas = masterChartInstance && masterChartInstance.data.datasets.length > 0;
        let box = document.getElementById('extraCreateBox');
        if (!masterHas && Object.keys(extraMasterCharts).length === 0) { if (box) box.remove(); return; }
        if (box) { host.appendChild(box); return; }
        box = document.createElement('button');
        box.id = 'extraCreateBox'; box.type = 'button';
        box.className = 'group w-full create-graph-box flex flex-col items-center justify-center gap-1.5 rounded border-2 border-dashed border-hairline hover:border-[color-mix(in_oklab,var(--accent)_70%,transparent)] hover:bg-panel-strip/40 transition-colors cursor-pointer';
        box.innerHTML = '<span class="text-accent cg-plus font-light leading-none group-hover:scale-110 transition-transform">＋</span>'
            + '<span class="text-ink text-sm font-bold tracking-[0.25em] uppercase">Create Graph</span>';
        box.addEventListener('click', spawnExtraGraph);
        host.appendChild(box);
    }

    function spawnExtraGraph() {
        const host = document.getElementById('extraGraphsHost');
        if (!host || typeof Chart === 'undefined' || typeof getBaseChartOptions !== 'function') return;
        const id = 'extraChart' + (++extraGraphSeq);
        const card = document.createElement('div');
        // Mirrors the master Create Your Own Graph card: same min height, title bar, centered create
        // prompt while empty, and chart wrapper once variables are picked.
        card.className = 'bg-panel border border-hairline rounded p-4 shadow-sm relative flex flex-col min-h-[300px]';
        card.dataset.extraChart = id;
        card.innerHTML =
            `<div class="flex justify-between items-center text-xs font-semibold text-muted uppercase tracking-wider mb-2 z-20" id="title-${id}">`
            + '<span class="extra-graph-title">Create Your Own Graph <span class="text-faint font-normal normal-case">: You can use this to compare any variables you\'d like!</span></span>'
            + '<div class="flex items-center gap-2">'
            + `<button class="reset-scale-btn text-muted text-base hover:text-accent hover:scale-110 transition-all focus:outline-none" onclick="resetChartScale('${id}')" title="Reset Zoom / scale">↺</button>`
            + '<div class="relative">'
            + `<button class="text-accent text-lg font-bold hover:text-ink hover:scale-110 transition-all focus:outline-none" onclick="toggleMenu(event, 'menu-${id}')" title="Choose variables to plot">＋</button>`
            + `<div id="menu-${id}" class="dropdown-menu"></div>`
            + '</div>'
            + `<button class="text-muted text-base hover:text-ink transition-colors focus:outline-none" onclick="removeExtraGraph('${id}')" title="Remove this graph">✕</button>`
            + '</div></div>'
            + `<button id="prompt-${id}" type="button" onclick="toggleMenu(event, 'menu-${id}')" class="group w-full flex-grow create-graph-box flex flex-col items-center justify-center gap-1.5 rounded border-2 border-dashed border-hairline hover:border-[color-mix(in_oklab,var(--accent)_70%,transparent)] hover:bg-panel-strip/40 transition-colors cursor-pointer">`
            + '<span class="text-accent cg-plus font-light leading-none group-hover:scale-110 transition-transform">＋</span>'
            + '<span class="text-ink text-sm font-bold tracking-[0.25em] uppercase">Create Graph</span>'
            + '<span class="text-faint text-[11px] normal-case font-normal">Click to choose the variables you want to plot</span>'
            + '</button>'
            + `<div id="wrapper-${id}" class="w-full flex-grow relative hidden h-full max-h-[300px] mt-1"><canvas id="${id}"></canvas></div>`;
        host.appendChild(card);
        extraMasterCharts[id] = new Chart(document.getElementById(id).getContext('2d'), {
            type: 'line',
            data: { labels: filteredData.map(d => `${d.time.slice(0, 2)}:${d.time.slice(2, 4)}:${d.time.slice(4)}`), datasets: [] },
            options: getBaseChartOptions('Custom Comparison', { enforceIntegers: false, minRange: 2, isMaster: true }),
            plugins: [markerPlugin],
        });
        buildExtraMenu(id);
        updateExtraGraphVisibility(id);   // starts on the create prompt with the default title
        ensureExtraCreateBox();   // the fresh add box lands under the new card
        // Open the new card's variable menu right away, matching the master prompt's flow.
        const addBtn = card.querySelector(`[onclick*="menu-${id}"]`);
        if (addBtn) addBtn.click();
    }

    // Toggle a spawned card between its create prompt (empty) and its chart (populated), and refresh
    // its variable-based title. Mirrors updateMasterGraphVisibility for the master card.
    function updateExtraGraphVisibility(id) {
        const chart = extraMasterCharts[id];
        const wrapper = document.getElementById('wrapper-' + id), prompt = document.getElementById('prompt-' + id);
        if (!chart || !wrapper || !prompt) return;
        if (chart.data.datasets.length > 0) { wrapper.classList.remove('hidden'); wrapper.classList.add('block'); prompt.classList.add('hidden'); chart.resize(); }
        else { wrapper.classList.remove('block'); wrapper.classList.add('hidden'); prompt.classList.remove('hidden'); }
        const card = document.querySelector(`[data-extra-chart="${id}"]`);
        if (card) setCustomGraphTitle(card.querySelector('.extra-graph-title'), chart);
    }

    function toggleExtraMetric(id, metricKey, isChecked) {
        const chart = extraMasterCharts[id]; if (!chart) return;
        if (isChecked) {
            const isImp = !document.getElementById('toggleSI').checked;
            const ds = createDatasetConfig(metricKey, false);
            ds.data = filteredData.map(d => getConvertedVal(d[metricKey], metricKey, isImp));
            chart.data.datasets.push(ds);
        } else {
            const idx = chart.data.datasets.findIndex(ds => ds.metricKey === metricKey);
            if (idx > -1) chart.data.datasets.splice(idx, 1);
        }
        chart.update('none'); buildExtraMenu(id); updateExtraGraphVisibility(id);
    }

    function buildExtraMenu(id) {
        const menu = document.getElementById('menu-' + id), chart = extraMasterCharts[id];
        if (!menu || !chart) return;
        menu.innerHTML = ''; const isImp = !document.getElementById('toggleSI').checked;
        const activeKeys = chart.data.datasets.map(ds => ds.metricKey);
        const clearAllItem = document.createElement('div'); clearAllItem.className = 'dropdown-item'; clearAllItem.style.color = '#ef4444'; clearAllItem.style.fontWeight = 'bold'; clearAllItem.innerText = '✕ Clear All';
        clearAllItem.onclick = (e) => { e.stopPropagation(); chart.data.datasets = []; chart.update('none'); buildExtraMenu(id); updateExtraGraphVisibility(id); };
        menu.appendChild(clearAllItem);
        const breakHr = document.createElement('div'); breakHr.style.borderTop = '1px solid #20262f'; breakHr.style.margin = '4px 0'; menu.appendChild(breakHr);
        Object.keys(METRIC_DEFS).forEach(key => {
            const isAvail = availableMetrics.has(key); const div = document.createElement('div');
            div.className = `dropdown-item ${activeKeys.includes(key) ? 'active' : ''}`; div.innerText = getMetricLabel(key, isImp); div.style.color = mutedMetricColor(METRIC_DEFS[key].color);
            if (isAvail) { div.onclick = (e) => { e.stopPropagation(); toggleExtraMetric(id, key, !activeKeys.includes(key)); }; }
            else { div.style.opacity = '0.3'; div.style.cursor = 'not-allowed'; }
            menu.appendChild(div);
        });
    }

    function removeExtraGraph(id) {
        const c = extraMasterCharts[id]; if (c) { try { c.destroy(); } catch (e) {} }
        delete extraMasterCharts[id];
        const card = document.querySelector(`[data-extra-chart="${id}"]`); if (card) card.remove();
        ensureExtraCreateBox();
    }

    // Layout rebuilds and Reset All: the extra cards go with their charts; the trailing box
    // reappears once the master graph has data again (ensureExtraCreateBox judges that).
    function resetExtraGraphs() {
        Object.keys(extraMasterCharts).forEach(removeExtraGraph);
        const box = document.getElementById('extraCreateBox'); if (box) box.remove();
        ensureExtraCreateBox();
    }

    // Rolling ±300-sample mean of ambient temp, kept as a sliding-window sum so a long flight
    // doesn't recompute 600 samples per row on every filter change.
    function computeTempBaseline() {
        const n = filteredData.length;
        tempBaseline = new Array(n).fill(null);
        let sum = 0, count = 0;
        const add = i => { const t = filteredData[i].tempr; if (t !== null) { sum += t; count++; } };
        const drop = i => { const t = filteredData[i].tempr; if (t !== null) { sum -= t; count--; } };
        for (let j = 0; j < Math.min(n, 300); j++) add(j);
        for (let i = 0; i < n; i++) {
            tempBaseline[i] = count > 0 ? sum / count : filteredData[i].tempr;
            if (i - 300 >= 0) drop(i - 300);
            if (i + 300 < n) add(i + 300);
        }
    }
