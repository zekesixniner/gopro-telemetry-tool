const gpmfExtract = require('gpmf-extract');
const goproTelemetry = require('gopro-telemetry');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const KNOWN_FORMATS = ['gpx', 'kml', 'geojson', 'csv', 'mgjson', 'virb', 'srt'];

function printUsage() {
  console.log(
    'Usage: node extract.js <input.360> <output-dir> [--formats fmt1,fmt2,...]\n\n' +
    `  Formats: ${KNOWN_FORMATS.join(', ')}\n` +
    '  Default (no --formats given): export all formats.\n\n' +
    'Examples:\n' +
    '  node extract.js GS010004.360 ./out\n' +
    '  node extract.js GS010004.360 ./out --formats gpx,srt\n' +
    '  node extract.js GS010004.360 ./out --formats=kml'
  );
}

function parseFormatsArg(argv) {
  const flag = argv.find(a => a === '--formats' || a.startsWith('--formats='));
  if (!flag) return null; // null = export everything (previous default behavior)

  let value;
  if (flag.includes('=')) {
    value = flag.slice(flag.indexOf('=') + 1);
  } else {
    value = argv[argv.indexOf(flag) + 1];
  }

  if (!value) {
    console.error('[ERROR] --formats requires a comma-separated list, e.g. --formats gpx,srt');
    process.exit(1);
  }

  const requested = value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const unknown = requested.filter(f => !KNOWN_FORMATS.includes(f));
  if (unknown.length) {
    console.error(`[ERROR] Unknown format(s): ${unknown.join(', ')}`);
    console.error(`        Known formats: ${KNOWN_FORMATS.join(', ')}`);
    process.exit(1);
  }

  return requested;
}

const allArgs = process.argv.slice(2);

if (allArgs.includes('--help') || allArgs.includes('-h')) {
  printUsage();
  process.exit(0);
}

const inputFile = process.argv[2];
const outputDir = process.argv[3];
const extraArgs = process.argv.slice(4);

if (!inputFile || !outputDir) {
  printUsage();
  process.exit(1);
}

const selectedFormats = parseFormatsArg(extraArgs); // null = all formats
if (selectedFormats) {
  console.log(`[INFO] Formats: ${selectedFormats.join(', ')}`);
}

// Create output directory if it does not exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const baseName = path.basename(inputFile).replace(/\.[^.]+$/, '');
const baseFile = path.join(outputDir, baseName);

console.log(`[INFO] Reading: ${inputFile}`);
const { size: inputFileSize } = fs.statSync(inputFile);
console.log(`[INFO] File size: ${(inputFileSize / (1024 ** 3)).toFixed(2)} GiB`);

const options = {
  GPSFix: 3,
  GPSPrecision: 500,
  WrongSpeed: 120,
  smooth: 3,
};

// ──────────────────────────────────────────────
// DJI FORMAT B .srt EXPORT
// ──────────────────────────────────────────────
//
// Ports the cue-generation logic from gpx_to_dji_srt.py (gopro-max2-gpx repo)
// so single-clip SRT output stays consistent with the multi-clip pipeline
// version. Key idea (same as the Python tool): the SRT cue timecode carries
// the elapsed video position, while the HOME(...) line inside each cue
// carries the real wall-clock GPS timestamp. OVRLEY reads these as two
// separate fields.
//
// Difference vs. the pipeline script: gpx_to_dji_srt.py stitches multiple
// clips together and rescales each clip's GPS timestamps to match its
// video's real (ffprobe) duration. This CLI processes one file at a time
// straight from GPMF, so there's no concatenation and no independently
// known video duration to rescale against — elapsed time is taken directly
// from the GPS clock (time of each point minus the first point's time).
// This is accurate as long as the GPS clock doesn't drift noticeably over
// the clip; for stitched multi-clip exports, prefer gpx_to_dji_srt.py.

function fmtSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function fmtDjiTimestamp(date) {
  // Format B expects: 2017.08.05 14:12:00
  const pad = n => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())} ` +
         `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function parseGpxPoints(gpxString) {
  const pointRe = /<trkpt lat="([^"]+)" lon="([^"]+)">\s*<ele>([^<]*)<\/ele>\s*<time>([^<]+)<\/time>/g;
  const points = [];
  let m;
  while ((m = pointRe.exec(gpxString)) !== null) {
    const [, lat, lon, ele, timeStr] = m;
    const t = new Date(timeStr);
    if (isNaN(t.getTime())) continue;
    points.push({ lat, lon, ele: ele || '0', time: t });
  }
  return points;
}

function gpxToDjiSrt(gpxString) {
  const points = parseGpxPoints(gpxString);
  if (points.length === 0) return null;

  const realStartMs = points[0].time.getTime();
  const cues = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const startSec = (p.time.getTime() - realStartMs) / 1000;
    const endSec = i + 1 < points.length
      ? (points[i + 1].time.getTime() - realStartMs) / 1000
      : startSec + 1; // last point: hold for 1s

    if (endSec <= startSec) continue;

    const body = `HOME(0.0000,0.0000) ${fmtDjiTimestamp(p.time)}\nGPS(${p.lat},${p.lon},${p.ele})`;
    cues.push({ startSec, endSec, body });
  }

  return cues
    .map((c, idx) => `${idx + 1}\n${fmtSrtTime(c.startSec)} --> ${fmtSrtTime(c.endSec)}\n${c.body}\n`)
    .join('\n');
}

// ──────────────────────────────────────────────
// GPMF TRACK EXTRACTION
// ──────────────────────────────────────────────
//
// fs.readFileSync has a hard 2 GiB buffer limit, and GoPro MAX2 8K footage
// routinely exceeds that. A previous attempt at this used gpmf-extract's
// documented-sounding `useProgressiveMode`/`fileSize` options with a plain
// fs.createReadStream — that combination isn't actually part of
// gpmf-extract's API and failed with "File not compatible" on real files.
//
// The verified fix (already shipped in gopro-telemetry-tool-win's main.js)
// is to use ffmpeg to extract just the GPMF metadata track into a small
// temp .mp4 file first, then feed *that* to gpmf-extract with a normal
// readFileSync. This is always used now, not just above the 2 GiB
// threshold: reading and mp4box-parsing an entire multi-GB source file
// (to find the same track ffmpeg can pull out directly) is also much
// slower for files that happen to be just under 2 GiB — a 1.84 GiB file
// took noticeably longer than a 3.73 GiB file that took the ffmpeg path,
// because ffmpeg only has to stream-copy ~96 kb/s of metadata regardless
// of the source file's size. Requires ffmpeg + ffprobe on PATH.
//
// The GPMF track's stream index isn't fixed across camera models — it
// happened to be 0:3 on tested MAX/MAX2 footage, but the number of
// video/audio streams (and therefore which index is GPMD) varies by
// model. Rather than hardcode 0:3 and risk silently mapping the wrong
// stream on other Hero models, detect the GPMD stream by its codec tag
// (fourCC) via ffprobe first.

function detectGpmfStreamIndex(sourceFile) {
  let out;
  try {
    out = execFileSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'd',
      '-show_entries', 'stream=index,codec_tag_string',
      '-of', 'csv=p=0',
      sourceFile,
    ], { encoding: 'utf8' });
  } catch (err) {
    console.error('[ERROR] ffprobe failed to inspect the input file.');
    console.error('        Make sure ffmpeg/ffprobe are installed and on PATH (sudo apt install ffmpeg).');
    if (err.stderr) console.error(err.stderr.toString());
    process.exit(1);
  }

  const line = out.split('\n').map(l => l.trim()).find(l => l.endsWith(',gpmd') || l === 'gpmd');
  if (!line) {
    console.error('[ERROR] No GPMD (GoPro metadata) stream found in this file.');
    console.error('        This tool only works on GoPro footage with embedded GPMF telemetry.');
    process.exit(1);
  }
  const index = line.split(',')[0];
  return index;
}

