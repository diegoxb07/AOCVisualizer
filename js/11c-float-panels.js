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
    const FLOAT_EDGE_PX = 10;          // grab band along each side of a floating panel that resizes

    // Which sides of the panel the pointer sits on (inside the edge band).
    function floatEdgesAt(el, e) {
        const r = el.getBoundingClientRect();
        return {
            n: e.clientY - r.top < FLOAT_EDGE_PX,
            s: r.bottom - e.clientY < FLOAT_EDGE_PX,
            w: e.clientX - r.left < FLOAT_EDGE_PX,
            e: r.right - e.clientX < FLOAT_EDGE_PX,
        };
    }
    function floatEdgeCursor(ed) {
        if ((ed.n && ed.w) || (ed.s && ed.e)) return 'nwse-resize';
        if ((ed.n && ed.e) || (ed.s && ed.w)) return 'nesw-resize';
        if (ed.n || ed.s) return 'ns-resize';
        if (ed.e || ed.w) return 'ew-resize';
        return '';
    }

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
        if (id === 'videoPanel') syncVideoCrop();
    }

    // Cover-crop the MMR whenever its box is flatter than the video's own frame, docked (the
    // media height handle squashing the bar) or floating alike: contain would pad the sides
    // while the frame's baked-in top/bottom black bands eat the height, so the trim comes out
    // of those bands instead (#videoPanel.video-crop flips object-fit to cover). A pinned
    // panel always shows the full frame.
    function syncVideoCrop() {
        const panel = document.getElementById('videoPanel'), v = document.getElementById('radarVideo');
        if (!panel || !v) return;
        if (panel.classList.contains('fake-fs')) { panel.classList.remove('video-crop'); return; }
        const box = v.parentElement ? v.parentElement.getBoundingClientRect() : null;
        if (!box || !box.width || !box.height) return;
        const ar = v.videoWidth > 0 ? v.videoWidth / v.videoHeight : 16 / 9;
        panel.classList.toggle('video-crop', box.width / box.height > ar);
    }

    // The same redraw combo the media height handle uses: sizes first, then the 2D reframe
    // with the panned view preserved (resizeCanvasLayout keeps it as geography), then the PFD.
    function floatRedraw() {
        resizeCanvasLayout();
        if (filteredData.length > 0 && trackerModeSelect.value === '2d') {
            calculateMapScales(); bgNeedsUpdate = true;
            renderMapEngineFrame(currentIdx, filteredData[currentIdx]);
        }
        if (filteredData.length > 0 && document.getElementById('togglePfd').checked) renderPFD(filteredData[currentIdx]);
        syncVideoCrop();
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
            el.classList.remove('float-panel', 'panel-compact', 'video-crop');
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

    // A video loaded while the map already floats joins it in PiP at the map's size, parked on
    // whichever side has the room (right, then left, then below). Called from the video-upload
    // handler in js/12-file-parsing.js once videoLoaded is set.
    function floatVideoBesideMap() {
        const mapSt = floatPanels.mapPanel;
        if (!mapSt || mapSt.suspended || floatPanels.videoPanel) return;
        if (typeof videoLoaded === 'undefined' || !videoLoaded) return;
        const r = mapSt.rect, vw = window.innerWidth, vh = window.innerHeight, gap = 12;
        const w = r.w, h = r.h;
        // Clamp a corner so the WHOLE panel stays on screen (near margin when it is larger than the
        // viewport), so an awkwardly-parked map never strands the video off-screen.
        const clampX = px => Math.max(8, Math.min(px, Math.max(8, vw - w - 8)));
        const clampY = py => Math.max(22, Math.min(py, Math.max(22, vh - h - 8)));
        let x, y;
        if (r.x + r.w + gap + w <= vw - 8) { x = r.x + r.w + gap; y = clampY(r.y); }   // fits fully to the right
        else if (r.x - gap - w >= 8) { x = r.x - gap - w; y = clampY(r.y); }           // fits fully to the left
        else { x = clampX(r.x); y = clampY(r.y + r.h + gap); }                         // otherwise directly below
        floatDetach('videoPanel', { x, y, w, h });
    }

    // Called by setFakePanel with the panel being pinned (or null). The pin's inset:0 must own
    // the rect while it lasts; the float rect comes back untouched when the pin releases.
    function floatPanelsOnPinChange(pinnedEl) {
        Object.keys(floatPanels).forEach(id => {
            const st = floatPanels[id], el = document.getElementById(id);
            if (!st || !el) return;
            if (el === pinnedEl && !st.suspended) {
                st.suspended = true;
                el.classList.remove('float-panel', 'panel-compact', 'video-crop');
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
            const y = Math.max(22, Math.min(r.y, vh - 60));
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
            // Hover feedback: the edge band shows its resize cursor so the sides read grabbable.
            el.addEventListener('pointermove', e => {
                if (floatDrag || !floatIsFloating(id)) { if (!floatDrag) el.style.cursor = ''; return; }
                el.style.cursor = floatEdgeCursor(floatEdgesAt(el, e));
            });
            el.addEventListener('pointerleave', () => { if (!floatDrag) el.style.cursor = ''; });
            el.addEventListener('pointerdown', e => {
                if (e.button !== 0) return;
                if (el.classList.contains('fake-fs')) return;   // pinned panels have no outline to grab
                if (floatIsFloating(id)) floatBringToFront(id);
                if (e.target === grip) {
                    const st = floatPanels[id];
                    if (!st || st.suspended) return;
                    floatDrag = { id, mode: 'resize', edges: { s: true, e: true }, startX: e.clientX, startY: e.clientY, rect0: { x: st.rect.x, y: st.rect.y, w: st.rect.w, h: st.rect.h }, detached: true };
                    e.preventDefault();
                    return;
                }
                if (!floatIsFloating(id)) {
                    // Docked: only the outline ring detaches (the panel itself as target), so
                    // the canvas and header keep their own gestures until the panel floats.
                    if (e.target !== el) return;
                } else {
                    if (e.target !== el) {
                        // Floating: the whole surface moves the window, except real controls and
                        // the media surfaces, which keep their own gestures (map pan, video zoom).
                        if (e.target.closest('button, select, input, a, label, textarea')) return;
                        if (e.target.closest('canvas, video, #threeDContainer')) return;
                    }
                    // A grab inside the edge band resizes from that side/corner instead of moving.
                    const ed = floatEdgesAt(el, e);
                    if (ed.n || ed.s || ed.e || ed.w) {
                        const st = floatPanels[id];
                        floatDrag = { id, mode: 'resize', edges: ed, startX: e.clientX, startY: e.clientY, rect0: { x: st.rect.x, y: st.rect.y, w: st.rect.w, h: st.rect.h }, detached: true };
                        e.preventDefault();
                        return;
                    }
                }
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
                st.rect.y = Math.max(22, Math.min(floatDrag.rect0.y + dy, vh - 60));   // 22px keeps the panel's top (with the dock button) on screen
                floatApplyRect(floatDrag.id);   // position only; nothing needs re-rendering
            } else {
                const ed = floatDrag.edges || { s: true, e: true };
                const r0 = floatDrag.rect0;
                const minW = FLOAT_MIN_W[floatDrag.id] || 280, minH = FLOAT_MIN_H[floatDrag.id] || 180;
                if (ed.e) st.rect.w = Math.max(minW, Math.min(r0.w + dx, vw - r0.x - 8));
                if (ed.s) st.rect.h = Math.max(minH, Math.min(r0.h + dy, vh - r0.y - 8));
                if (ed.w) {
                    // The left edge follows the pointer: width changes and x moves with it, so
                    // the right edge stays planted.
                    const w = Math.max(minW, Math.min(r0.w - dx, r0.x + r0.w - 8));
                    st.rect.x = r0.x + (r0.w - w); st.rect.w = w;
                }
                if (ed.n) {
                    const h = Math.max(minH, Math.min(r0.h - dy, r0.y + r0.h - 22));   // 22px keeps the panel's top (with the dock button) on screen
                    st.rect.y = r0.y + (r0.h - h); st.rect.h = h;
                }
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
