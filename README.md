# Mission Visualizer

This video telemetry tool replays flight-level instrument data together with synced radar
(**MMR**) video, and adds a live map tracker, fully customizable graphs with tons of variables, a Primary Flight Display, satellite imagery overlays, storm best-track overlays, and KML / video clip export capabilities.

Built for the **NOAA Aircraft Operations Center**. Runs entirely in the browser, API-backend optional.

- **Tool Link:** https://diegoxb07.github.io/AOCVisualizer/ (GitHub Pages)
- **Repository:** https://github.com/diegoxb07/AOCVisualizer

---

## What it's for

| Use case | What the tool gives you |
| --- | --- |
| **Training** | Replay a real mission at any speed, scrub to any moment, and watch the aircraft state (attitude, winds, altitude, speeds) change live on the map, PFD, and graphs all together with the MMR video synced alongside. You can also record clips in advance for presentations. |
| **Replay / analysis** | Load flight-level data (or pull a whole mission from the archive), trim to a time window, color the track by wind speed or temperature, drop measurement shapes, do point analyses, overlay GOES/MODIS/VIIRS satellite imagery for the flight's date, and export the track to KML. |
| **API-backed workflow** | A built-in **NOAA Recon Archive** browser (Year → Storm → Mission) loads full-resolution mission NetCDF and the storm's whole-life best-track automatically, and archive **GOES** satellite imagery is rendered on demand for the historical dates these flights fall on. |

---

## Decision Flowchart

You can use this flowchart in case you are unsure of what to do:

```mermaid
flowchart TD
    START(["Open the app"]) --> ARCHIVE{"Archive dropdowns available?<br>(Year / Storm / Flight)"}
    ARCHIVE -- "Yes" --> LOADARC["Pick <b>Year → Storm → Flight</b><br>click <b>⤓ Load Flight + Storm Track</b><br>(full-res NetCDF + storm best-track)"]
    ARCHIVE -- "No, API Offline banner" --> UPLOAD["Drop your <b>.nc</b> or <b>.txt</b> file<br>on the <b>or upload:</b> zone"]
    LOADARC --> LOADED["Flight loaded: map, charts & PFD populate"]
    UPLOAD --> LOADED
    LOADED --> MMR{"Have an MMR video<br>for this flight?"}
    MMR -- "Yes" --> VIDEO["Drop the <b>.mp4</b> in <b>Upload MMR to Sync</b><br>Auto-Sync reads the burned-in timestamp<br>and the window auto-follows the video<br>(<b>🔄 Sync Now</b> forces a lock, or use Manual)"]
    MMR -- "No" --> WINDOW{"Replay only part<br>of the flight?"}
    WINDOW -- "Yes" --> TRIM["Set <b>Start / End</b> times (HHMMSS)<br>then click <b>Apply & Run</b>"]
    WINDOW -- "No" --> SAT{"Want satellite imagery<br>behind the 2D track?"}
    TRIM --> SAT
    VIDEO --> SAT
    SAT -- "Yes" --> FROMARC{"Was the flight loaded from<br>the archive in step 1?"}
    FROMARC -- "Yes" --> SATGOES["<b>Sat:</b> dropdown → GOES East/West (archive)<br>pick a product to pre-cache the flight"]
    FROMARC -- "No --> SATPOLAR["<b>Sat:</b> dropdown → a MODIS/VIIRS pass<br>(works for any date, no API needed)"]
    SAT -- "No" --> PLAY["<b>▶ Play</b>, scroll through the timeline, change speed,<br>toggle 8Hz Smoothing / PFD / Imperial"]
    SATGOES --> PLAY
    SATPOLAR --> PLAY
    PLAY --> EXPORT{"Need a deliverable?"}
    EXPORT -- "Google Earth" --> KML["🌍 Export KML"]
    EXPORT -- "Briefing video" --> CLIP["🎥 Record Clip (.webm)"]
    EXPORT -- "No, just analyzing" --> DONE(["Done: measure, mark & compare freely"])
```

