# User & Training Guide

This guide walks through the Mission Visualizer panel by panel, in the order you'd use them
during a **training** or **replay** session. If something you expect is greyed out or shows
"API Offline," jump to **[API & Connectivity](CONNECTIVITY.md)** — the app is designed to
keep working from a manual file even with no internet.

- [1. Layout at a glance](#1-layout-at-a-glance)
- [2. Getting a flight in](#2-getting-a-flight-in)
- [3. Trimming the time window](#3-trimming-the-time-window)
- [4. Replay controls](#4-replay-controls)
- [5. The map tracker (2D & 3D)](#5-the-map-tracker-2d--3d)
- [6. MMR video sync](#6-mmr-video-sync)
- [7. Satellite overlays](#7-satellite-overlays)
- [8. Storm best-track overlay](#8-storm-best-track-overlay)
- [9. Charts & "Create Your Own Graph"](#9-charts--create-your-own-graph)
- [10. PFD, HUD & units](#10-pfd-hud--units)
- [11. Measure, mark, and analyze](#11-measure-mark-and-analyze)
- [12. Exporting: KML & recorded clips](#12-exporting-kml--recorded-clips)
- [13. Suggested training walkthrough](#13-suggested-training-walkthrough)
- [14. Troubleshooting](#14-troubleshooting)

---

## 1. Layout at a glance

- **Top card** — data loading (archive browser + manual upload), MMR video upload, time
  window, sync mode, and export buttons. A **mission status strip** shows Flight ID,
  Aircraft, Date, and the detected data range.
- **Sticky media bar** — the **Flight-Level Data Player** (map tracker) on the left and the
  **MMR Media Display** (video) on the right. Drag the handle at the bottom of this bar to
  resize both, or drag it all the way down to collapse.
- **Chart grid** — eight fixed charts plus the full-width **Create Your Own Graph**.
- **Sticky bottom bar** — Playback, Sync, Markers, Track Color, Wind Barb Color, Filters, and
  the timeline slider + UTC clock.

---

## 2. Getting a flight in

There are two ways to load flight-level data. Both feed the **same** parser, so the map,
charts, PFD, and export behave identically no matter which you use.

### Option A — NOAA Recon Archive (one-stop shop, needs API online)

In the top-left card, use the three cascading dropdowns:

1. **Year…** → pick a hurricane season.
2. **Storm…** → pick the storm.
3. **Flight…** → pick the specific mission.
4. Click **⤓ Load Flight + Storm Track**.

This streams the mission's **full-resolution NetCDF** directly (with a real byte-progress
readout), parses every recorded variable, **and** loads the storm's **whole-life best-track**
for the overlay. The **⬇ .nc** link that appears opens the original NOAA file for use in
other tools.

> If the download or parse ever fails, the app automatically falls back to a lower-rate
> (0.2 Hz) decimated track so you still get something to replay. The status text tells you
> which path ran.

If these controls are **greyed out with an "API Offline" banner**, the archive service is
unreachable — use Option B instead. See **[API & Connectivity](CONNECTIVITY.md)**.

### Option B — Manual upload (always works, no internet needed)

Drop a file on the **"or upload:"** zone (top-left, next to *Load Flight-Level Data*), or
click it to browse. Accepted formats:

- **`.txt`** — a tab-separated AOC flight-level log.
- **`.nc`** — NetCDF; converted to the same tab-separated format internally, then parsed.

When a file loads, the detected time range and mission info populate automatically.

---

## 3. Trimming the time window

Under the data card, set **Flight-Data Start Time** and **Flight-Data End Time** in `HHMMSS`
(UTC). Everything downstream — map, charts, PFD, timeline — renders only the rows inside this
window. Leave them at the detected full range to replay the whole flight.

You must click **`Apply & Run`** (bottom bar) after changing the window for it to take effect.

---

## 4. Replay controls

All in the **sticky bottom bar**:

| Control | What it does |
| --- | --- |
| **`Apply & Run`** | Applies the time window and (re)initializes playback. Run this after loading or after changing start/end times. |
| **`▶ Play` / `⏸ Pause`** | Start / stop playback. |
| **`⏪ / 1x / ⏩`** | Decrease / show / increase playback speed. |
| **`↻ Reset`** | Jump back to the start of the window. |
| **Timeline slider** | Scrub to any moment; the UTC clock on the right updates live. |
| **8Hz Smoothing** (map controls) | Catmull-Rom cubic interpolation between samples so motion is fluid instead of stepping at the native sample rate. Recommended for training playback. |

If an MMR video is loaded, playback is driven by the **video clock** and the telemetry
follows it; otherwise the engine advances through the data on its own clock.

---

## 5. The map tracker (2D & 3D)

Switch modes with the **2D Map Tracker / 3D WebGL Tracker** dropdown in the map header.

- **2D** — a hand-drawn canvas map of the **whole world** (coastlines + US states). Zoom with
  the scroll wheel, pan by dragging. Zooming out far enough reveals all continents for
  synoptic context.
- **3D** — a Three.js scene with extruded terrain, a plane model, and the flight path drawn in
  3D by altitude. Orbit/zoom with the mouse.

**Track color** (bottom bar) — colour the flight path by **Wind Speed** or by
**Warming/Cooling** (temperature).

**Wind Barb Color** (bottom bar) — colour wind barbs by **Wind Speed** or by
**Hurricane Wind Field**.

**Simple Icon (2D)** (Filters) — swap the detailed aircraft glyph for a simple marker.

Use **⛶** in the map header (or the global **⛶ Fullscreen**, top-right) to go fullscreen for
presentations.

---

## 6. MMR video sync

Load a cockpit/radar **`.mp4`** in the **"Upload MMR to Sync"** zone (top-left). It appears in
the **MMR Media Display** panel and, once synced, plays locked to the flight data.

Choose a **Video Sync Mode** (top card):

### Manual Time Input
Type the video's UTC start time in **MMR Start Time** (`HHMMSS`). The telemetry index then
follows a fixed offset from the video clock. Simple and reliable when you know the start time.

### Auto-Sync (MMR / OCR)
The app uses OCR (Tesseract.js) to read the timestamp **burned into the video frame** and
derive the start time automatically. A small **green pulse** in the video panel indicates OCR
is active; a **"Syncing…"** pill shows while it's hunting/realigning (it's non-blocking — you
can keep working).

- Click **🔄 Sync Now** (Sync group, bottom bar) to force an immediate lock. **Tip:** click it
  a few times if the first attempt misses, and jump to a frame where the timestamp is clear
  and unobstructed.
- OCR results are sanity-checked against the loaded flight's time range before being trusted,
  so a misread won't send playback to a wildly wrong time.
- Hide any *other* on-screen timestamps in the video frame — extra numbers can confuse OCR.

---

## 7. Satellite overlays

Use the **Sat:** dropdown in the map header. Options auto-populate based on the flight's
**date and location** after data loads. There are two families:

### MODIS / VIIRS (polar, NASA GIBS)
Work for **any date** back to the mission's start. Imagery is keyed to a **calendar day**; a
**◀ day ▶ stepper** appears so you can move between days, and overpass times are looked up
automatically.

### GOES-East / GOES-West (archive, needs API online)
Rendered **server-side from NOAA's S3 archive** for the flight's **historical date** (this is
what lets you see GOES for older flights that NASA GIBS no longer keeps). Notes:

- After picking **GOES-East (Archive)** or **GOES-West (Archive)**, a **product picker**
  (`Choose a product…`) appears. **Nothing fetches until you pick a product** (e.g. a Clean
  IR band, Water Vapor, or a composite like Sandwich/GeoColor). This is intentional.
- Once you pick a product, the app **auto-caches the entire flight's imagery up front** so
  scrubbing/playback never waits mid-flight. A progress bar shows caching; **Cancel** stops it.
- Imagery advances as the tracker crosses each **10-minute** mark; the badge shows the current
  scan time. Use **⏪ 10m / 10m ⏩** (top-center of the 2D tracker) to step the playhead — and
  thus the satellite scan — by 10 flight-minutes.
- If the flight is **outside** a satellite's Earth-disk view (e.g. an Atlantic flight vs.
  GOES-West), that option is greyed out.

### Pre-caching for multiple flights
The **⤓ Locally Cache Satellites** button (top card) opens a modal where you pick a
satellite + band(s) and select **one or more** flight files. Every tile those flights need is
downloaded to the local cache so later playback needs no fetching. (Cache lasts until you
close the tab.)

> All GOES-archive features require the API to be online. If it's offline they're disabled and
> labelled "API Offline." MODIS/VIIRS still work. See **[API & Connectivity](CONNECTIVITY.md)**.

---

## 8. Storm best-track overlay

When you load a mission via the **archive browser**, the storm's **whole-life** best-track
(independent of the flight's own time window) loads automatically as a dashed,
**intensity-coloured** line on both the 2D and 3D map.

- Toggle it with the **Storm Track** checkbox in the map header (only shown once a track is
  loaded).
- The **🌀 Last Storm Observation** card (in the tracker pane) shows the nearest best-track fix
  to the current playback time, updating as you scrub.
- Hover a best-track point for a tooltip.

(Manual uploads don't include a storm track; the overlay only appears for archive loads.)

---

## 9. Charts & "Create Your Own Graph"

The chart grid has eight synced charts: **Temperature Profiles, Navigation Angles, Flow
Angles, Altitude, Speed Profiles, Vertical Speeds & Accel, Pressure Profiles,** and
**Thermodynamics & Moisture**. Each tracks the current playback moment.

- **↺** resets that chart's zoom/scale.
- **＋** opens a menu to add/remove series on that chart.
- Scroll/drag on a chart to zoom/pan (Chart.js zoom plugin).

**Create Your Own Graph** (full-width, bottom) — click **Create Graph** (or the **＋**) and
pick **any** variables the file contains to plot them together. Useful for ad-hoc comparisons
during analysis or teaching a specific relationship.

---

## 10. PFD, HUD & units

- **Cockpit PFD** (Filters) — shows a cockpit-style **attitude indicator** overlaid on the
  map, driven by the current attitude data.
- The **HUD** text box shows live telemetry for the current moment.
- **Imperial Units** (Filters) — toggle metric ↔ imperial across the whole app.
- **Press-→GPS Alt** (Filters, shown when available) — switch the altitude source.

---

## 11. Measure, mark, and analyze

- **📏 Measure** (map header) — choose **Polygon / Circle / Rectangle**, then click on the map
  to measure distance/area. **✕ Clear** removes it.
- **📌 Mark Point** (Markers, bottom bar) — drop a marker at the current position. **❌ Clear**
  removes all markers.
- Click a marked point (or a data point) to open **Point Data Analysis**, then
  **📥 Download Report (.txt)** to save that point's full data.

---

## 12. Exporting: KML & recorded clips

### 🌍 Export KML
Saves the flight path as a KML placemark you can open in Google Earth or GIS tools.

### 🎥 Record Clip
Opens the **Record Mission Clip** modal:

1. Set **Start Point** and **End Point** on the mini-timeline.
2. Choose the **Tracker** (2D/3D), **Satellite Overlay**, whether to include the **MMR video**,
   and up to **four graphs** to stack on the right.
3. Click **⏺ Start Recording**. The app auto-plays the selected range and screen-captures it
   (via `getDisplayMedia` + `MediaRecorder`) to a **`.webm`** file. A progress pill shows
   status; **■ Stop** ends and saves early.

Great for producing briefing/training clips of a specific mission segment.

---

## 13. Suggested training walkthrough

A repeatable flow for a training or briefing session:

1. **Load the mission** from the archive (Year → Storm → Flight → *Load Flight + Storm
   Track*). No internet / API down? Upload the mission `.txt`/`.nc` manually instead.
2. **(Optional) Load the MMR video** and set **Auto-Sync**, then **🔄 Sync Now**.
3. **Trim** to the segment you want to teach (e.g. the eyewall penetration), then **Apply &
   Run**.
4. Turn on **8Hz Smoothing**, set **Track Color → Wind Speed**, and add a **satellite
   overlay** for context (pick a GOES product to auto-cache the segment).
5. **Play** at a comfortable speed; scrub with the timeline to pause on key moments. Watch the
   **PFD**, **charts**, and **storm track card** update together.
6. **Measure / Mark** points of interest and download the point report if needed.
7. **Record a clip** of the segment with the tracker + video + a couple of charts for reuse.

---

## 14. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Archive dropdowns greyed out, **"API Offline"** banner | The noaa-recon-api is unreachable. Use **manual upload**. See [API & Connectivity](CONNECTIVITY.md). It re-checks every ~60s and re-enables itself when it recovers. |
| A GOES satellite option is greyed out | Either the API is offline **or** the flight is outside that satellite's Earth-disk view (e.g. GOES-West for an Atlantic flight). Try the other GOES, or MODIS/VIIRS. |
| Picked GOES but nothing shows | GOES products don't auto-select — you must pick a **product** from the `Choose a product…` picker. Then it fetches/caches. |
| Auto-Sync lands on the wrong time | Click **🔄 Sync Now** again (a few times), jump to a frame with a clear, unobstructed timestamp, and hide any other on-screen timestamps. Or switch to **Manual** and type the start time. |
| Charts/map not updating after changing time window | Click **`Apply & Run`**. |
| Nothing plays | Make sure a file is loaded and you clicked **`Apply & Run`** then **`▶ Play`**. |
| Everything feels slow while satellite is on | Let the **pre-cache** finish (progress bar), or pre-cache flights ahead of time with **⤓ Locally Cache Satellites**. |

For what does and doesn't need connectivity, read **[API & Connectivity](CONNECTIVITY.md)**.