function extractGpmfTrackWithFfmpeg(sourceFile) {
  const streamIndex = detectGpmfStreamIndex(sourceFile);
  const tmpFile = path.join(os.tmpdir(), `gpmf_${Date.now()}_${process.pid}.mp4`);
  console.log(`[INFO] Extracting GPMF track (stream 0:${streamIndex}) with ffmpeg...`);
  try {
    execFileSync('ffmpeg', ['-i', sourceFile, '-map', `0:${streamIndex}`, '-c', 'copy', '-y', tmpFile], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    console.error('[ERROR] ffmpeg failed to extract the GPMF track.');
    console.error('        Make sure ffmpeg is installed and on PATH (sudo apt install ffmpeg).');
    if (err.stderr) console.error(err.stderr.toString());
    process.exit(1);
  }
  return tmpFile;
}

const tmpGpmfFile = extractGpmfTrackWithFfmpeg(inputFile);
const file = fs.readFileSync(tmpGpmfFile);

function cleanupTmpFile() {
  try { fs.unlinkSync(tmpGpmfFile); } catch (e) { /* ignore */ }
}

gpmfExtract(file)
  .then(extracted => {
    console.log(`[INFO] Extracting telemetry...`);

    const formats = [
      { preset: 'gpx',     ext: 'gpx',      fix: s => s },
      { preset: 'kml',     ext: 'kml',      fix: s => s.replace(/clampToGround/g, 'absolute') },
      { preset: 'geojson', ext: 'geojson',  fix: s => s },
      { preset: 'csv',     ext: 'csv',      fix: s => s },
      { preset: 'mgjson',  ext: 'mgjson',   fix: s => s,
        note: 'Not supported for GoPro MAX2 (missing frames/second in GPMF data). ' +
              'Use gpmf2gpx.py + After Effects import instead: https://github.com/zekesixniner/gopro-max2-gpx' },
      { preset: 'virb',    ext: 'virb.gpx', fix: s => s },
    ];

    const formatsToRun = selectedFormats
      ? formats.filter(f => selectedFormats.includes(f.preset))
      : formats;

    const promises = formatsToRun.map(({ preset, ext, fix, note }) =>
      goproTelemetry(extracted, { ...options, preset })
        .then(data => {
          const content = typeof data === 'string' ? fix(data) : fix(JSON.stringify(data, null, 2));
          const outFile = `${baseFile}.${ext}`;
          fs.writeFileSync(outFile, content);
          console.log(`[INFO] Saved: ${outFile}`);
        })
        .catch(err => {
          if (note) {
            console.log(`[SKIP] ${preset}: ${note}`);
          } else {
            console.error(`[ERROR] ${preset}:`, err.message);
          }
        })
    );

    // DJI Format B .srt is derived from the gpx preset rather than its own
    // goproTelemetry preset (no native srt preset exists in gopro-telemetry),
    // so it's requested/skipped independently of whether 'gpx' itself was selected.
    const runSrt = !selectedFormats || selectedFormats.includes('srt');
    const srtPromise = runSrt
      ? goproTelemetry(extracted, { ...options, preset: 'gpx' })
          .then(gpxData => {
            const srtContent = gpxToDjiSrt(gpxData);
            if (!srtContent) {
              console.log('[SKIP] srt: no GPS points found, nothing to write');
              return;
            }
            const outFile = `${baseFile}.srt`;
            fs.writeFileSync(outFile, srtContent);
            console.log(`[INFO] Saved: ${outFile}`);
          })
          .catch(err => console.error('[ERROR] srt:', err.message))
      : Promise.resolve();

    return Promise.all([...promises, srtPromise]);
  })
  .then(() => console.log('\n✅ Done!'))
  .catch(err => console.error('[ERROR]', err))
  .finally(() => cleanupTmpFile());