---

## 1. Loading a flight

Both paths feed the **same** parser, so the map, charts, PFD, and export behave identically either way.

**Option 1: Archive browser (one-stop shop, needs the API online).** Pick **Year → Storm → Flight** in the top-left card, then click **⤓ Load Flight + Storm Track**. This streams the mission's full-resolution NetCDF (with a byte-progress readout), parses every recorded variable, **and** loads the storm's whole-life best-track. The **⬇ .nc** link that appears opens the original NOAA file for use in other tools. If the download ever fails it automatically falls back to a decimated (0.2 Hz) track; the status text tells you which path ran.

**Option 2: Manual upload (always works, no internet needed).** Drop a **`.nc`** file (e.g. `20221028H1_A.nc`) or a tab-separated AOC **`.txt`** log on the **"or upload:"** zone. Manually loaded flights have no storm best-track; that only comes with an archive load.

> Archive controls greyed out with an **"API Offline"** banner mean the archive service is unreachable, and one should use manual upload. It re-checks every ~60 s and can re-enable itself. Details: **[API & Connectivity](docs/CONNECTIVITY.md)**.

---

## 2. Time window & replay controls

Set **Flight-Data Start / End Time** (`HHMMSS` UTC) to replay just a segment, and everything downstream (map, charts, PFD, timeline) renders only that window. Leave the detected range alone to replay the whole flight. **After changing the window, click `Apply & Run`.**

With a synced MMR video loaded, the window auto-adjusts to the video's timeframe, so manual trimming mainly applies to data-only replay (or Manual sync mode).

All playback lives in the sticky bottom bar:

| Control | What it does |
| --- | --- |
| **`Apply & Run`** | Applies the time window and (re)initializes playback. |
| **`▶ Play` / `⏸ Pause`** | Start / stop. |
| **`⏪ / 1x / ⏩`** | Playback speed. |
| **`↻ Reset`** | Jump back to the start of the window. |
| **Timeline slider** | Scrub anywhere; the UTC readout updates live. |
| **8Hz Smoothing** (map header) | Catmull-Rom interpolation between the native 1-second samples for fluid motion instead of stepping. Recommended for training. |

If an MMR video is loaded, the **video clock drives playback** and the telemetry follows it; otherwise the engine advances on its own clock.

---

## 3. The map tracker (2D & 3D)

Switch with the **2D Map Tracker / 3D WebGL Tracker** dropdown in the map header.

- **2D**: whole-world canvas map (coastlines, US states) with satellite imagery and **wind barbs**. Wheel to zoom, drag to pan; zoom out for synoptic context.
- **3D**: Three.js scene with terrain, a plane model, and the track drawn by altitude. Orbit/zoom with the mouse.

Options (bottom bar): **Track Color** (wind speed or warming/cooling), **Wind Barb Color** (wind speed or hurricane wind field), **Simple Icon (2D)**. Use **⛶** for fullscreen presentations.

**Measure & mark:** **📏 Measure** (map header) draws polygon/circle/rectangle for distance & area; **📌 Mark Point** (bottom bar) drops a marker at the current position. Click a marked point to open **Point Data Analysis** and **📥 download** its full report.

---

## 4. MMR video sync

Load a cockpit/radar **`.mp4`** in **Upload MMR to Sync**. Two sync modes:

- **Auto-Sync (default)**: OCR reads the timestamp **burned into the video frame** and aligns automatically. A green pulse means OCR is active; a non-blocking "Syncing…" pill shows while it hunts. Click **🔄 Sync Now** to force a lock (a few clicks on a clear frame helps), and hide any *other* on-screen timestamps that could confuse it. Reads are sanity-checked against the flight's time range, so a misread can't jump playback wildly.
- **Manual Time Input**: type the video's UTC start time in **MMR Start Time** (`HHMMSS`). Simple and reliable when you already know it.

---

## 5. Satellite overlays

