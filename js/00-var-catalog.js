/* Mission Visualizer - Raw flight-level variable catalog (INERT background data)
   Part of index.html, split into modules so a failure in one file does not break the others.
   Loaded FIRST as a classic (non-module) script; shares the one global scope like every other part.

   WHAT THIS IS
   A dictionary of the raw AOC flight-level variables that actually appear in the tab-separated
   .txt / NetCDF logs (P-3 as of 2026-07-04; the G-IV is similar but has more faulty sensors, and
   future aircraft will differ). It is NOT wired into playback - the visualizer still reads only the
   handful of QC'd fields the parser pulls (js/12-file-parsing.js) into METRIC_DEFS. This catalog
   exists so the app has an internal model of everything that IS in a flight, and as scaffolding for
   a future Quality-Check (QC) mode that would: list every variable present, cross-compare the
   redundant sensors of one measurement, flag aberrant data (gaps, spikes, sensor disagreement),
   and help pick which sensor should become the post-flight 'ref'.

   UNITS ARE NOT AUTHORITATIVE for any family whose `used` key is '' (empty). Units for the families
   the visualizer already plots are confirmed correct (they render right today); every other unit
   here is a LOGICAL DEDUCTION from the naming + physics and is flagged unitConf:'assumed' until it
   is checked against real sample values. Some names in the source notes also disagree with the true
   column names (naming inconsistencies are expected); this catalog follows the ACTUAL column names.
   Variables come and go year to year - nothing here is guaranteed to be present in any given file. */

    // Sensor / suffix naming conventions used throughout the raw columns.
    const RAW_VAR_CONVENTIONS = {
        '.d': 'derived value (computed from other channels)',
        '.c': 'corrected value',
        '.<N>': 'redundant sensor index: .1 .2 .3 ... each N is a separate physical sensor of the same quantity',
        'ref': 'the sensor chosen post-flight to best represent that quantity (the quality-assured reference)',
        'I': 'INE - Inertial Navigation Equipment derived (e.g. PitchI, RollI, GsXI)',
        'I-GPS': 'blended INE + GPS solution',
        'GPS': 'GPS receiver channel',
        'ADDU': 'Air Data Distribution Unit (air-data computer feed: TasADDU, AltPaADDU, ...)',
        'AAD': 'Air-data / AoA sensor housekeeping (checksums, QC volts, status bits)',
        'DS_': 'dropsonde channel (indices .1-.8 = successive drops in the record)',
        'Sfmr / ASfmr': 'Stepped-Frequency Microwave Radiometer - surface wind speed & rain rate',
        'kt / ft suffix': 'an explicit-unit variant of a metric base (e.g. TASkt.d = TAS in knots, ALTPAft.d = pressure alt in feet)'
    };

    // Compact rows: [base, description, unit, category, usedKey]
    //   unit     = the metric/native unit this family carries (deduced unless confirmed)
    //   category = coarse grouping for the QC tool's variable browser
    //   usedKey  = METRIC_DEFS key derived from this family, or '' if unused
    // A family collapses all its sensor indices (TTM covers TTM.1/.3/.4) into one comparison unit.
    const RAW_VAR_ROWS = [
        // --- time ---
        ['Time', 'Seconds since file start / time base', 's', 'time', ''],
        ['HH', 'UTC hour', 'h', 'time', ''],
        ['MM', 'UTC minute', 'min', 'time', ''],
        ['SS', 'UTC second', 's', 'time', ''],
        ['MDSHOUR', 'Mission Data System UTC hour', 'h', 'time', ''],
        ['MDSMINUTE', 'Mission Data System UTC minute', 'min', 'time', ''],
        ['MDSSECOND', 'Mission Data System UTC second', 's', 'time', ''],

        // --- position (lat/lon + the chosen references) ---
        ['LATref', 'Latitude, reference sensor (links to best LatGPS.x)', 'deg', 'position', ''],
        ['LONref', 'Longitude, reference sensor (links to best LonGPS.x)', 'deg', 'position', ''],
        ['ALTref', 'GPS altitude MSL, reference sensor (links to best AltGPS.x)', 'm', 'position', 'gpsAlt'],
        ['LatGPS', 'GPS latitude', 'deg', 'position', ''],
        ['LonGPS', 'GPS longitude', 'deg', 'position', ''],
        ['LatFGPS', 'GPS latitude (filtered)', 'deg', 'position', ''],
        ['LonFGPS', 'GPS longitude (filtered)', 'deg', 'position', ''],
        ['AltGPS', 'GPS altitude (mean sea level)', 'm', 'altitude', 'gpsAlt'],
        ['LatI', 'INE latitude', 'deg', 'position', ''],
        ['LonI', 'INE longitude', 'deg', 'position', ''],
        ['AltI', 'INE inertial altitude', 'm', 'altitude', ''],

        // --- attitude & heading (+ their references) ---
        ['THDGref', 'True heading, reference sensor', 'deg', 'attitude', 'th'],
        ['THdgI', 'INE true heading', 'deg', 'attitude', 'th'],
        ['ROLLref', 'Roll angle, reference sensor', 'deg', 'attitude', 'roll'],
        ['RollI', 'INE roll angle', 'deg', 'attitude', 'roll'],
        ['PITCHref', 'Pitch angle, reference sensor', 'deg', 'attitude', 'pitch'],
        ['PitchI', 'INE pitch angle', 'deg', 'attitude', 'pitch'],
        ['TrkI', 'INE ground track angle', 'deg', 'attitude', 'gTrack'],
        ['TrkGPS', 'GPS ground track angle', 'deg', 'attitude', 'gTrack'],
        ['TRK', 'Track angle (derived)', 'deg', 'attitude', 'gTrack'],
        ['TRKdesired', 'Desired track angle', 'deg', 'attitude', ''],
        ['COURSEcorr', 'Course correction', 'deg', 'attitude', ''],
        ['DAI', 'INE drift angle', 'deg', 'attitude', 'driftAngle'],
        ['DA', 'Drift angle (derived)', 'deg', 'attitude', 'driftAngle'],

        // --- angular rates ---
        ['YawRateI', 'INE yaw rate', 'deg/s', 'rates', ''],
        ['YAWRATEref', 'Yaw rate, reference sensor', 'deg/s', 'rates', ''],
        ['RollRateI', 'INE roll rate', 'deg/s', 'rates', ''],
        ['PitchRateI', 'INE pitch rate', 'deg/s', 'rates', ''],
        ['TrkRateI', 'INE track rate', 'deg/s', 'rates', ''],

        // --- ground speed / velocity components (+ references) ---
        ['GsI', 'INE ground speed', 'm/s', 'velocity', ''],
        ['GsGPS', 'GPS ground speed', 'm/s', 'velocity', ''],
        ['GsGPSkt', 'GPS ground speed', 'kt', 'velocity', ''],
        ['GsIkt', 'INE ground speed', 'kt', 'velocity', ''],
        ['GsXI', 'INE X (east) ground velocity', 'm/s', 'velocity', ''],
        ['GsYI', 'INE Y (north) ground velocity', 'm/s', 'velocity', ''],
        ['GsZI', 'INE Z (vertical) ground velocity', 'm/s', 'velocity', ''],
        ['GsXGPS', 'GPS X (east) ground velocity', 'm/s', 'velocity', ''],
        ['GsYGPS', 'GPS Y (north) ground velocity', 'm/s', 'velocity', ''],
        ['GsZGPS', 'GPS Z (vertical) ground velocity', 'm/s', 'velocity', ''],
        ['GsXGPSkt', 'GPS X ground velocity', 'kt', 'velocity', ''],
        ['GsYGPSkt', 'GPS Y ground velocity', 'kt', 'velocity', ''],
        ['GsXIkt', 'INE X ground velocity', 'kt', 'velocity', ''],
        ['GsYIkt', 'INE Y ground velocity', 'kt', 'velocity', ''],
        ['GsZGPSft', 'GPS vertical ground velocity', 'ft/min?', 'velocity', ''],
        ['GsZIft', 'INE vertical ground velocity', 'ft/min?', 'velocity', ''],
        ['GSXref', 'X ground velocity, reference', 'm/s', 'velocity', ''],
        ['GSYref', 'Y ground velocity, reference', 'm/s', 'velocity', ''],
        ['GSZref', 'Z ground velocity, reference', 'm/s', 'velocity', ''],
        ['UIZ', 'Vertical ground speed (derived)', 'm/s', 'velocity', ''],

        // --- acceleration (+ reference) ---
        ['AccAXI', 'Aircraft longitudinal acceleration', 'm/s2', 'accel', ''],
        ['AccAYI', 'Aircraft lateral acceleration', 'm/s2', 'accel', ''],
        ['AccAZI', 'Aircraft normal (vertical) acceleration', 'm/s2', 'accel', ''],
        ['AccZI', 'INE Z acceleration', 'm/s2', 'accel', 'accZ'],
        ['ACCZref', 'Vertical acceleration, reference sensor', 'm/s2', 'accel', 'accZ'],

        // --- airspeed & Mach ---
        ['TAS', 'True airspeed (derived)', 'm/s', 'airspeed', 'tas'],
        ['TASkt', 'True airspeed', 'kt', 'airspeed', 'tas'],
        ['TASref', 'True airspeed, reference', 'm/s', 'airspeed', 'tas'],
        ['TasADDU', 'True airspeed (air-data unit)', 'kt', 'airspeed', 'tas'],
        ['TasADDUkt', 'True airspeed (air-data unit)', 'kt', 'airspeed', 'tas'],
        ['IAS', 'Indicated airspeed (derived)', 'm/s', 'airspeed', 'ias'],
        ['IASkt', 'Indicated airspeed', 'kt', 'airspeed', 'ias'],
        ['IasADDU', 'Indicated airspeed (air-data unit)', 'kt', 'airspeed', 'ias'],
        ['CasADDU', 'Calibrated airspeed (air-data unit)', 'kt', 'airspeed', 'ias'],
        ['CasADDUkt', 'Calibrated airspeed (air-data unit)', 'kt', 'airspeed', 'ias'],
        ['MACH', 'Mach number (derived)', 'Mach', 'airspeed', ''],
        ['MACH_SQ', 'Mach number squared', 'Mach2', 'airspeed', ''],
        ['MachADDU', 'Mach number (air-data unit)', 'Mach', 'airspeed', ''],
        ['AltRateADDU', 'Altitude rate (air-data unit)', 'm/s', 'velocity', ''],

        // --- pressure & pressure-altitude (+ references) ---
        ['PS', 'Corrected static pressure', 'mb', 'pressure', 'pressure'],
        ['PSM', 'Static pressure transducer', 'mb', 'pressure', 'pressure'],
        ['PSMref', 'Static pressure, reference sensor', 'mb', 'pressure', 'pressure'],
        ['PQ', 'Corrected dynamic pressure', 'mb', 'pressure', ''],
        ['PQM', 'Dynamic pressure transducer', 'mb', 'pressure', ''],
        ['PQMref', 'Dynamic pressure, reference sensor', 'mb', 'pressure', ''],
        ['PtADDU', 'Total pressure (air-data unit)', 'mb', 'pressure', ''],
        ['ALTPA', 'Pressure altitude (fuselage)', 'm', 'altitude', 'pAlt'],
        ['ALTPAft', 'Pressure altitude (fuselage)', 'ft', 'altitude', 'pAlt'],
        ['AltPaADDU', 'Pressure altitude (air-data unit)', 'ft', 'altitude', 'pAlt'],
        ['AltPaADDUft', 'Pressure altitude (air-data unit)', 'ft', 'altitude', 'pAlt'],
        ['AltBCADDU', 'Baro-corrected altitude (air-data unit)', 'ft', 'altitude', ''],
        ['AltBCADDUft', 'Baro-corrected altitude (air-data unit)', 'ft', 'altitude', ''],
        ['AltIft', 'INE inertial altitude', 'ft', 'altitude', ''],
        ['AltGPSft', 'GPS altitude', 'ft', 'altitude', ''],
        ['DV', 'D-value: true altitude minus pressure altitude', 'm', 'altitude', 'dValue'],
        ['DIFF', 'Difference/QC channel (context-dependent)', '?', 'derived', ''],
        ['GDIFF', 'Geoid / GPS altitude difference', 'm', 'altitude', ''],
        ['HT', 'Height of standard pressure surface', 'm', 'altitude', ''],
        ['GS', 'Height of standard surface pressure (derived)', 'm', 'altitude', ''],
        ['ALTGA', 'Geopotential altitude', 'm', 'altitude', ''],

        // --- radar altimeter ---
        ['AltRa', 'Radar altimeter altitude', 'm', 'altitude', 'radAlt'],
        ['AltRa1', 'Corrected radar altimeter', 'm', 'altitude', 'radAlt'],
        ['AltRaft', 'Radar altimeter altitude', 'ft', 'altitude', 'radAlt'],
        ['AltRaValid', 'Radar altimeter validity flag', 'flag', 'sensor', ''],

        // --- temperature & thermodynamics ---
        ['TA', 'Ambient (static) air temperature', 'degC', 'temp', 'tempr'],
        ['TAkelvin', 'Ambient air temperature', 'K', 'temp', ''],
        ['TaADDU', 'Static air temperature (air-data unit)', 'degC', 'temp', 'tempr'],
        ['TtADDU', 'Total air temperature (air-data unit)', 'degC', 'temp', ''],
        ['TTkelvin', 'Total air temperature', 'K', 'temp', ''],
        ['TTM', 'Total temperature sensor (w/ amplifier)', 'degC', 'temp', ''],
        ['TTMref', 'Total temperature, reference sensor', 'degC', 'temp', ''],
        ['TDM', 'Dewpointer', 'degC', 'moisture', 'dewpt'],
        ['TDMref', 'Dewpoint, reference sensor', 'degC', 'moisture', 'dewpt'],
        ['TDMfilter', 'Dewpointer (filtered)', 'degC', 'moisture', ''],
        ['TD', 'Corrected dew point', 'degC', 'moisture', 'dewpt'],
        ['TVIRT', 'Virtual temperature', 'K', 'temp', ''],
        ['THETA', 'Potential temperature', 'K', 'temp', ''],
        ['THETAV', 'Virtual potential temperature', 'K', 'temp', ''],
        ['THETAE', 'Equivalent potential temperature', 'K', 'temp', 'thetaE'],
        ['SST', 'Sea surface temperature', 'degC', 'ocean', ''],

        // --- moisture ---
        ['EW', 'Saturation vapor pressure', 'mb', 'moisture', ''],
        ['EE', 'Vapor pressure', 'mb', 'moisture', ''],
        ['HUM_REL', 'Relative humidity', '%', 'moisture', ''],
        ['HUM_SPEC', 'Specific humidity', 'g/kg', 'moisture', ''],
        ['HUM_ABS', 'Absolute humidity', 'g/m3', 'moisture', ''],
        ['MR', 'Mixing ratio', 'g/kg', 'moisture', 'mixRate'],
        ['MRkg', 'Mixing ratio', 'kg/kg', 'moisture', 'mixRate'],

        // --- gas properties (derived constants) ---
        ['RGAS', 'Gas constant for mixed air', 'J/(kg K)', 'derived', ''],
        ['SPHEATCP', 'Specific heat of mixed air (const pressure)', 'J/(kg K)', 'derived', ''],
        ['GM', 'Ratio of specific heats', '', 'derived', ''],
        ['GO', 'Ratio of specific heats minus 1', '', 'derived', ''],

        // --- wind ---
        ['WS', 'Horizontal wind speed (derived)', 'm/s', 'wind', 'windSpd'],
        ['WSkt', 'Horizontal wind speed', 'kt', 'wind', 'windSpd'],
        ['WsI', 'INE horizontal wind speed', 'm/s', 'wind', 'windSpd'],
        ['WsIkt', 'INE horizontal wind speed', 'kt', 'wind', 'windSpd'],
        ['WD', 'Horizontal wind direction', 'deg', 'wind', 'windDir'],
        ['WdI', 'INE horizontal wind direction', 'deg', 'wind', 'windDir'],
        ['UWX', 'Horizontal wind, X (east) component', 'm/s', 'wind', ''],
        ['UWY', 'Horizontal wind, Y (north) component', 'm/s', 'wind', ''],
        ['UWZ', 'Vertical wind (Z component)', 'm/s', 'wind', 'vtWnd'],
        ['UTAN', 'Tangential wind', 'm/s', 'wind', ''],
        ['URAD', 'Radial wind', 'm/s', 'wind', ''],

        // --- flow angles & radome/fuselage air-data sensors ---
        ['AA', 'Attack angle (angle of attack)', 'deg', 'flowangle', 'alpha'],
        ['AAref', 'Angle of attack, reference sensor', 'deg', 'flowangle', 'alpha'],
        ['AaADDU', 'Angle of attack (air-data unit)', 'deg', 'flowangle', 'alpha'],
        ['SA', 'Side-slip angle', 'deg', 'flowangle', 'beta'],
        ['SAref', 'Side-slip angle, reference sensor', 'deg', 'flowangle', 'beta'],
        ['PDALPHA', 'Radome differential attack pressure', 'mb', 'flowangle', 'alpha'],
        ['PDALPHAref', 'Radome differential attack pressure, reference', 'mb', 'flowangle', 'alpha'],
        ['PDBETA', 'Radome differential sideslip pressure', 'mb', 'flowangle', 'beta'],
        ['PDBETAref', 'Radome differential sideslip pressure, reference', 'mb', 'flowangle', 'beta'],
        ['PQALPHA', 'Fuselage differential attack pressure', 'mb', 'flowangle', ''],
        ['PQALPHAref', 'Fuselage differential attack pressure, reference', 'mb', 'flowangle', ''],
        ['PQBETA', 'Fuselage differential sideslip pressure', 'mb', 'flowangle', ''],
        ['PQBETAref', 'Fuselage differential sideslip pressure, reference', 'mb', 'flowangle', ''],

        // --- air-data sensor housekeeping (AAD*) & transducer volts (QC-only) ---
        ['AADChecksum', 'Air-data sensor checksum', '', 'sensor', ''],
        ['AADQC1Volt', 'Air-data QC voltage 1', 'V', 'sensor', ''],
        ['AADQC2Volt', 'Air-data QC voltage 2', 'V', 'sensor', ''],
        ['AADGroundVolt', 'Air-data ground voltage', 'V', 'sensor', ''],
        ['AADStatus1', 'Air-data status word 1', 'bits', 'sensor', ''],
        ['AADStatus2', 'Air-data status word 2', 'bits', 'sensor', ''],
        ['PSMVolt', 'Static pressure transducer voltage', 'V', 'sensor', ''],
        ['PQMVolt', 'Dynamic pressure transducer voltage', 'V', 'sensor', ''],
        ['TTMVolt', 'Total temperature transducer voltage', 'V', 'sensor', ''],
        ['TDMVolt', 'Dewpointer transducer voltage', 'V', 'sensor', ''],
        ['PDALPHAVolt', 'Radome attack transducer voltage', 'V', 'sensor', ''],
        ['PDBETAVolt', 'Radome sideslip transducer voltage', 'V', 'sensor', ''],
        ['PQALPHAVolt', 'Fuselage attack transducer voltage', 'V', 'sensor', ''],
        ['PQBETAVolt', 'Fuselage sideslip transducer voltage', 'V', 'sensor', ''],

        // --- SFMR (surface wind & rain) ---
        ['SfmrWS', 'SFMR surface wind speed', 'kt', 'sfmr', ''],
        ['SFMRWSref', 'SFMR surface wind speed, reference', 'kt', 'sfmr', ''],
        ['SfmrRainRate', 'SFMR rain rate', 'mm/h', 'sfmr', ''],
        ['SFMRRAINRATEref', 'SFMR rain rate, reference', 'mm/h', 'sfmr', ''],
        ['SfmrDV', 'SFMR D-value / diagnostic', '?', 'sfmr', ''],
        ['SfmrHS', 'SFMR diagnostic', '?', 'sfmr', ''],
        ['SfmrWErr', 'SFMR wind error estimate', 'kt', 'sfmr', ''],
        ['SfmrAP', 'SFMR air/surface pressure', 'mb', 'sfmr', 'sfcPr'],
        ['SfmrT', 'SFMR channel brightness temperature', 'K', 'sfmr', ''],
        ['SfmrCA', 'SFMR calibration coefficient A', '', 'sfmr', ''],
        ['SfmrCC', 'SFMR calibration coefficient C', '', 'sfmr', ''],
        ['SfmrCW', 'SFMR calibration coefficient W', '', 'sfmr', ''],
        ['SfmrID', 'SFMR unit ID', '', 'sfmr', ''],
        ['SfmrSerialNumber', 'SFMR serial number', '', 'sfmr', ''],
        ['ASfmrGamma', 'Advanced-SFMR gamma coefficient', '', 'sfmr', ''],
        ['ASfmrT', 'Advanced-SFMR brightness temperature', 'K', 'sfmr', ''],
        ['ASfmrTB', 'Advanced-SFMR brightness temperature (cal)', 'K', 'sfmr', ''],
        ['ASfmrWS', 'Advanced-SFMR surface wind speed', 'kt', 'sfmr', ''],
        ['ASfmrRainRate', 'Advanced-SFMR rain rate', 'mm/h', 'sfmr', ''],

        // --- dropsondes (DS_, indices = successive drops) ---
        ['DS_Ws', 'Dropsonde wind speed', 'm/s', 'dropsonde', ''],
        ['DS_Wd', 'Dropsonde wind direction', 'deg', 'dropsonde', ''],
        ['DS_WndErr', 'Dropsonde wind error', 'm/s', 'dropsonde', ''],
        ['DS_Ta', 'Dropsonde temperature', 'degC', 'dropsonde', ''],
        ['DS_PS', 'Dropsonde air pressure', 'mb', 'dropsonde', ''],
        ['DS_RH', 'Dropsonde relative humidity', '%', 'dropsonde', ''],
        ['DS_Rh1', 'Dropsonde relative humidity, sensor 1', '%', 'dropsonde', ''],
        ['DS_Rh2', 'Dropsonde relative humidity, sensor 2', '%', 'dropsonde', ''],
        ['DS_GPSAlt', 'Dropsonde GPS altitude', 'm', 'dropsonde', ''],
        ['DS_AltGA', 'Dropsonde geopotential altitude', 'm', 'dropsonde', ''],
        ['DS_GPSLat', 'Dropsonde latitude', 'deg', 'dropsonde', ''],
        ['DS_GPSLon', 'Dropsonde longitude', 'deg', 'dropsonde', ''],
        ['DS_GPSGsZ', 'Dropsonde vertical velocity', 'm/s', 'dropsonde', ''],
        ['DS_ID', 'Dropsonde serial number', '', 'dropsonde', ''],
        ['DS_Channel', 'Dropsonde telemetry channel', '', 'dropsonde', ''],
        ['DS_Date', 'Dropsonde launch date', '', 'dropsonde', ''],
        ['DS_Time', 'Dropsonde launch time', '', 'dropsonde', ''],
        ['DS_SndSats', 'Dropsonde sounding satellites', 'count', 'dropsonde', ''],
        ['DS_WndSats', 'Dropsonde wind satellites', 'count', 'dropsonde', ''],

        // --- GPS receiver housekeeping ---
        ['GPS_Vfom', 'GPS vertical figure of merit', 'm', 'gps', ''],
        ['GPS_Hfom', 'GPS horizontal figure of merit', 'm', 'gps', ''],
        ['GPS_Vdop', 'GPS vertical dilution of precision', '', 'gps', ''],
        ['GPS_Hdop', 'GPS horizontal dilution of precision', '', 'gps', ''],
        ['GPS_Stat', 'GPS status word', 'bits', 'gps', ''],
        ['GPS_Mstat', 'GPS mode status word', 'bits', 'gps', ''],
        ['GPS_AltErr', 'GPS altitude error estimate', 'm', 'gps', ''],
        ['GPS_LatErr', 'GPS latitude error estimate', 'm', 'gps', ''],
        ['GPS_LonErr', 'GPS longitude error estimate', 'm', 'gps', ''],
        ['GPS_GeoidHt', 'GPS height of geoid', 'm', 'gps', ''],
        ['GPS_Quality', 'GPS fix quality indicator', '', 'gps', ''],
        ['GPS_SatNum', 'GPS satellites used in fix', 'count', 'gps', ''],
        ['GPS_Fxtime', 'GPS time of fix', 's/100', 'gps', ''],
        ['GPS_GGAcnt', 'GPS GGA sentence burst count', 'count', 'gps', ''],
        ['GPS_GSAcnt', 'GPS GSA sentence burst count', 'count', 'gps', ''],
        ['GPS_GSTcnt', 'GPS GST sentence burst count', 'count', 'gps', ''],

        // --- ocean / misc ---
        ['Salinity', 'Sea surface salinity', 'PSU', 'ocean', '']
    ];

    // Expand the compact rows into structured records. `unitConf` is 'confirmed' for families the
    // visualizer already plots correctly today, 'assumed' (deduced, not yet checked against real
    // sample values) for everything else.
    const RAW_VAR_CATALOG = RAW_VAR_ROWS.map(([base, desc, unit, category, usedKey]) => ({
        base, desc, unit, category,
        used: usedKey || null,
        unitConf: usedKey ? 'confirmed' : 'assumed'
    }));

    // Strip a raw column name down to its family base ('THdgI.2' -> 'THdgI', 'DS_Ta.5' -> 'DS_Ta',
    // 'LATref' -> 'LATref'), then look it up. Returns the catalog record or null. For the future QC
    // tool: use this to label an arbitrary column from a freshly uploaded file's header.
    function rawVarLookup(colName) {
        if (!colName) return null;
        const base = String(colName).replace(/\.(\d+|[dcx])$/i, '');
        return RAW_VAR_CATALOG.find(v => v.base === base) ||
               RAW_VAR_CATALOG.find(v => v.base.toLowerCase() === base.toLowerCase()) || null;
    }
