# GoPro MAX / MAX2 Telemetry Tool

Extracts telemetry data from GoPro MAX and MAX2 `.360` files and saves to multiple formats simultaneously.

Built on top of [gopro-telemetry](https://github.com/JuanIrache/gopro-telemetry) and [gpmf-extract](https://github.com/JuanIrache/gpmf-extract) by Juan Irache.

---

## Batch processing multiple files

GoPro splits large recordings across multiple `GSccnnnn.360` files that
share a file number (`nnnn`) but have different chapter numbers (`cc`).
`gopro_extract_gnss.sh` wraps `extract.js` to handle a whole card/folder of
these correctly:

```
chmod +x gopro_extract_gnss.sh
./gopro_extract_gnss.sh --formats gpx,srt --output-dir ./telemetry 'GS0*.360'
```

- **Correct order:** processes files by `(file number, chapter)`, not
  alphabetically — `GS020068.360` (chapter 2 of file 0068) is placed right
  after `GS010068.360` (chapter 1), even though `GS010069.360` sorts
  alphabetically in between.
- **Glob-drop warning:** quote your pattern (`'GS0*.360'`, not `GS0*.360`)
  so the script does the expansion itself — this lets it check the
  directory for chapters that a narrower pattern (classically
  `GS01*.360`, which only matches chapter 01) would have silently
  dropped, and warn before processing an incomplete set.
- Accepts either a quoted pattern or an already-expanded file list —
  either way, run `--help` for all options (`--output-dir`, `--formats`,
  `--extract-js`, `-y`/`--yes` to skip the confirmation prompt).

---

## Output formats

Pick which of these to generate with `--formats` (see Usage below); all are
exported by default.

| Format  | Extension   | Description                                                                 |
| ------- | ----------- | ---------------------------------------------------------------------------- |
| GPX     | `.gpx`      | GPS Exchange Format – compatible with most map systems                       |
| KML     | `.kml`      | Keyhole Markup Language – Google Earth (with absolute altitude)              |
| GeoJSON | `.geojson`  | Open standard for geographic features – GIS tools                            |
| CSV     | `.csv`      | Comma Separated Values – Excel and spreadsheet software                      |
| SRT     | `.srt`      | DJI Format B telemetry subtitle – direct import into [OVRLEY](https://github.com/spirokai/OVRLEY) as an activity file |
| MGJSON  | `.mgjson`   | Adobe After Effects – data-driven animations. **Not supported for MAX2** (see Notes) |
| VIRB    | `.virb.gpx` | Garmin Virb Edit compatible GPX                                              |

---

## Requirements

### Node.js 18 or later

```
# Install via NodeSource (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
```

Verify:

```
node --version   # v20.x.x
npm --version    # 10.x.x
```

### ffmpeg

`extract.js` shells out to `ffmpeg` to pull out just the GPMF metadata
track before handing it to `gpmf-extract` — see "How extraction works"
below. Required regardless of file size.

```
sudo apt install ffmpeg
```

---

## Installation

```
git clone https://github.com/zekesixniner/gopro-telemetry-tool
cd gopro-telemetry-tool
npm install
```

---

## Usage

```
node extract.js <input.360> <output-directory> [--formats fmt1,fmt2,...]
```

By default (no `--formats` given) every format is exported. Use `--formats`
to export only specific ones:

```
node extract.js GS010004.360 ~/telemetry/GS010004 --formats gpx,srt
```

Available format keys: `gpx`, `kml`, `geojson`, `csv`, `mgjson`, `virb`, `srt`.
`--formats=gpx,srt` (with `=`) also works. Run `node extract.js --help` for
the full usage text. An unknown format name aborts with an error before any
extraction work is done.

### Example

```
node extract.js GS010004.360 ~/telemetry/GS010004
```

This creates the output directory if it does not exist and saves the following formats:

```
~/telemetry/GS010004/
├── GS010004.gpx
├── GS010004.kml
├── GS010004.geojson
├── GS010004.csv
├── GS010004.srt
└── GS010004.virb.gpx
```

`GS010004.mgjson` is skipped automatically for MAX2 footage — see Notes.

### Example — only GPX and SRT

```
node extract.js GS010004.360 ~/telemetry/GS010004 --formats gpx,srt
```

```
~/telemetry/GS010004/
├── GS010004.gpx
└── GS010004.srt
```

---

## Options

The following filters are applied by default in `extract.js`:

| Option         | Value | Description                                                   |
| -------------- | ----- | ------------------------------------------------------------- |
| `GPSFix`       | `3`   | Only keep points with 3D GPS lock                             |
| `GPSPrecision` | `500` | Filter out points with DOP > 500                              |
| `WrongSpeed`   | `120` | Filter out points generating speeds above 120 m/s (~430 km/h) |
| `smooth`       | `3`   | Smooth each sample using 3 adjacent samples on each side      |

To adjust these, edit the `options` object in `extract.js`.

---

## SRT output (DJI Format B)

`extract.js` derives the `.srt` file from the same GPS points used for the GPX
output, formatted as DJI Format B telemetry cues:

```
1
00:00:00,000 --> 00:00:00,500
HOME(0.0000,0.0000) 2026.08.30 10:00:00
GPS(55.60500,13.00000,42.0)
```

The cue timecode is the elapsed time since the first GPS point (i.e. the
clip's own position), while the `HOME(...)` line carries the real wall-clock
GPS timestamp for that point. This is the same field split used by
[`gpx_to_dji_srt.py`](https://github.com/zekesixniner/gopro-max2-gpx) in the
video+GPX pipeline repo, so `.srt` files from either tool import into OVRLEY
the same way — pick the **Date/Time** widget for the clock, GPS-based widgets
(position, altitude, map) for the rest.

**Difference from `gpx_to_dji_srt.py`:** that script stitches multiple clips
together and rescales each clip's GPS timestamps against its video's real
(`ffprobe`) duration. This tool processes a single file straight from GPMF,
so there's no concatenation and no independently known video duration to
rescale against — elapsed time comes directly from the GPS clock (each
point's time minus the first point's time). This is accurate as long as the
GPS clock doesn't drift noticeably over the clip. For stitched multi-clip
exports, use `gpx_to_dji_srt.py` instead.

---

## How extraction works

`extract.js` always shells out to `ffmpeg` first to pull out just the GPMF
metadata track (`-map 0:3`) into a small temp `.mp4` file — a few MB
regardless of the source video's size — and feeds *that* to
`gpmf-extract`. The full video is never read into memory or parsed as a
whole. The temp file is cleaned up automatically when the run finishes (or
fails).

This isn't only about the 2 GiB `fs.readFileSync` buffer limit that GoPro
MAX2 8K footage routinely exceeds — it's also just faster: extracting via
ffmpeg is a fast stream-copy of ~96 kb/s of metadata, whereas reading and
mp4box-parsing an entire multi-GB file (the old behavior, and what
`gpmf-extract` would otherwise have to do to find the same track itself)
scales with the source file's size. A 1.84 GiB file took noticeably longer
than a 3.73 GiB file once only the smaller one was going through the full
read.

The GPMF track's stream index isn't fixed across camera models — the
number of video/audio streams (and therefore which index is GPMD) varies,
so `extract.js` detects the GPMD stream by its codec tag via `ffprobe`
first rather than assuming a fixed index. This is what `gopro-telemetry`
itself is documented to support broadly (Hero5 and later); this tool has
been tested end-to-end against both GoPro MAX and MAX2 `.360` files (both
happen to have GPMD at stream 0:3), so treat other Hero models as
untested rather than unsupported.

This is the same approach already used in
[`gopro-telemetry-tool-win`](https://github.com/zekesixniner/gopro-telemetry-tool-win)'s
`main.js`. An earlier attempt at handling large files used
`gpmf-extract`'s `useProgressiveMode`/`fileSize` options with a plain read
stream — that combination isn't actually part of `gpmf-extract`'s
documented API and failed with `File not compatible` on real footage, so
don't reuse it.

Requires `ffmpeg` on `PATH` (see Requirements above).

## Notes

- The KML output has `<altitudeMode>absolute</altitudeMode>` injected automatically, so the flight path renders at correct altitude in Google Earth.
- **MGJSON does not work with GoPro MAX2 footage** — the MAX2's GPMF data is missing the `frames/second` field that the MGJSON preset requires, so `goproTelemetry` throws and `extract.js` skips it with a `[SKIP]` message. For an After Effects workflow with MAX2 footage, extract GPS with [`gpmf2gpx.py`](https://github.com/zekesixniner/gopro-max2-gpx) instead.
- Tested with GoPro Max (firmware H19.03.02.02.00) and GoPro MAX2 (firmware H24.02.01.22.00).
- Works with any GoPro camera supported by `gopro-telemetry` (Hero5 and later); MGJSON and other presets should work normally on cameras whose GPMF data includes the fields they need.

---

## Related repos

- [`gopro-telemetry-tool-win`](https://github.com/zekesixniner/gopro-telemetry-tool-win) — Windows Electron GUI wrapping the same extraction logic
- [`gopro-max2-gpx`](https://github.com/zekesixniner/gopro-max2-gpx) — Python CLI (`gpmf2gpx.py` for GPS9/STMP-based extraction, `gpx_to_dji_srt.py` for multi-clip DJI SRT generation)

---

## Tested with

- GoPro Max, firmware H19.03.02.02.00
- GoPro MAX2, firmware H24.02.01.22.00
- Ubuntu 24.04 / WSL1 on Windows 11
- Node.js v20.20.2
- npm 10.8.2
