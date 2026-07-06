/* Parser QC checks: node tests/run-tests.js
   Flag-style, not fail-style: every check prints PASS or FLAG with the observed vs expected value,
   and the process always exits 0. A FLAG means a scientific judgment call in the parser no longer
   matches its independently computed expectation and should be looked at, not that the app is down.
   All fixtures are synthetic and built in this file; expected values come from physics constants
   and the format spec, never from a captured baseline. */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The parser core is a classic (non-module) script; evaluating it in this context turns its
// function declarations into globals, exactly like a <script> tag or importScripts does.
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', '11b-parser-core.js'), 'utf8'));
try { globalThis.netcdfjs = require(path.join(__dirname, '..', 'lib', 'netcdfjs.min.js')); } catch (e) { globalThis.netcdfjs = null; }

let passCount = 0; const flagged = [];
function check(name, actual, expected, tol) {
    let ok;
    if (typeof expected === 'number' && tol !== undefined) ok = typeof actual === 'number' && Math.abs(actual - expected) <= tol;
    else ok = actual === expected;
    if (ok) { passCount++; console.log('  PASS  ' + name); }
    else {
        flagged.push(name);
        console.log('  FLAG  ' + name + '  (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + (tol !== undefined ? ' within ' + tol : '') + ')');
    }
}
function section(title) { console.log('\n' + title); }

// TSV fixture builder. The parser requires 10+ tab fields per row, so short header sets are padded.
function tsv(headers, rows) {
    while (headers.length < 10) headers.push('X' + headers.length);
    return headers.join('\t') + '\n' + rows.map(r => { const c = r.slice(); while (c.length < headers.length) c.push(''); return c.join('\t'); }).join('\n') + '\n';
}
const H = ['HH', 'MM', 'SS', 'LATref', 'LONref', 'TASkt.d', 'WSkt.d', 'WD.d', 'ALTPA.d', 'TA.d'];

// ---------------------------------------------------------------------------------------------
section('Units and physics (expected values computed independently)');
{
    // Wind carried only as WS.d (m/s): the parser must convert with the exact m/s-to-knot factor.
    const MS_TO_KT = 3600 / 1852;   // knot = 1852 m/h by definition
    const r = parseFlightTextToRows(tsv(['HH', 'MM', 'SS', 'LATref', 'LONref', 'TASkt.d', 'WS.d', 'WD.d', 'ALTPA.d', 'TA.d'], [
        ['10', '0', '0', '20.000', '-60.000', '200', '50', '90', '3000', '20'],
        ['10', '0', '1', '20.001', '-60.001', '200', '50', '90', '3010', '20'],
    ]));
    check('rows parsed', r.rows.length, 2);
    check('wind 50 m/s converts to knots', r.rows[0].windSpd, 50 * MS_TO_KT, 0.01);
    check('m/s wind conversion is disclosed in stats', r.stats.derived.windFromMs, 2);
    check('computedVsi from pressure-altitude delta (10 m in 1 s)', r.rows[1].computedVsi, 10, 1e-9);
    check('absSeconds of 10:00:01', r.rows[1].absSeconds, 10 * 3600 + 1);
}
{
    // Pressure altitude derived from static pressure: 700 hPa sits near 3012 m in the ICAO
    // standard atmosphere (literature value, independent of the code's own constants).
    const r = parseFlightTextToRows(tsv(['HH', 'MM', 'SS', 'LATref', 'LONref', 'TASkt.d', 'PS.c', 'WD.d', 'X8', 'TA.d'], [
        ['12', '0', '0', '25.0', '-70.0', '210', '700', '90', '', '15'],
        ['12', '0', '1', '25.001', '-70.001', '210', '700', '90', '', '15'],
    ]));
    check('700 hPa derives ~3012 m (ICAO standard atmosphere)', r.rows[0].pAlt, 3012, 25);
    check('derived pressure altitude is disclosed in stats', r.stats.derived.pAltFromPressure, 2);
}
{
    // Mixing ratio unit guess: kg/kg values scale to g/kg; already-g/kg values pass through.
    const kg = parseFlightTextToRows(tsv(['HH', 'MM', 'SS', 'LATref', 'LONref', 'TASkt.d', 'MRkg.d', 'WD.d', 'X8', 'TA.d'], [
        ['10', '0', '0', '20.0', '-60.0', '200', '0.012', '90', '', '20'],
        ['10', '0', '1', '20.001', '-60.001', '200', '0.012', '90', '', '20'],
    ]));
    check('0.012 kg/kg scales to 12 g/kg', kg.rows[0].mixRate, 12, 1e-9);
    check('mixing-ratio scaling is disclosed in stats', kg.stats.derived.mixRateScaled, 2);
    const g = parseFlightTextToRows(tsv(['HH', 'MM', 'SS', 'LATref', 'LONref', 'TASkt.d', 'MR.d', 'WD.d', 'X8', 'TA.d'], [
        ['10', '0', '0', '20.0', '-60.0', '200', '12', '90', '', '20'],
        ['10', '0', '1', '20.001', '-60.001', '200', '12', '90', '', '20'],
    ]));
    check('12 g/kg passes through unscaled', g.rows[0].mixRate, 12, 1e-9);
    check('no scaling disclosed when input is already g/kg', g.stats.derived.mixRateScaled, 0);
}
{
    // Radar altitude carried only in feet converts with the exact international foot.
    const r = parseFlightTextToRows(tsv(['HH', 'MM', 'SS', 'LATref', 'LONref', 'TASkt.d', 'AltRaft.1', 'WD.d', 'X8', 'TA.d'], [
        ['10', '0', '0', '20.0', '-60.0', '200', '1000', '90', '', '20'],
        ['10', '0', '1', '20.001', '-60.001', '200', '1000', '90', '', '20'],
    ]));
    check('1000 ft radar altitude converts to 304.8 m', r.rows[0].radAlt, 304.8, 1e-6);
    check('feet conversion is disclosed in stats', r.stats.derived.radAltFromFeet, 2);
}

