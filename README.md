# Mission Visualizer

A client-only web app for **NOAA Aircraft Operations Center (AOC)** hurricane-hunter
flight data. It replays flight-level instrument data together with synced cockpit / radar
(**MMR**) video, and adds a live map tracker, a full chart suite, a Primary Flight Display
(PFD), satellite imagery overlays, storm best-track overlays, and KML / video clip export.

Built for the **NOAA AOC Science Branch**. Runs entirely in the browser — no install, no
server, no accounts.

- **Live app:** https://diegoxb07.github.io/AOCVisualizer/ (GitHub Pages)
- **Repository:** https://github.com/diegoxb07/AOCVisualizer

---

## What it's for

| Use case | What the tool gives you |
| --- | --- |
| **Training** | Replay a real mission at controlled speed, scrub to any moment, and watch the aircraft state (attitude, winds, altitude, speeds) evolve on the map, PFD, and charts together — with the actual MMR cockpit/radar video synced alongside. Record narrated clips for briefings. |
| **Replay / analysis** | Load flight-level data (or pull a whole mission from the archive), trim to a time window, colour the track by wind speed or temperature, drop measurement shapes, mark points, overlay GOES/MODIS/VIIRS satellite imagery for the flight's date, and export the track to KML. |
| **API-backed workflows** | A built-in **NOAA Recon Archive** browser (Year → Storm → Mission) loads full-resolution mission NetCDF and the storm's whole-life best-track automatically, and archive **GOES** satellite imagery is rendered on demand for the historical dates these flights fall on. |

---

## Quick start

1. **Open the app** — go to the live URL above, or open [index.html](index.html) directly in
   a browser (or serve the folder with any static file server).
2. **Get a flight in.** Either:
   - **Archive (needs API online):** pick **Year → Storm → Flight**, then click
     **⤓ Load Flight + Storm Track**; or
   - **Manual upload (always works):** drop a `.txt` (tab-separated AOC flight-level log) or
     `.nc` (NetCDF) file on the **"or upload"** zone.
3. **Set the window (optional).** Adjust **Flight-Data Start / End Time** (`HHMMSS`).
4. **Click `Apply & Run`**, then **`▶ Play`**. Use the speed `⏪ / ⏩` buttons and the
   timeline slider at the bottom to scrub.
5. **(Optional) Add MMR video, satellite, charts, export** — see the
   **[User & Training Guide](docs/USER_GUIDE.md)**.

> **First stop for most users:** the **[User & Training Guide](docs/USER_GUIDE.md)** walks
> through every panel step by step. If a satellite layer or the archive browser is greyed
> out, read **[API & Connectivity](docs/CONNECTIVITY.md)** — it's almost always the API
> being offline, and manual upload still works.

---

## Documentation

| Doc | Read it for |
| --- | --- |
| **[User & Training Guide](docs/USER_GUIDE.md)** | Step-by-step: loading data, replay controls, video sync, satellite overlays, storm tracks, measuring, markers, charts, and export. Written for training/replay sessions. |
| **[API & Connectivity](docs/CONNECTIVITY.md)** | What the external API does, how the app detects online vs. offline, and exactly what still works (and what's disabled) in each state. |
| **[CLAUDE.md](CLAUDE.md)** | Deep architecture / developer reference (code layout, rendering, sync engine, data model). |

---

## Feature overview

- **Two data paths:** one-click **archive** load (full-resolution NetCDF + storm best-track,
  via the noaa-recon-api) or **manual** `.txt` / `.nc` upload — both go through the same
  parser, so everything downstream is identical.
- **Replay engine:** single-clock playback of `filteredData`, variable speed, timeline
  scrubbing, optional **8 Hz Catmull-Rom smoothing** for fluid motion between samples.
- **MMR video sync:** load a `.mp4` and sync it either **Manually** (type the video's UTC
  start) or via **Auto-Sync (OCR)**, which reads the timestamp burned into the video frame.
- **Map tracker (2D & 3D):** hand-rolled 2D canvas map (whole world, coastlines/states) or a
  Three.js **3D WebGL** scene, with the flight track coloured by wind speed or temperature,
  wind barbs, hurricane wind-field colouring, and custom markers.
- **Satellite overlays:** NASA GIBS **MODIS/VIIRS** (any date back to mission start) and
  archive **GOES-East / GOES-West** (rendered server-side from NOAA's S3 archive for the
  historical flight date). Imagery advances with the playback clock; **⏪10m / ⏩10m** step it.
- **Storm best-track overlay:** the storm's whole-life intensity-coloured track (from the
  archive), with a "last observation" status card.
- **Charts:** a fixed suite (temperature, nav angles, flow angles, altitude, speeds, vertical
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

- **No build step, no dependencies to install.** Open [index.html](index.html) in a browser,
  or serve the directory statically (`python3 -m http.server`, etc.). All libraries load from
  CDNs (Tailwind, Chart.js, Three.js, netcdfjs, Tesseract.js).
- **Deployment:** GitHub Pages via
  [.github/workflows/static.yml](.github/workflows/static.yml) — pushing to `main` uploads
  the repo as-is (no compile). The app is served from
  `https://diegoxb07.github.io/AOCVisualizer/`.
- **No lint/test suite.** Verify changes by opening the page and exercising the
  upload → play flow.

---

## Data & privacy

Everything runs **in your browser**. Uploaded files are parsed locally and never leave your
machine. The only outbound requests are to public services: map geometry (GitHub-hosted
GeoJSON), satellite imagery (NASA GIBS + the noaa-recon-api), and the archive endpoints. If
you have no connectivity, manual upload and local replay still work — see
**[API & Connectivity](docs/CONNECTIVITY.md)**.