Pick a layer from the **Sat:** dropdown in the map header (options auto-populate from the flight's date and location).

- **MODIS / VIIRS (polar, NASA GIBS)**: any date back to each mission's start. Keyed to a calendar day; a **day-stepper** moves between days and overpass times are looked up automatically.
- **GOES-East / GOES-West (archive, needs API)**: rendered server-side from NOAA's S3 archive for the flight's **historical** date. Pick a **product** from the `Choose a product…` picker (spectral bands like Clean IR / Water Vapor, or composites like Sandwich / GeoColor). **Nothing fetches until you pick**, then the tool **pre-caches the whole flight** so scrubbing never waits (progress bar + Cancel). Imagery advances every **10 flight-minutes**; step it with **⏪ 10m / 10m ⏩**. A GOES option greys out when the flight is outside that satellite's view of Earth.
- **⤓ Locally Cache Satellites** (top card) pre-downloads imagery for **multiple flights** at once; the cache lasts until the tab closes.

---

## 6. Storm best-track overlay

Archive loads automatically draw the storm's **whole-life**, intensity-colored, dashed best-track on both trackers. Toggle it with the **Storm Track** checkbox; the **🌀 Last Storm Observation** card shows the nearest fix to the playback time, and hovering a track point pops its category, wind, pressure, and time.

---

## 7. Charts, PFD & HUD

Eight synced charts (temperature, nav angles, flow angles, altitude, speeds, vertical speeds/accel, pressure, thermodynamics) track the playback moment: **↺** resets zoom, **＋** adds/removes series, scroll/drag to zoom and pan. **Create Your Own Graph** (bottom) plots **any** variables the file contains against each other.

Filters (bottom bar): **Cockpit PFD** (attitude indicator overlay), **Imperial Units**, and **Press→GPS Alt** (altitude source, when available). The HUD box on the map shows live telemetry text.

---

## 8. Exporting

- **🌍 Export KML**: saves the flight path for Google Earth / GIS.
- **🎥 Record Clip**: pick a start/end range, tracker mode, satellite overlay, optional MMR video, and up to four graphs; the tool auto-plays the range and screen-records it to a **`.webm`** (progress pill + **■ Stop**). Great for briefing clips.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Archive dropdowns greyed out, **"API Offline"** | The noaa-recon-api is unreachable, so use **manual upload**. Auto-recovers when the API returns. See [API & Connectivity](docs/CONNECTIVITY.md). |
| A GOES option is greyed out | API offline, **or** the flight is outside that satellite's Earth-disk view (e.g. GOES-West for an Atlantic flight). Try the other GOES or MODIS/VIIRS. |
| Picked GOES but nothing shows | Products don't auto-select; pick one from **`Choose a product…`** first. |
| Auto-Sync lands on the wrong time | Click **🔄 Sync Now** again on a clear frame, hide other on-screen timestamps, or switch to **Manual**. |
| Charts/map not updating after a window change | Click **`Apply & Run`**. |
| Nothing plays | Load a file, then **`Apply & Run`**, then **`▶ Play`**. |
| Sluggish with satellite on | Let the pre-cache finish, or pre-cache ahead of time with **⤓ Locally Cache Satellites**. |

---

## Documentation

| Doc | Read it for |
| --- | --- |
| **[API & Connectivity](docs/CONNECTIVITY.md)** | What the external API does, how the app detects online vs. offline, and exactly what still works (and what's disabled) in each state. |
| **[CLAUDE.md](CLAUDE.md)** | Deep architecture / developer reference (code layout, rendering, sync engine, data model). |

---

## Running & deploying

- **No build step, no dependencies to install.** Open https://diegoxb07.github.io/AOCVisualizer/ in a browser, or serve the directory statically (`python3 -m http.server`, etc.). All libraries load from CDNs (Tailwind, Chart.js, Three.js, netcdfjs, Tesseract.js).
- **Deployment:** GitHub Pages via [.github/workflows/static.yml](.github/workflows/static.yml)
- **No test suite.** Verify changes by opening the page and exercising the upload → play flow.