// ---------------------------------------------------------------------------------------------
section('Time handling');
{
    check('timeToSeconds(120000) is 43200', timeToSeconds('120000'), 43200);
    check('toHHMMSS(43200) is 120000', toHHMMSS(43200), '120000');
}
{
    // Midnight crossing: the clock wraps but absSeconds must keep increasing.
    const r = parseFlightTextToRows(tsv(H, [
        ['23', '59', '58', '20.000', '-60.000', '200', '50', '90', '3000', '20'],
        ['23', '59', '59', '20.001', '-60.001', '200', '50', '90', '3000', '20'],
        ['0', '0', '0', '20.002', '-60.002', '200', '50', '90', '3000', '20'],
        ['0', '0', '1', '20.003', '-60.003', '200', '50', '90', '3000', '20'],
    ]));
    check('all rows survive a midnight crossing', r.rows.length, 4);
    check('absSeconds continues past 86400', r.rows[3].absSeconds, 86401);
}
{
    // A generic 'time' column holding HHMMSS numbers.
    const r = parseFlightTextToRows(tsv(['time', 'LATref', 'LONref', 'TASkt.d', 'WD.d', 'TA.d'], [
        ['100000', '20.000', '-60.000', '200', '90', '20'],
        ['100001', '20.001', '-60.001', '200', '90', '20'],
    ]));
    check('HHMMSS time column decodes to 10:00:01', r.rows[1].absSeconds, 36001);
    check('HHMMSS time source is disclosed', r.stats.timeSource, 'HHMMSS numbers');
}
{
    // A 'time' column holding unix epoch seconds.
    const t0 = 1727000000;
    const d = new Date(t0 * 1000);
    const expect = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
    const r = parseFlightTextToRows(tsv(['time', 'LATref', 'LONref', 'TASkt.d', 'WD.d', 'TA.d'], [
        [String(t0), '20.000', '-60.000', '200', '90', '20'],
        [String(t0 + 1), '20.001', '-60.001', '200', '90', '20'],
    ]));
    check('epoch-seconds time column decodes to UTC clock', r.rows[0].absSeconds, expect);
    check('epoch time source is disclosed', r.stats.timeSource, 'epoch seconds');
}

