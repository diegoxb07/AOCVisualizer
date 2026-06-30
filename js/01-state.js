/* Mission Visualizer — global playback/render state
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
