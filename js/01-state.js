/* Mission Visualizer - global playback/render state
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    let allParsedData = [];
    let filteredData = [];
    let availableMetrics = new Set();
    let currentIdx = 0;
    let isPlaying = false;
    let isNcFile = false;
    
    let satImage = new Image();
    let satImageLoaded = false;
    let lastSatFetchTime = "";
    let satLoadedInfo = null;
    let satImageBox = null;
    let satDebounceTimer = null;
    // Two-tier satellite tile cache, both keyed by the exact fetchId (layer||band||time||box).
    // HOT = decoded drawables (canvas/ImageBitmap) for instant display; small, holds the playback
    // neighborhood. COLD = compressed PNG blobs (lossless, ~50-100x lighter); big, survives across
    // flights so many storms can stay cached until the tab closes. A COLD hit is decoded into HOT on
    // demand (~ms) and the preloader pre-decodes upcoming buckets so playback sees no delay.
    const satTileCache = new Map();          // HOT: fetchId -> { canvas, box, scanStartMs }
    const SAT_CACHE_MAX = 24;                // just the playback neighborhood (decoded = RAM-heavy)
    const satBlobStore = new Map();          // COLD: fetchId -> { blob, box, scanStartMs }
    const SAT_BLOB_MAX = 1500;               // ≈ 30 storm-bands of 10-min tiles (LRU-evicted)
    let batchCaching = false;                // a multi-flight local sat-cache pass is running
    let batchCacheCancel = false;            // user asked to stop the current pass
    // Smooth scrubbing: a background preloader warms the buckets around the playhead into the cache.
    const satFetchInFlight = new Map();      // fetchId -> in-flight Promise (dedupe live + preload + prefetch)
    let satPreloadQueue = [];                // upcoming buckets queued to warm around the playhead
    let satPreloadActive = false;            // the preload worker loop is running
    let _satPreloadBucket = null;            // last playhead bucket we queued neighbors for (avoids requeue spam)
    let slideSyncTimer = null;  
    let isResizingMedia = false; 

    let mapFeatures = [];
    let customMarkers = [];
    let flightMetaData = { id: 'Unknown', date: 'Unknown', aircraft: 'Unknown' };
    let currentPointAnalysisData = null; 
    let tempBaseline = [];
    
    let bgNeedsUpdate = true;
    let bgCanvas = document.createElement('canvas');
    let bgCtx = bgCanvas.getContext('2d');

    // HiDPI: the canvas backing store is sized cssW*DPR x cssH*DPR (sharp on Retina), while all
    // projection + mouse math works in LOGICAL css pixels (cssW/cssH). DPR is applied as the base
    // transform in the renderers. Set by resizeCanvasLayout.
    let cssW = 0, cssH = 0, DPR = 1;
