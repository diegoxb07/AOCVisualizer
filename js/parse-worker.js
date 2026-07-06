/* Mission Visualizer, flight-file parse worker.
   Runs the pure parser core off the main thread so a large .nc/.txt load never freezes the page.
   Receives { tsv } or { nc: ArrayBuffer } and posts back parseFlightTextToRows' { rows, stats },
   or { error } if the file can't be read. The ?v= cache-buster arrives via the worker URL's query
   string and is forwarded to the core import so both bust together. */
importScripts('../lib/netcdfjs.min.js', '11b-parser-core.js' + self.location.search);

self.onmessage = (e) => {
    try {
        const tsv = e.data.nc ? ncArrayBufferToTsv(e.data.nc) : e.data.tsv;
        self.postMessage(parseFlightTextToRows(tsv));
    } catch (err) {
        self.postMessage({ error: String((err && err.message) || err) });
    }
};
