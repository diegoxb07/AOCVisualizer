/* Mission Visualizer - metric definitions + map/measure state
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded as a classic (non-module) script; all parts share one global scope, in order. */

    let scene3D, camera3D, renderer3D, controls3D;
    let planeGroup3D, trackArrow3D;
    let threeMapGroup = new THREE.Group();
    let threeMarkersGroup = new THREE.Group();
    let threeDInitialized = false;

    const METRIC_DEFS = {
        'pAlt': { label: 'Press Altitude (m)', color: '#d946ef', yAxisID: 'y' },
        'gpsAlt': { label: 'GPS Altitude (m)', color: '#a855f7', yAxisID: 'y' },
        'radAlt': { label: 'Radar Altitude (m)', color: '#14b8a6', yAxisID: 'y' },
        'dValue': { label: 'D-Value (m)', color: '#8b5cf6', yAxisID: 'y' },
        'sfcPr': { label: 'Surface Press (mb)', color: '#38bdf8', yAxisID: 'y' },
        'tempr': { label: 'Ambient Temp (°C)', color: '#ff5555', yAxisID: 'y1' },
        'dewpt': { label: 'Dew Point (°C)', color: '#ffaa00', yAxisID: 'y1' },
        'tas': { label: 'TAS (kt)', color: '#f59e0b', yAxisID: 'y1' },
        'ias': { label: 'IAS (kt)', color: '#a3e635', yAxisID: 'y1' },
        'windSpd': { label: 'Wind Speed (kt)', color: '#f43f5e', yAxisID: 'y1' },
        'driftAngle': { label: 'Drift Angle (Deg)', color: '#ec4899', yAxisID: 'y1' },
        'th': { label: 'True Heading (Deg)', color: '#3b82f6', yAxisID: 'y1' },
        'gTrack': { label: 'Ground Track (Deg)', color: '#38bdf8', yAxisID: 'y1' },
        'pitch': { label: 'Pitch (°)', color: '#ef4444', yAxisID: 'y1' },
        'roll': { label: 'Roll (°)', color: '#3b82f6', yAxisID: 'y1' },
        'alpha': { label: 'Alpha (AOA °)', color: '#10b981', yAxisID: 'y1' },
        'beta': { label: 'Beta (Slip °)', color: '#ec4899', yAxisID: 'y1' },
        'vtWnd': { label: 'Vert Wind (m/s)', color: '#ff1744', yAxisID: 'y1' },
        'accZ': { label: 'Vertical Accel (m/s²)', color: '#f43f5e', yAxisID: 'y1' },
        'mixRate': { label: 'Mixing Ratio (g/kg)', color: '#fbbf24', yAxisID: 'y1' },
        'thetaE': { label: 'Theta E (K)', color: '#c084fc', yAxisID: 'y1' },
        'pressure': { label: 'Static Press (mb)', color: '#00ffcc', yAxisID: 'y' }
    };

    let customCharts = {}; 
    let masterChartInstance = null;
    let animationFrameId = null;
    let videoLoaded = false;
    let videoStartSeconds = 0;
    let lastTickTime = 0;
    let videoPlaybackAccumulator = 0;

    let mapScale = 1, mapOffsetX = 0, mapOffsetY = 0;
    let isDraggingMap = false, dragStartX = 0, dragStartY = 0;
    let playbackAccumulator = 0;
    let speeds = [1, 2, 4, 8, 16, 32, 64, 128]; 
    let currentSpeedIdx = 0;
    let plotMinLon, plotMaxLon, plotMinLat, plotMaxLat, deltaLon, deltaLat;

    let isMeasuring = false, measureShape = 'polygon', measurePointsGeo = [], drawnShapes = [], liveMouseGeo = null;
    let baseHudHeight = 0;
    const EARTH_RADIUS_NM = 3440.065;

    let isScrubbing = false, activeScrubChart = null, wasPlayingBeforeScrub = false;
    let hasInitialSyncOccurred = false, scrubSyncTimeout = null, forceOcrSyncNextTick = false;
    let isManualSyncRequest = false, scrubDebounceTimer = null;
    let isHoveringShape = false, isDraggingShape = false, lastDragGeo = null;
    let draggingShapeIndex = -1, hoveredShapeIndex = -1, measureButtons = [], measureClickHandled = false;
