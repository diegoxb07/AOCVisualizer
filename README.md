# Mission Visualizer

The **NOAA AOC** video telemetry tool replays flight-level instrument data together with synced cockpit / radar
(**MMR**) video, and adds a live map tracker, a full customizable graphs with tons of variables, a Primary Flight Display, satellite imagery overlays, storm best-track overlays, and KML / video clip export capabilities.

Built for the **NOAA Aircraft Operations Center**. Runs entirely in the browser, API-backend optional

- **Tool Link:** https://diegoxb07.github.io/AOCVisualizer/ (GitHub Pages)
- **Repository:** https://github.com/diegoxb07/AOCVisualizer

---

## What it's for

| Use case | What the tool gives you |
| --- | --- |
| **Training** | Replay a real mission at any speed, scrub to any moment, and watch the aircraft state (attitude, winds, altitude, speeds) change live on the map, PFD, and graphs all together with the MMR video synced alongside.You can also record clips in advance for presentations. |
| **Replay / analysis** | Load flight-level data (or pull a whole mission from the archive), trim to a time window, color the track by wind speed or temperature, drop measurement shapes, do point analyses, overlay GOES/MODIS/VIIRS satellite imagery for the flight's date, and export the track to KML. |
| **API-backed workflow** | A built-in **NOAA Recon Archive** browser (Year → Storm → Mission) loads full-resolution mission NetCDF and the storm's whole-life best-track automatically, and archive **GOES** satellite imagery is rendered on demand for the historical dates these flights fall on. |

---

## Quick start

1. **Open the app**: go to (https://diegoxb07.github.io/AOCVisualizer/).
2. **Get a flight in.** Either:
   - **Option 1: Server-side Archive (needs API to be up):** pick **Year → Storm → Flight**, then click
     **⤓ Load Flight + Storm Track**; or
   - **Option 2: Manual upload (always works):** drop the raw flight-level data in `.nc` (ex. 20221028H1_A.nc) or
     in the **"or upload"** zone.
3. **Optional: If you want to see a set period within that data, set the window.** Do this by adjusting the **Flight-Data Start / End Time** (`HHMMSS`).
4. **If window has been changed, Click `Apply & Run`**, then **`▶ Play`**. Use the speed `⏪ / ⏩` buttons and the
   timeline slider at the bottom to scrub through the footage.
5. **(Optional) Add MMR video, satellite, charts, export** — see the
   **[User & Training Guide](docs/USER_GUIDE.md)**.

> **First stop for most users:** the **[User & Training Guide](docs/USER_GUIDE.md)** walks
> through every panel step by step. If a satellite layer or the archive browser is greyed
> out, read **[API & Connectivity](docs/CONNECTIVITY.md)** , likely the case is the API is offline.

---

## Documentation

| Doc | Read it for |
| --- | --- |
| **[User & Training Guide](docs/USER_GUIDE.md)** | Step-by-step: loading data, replay controls, video sync, satellite overlays, storm tracks, measuring, markers, charts, and export. Written for training/replay sessions. |
| **[API & Connectivity](docs/CONNECTIVITY.md)** | What the external API does, how the app detects online vs. offline, and exactly what still works (and what's disabled) in each state. |
| **[CLAUDE.md](CLAUDE.md)** | Deep architecture / developer reference (code layout, rendering, sync engine, data model). |

---

## Feature overview

- **Two data paths:** one-click **archive** load (NetCDF + storm best-track,
  via the noaa-recon-api + 10-minute satellite data) or **manual** `.nc` upload (no 10-min satellite, no storm best-track)
- **Replay engine:** single-clock playback of `filteredData`, variable speed, timeline
  scrubbing, with the optional **8 Hz Catmull-Rom smoothing** for fluid motion filling between each 1s sample.
- **MMR video sync:** load a `.mp4` and sync it on default via **Auto-Sync (OCR)**, which reads the timestamp burned into the video frame,
- or it can be **Manually** (type the video's UTC start).
- **Map tracker (2D & 3D):**2D canvas map (whole world, coastlines/states, satellite imagery, wind-barbs) or a
  Three.js **3D WebGL** scene, both with the flight track coloured by wind speed or temperature,
  hurricane wind-field colouring, and custom markers.
- **Satellite overlays:** NASA GIBS **MODIS/VIIRS** (any date back to mission start) and
  archive **GOES-East / GOES-West** (rendered server-side from NOAA's AWS S3 archive for the
  historical flight date). Imagery advances with the playback clock; **⏪10m / ⏩10m** step it.
- **Storm best-track overlay:** the storm's whole-life intensity-coloured track (from the
  archive), with a "last observation" status card.
- **Charts:** a fixed collection (temperature, nav angles, flow angles, altitude, speeds, vertical
  winds/accel, pressure, thermodynamics) plus a **"Create Your Own Graph"** for arbitrary
  variable comparison.
- **PFD / HUD:** cockpit-style attitude indicator and a text telemetry box, both synced.
- **Tools:** distance/area **Measure** (polygon/circle/rectangle), **Mark Point** with
  point-data analysis export, **Imperial/metric** toggle.
- **Export:** **KML** flight path, and **Record Clip** (screen-captures an auto-played range
  with your chosen tracker/satellite/video/graphs to a `.webm`).
- **Offline resilience:** manual upload and everything you can do with an already-loaded
  flight keep working with no internet; only archive load and satellite imagery need the API.

---

## Running & deploying

- **No build step, no dependencies to install.** Open (https://diegoxb07.github.io/AOCVisualizer/) in a browser,
  or serve the directory statically (`python3 -m http.server`, etc.). All libraries load from
  CDNs (Tailwind, Chart.js, Three.js, netcdfjs, Tesseract.js).
- **Deployment:** GitHub Pages via
  [.github/workflows/static.yml](.github/workflows/static.yml) 
- **No test suite.** Verify changes by opening the page and exercising the
  upload → play flow.