// ---------------------------------------------------------------------------------------------
section('Row filters count what they drop');
{
    // Taxi filter: TAS below 60 kt.
    const r = parseFlightTextToRows(tsv(H, [
        ['10', '0', '0', '20.000', '-60.000', '30', '50', '90', '3000', '20'],
        ['10', '0', '1', '20.001', '-60.001', '200', '50', '90', '3000', '20'],
        ['10', '0', '2', '20.002', '-60.002', '200', '50', '90', '3000', '20'],
    ]));
    check('sub-60kt row dropped', r.rows.length, 2);
    check('taxi drop counted', r.stats.dropped.taxi, 1);
}
{
    // Dateline crossing survives (a realistic 1 Hz step), a genuine teleport is dropped and counted.
    const r = parseFlightTextToRows(tsv(H, [
        ['10', '0', '0', '20.000', '-179.999', '200', '50', '90', '3000', '20'],
        ['10', '0', '1', '20.001', '179.999', '200', '50', '90', '3000', '20'],
        ['10', '0', '2', '20.002', '179.997', '200', '50', '90', '3000', '20'],
        ['10', '0', '3', '20.500', '179.995', '200', '50', '90', '3000', '20'],
    ]));
    check('dateline crossing rows kept', r.rows.length, 3);
    check('0.5 degree teleport dropped as glitch', r.stats.dropped.glitch, 1);
    check('longitudes stay in [-180,180] after the crossing', r.rows[1].lon, 179.999, 1e-9);
}
{
    // Duplicate timestamps and hour-plus gaps.
    const r = parseFlightTextToRows(tsv(H, [
        ['10', '0', '0', '20.000', '-60.000', '200', '50', '90', '3000', '20'],
        ['10', '0', '0', '20.000', '-60.000', '200', '50', '90', '3000', '20'],
        ['10', '0', '1', '20.001', '-60.001', '200', '50', '90', '3000', '20'],
        ['13', '0', '0', '21.000', '-61.000', '200', '50', '90', '3000', '20'],
        ['13', '0', '1', '21.001', '-61.001', '200', '50', '90', '3000', '20'],
    ]));
    check('duplicate timestamp dropped and counted', r.stats.dropped.dupTime, 1);
    check('rows before a 3 hr gap discarded and counted', r.stats.dropped.gapReset, 2);
    check('post-gap rows survive', r.rows.length, 2);
}
{
    // -9999 fill sentinel reads as null, never as a value.
    const r = parseFlightTextToRows(tsv(H, [
        ['10', '0', '0', '20.000', '-60.000', '200', '50', '90', '3000', '-9999'],
        ['10', '0', '1', '20.001', '-60.001', '200', '50', '90', '3000', '20'],
    ]));
    check('-9999 temperature is null', r.rows[0].tempr, null);
}
{
    // A file with no recognizable time yields zero rows plus an explanation, not a mystery.
    const r = parseFlightTextToRows(tsv(['A', 'B', 'LATref', 'LONref', 'TASkt.d', 'WD.d'], [
        ['1', '2', '20.0', '-60.0', '200', '90'],
        ['1', '2', '20.0', '-60.0', '200', '90'],
    ]));
    check('unparseable file yields zero rows', r.rows.length, 0);
    check('missing time counted per line', r.stats.dropped.noTime, 2);
    check('summary line names the problem', summarizeParseStats(r.stats).includes('no valid time'), true);
}

