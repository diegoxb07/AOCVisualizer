# Mission Visualizer

This video telemetry tool replays flight-level instrument data together with synced radar
(**MMR**) video, and adds a live map tracker, fully customizable graphs with tons of variables, a Primary Flight Display, satellite imagery overlays, storm best-track overlays, and video clip ex[...]

Built for the **NOAA Aircraft Operations Center**. Runs entirely in the browser, API-backend optional.

- **Tool Link:** https://diegoxb07.github.io/AOCVisualizer/ (GitHub Pages)
- **Repository:** https://github.com/diegoxb07/AOCVisualizer

---

## Decision Flowchart

You can use this flowchart in case you are unsure of what to do:

```mermaid
flowchart TD
    START(["Open the app"]) --> ARCHIVE{"Archive dropdowns available?<br>(Year / Storm / Flight)"}
    ARCHIVE -- "Yes" --> LOADARC["Pick <b>Year → Storm → Flight</b><br>click <b>⤓ Load Flight + Storm Track</b><br>(full-res NetCDF + storm best-track)"]
    ARCHIVE -- "No, API Offline banner" --> UPLOAD["Drop your <b>.nc</b> file<br>on the <b>or upload:</b> zone"]
    LOADARC --> LOADED["Flight loaded: map, charts & PFD populate"]
    UPLOAD --> LOADED
    LOADED --> MMR{"Have an MMR video<br>for this flight?"}
    MMR -- "Yes" --> VIDEO["Drop the <b>.mp4</b> in <b>Upload MMR to Sync</b><br>Auto-Sync reads the burned-in timestamp<br>and the window auto-follows the video<br><b>Sync Now</b> forces a lock, or use Manual"]
    MMR --> SAT
    MMR -- "No" --> SAT{"Want satellite imagery<br>behind the 2D track?"}
    VIDEO --> SAT
    SAT -- "Yes" --> FROMARC{"Was the flight loaded from<br>the archive in step 1?"}
    FROMARC -- "Yes" --> SATGOES["<b>Sat:</b> dropdown → GOES East/West (archive)<br>pick a product to pre-cache the flight"]
    FROMARC -- "No" --> SATPOLAR["<b>Sat:</b> dropdown → a MODIS/VIIRS pass<br>(works for any date, no API needed)"]
    SAT -- "No" --> PLAY["<b>Play</b>, scroll through timeline, filters: change speed,<br>toggle 8Hz Smoothing / PFD / S.I Units"]
    SATGOES --> PLAY
    SATPOLAR --> PLAY
    PLAY --> EXPORT{"Need a deliverable?"}
    EXPORT -- "Briefing video" --> CLIP["Record Clip (.webm)"]
    EXPORT -- "No, just analyzing" --> DONE(["Done: measure, mark & compare freely"])

    classDef decision fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef data fill:#d1fae5,stroke:#059669,color:#064e3b
    classDef mmr fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
    classDef sat fill:#cffafe,stroke:#0891b2,color:#164e63
    classDef playback fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef term fill:#e2e8f0,stroke:#475569,color:#0f172a
    class ARCHIVE,MMR,WINDOW,SAT,FROMARC,EXPORT decision
    class LOADARC,UPLOAD,LOADED data
    class VIDEO,CLIP mmr
    class SATGOES,SATPOLAR sat
    class TRIM,PLAY playback
    class START,DONE term
    %% linkStyle numbers = edge definition order above; update them if edges are added or reordered
    linkStyle 1,6,8,12,13 stroke:#059669,stroke-width:2px
    linkStyle 2,7,9,14,15,20 stroke:#dc2626,stroke-width:2px
```

---

## What it's for

| Use case | What the tool gives you |
| --- | --- |
| **Training** | Replay a real mission at any speed, scrub to any moment, and watch the aircraft state (attitude, winds, altitude, speeds) change live on the map, PFD, and graphs all together with the[...]
| **Replay / analysis** | Load flight-level data (or pull a whole mission from the archive), trim to a time window, color the track by wind speed or temperature, drop measurement shapes, do point anal[...]
| **API-backed workflow** | A built-in **NOAA Recon Archive** browser (Year → Storm → Mission) loads full-resolution mission NetCDF and the storm's whole-life best-track automatically, and archive[...]

---

## 1. Loading a flight

> **Tip: preload flight data first.** Click **⤓ Preload Flight Data** after picking a year and check every mission you plan to look at. They download and parse once in the background, stay saved on this device, and then open instantly from the **Preloaded missions** list, so you can hop between multiple flights without waiting on processing (even after a page reload).

