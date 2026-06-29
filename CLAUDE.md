# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file, client-only web app ("Mission Visualizer") for NOAA Aircraft Operations Center (AOC) hurricane-hunter flight data. It plays back flight-level instrument data and synced cockpit/radar (MMR) video, with map tracking, charts, a PFD, satellite overlay, and KML/clip export. Built for NOAA AOC Science Branch.

There is no build system, package.json, or test suite. The entire application — markup, styles, and logic — lives in [index.html](index.html) (~3400 lines). All libraries are loaded from CDNs in the `<head>`: Tailwind (via CDN script, configured inline), Chart.js + chartjs-plugin-zoom, Three.js r128 + OrbitControls, netcdfjs, and Tesseract.js (OCR).

## Running / deploying

- There's no dev server or build step. Open [index.html](index.html) directly in a browser, or serve the directory with any static file server.
- Deployment is GitHub Pages via [.github/workflows/static.yml](.github/workflows/static.yml) (uploads the whole repo as-is) — [.github/workflows/jekyll-gh-pages.yml](.github/workflows/jekyll-gh-pages.yml) also exists but is the unused sample workflow. Either pushes to `main` trigger an upload, no compile step.
- There is no lint/test command. Verify changes by opening the page in a browser and exercising the upload/playback flow (see `/run` or `/verify` skill).

## Architecture (all inside the one `<script>` block in index.html)

**Data model**: Uploading a `.txt` (tab-separated AOC flight-level log) or `.nc` (NetCDF) file runs it through `parseEntireFile()` (~line 2191), which normalizes rows into `allParsedData` — one object per timestamp with fields like `lat`, `lon`, `pAlt`, `gpsAlt`, `tas`, `windSpd`, `pitch`, `roll`, etc. `.nc` files are first converted to the same tab-separated text format (via `netcdfjs`) before being handed to the same parser. The known/plottable fields are declared centrally in `METRIC_DEFS` (~line 1006) — label, color, and chart y-axis per metric; `availableMetrics` is derived from whichever of those keys are actually present in the uploaded file.

Time filtering (`applyFiltersAndInit`) derives `filteredData` from `allParsedData` based on the start/end time inputs; almost everything downstream (map, charts, PFD, HUD) renders off `filteredData[currentIdx]`, never `allParsedData` directly.

**Playback engine**: `masterSyncEngineTick()` is the single requestAnimationFrame loop driving playback. If no video is loaded, it advances `currentIdx` through `filteredData` using a `playbackAccumulator` scaled by the selected speed. If a video is loaded, it instead drives the video's `currentTime`/`playbackRate` and calls `syncTelemetryToVideoClock()` to keep `currentIdx` following the video clock.

**Video sync (two modes, `videoSyncMode`)**:
- *Manual*: user types an MMR start time; `filteredData` index follows a fixed offset from the video clock.
- *Auto-Sync (OCR)*: `Tesseract.js` (`initOCR`/`ocrWorker`) reads the timestamp burned into the video frame (`performImmediateOcrLock` for the "Sync Now" button, and an ongoing check inside `syncTelemetryToVideoClock`) and derives `videoStartSeconds` from it. OCR results are sanity-checked against the loaded flight data's time range before being trusted.

**Map rendering**: Two interchangeable tracker modes (`trackerModeSelect`):
- *2D* (`renderMapEngineFrame`, ~line 2552 + helpers `getX`/`getY`/`renderBackground`): hand-rolled 2D canvas projection (no map library) drawing coastline/state polygons (`mapFeatures`, fetched once from Natural Earth + US states GeoJSON on GitHub, ~line 3224), the flight track colored by wind speed or temperature (`getPathColorRGB`/`getSpdColorRGB`), wind barbs, custom markers, and the measurement tool (polygon/circle/rectangle hit-testing around line 1057-1163).
- *3D* (`init3D`/`build3DScene`/`update3DFrame`, ~line 1346+): a Three.js scene with the same GeoJSON extruded as flat polygons, a plane model, and a colored 3D flight path. `get3DCoord()` is the lon/lat/alt → Three.js-space projection shared by both the terrain and the track.

Both modes overlay an optional satellite image (`fetchSatelliteImage`, GIBS_LAYERS table ~line 633) pulled from NASA GIBS WMS, with granule timing looked up via NASA CMR (`lookupModisGranuleTime`).

**HUD/PFD overlays**: `renderHUD()` and `renderPFD()` (~line 2733/2817) draw the text telemetry box and the attitude indicator respectively, reading from the currently interpolated row.

**Smooth interpolation**: `getInterpolatedRow()` (~line 1163) does Catmull-Rom cubic interpolation (with circular-angle unwrapping for heading/track) between the surrounding `filteredData` samples, used when "8Hz Smoothing" is enabled so playback isn't locked to the native sample rate of the log.

**Charts**: Chart.js instances are built in `buildChartLayout()` for the fixed set of canvases (`tempChart`, `navChart`, `attChart`, `altChart`, `tasChart`, `vertWindChart`, `sfcChart`, `thermoChart`) plus a free-form "Create Your Own Graph" (`masterChart`/`parameterChart`) where the user picks arbitrary metrics from `METRIC_DEFS` via `buildMasterMenu()`/`toggleMasterMetric()`. `updateVisualComponents(idx)` (~line 3031) is the per-frame fan-out that updates the map, charts, HUD/PFD, and timeline display together — this is the function to extend when adding a new synced visual element.

**Export**: KML export (flight path placemark) and a "Record Clip" feature that uses `navigator.mediaDevices.getDisplayMedia` + `MediaRecorder` to capture a screen-share of the tab while auto-playing a selected timeline range, saving a `.webm`.

## Working in this file

- Everything is global state (top-level `let`/`const` in the script — `allParsedData`, `filteredData`, `currentIdx`, `mapScale`, etc.) and DOM lookups by `getElementById`, not a component framework. Follow that style rather than introducing modules/build tooling.
- When adding a new flight-data metric, add it to `METRIC_DEFS` so it's auto-detected, plottable in "Create Your Own Graph", and unit-converted by `getConvertedVal`/`getMetricLabel`.
- When adding a new per-frame visual, wire it into `updateVisualComponents()` so it stays in sync with both manual playback and video-synced playback.
- Imperial/metric conversion and 2D/3D tracker parity are both intentional — when changing rendering logic, check whether the equivalent code path exists in both `renderMapEngineFrame` (2D) and `build3DScene`/`update3DFrame` (3D).
