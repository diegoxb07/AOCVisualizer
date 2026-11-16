# API & Connectivity

The Mission Visualizer runs **entirely in your browser**: it reads your files and does all the replay on your own machine, and only a few features need outside services. This page explains **what those services are**, **how the app checks whether it's online or offline**, and **exactly what you can still do in each case**, so you always know your options during a training or replay session.

- [The external services](#the-external-services)
- [The recon archive API](#the-recon-archive-api)
- [How the app checks the connection](#how-the-app-checks-the-connection)
- [What works: online vs. offline](#what-works-online-vs-offline)
- [Using the app when the API is offline](#using-the-app-when-the-api-is-offline)
- [When the API comes back](#when-the-api-comes-back)
- [Endpoint reference](#endpoint-reference)
- [FAQ](#faq)

---

## The external services

| Service | What it's for | Do you need it? |
| --- | --- | --- |
| **recon archive API** | Loading flights from the archive (the mission NetCDF plus the storm's best-track), archive GOES imagery, and TDR | Only for archive loading, GOES imagery, and TDR |
| **NASA GIBS** | MODIS / VIIRS polar satellite imagery | Only for MODIS/VIIRS imagery |
| **GitHub-hosted GeoJSON** (Natural Earth plus US states) | A backup copy of the coastline and state outlines in case the app's own copies fail to load | Fetched once at startup, and the map still works if it fails |

There are **no CDNs**: all the libraries, fonts, basemap data, and the Auto-Sync OCR engine are in the repo and served from the same site. A **service worker** (`sw.js`) saves the whole app on your first visit, so after that the page, its scripts, fonts, coastlines, terrain, and OCR all load with **no network at all**.

**Your uploaded files never leave your computer.** They're read and parsed in your browser, and the requests above are only for imagery, map outlines, and the archive catalog.

---

## The recon archive API

The **recon archive API** is a public service that does two jobs for the app. Its requests carry a token that's built into the page (`js/02-satellite.js`), and like a publishable key it's meant to be visible, so you never have to sign in. If you have your own token, you can use it by setting `reconApiToken` in localStorage.

1. **Archive catalog and flight data.** The Year/Storm/Flight browser runs on its `/v1/recon/*` and `/v1/storms/*` endpoints, and when you load a mission, the API streams the original **full-resolution NetCDF** to you along with the storm's **best-track for its whole life**.
2. **Archive GOES imagery.** It renders **GOES-East / GOES-West** ABI tiles **on the server from NOAA's AWS S3 archive**, picking the right satellite for the date (East: GOES-16/19, West: GOES-17/18). That's how you get GOES for the *past* dates recon flights were flown, which NASA GIBS doesn't provide.

Since the API is still being developed, the app **requests the list** of satellite products from the API at startup (`GET /v1/satellite/products`), so new bands show up in the picker with no code change.

---

## How the app checks the connection

When the app starts, and every **60 seconds** while the tab is visible, it calls `GET /v1/satellite/products`, and that one call is the **health check**.

- **If it succeeds**, the API is marked **online**, the archive controls and GOES options are turned on, and the live product list replaces the built-in fallback list.
- **If it fails** (a network error, an error status, or an empty response), the API is marked **offline**, every control that needs it is turned off and clearly labeled, and you're pointed to uploading your file yourself.

There's **no "reconnect" button** to press. The 60-second check turns everything back on as soon as the API responds again. (In the code: `loadSatelliteProducts()` and `setReconApiHealth()` in `js/02-satellite.js`.)

### What you'll see when it's offline

- The **Year / Storm / Flight** dropdowns, the search box, and **⤓ Load Flight + Storm Track** are greyed out and can't be clicked.
- An **"API Offline"** label covers those controls, with the upload box right next to it, enlarged and labeled **Upload:**, and the note "← upload a file manually while the API is offline" beside it.
- **⤓ Batch Load Flight Data** and **⤓ Pre-Cache Satellite Imagery** in the menu bar are greyed out.
- In the **Overlays** satellite list, the **GOES-East/West** options are turned off and labeled **"(API Offline)"**.

---

## What works: online vs. offline

| What you want to do | API online | API offline |
| --- | --- | --- |
| **Archive browser** (Year, Storm, Flight) | Yes | No (greyed out, "API Offline") |
| **Uploading a file yourself** (`.nc`, also `.txt`) | Yes | Yes |
| Replay: play/pause, speed, timeline, 8Hz Smoothing | Yes | Yes |
| Map tracker (2D and 3D), track and barb colors, markers | Yes | Yes |
| Charts and Create Your Own Graph | Yes | Yes |
| PFD, HUDs, and the units switch | Yes | Yes |
| Measure, Mark Point, and point reports | Yes | Yes |
| Loading and syncing an MMR video (Auto-Sync/OCR and Manual) | Yes | Yes (all on your machine) |
| **Record Clip** | Yes | Yes |
| **MODIS / VIIRS** satellite imagery (NASA GIBS) | Yes | Needs NASA GIBS, which is separate from the recon API |
| **GOES-East / GOES-West** archive imagery | Yes | No (greyed out, "API Offline") |
| **TDR** (2D layers and 3D columns) | Yes | No for new legs and cross-sections, though legs you already downloaded keep showing |
| **Storm best-track** | Yes (comes with an archive load) | No for new loads, though a track you already loaded stays until you open another flight |
| **Pre-caching satellite imagery** (GOES) | Yes | No (GOES greyed out) |
| Imagery you **already cached** | Yes | Yes (loaded from the cache) |

**In short:** you only truly need the recon API for **loading flights from the archive**, **archive GOES imagery** (and caching it), **TDR**, and the **storm best-track** that comes with an archive load. Replaying a flight you already have works completely offline.

---

## Using the app when the API is offline

You can run a full training or replay session with no API.

1. **Upload the flight yourself.** Drop a `.nc` file on the **Upload:** box next to the "API Offline" label. It goes through the same parser the archive uses, so everything after that works the same.
2. **Load the MMR video** and sync it with Auto-Sync or Manual Time Input, which all happens on your machine.
3. **Replay** with all the controls, charts, PFD, Measure, Mark Point, and Record Clip.
4. **Satellite:** use **MODIS/VIIRS** if you have regular internet (NASA GIBS), or any imagery you cached earlier with **⤓ Pre-Cache Satellite Imagery**, since GOES from the archive is unavailable until the recon API is back.

> Tip for the field or anywhere with poor internet: while you *do* have the API, use **⤓ Pre-Cache Satellite Imagery** to download the GOES imagery for the flights you'll present. Cached imagery plays back with no network, is saved on this device, and stays there after reloads.

---

## When the API comes back

You don't need to do anything. The app repeats the health check about every 60 seconds while the tab is visible, and as soon as `GET /v1/satellite/products` works again:

- The archive dropdowns and the Load button turn back on, in whatever state they were in before.
- The "API Offline" label goes away and the upload box goes back to its normal size and place.
- The GOES options turn back on and the live product list refreshes.

If you don't want to wait, reloading the page checks right away.

---

## Endpoint reference

All of these are under `RECON_API_BASE` (defined in `js/02-satellite.js`).

| Endpoint | What it's for |
| --- | --- |
| `GET /v1/satellite/products` | The **health check**, plus the list of available bands and each satellite's active date range. |
| `GET /v1/satellite/tile?...` | Requests a GOES tile render (a background job). |
| `GET /v1/satellite/status/{key}` | Checked about every 3 seconds until the tile job is `ready`, for up to 30 seconds. |
| `GET /v1/recon/*`, `GET /v1/storms/*` | The archive catalog: years, storms, missions, and best-tracks. |
| `GET /v1/recon/mission/{id}` | Mission details plus a 0.2 Hz reduced track (the fallback path). |
| `GET /v1/recon/mission/{id}/download` | Streams the **full-resolution** mission NetCDF (the main archive load path). |
| `GET /v1/tdr/mission/{id}`, `/v1/tdr/volume`, `/v1/tdr/plane_slice` | Tail Doppler Radar coverage, full reflectivity volumes for the radar overlay, and vertical cross-sections. |

> The API's product list sets which satellite products you can pick. New bands need **no** change in the app and show up in the picker the next time the list is fetched, so check the API's own docs before you assume a product is missing.

---

## Changing the API host

If the recon API ever moves to a new host, you only need two edits, because every request in the app goes through the single `RECON_API_BASE` constant:

1. **`RECON_API_BASE`** in `js/02-satellite.js`: point it at the new base URL (keep the `/api` path segment if the new server uses one).
2. **The CSP `<meta>` tag** in `index.html`: replace the current API origin (the value of `RECON_API_BASE`) with the new one in **both** `connect-src` and `img-src`, because otherwise the browser blocks the new host without showing an error.

After that, update the comments at the top of `js/12b-recon-archive.js`, `js/01-state.js`, and `js/02-satellite.js`.

---

## FAQ

**Do my uploaded flight files get sent to the API?**
No, your files are parsed entirely in your browser. The app only contacts the API for the archive catalog, archive NetCDF downloads (when *you* pick a mission), storm tracks, TDR, and satellite imagery.

**The archive worked this morning and now it's greyed out. Did I break something?**
No, that's the offline state, which means the health check failed because of a problem with the service or your network. Upload your file yourself in the meantime, and the archive turns back on within about 60 seconds of the service recovering, or when you reload.

**Why can I pick MODIS/VIIRS but not GOES?**
MODIS/VIIRS come from **NASA GIBS**, which is a different service, while archive GOES comes from the **recon archive API**, so if only the recon API is down, MODIS/VIIRS still work.

**Why is one GOES option greyed out even when the API is online?**
The flight is outside that satellite's view of the Earth (more than about 65° from the point below it), so an Atlantic flight greys out GOES-West and an east Pacific flight greys out GOES-East.

**Can I use this with no internet at all?**
Yes, after you've opened it online once. The service worker (`sw.js`) saves the whole app on that first load, so afterwards the page opens with no network, and uploading files, replay, video sync (including Auto-Sync OCR), charts, the map's coastlines and terrain, and every export all work. The only things that still need a connection are the network features themselves: archive loading, GOES imagery, TDR, and storm tracks (recon API), plus MODIS/VIIRS (NASA GIBS), unless you cached the imagery while you were online. After a new version is deployed, the first page load still shows the previous version while the update installs in the background, and the next reload shows the new one.