Both paths feed the **same** parser, so the map, charts, PFD, and export behave identically either way.

**Option 1: Archive browser (one-stop shop, needs the API online).** Pick **Year → Storm → Flight** in the top-left card, then click **⤓ Load Flight + Storm Track**. This streams the mission's f[...]

**Option 2: Manual upload (always works, no internet needed).** Drop a **`.nc`** file (e.g. `20221028H1_A.nc`) on the **"or upload:"** zone. Manually loaded fligh[...]

> Archive controls greyed out with an **"API Offline"** banner mean the archive service is unreachable, and one should use manual upload. It re-checks every ~60 s and can re-enable itself. Details: **[...]

---

## 2. Time window & replay controls

Set **Flight-Data Start / End Time** (`HHMMSS` UTC) to replay just a segment, and everything downstream (map, charts, PFD, timeline) renders only that window. Leave the detected range alone to replay [...]

With a synced MMR video loaded, the window auto-adjusts to the video's timeframe, so manual trimming mainly applies to data-only replay (or Manual sync mode).

All playback lives in the sticky bottom bar:

| Control | What it does |
| --- | --- |
| **`Apply & Run`** | Applies the time window and (re)initializes playback. |
| **`Play` / `Pause`** | Start / stop. |
| **`« / 1x / »`** | Playback speed. |
| **`↻ Reset`** | Jump back to the start of the window. |
| **Timeline slider** | Scrub anywhere; the UTC readout updates live. |
| **8Hz Smoothing** (map header) | Catmull-Rom interpolation between the native 1-second samples for fluid motion instead of stepping. Recommended for training. |

