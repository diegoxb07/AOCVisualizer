# API & Connectivity

The NOAA AOC video telemetry tool is **client-only**: it parses your files and does all replay
locally. A few features, though, reach out to external services. This doc explains **what those
services are**, **how the tool decides it's online or offline**, and **exactly what still works
in each state**, so during a training or replay session you always know your options.

- [The external services](#the-external-services)
- [The noaa-recon-api](#the-noaa-recon-api)
- [How online/offline is detected](#how-onlineoffline-is-detected)
- [What works: online vs. offline](#what-works-online-vs-offline)
- [Using the tool when the API is offline](#using-the-tool-when-the-api-is-offline)
- [Recovery](#recovery)
- [Endpoint reference](#endpoint-reference)
- [FAQ](#faq)

---

## The external services

| Service | Used for | Required? |
| --- | --- | --- |
| **noaa-recon-api** (currently `https://joshmurdock.net/api`, planned move to a NOAA-internal host, see [Changing the API host](#changing-the-api-host)) | Archive flight loading (mission NetCDF plus storm best-track) and archive GOES satellite imagery | Only for archive load and GOES imagery |
| **NASA GIBS** | MODIS / VIIRS polar satellite overlays | Only for MODIS/VIIRS overlays |
| **GitHub-hosted GeoJSON** (Natural Earth plus US states) | Fallback for the map's coastline and state geometry if the repo's local copies fail | Fetched once at startup; map still runs if it fails |

There are **no CDNs**: all libraries, fonts, basemap data, and the Auto-Sync OCR engine ship in
the repo and are served same-origin. A **service worker** (`sw.js`) precaches the entire app on
the first visit, so the page itself, its scripts, fonts, coastlines, terrain, and OCR all load
with **no network at all** afterwards.

**None of your uploaded data is ever sent anywhere.** Files are read and parsed in the browser.
The requests above are for imagery, geometry, and the archive catalog only.

---

## The noaa-recon-api

The **noaa-recon-api** is a public, CORS-open service
([github.com/jjmurdock19/noaa-recon-api](https://github.com/jjmurdock19/noaa-recon-api)) that
does two jobs for this tool. Its requests carry a bearer token that ships embedded in the page
(`js/02-satellite.js`); like a publishable key it is meant to be visible, so nothing needs a
sign-in. A user with their own token can override it by setting `reconApiToken` in localStorage.

1. **Archive catalog plus flight data.** The Year/Storm/Flight browser is backed by its
   `/v1/recon/*` and `/v1/storms/*` endpoints. Loading a mission streams the original
   **full-resolution NetCDF** straight through the API (CORS-open), plus the storm's
   **whole-life best-track**.
2. **Archive GOES imagery.** It renders **GOES-East / GOES-West** ABI tiles **server-side from
   NOAA's AWS S3 archive**, auto-resolving the right spacecraft for the date (East: GOES-16/19,
   West: GOES-17/18). This is what makes GOES available for the *historical* dates recon flights
   fall on, which NASA GIBS does not serve.

Because it's actively developed, the tool **discovers** the available satellite products at
startup (`GET /v1/satellite/products`) rather than hardcoding them. New bands and composites
show up in the picker automatically, with no code change.

---

## How online/offline is detected

At startup (and every **60 seconds** while the tab is visible) the tool calls
`GET /v1/satellite/products`. That single call is the **health check**.

- **Success** means the API is marked **online**. Archive controls and GOES options are enabled,
  and the live product list replaces the built-in fallback.
- **Failure** (network error, non-2xx, empty payload) means the API is marked **offline**. All
  API-dependent controls are disabled and clearly labelled, and the tool steers you to manual
  upload.

There's **no manual "reconnect" button**. The 60-second re-check flips everything back on by
itself once the service recovers. (Reference: `loadSatelliteProducts()` and `setReconApiHealth()`
in `js/02-satellite.js`.)

### What "offline" looks like in the UI

- The **Year / Storm / Flight** dropdowns and **⤓ Load Flight + Storm Track** button go greyed
  out and unclickable.
- A **full-cover banner** appears over those controls: **"API Offline, ↑ use manual upload
  instead."**
- The **manual upload zone** is highlighted (blue ring) to draw your eye to it.
- In the satellite dropdown, **GOES-East/West** options are disabled and relabelled
  **"…API Offline."**
- The **Pre-Cache Satellite Imagery** modal disables GOES options the same way.

---

## What works: online vs. offline

| Capability | API online | API offline |
| --- | --- | --- |
| **Archive browser** (Year, Storm, Flight load) | Yes | No (disabled, "API Offline") |
| **Manual upload** (`.nc`, also `.txt`) | Yes | Yes |
| Replay: play/pause, speed, timeline sliding, 8 Hz smoothing | Yes | Yes |
| Map tracker (2D & 3D), track/barb colouring, markers | Yes | Yes |
| Charts plus "Create Your Own Graph" | Yes | Yes |
| PFD / HUD, units toggle | Yes | Yes |
| Measure / Mark / point analysis export | Yes | Yes |
| MMR video load plus sync (Auto-Sync/OCR and Manual) | Yes | Yes (all local) |
| **Record Clip** | Yes | Yes |
| **MODIS / VIIRS** satellite overlays (NASA GIBS) | Yes | Needs GIBS, independent of the recon-api |
| **GOES-East / GOES-West** archive imagery | Yes | No (disabled, "API Offline") |
| **TDR overlays** (2D layers and 3D columns) | Yes | No for new analyses and cross-sections; already-fetched ones keep showing |
| **Storm best-track** overlay | Yes (comes with archive load) | No for new loads; an already-loaded track stays until reset |
| **Batch satellite pre-cache** (GOES) | Yes | No (GOES disabled) |
| Imagery already in the **local cache** | Yes | Yes (served from cache, no fetch) |

**Bottom line:** the only things that truly need the recon-api are **archive flight loading**,
**archive GOES imagery** (and its caching), and the **storm-track overlay** that comes with an
archive load. Everything about replaying a flight you already have works fully offline.

---

## Using the tool when the API is offline

You can run a complete training or replay session with no API.

1. **Load the flight manually.** Drop a `.nc` file on the upload zone (the tool highlights it for
   you). This is the same parser the archive uses, so nothing downstream changes.
2. **Load the MMR video** and sync it (Auto-Sync or Manual). All local.
3. **Replay** with full controls, charts, PFD, measure, mark, and Record Clip.
4. **Satellite:** use **MODIS/VIIRS** if you have general internet (NASA GIBS), or rely on any
   imagery you cached earlier via **⤓ Pre-Cache Satellite Imagery**. GOES-archive is
   unavailable until the recon-api is back.

> Tip for field or limited-connectivity use: while you *do* have the API, use **⤓ Pre-Cache
> Satellite Imagery** to download the GOES imagery for the flights you'll present. Cached
> imagery plays back with no network, is saved on this device, and survives reloads.

---

## Recovery

Nothing to do. The tool re-runs the health check every ~60s (when the tab is visible). As soon as
`GET /v1/satellite/products` succeeds again:

- Archive dropdowns and the Load button re-enable (restoring whatever cascading state they had).
- The "API Offline" banner disappears and the upload zone highlight relaxes.
- GOES satellite options re-enable and the live product list refreshes.

If you can't wait, reloading the page also re-checks immediately.

---

## Endpoint reference

All under `RECON_API_BASE` (defined in `js/02-satellite.js`, currently `https://joshmurdock.net/api`).

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/satellite/products` | **Health check** plus discovery of available bands/composites and each spacecraft's active date range. |
| `GET /v1/satellite/tile?…` | Request a GOES tile render (async job). |
| `GET /v1/satellite/status/{key}` | Poll a tile job until `ready` (polled about every 3s, 30s cap). |
| `GET /v1/recon/*`, `GET /v1/storms/*` | Archive catalog: years, storms, missions, and best-tracks. |
| `GET /v1/recon/mission/{id}` | Mission metadata plus a 0.2 Hz-decimated track (the fallback path). |
| `GET /v1/recon/mission/{id}/download` | Streams the **full-resolution** mission NetCDF (CORS-open; the primary archive load path). |
| `GET /v1/tdr/mission/{id}`, `/v1/tdr/volume`, `/v1/tdr/plane_slice` | Tail Doppler Radar coverage, full reflectivity volumes for the radar overlays, and vertical cross-sections. |

> The API is the source of truth for available satellite products. New bands and composites need
> **no** client change; they appear in the picker on the next `products` fetch. Check the API repo
> or `API.md` (github.com/jjmurdock19/noaa-recon-api) before assuming a product is missing.

---

## Changing the API host

The recon API is planned to move from `joshmurdock.net` to a NOAA-internal host. Every fetch in
the app goes through the single `RECON_API_BASE` constant, so the swap is two edits:

1. **`RECON_API_BASE`** in `js/02-satellite.js`: point it at the new base URL (keep the `/api` path
   segment if the new deployment uses one).
2. **The CSP `<meta>` tag** in `index.html`: replace `https://joshmurdock.net` with the new origin
   in **both** `connect-src` and `img-src` (the browser blocks the new host silently otherwise).

Then update the host shown in this file and in the doc comments at the top of
`js/12b-recon-archive.js`, `js/01-state.js`, and `js/02-satellite.js`.

---

## FAQ

**Do my uploaded flight files get sent to the API?**
No. Files are parsed entirely in your browser. The API is only queried for the archive catalog,
archive NetCDF downloads (when *you* pick a mission), storm tracks, and satellite imagery.

**The archive worked this morning and now it's greyed out. Did I break something?**
No, that's the offline state. The health check failed (service hiccup or your network). Use manual
upload; it'll re-enable itself within ~60s of the service recovering, or on reload.

**Why can I pick MODIS/VIIRS but not GOES?**
MODIS/VIIRS come from **NASA GIBS**, a different service; GOES-archive comes from the
**noaa-recon-api**. If only the recon-api is down, MODIS/VIIRS still work.

**Why is one GOES option greyed out even when the API is online?**
The flight is outside that satellite's Earth-disk view (more than about 65° from its sub-point).
An Atlantic flight greys out GOES-West; an east-Pacific flight greys out GOES-East.

**Can I use this completely offline (no internet at all)?**
Yes, after one online visit. A service worker (`sw.js`) precaches the whole app on first load,
so the page opens with no network and manual upload, local replay, video sync (including
Auto-Sync OCR), charts, map coastlines/terrain, and every export all work. The only things that
still need connectivity are the network features themselves: archive loading, GOES imagery, and
storm tracks (recon-api) plus MODIS/VIIRS (NASA GIBS), unless you pre-cached imagery while
online. After a new version is deployed, the first page load still shows the previous build
while the update installs in the background; the following reload shows the new one.
