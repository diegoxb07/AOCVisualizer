/* Mission Visualizer, floating media panels
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order.

   Picture-in-picture float for the two media panels: dragging a panel's outline (the padding
   ring around its content) detaches it into a fixed, movable, resizable window over the page;
   the ⇱ Dock button returns it to the media bar. A floating panel reparents to <body>, so
   collapsing the media bar cannot hide it, and every size change routes through
   resizeCanvasLayout, which already preserves the 2D view and resizes the 3D renderer.
   Pinning (.fake-fs via the panel ⛶ or TDR mode) suspends a float: the inline rect clears so
   the pin's inset:0 wins, and the float returns when the pin releases (floatPanelsOnPinChange,
   called from setFakePanel in js/07-ui-controls.js). */

    const floatPanels = {};            // panel id -> { rect: {x,y,w,h}, suspended: bool }
    let floatDrag = null;              // live gesture: { id, mode:'move'|'resize', startX, startY, rect0, detached }
    let _floatRafPending = false;

    const FLOAT_MIN_W = { mapPanel: 340, videoPanel: 280 };
    const FLOAT_MIN_H = { mapPanel: 260, videoPanel: 180 };
    const FLOAT_COMPACT_W = 520;       // below this width the map's large overlays hide
    const FLOAT_DETACH_PX = 6;         // outline drag distance before a docked panel detaches

    function floatIsFloating(id) { return !!(floatPanels[id] && !floatPanels[id].suspended); }

    function floatSyncBarClass() {
        const bar = document.getElementById('stickyMediaBar');
        if (bar) bar.classList.toggle('all-floating', !!(floatPanels.mapPanel && floatPanels.videoPanel));
    }

    function floatApplyRect(id) {
        const st = floatPanels[id], el = document.getElementById(id);
        if (!st || !el || st.suspended) return;
        el.classList.add('float-panel');
        el.style.left = Math.round(st.rect.x) + 'px';
        el.style.top = Math.round(st.rect.y) + 'px';
        el.style.width = Math.round(st.rect.w) + 'px';
        el.style.height = Math.round(st.rect.h) + 'px';
        if (id === 'mapPanel') el.classList.toggle('panel-compact', st.rect.w < FLOAT_COMPACT_W);
    }

    // The proven redraw combo the media height handle uses: sizes first, then the 2D reframe
    // with the panned view preserved (resizeCanvasLayout keeps it as geography), then the PFD.
    function floatRedraw() {
        resizeCanvasLayout();
        if (filteredData.length > 0 && trackerModeSelect.value === '2d') {
            calculateMapScales(); bgNeedsUpdate = true;
            renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
        }
        if (filteredData.length > 0 && document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]);
    }

    function floatBringToFront(id) {
        Object.keys(floatPanels).forEach(k => {
            const el = document.getElementById(k);
            if (el && floatIsFloating(k)) el.style.zIndex = (k === id) ? '1401' : '1400';
        });
    }

    function floatDetach(id, rect) {
        if (floatPanels[id]) return;
        const el = document.getElementById(id);
        if (!el) return;
        // An empty video panel floating over the page is just a dead box; only a loaded MMR floats.
        if (id === 'videoPanel' && (typeof videoLoaded === 'undefined' || !videoLoaded)) return;
        // Popovers are anchored to their buttons' rects at open time and would strand mid-drag.
        if (typeof closeSatPicker === 'function') closeSatPicker();
        if (typeof closeLoadedPicker === 'function') closeLoadedPicker();
        floatPanels[id] = { rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, suspended: false };
        document.body.appendChild(el);
        const grid = document.getElementById('mediaGrid');
        if (grid) grid.classList.add(id === 'mapPanel' ? 'map-floating' : 'video-floating');
        floatSyncBarClass();
        floatApplyRect(id);
        floatBringToFront(id);
        floatRedraw();
    }

    function floatDock(id) {
        const st = floatPanels[id];
        if (!st) return;
        const el = document.getElementById(id);
        delete floatPanels[id];
        if (el) {
            el.classList.remove('float-panel', 'panel-compact');
            el.style.left = el.style.top = el.style.width = el.style.height = el.style.zIndex = '';
            const grid = document.getElementById('mediaGrid');
            if (grid) {
                // Deterministic slots: the map is always the grid's first cell, the video its last.
                if (id === 'mapPanel') grid.insertBefore(el, grid.firstElementChild);
                else grid.appendChild(el);
                grid.classList.remove(id === 'mapPanel' ? 'map-floating' : 'video-floating');
            }
        }
        floatSyncBarClass();
        floatRedraw();
    }

    function floatPanelsDockAll() { floatDock('mapPanel'); floatDock('videoPanel'); }

    // Called by setFakePanel with the panel being pinned (or null). The pin's inset:0 must own
    // the rect while it lasts; the float rect comes back untouched when the pin releases.
    function floatPanelsOnPinChange(pinnedEl) {
        Object.keys(floatPanels).forEach(id => {
            const st = floatPanels[id], el = document.getElementById(id);
            if (!st || !el) return;
            if (el === pinnedEl && !st.suspended) {
                st.suspended = true;
                el.classList.remove('float-panel', 'panel-compact');
                el.style.left = el.style.top = el.style.width = el.style.height = el.style.zIndex = '';
            } else if (el !== pinnedEl && st.suspended) {
                st.suspended = false;
                floatApplyRect(id);
            }
        });
    }

    function floatClampAll() {
        const vw = window.innerWidth, vh = window.innerHeight;
        let touched = false;
        Object.keys(floatPanels).forEach(id => {
            const st = floatPanels[id];
            if (!st || st.suspended) return;
            const r = st.rect;
            const w = Math.min(r.w, vw - 16), h = Math.min(r.h, vh - 16);
            const x = Math.max(80 - r.w, Math.min(r.x, vw - 80));
            const y = Math.max(0, Math.min(r.y, vh - 60));
            if (w !== r.w || h !== r.h || x !== r.x || y !== r.y) {
                st.rect = { x, y, w, h };
                floatApplyRect(id);
                touched = true;
            }
        });
        if (touched) floatRedraw();
    }

    (function wireFloatPanels() {
        ['mapPanel', 'videoPanel'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const grip = document.createElement('div');
            grip.className = 'float-resize-grip';
            grip.title = 'Resize';
            el.appendChild(grip);
            const dockBtn = document.createElement('button');
            dockBtn.type = 'button';
            dockBtn.className = 'float-dock-btn';
            dockBtn.textContent = '⇱ Dock';
            dockBtn.title = 'Return this panel to the media bar';
            el.appendChild(dockBtn);
            dockBtn.addEventListener('click', () => floatDock(id));
            el.addEventListener('pointerdown', e => {
                if (e.button !== 0) return;
                if (el.classList.contains('fake-fs')) return;   // pinned panels have no outline to grab
                if (floatIsFloating(id)) floatBringToFront(id);
                if (e.target === grip) {
                    const st = floatPanels[id];
                    if (!st || st.suspended) return;
                    floatDrag = { id, mode: 'resize', startX: e.clientX, startY: e.clientY, rect0: { x: st.rect.x, y: st.rect.y, w: st.rect.w, h: st.rect.h }, detached: true };
                    e.preventDefault();
                    return;
                }
                // Outline only: the padding ring is the one place the panel itself is the target,
                // so header buttons and the canvas's own drags never start a panel move.
                if (e.target !== el) return;
                const r = el.getBoundingClientRect();
                floatDrag = { id, mode: 'move', startX: e.clientX, startY: e.clientY, rect0: { x: r.left, y: r.top, w: r.width, h: r.height }, detached: floatIsFloating(id) };
                e.preventDefault();
            });
        });

        window.addEventListener('pointermove', e => {
            if (!floatDrag) return;
            const dx = e.clientX - floatDrag.startX, dy = e.clientY - floatDrag.startY;
            if (!floatDrag.detached) {
                if (Math.hypot(dx, dy) < FLOAT_DETACH_PX) return;
                floatDetach(floatDrag.id, floatDrag.rect0);
                if (!floatPanels[floatDrag.id]) { floatDrag = null; return; }   // detach refused (empty video)
                floatDrag.detached = true;
            }
            const st = floatPanels[floatDrag.id];
            if (!st || st.suspended) { floatDrag = null; return; }
            const vw = window.innerWidth, vh = window.innerHeight;
            if (floatDrag.mode === 'move') {
                st.rect.x = Math.max(80 - st.rect.w, Math.min(floatDrag.rect0.x + dx, vw - 80));
                st.rect.y = Math.max(0, Math.min(floatDrag.rect0.y + dy, vh - 60));
                floatApplyRect(floatDrag.id);   // position only; nothing needs re-rendering
            } else {
                st.rect.w = Math.max(FLOAT_MIN_W[floatDrag.id] || 280, Math.min(floatDrag.rect0.w + dx, vw - st.rect.x - 8));
                st.rect.h = Math.max(FLOAT_MIN_H[floatDrag.id] || 180, Math.min(floatDrag.rect0.h + dy, vh - st.rect.y - 8));
                floatApplyRect(floatDrag.id);
                if (!_floatRafPending) {
                    _floatRafPending = true;
                    requestAnimationFrame(() => { _floatRafPending = false; floatRedraw(); });
                }
            }
            if (e.cancelable) e.preventDefault();
        });
        window.addEventListener('pointerup', () => {
            if (!floatDrag) return;
            const wasResize = floatDrag.mode === 'resize' && floatDrag.detached;
            floatDrag = null;
            if (wasResize) floatRedraw();
        });
        window.addEventListener('resize', floatClampAll);
    })();