Keyboard: **Space** = play/pause, **← / →** = scrub (hold to accelerate), **Shift + ← / →** = jump 10 flight-minutes. Display preferences (units, tracker mode, track/barb colors, PFD, smoothin[...]

If an MMR video is loaded, the **video clock drives playback** and the telemetry follows it; otherwise the engine advances on its own clock.

---

## 3. The map tracker (2D & 3D)

Switch with the **2D Map Tracker / 3D WebGL Tracker** dropdown in the map header.

- **2D**: whole-world canvas map (coastlines, US states) with satellite imagery and **wind barbs**. Wheel to zoom, drag to pan; zoom out for synoptic context.
- **3D**: Three.js scene with terrain, a plane model, and the track drawn by altitude (GPS or pressure, selectable; defaults to GPS). Orbit/zoom with the mouse.

Options (bottom bar): **Track Color** (wind speed or warming/cooling), **Wind Barb Color** (wind speed or hurricane wind field), **3D Track Altitude** (GPS or pressure altitude for the 3D height, inde[...]

> **Note on Hurricane Wind Field coloring:** barbs (and the track, in that mode) stay **black** until the flight-level data records hurricane-force winds; color only appears at **64 kt and above**, st[...]

**Measure & mark:** **Measure** (map header) draws polygon/circle/rectangle for distance & area; **Mark Point** (bottom bar) drops a marker at the current position. Click a marked point to o[...]

---

## 4. MMR video sync

Load a cockpit/radar **`.mp4`** in **Upload MMR to Sync**. Two sync modes:

- **Auto-Sync (default)**: OCR reads the timestamp **burned into the video frame** and aligns automatically. A green pulse means OCR is active; a non-blocking "Syncing…" pill shows while it hunts. C[...]
- **Manual Time Input**: type the video's UTC start time in **MMR Start Time** (`HHMMSS`). Simple and reliable when you already know it.

---

## 5. Satellite overlays

Pick a layer from the **Sat:** dropdown in the map header (options auto-populate from the flight's date and location).

- **MODIS / VIIRS (polar, NASA GIBS)**: any date back to each mission's start. Keyed to a calendar day; a **day-stepper** moves between days and overpass times are looked up automatically.
- **GOES-East / GOES-West (archive, needs API)**: rendered server-side from NOAA's S3 archive for the flight's **historical** date. Pick a **product** from the `Choose a product…` picker (spectral b[...]
- **⤓ Pre-Cache Satellite Imagery** (top card) pre-downloads imagery for **multiple flights** at once; the cache lasts until the tab closes.

Current GOES archive products (the picker auto-discovers these from the API, so new ones appear without an app update):

- **Band 3**: Veggie (Vegetation/NIR, 0.86 µm), daytime land and low-cloud contrast
- **Band 5**: Near-IR (Snow/Ice, 1.6 µm), separates ice cloud from water cloud
- **Band 7**: Shortwave IR ("Fire Temperature", 3.9 µm), low cloud and fog at night
- **Band 9**: Mid-Level Water Vapor (6.9 µm), moisture, dry slots, shear
- **Band 13**: Clean IR Window (10.3 µm), cloud-top temperature day or night; also offered as **IR Enhanced (ir4)** and **BD Curve (Dvorak)** variants
- **Sandwich** (composite): Band 13 IR color over visible texture, best for daytime convection
- **GeoColor** (composite): true color by day, IR by night

---

## 6. Storm best-track overlay

Archive loads automatically draw the storm's **whole-life**, intensity-colored, dashed best-track on both trackers. Toggle it with the **Storm Track** checkbox; the **Last Storm Observation** car[...]

---

## 7. Charts, PFD & HUD

Eight synced charts (temperature, nav angles, flow angles, altitude, speeds, vertical speeds/accel, pressure, thermodynamics) track the playback moment: **↺** resets zoom, **＋** adds/removes serie[...] 

Filters (bottom bar): **Cockpit PFD** (a G1000-style primary flight display: attitude ladder, airspeed/altitude/heading tapes, VSI, a bank scale with a **slip/skid indicator**, wind box, ground-track [...]

**8 Hz Smoothing** (map header) interpolates between the 1-second samples for fluid playback. The small sub-second motion it adds is turbulence-aware, scaled to the recorded vertical wind, so calm leg[...]

**Crew Ride** (filters, *experimental*) is an optional novelty: seatbelted crew figures that lean with the flight's *real* lateral G and roll, **float** up against the belt in negative-G, **hunch** do[...]

---

## 8. Exporting

- **Record Clip**: pick a start/end range, tracker mode, satellite overlay, optional MMR video, and up to four graphs; the tool auto-plays the range and screen-records it to a **`.webm`** (progre[...]

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Archive dropdowns greyed out, **"API Offline"** | The noaa-recon-api is unreachable, so use **manual upload**. Auto-recovers when the API returns. See [API & Connectivity](docs/CONNECTIVITY.md). |
| A GOES option is greyed out | API offline, **or** the flight is outside that satellite's Earth-disk view (e.g. GOES-West for an Atlantic flight). Try the other GOES or MODIS/VIIRS. |
| Picked GOES but nothing shows | Products don't auto-select; pick one from **`Choose a product…`** first. |
| Auto-Sync lands on the wrong time | Click **Sync Now** again on a clear frame, hide other on-screen timestamps, or switch to **Manual**. |
| Charts/map not updating after a window change | Click **`Apply & Run`**. |
| Nothing plays | Load a file, then **`Apply & Run`**, then **`Play`**. |
| Sluggish with satellite on | Let the pre-cache finish, or pre-cache ahead of time with **⤓ Pre-Cache Satellite Imagery**. |

---

## Documentation

| Doc | Read it for |
| --- | --- |
| **[API & Connectivity](docs/CONNECTIVITY.md)** | What the external API does, how the app detects online vs. offline, and exactly what still works (and what's disabled) in each state. |

---

## Running & deploying

- **No build step, no dependencies to install.** Open https://diegoxb07.github.io/AOCVisualizer/ in a browser, or serve the directory statically (`python3 -m http.server`, etc.). All libraries, fonts,[...]
- **Deployment:** GitHub Pages via [.github/workflows/static.yml](.github/workflows/static.yml)
- **No test suite.** Verify changes by opening the page and exercising the upload → play flow.

---

## Appendix: flight-level variables & sensors

AOC flight-level files carry **hundreds** of columns, but this visualizer reads only the quality-controlled subset it needs to plot: position, GPS/pressure/radar altitude, D-value, pressures, temperat[...]

Most raw columns come in **redundant sensors** (`.1`, `.2`, `.3` …), and after each flight a quality-assurance pass picks the best one as the **reference** (the `ref` suffix, e.g. `THDGref`, `LATref[...]

Everything is **metric by default**; the **Imperial Units** filter converts (m→ft, m/s→mph, °C→°F), while knots and nautical miles are never converted. A variable that isn't present in the upl[...]

> The app also carries an internal dictionary of the full raw-variable set (`js/00-var-catalog.js`) that it does **not** yet use for playback. It's groundwork for a future **Quality-Check mode** that [...]