// ---------------------------------------------------------------------------------------------
section('NetCDF path (minimal NetCDF-3 file built from the format spec)');
if (!globalThis.netcdfjs) {
    console.log('  SKIP  vendored netcdfjs did not load under node');
} else {
    // Classic NetCDF-3 (CDF-1), big-endian, no record dimension: header then fixed-size var data.
    function buildNc() {
        const head = [];
        const i32 = v => { const b = Buffer.alloc(4); b.writeInt32BE(v); return b; };
        const f32 = v => { const b = Buffer.alloc(4); b.writeFloatBE(v); return b; };
        const f64 = v => { const b = Buffer.alloc(8); b.writeDoubleBE(v); return b; };
        const name = s => { const b = Buffer.from(s, 'ascii'); const pad = (4 - (b.length % 4)) % 4; return Buffer.concat([i32(b.length), b, Buffer.alloc(pad)]); };
        const chars = s => { const b = Buffer.from(s, 'ascii'); const pad = (4 - (b.length % 4)) % 4; return Buffer.concat([b, Buffer.alloc(pad)]); };

        const N = 5;
        const vars = [
            { nm: 'LATref', atts: [], data: [20.0, 20.001, 20.002, 20.003, 20.004] },
            { nm: 'LONref', atts: [], data: [-60.0, -60.001, -60.002, -60.003, -60.004] },
            { nm: 'TASkt.d', atts: [], data: [200, 200, 200, 200, 200] },
            // Packed variable: raw shorts-as-floats with scale_factor 0.1 (unpacks 7000 -> 700 hPa).
            { nm: 'PS.c', atts: [{ nm: 'scale_factor', type: 6, buf: f64(0.1) }, { nm: 'add_offset', type: 6, buf: f64(0) }], data: [7000, 7000, 7000, 7000, 7000] },
            // Fill-valued variable: index 1 carries the sentinel and must come out null.
            { nm: 'TA.d', atts: [{ nm: '_FillValue', type: 5, buf: f32(-32768) }], data: [20, -32768, 21, 22, 23] },
        ];

        head.push(Buffer.from('CDF\x01', 'latin1'));
        head.push(i32(0));                                   // numrecs
        head.push(i32(0x0A), i32(1), name('obs'), i32(N));   // dim_list
        head.push(i32(0x0C), i32(1), name('TimeInterval'), i32(2), i32(17), chars('10:00:00-10:00:04'));   // gatt_list

        // var_list with placeholder begins, then patch once the header size is known.
        const varHead = [i32(0x0B), i32(vars.length)];
        const beginPatch = [];
        vars.forEach(v => {
            varHead.push(name(v.nm), i32(1), i32(0));         // one dim: obs
            varHead.push(i32(0x0C), i32(v.atts.length));
            v.atts.forEach(a => varHead.push(name(a.nm), i32(a.type), i32(1), a.buf));
            varHead.push(i32(5));                             // NC_FLOAT
            varHead.push(i32(N * 4));                         // vsize
            const b = i32(0); beginPatch.push(b); varHead.push(b);   // begin, patched below
        });
        const headerLen = Buffer.concat(head).length + Buffer.concat(varHead).length;
        let offset = headerLen;
        const dataChunks = [];
        vars.forEach((v, i) => {
            beginPatch[i].writeInt32BE(offset);
            v.data.forEach(x => dataChunks.push(f32(x)));
            offset += N * 4;
        });
        const buf = Buffer.concat([...head, ...varHead, ...dataChunks]);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }

    try {
        const r = parseFlightTextToRows(ncArrayBufferToTsv(buildNc()));
        check('nc rows decode', r.rows.length, 5);
        check('nc TimeInterval clock reconstructs 10:00:04 at the last row', r.rows[4].absSeconds, 10 * 3600 + 4);
        check('nc scale_factor unpacks 7000 raw to 700 hPa', r.rows[0].pressure, 700, 0.01);
        check('nc packed pressure derives standard-atmosphere altitude', r.rows[0].pAlt, 3012, 25);
        check('nc _FillValue row reads as null temperature', r.rows[1].tempr, null);
        check('nc unfilled temperature survives', r.rows[2].tempr, 21, 0.001);
    } catch (e) {
        check('NetCDF fixture decodes without error', String(e.message || e), 'no error');
    }
}

// ---------------------------------------------------------------------------------------------
console.log('\n' + (passCount + flagged.length) + ' checks: ' + passCount + ' passed, ' + flagged.length + ' flagged.');
if (flagged.length) {
    console.log('Flagged (parser behavior no longer matches its documented expectation):');
    flagged.forEach(f => console.log('  - ' + f));
}
process.exit(0);
