# Changelog

## 1.1.1

- Renamed `extract-batch.sh` to `gopro_extract_gnss.sh` (GNSS is the
  accurate term for the satellite position data — it isn't GPS-only —
  and the new name matches the `snake_case` convention used by the
  Python pipeline scripts in `gopro-max2-gpx`).
- `extract.js` no longer hardcodes `-map 0:3` for the GPMF track. That
  index was verified correct for MAX/MAX2 footage (7-stream layout with
  GPMD at index 3), but isn't guaranteed on other Hero models, where the
  number of video/audio streams — and therefore which index is GPMD —
  can differ. `extract.js` now detects the GPMD stream by its codec tag
  (fourCC) via `ffprobe` first, then maps whichever index that turns out
  to be. This is what makes the general (non-MAX-specific) name for the
  batch script accurate: the underlying extraction no longer assumes a
  MAX/MAX2-shaped stream layout. Still only tested end-to-end against
  MAX/MAX2 `.360` files — untested on other Hero models, but no longer
  relies on an assumption that's specific to MAX/MAX2.
- Clear error if no GPMD stream is found in the input file at all (i.e.
  it's not GoPro GPMF footage).
- Requires `ffprobe` on `PATH` in addition to `ffmpeg` (installed
  together by `apt install ffmpeg` already, so no new install step).

## 1.1.0

- Added `gopro_extract_gnss.sh`, a bash wrapper around `extract.js` for
  processing a whole card/folder of `.360` files in one go:
  - Sorts by `(file number, chapter)` instead of alphabetically, so
    chaptered recordings (`GSccnnnn.360`) are processed in true
    chronological order (`GS020068.360` right after `GS010068.360`, not
    after `GS010069.360`).
  - Warns loudly and asks for confirmation if it looks like an unquoted
    glob dropped chapter files (e.g. `GS01*.360` silently missing
    `GS02*.360` continuations) — same protection already used by the
    Python pipeline scripts in `gopro-max2-gpx`.
  - Accepts either a quoted glob pattern (does its own expansion, so it
    can see the full directory for the warning check) or an
    already-expanded file list.
  - Passes `--formats`, `--output-dir` through to `extract.js`;
    `--extract-js` / `EXTRACT_JS` to point at a non-default location;
    `-y`/`--yes` to skip the confirmation prompt for scripted use.
  - Tested against synthetic `GSccnnnn.360` filename sets (sorting order,
    glob-drop warning with both pre-expanded and quoted-pattern input,
    invalid filenames, `--formats` passthrough) with a stub `extract.js`.

## 1.0.13

- ffmpeg GPMF-track extraction is now used for **every** file, not just
  ones over the ~1.9 GiB threshold. Turned out to matter for speed too,
  not just the 2 GiB limit: a 1.84 GiB file (just under the old threshold,
  so it took the direct `readFileSync` + full-file mp4box parse path) was
  noticeably slower than a 3.73 GiB file that took the ffmpeg path,
  because ffmpeg only stream-copies the ~96 kb/s metadata track regardless
  of the source file's size. ffmpeg is now a hard requirement (see
  Requirements in README) rather than a conditional one.

## 1.0.12

- Fixed the 1.0.11 large-file fix: the ffmpeg temp file used a `.bin`
  extension, which ffmpeg can't pick a muxer for
  (`Unable to choose an output format for '....bin'`), so the GPMF
  extraction step always failed on real footage. Temp file now uses a
  `.mp4` extension (matching `gopro-telemetry-tool-win`'s `main.js`), so
  ffmpeg muxes it correctly and `gpmf-extract` gets a valid MP4 container
  with the GPMD track inside. Confirmed the muxer choice against a real
  multi-stream layout matching a MAX2 `.360` file.

## 1.0.11

- **Corrected** the 1.0.10 large-file fix. `useProgressiveMode`/`fileSize`
  passed to `gpmf-extract` with a plain `fs.createReadStream` is not
  actually part of `gpmf-extract`'s API — it failed with
  `[ERROR] File not compatible` on real GoPro MAX2 footage (confirmed on
  a real 3.73 GiB file).
- Replaced it with the approach already verified in
  `gopro-telemetry-tool-win`'s `main.js`: for files ≥ ~1.9 GiB, shell out
  to `ffmpeg -map 0:3` to extract just the GPMF metadata track to a small
  temp file, then `fs.readFileSync` that instead of the original video.
  Temp file is cleaned up automatically. Files under the threshold are
  read directly, same as before — no ffmpeg dependency for smaller clips.
- Clear error message (with install hint) if ffmpeg is missing or fails.
- README: added a "Large files" section explaining this, and ffmpeg as a
  conditional requirement.

## 1.0.10

- ~~Fixed `ERR_FS_FILE_TOO_LARGE`... via streaming.~~ **Superseded by 1.0.11
  — this approach did not actually work on real files.**

- Fixed `ERR_FS_FILE_TOO_LARGE` on GoPro MAX2 8K footage over 2 GiB.
  `extract.js` used `fs.readFileSync`, which has a hard 2 GiB buffer limit —
  it now streams the file with `fs.createReadStream` and passes
  `useProgressiveMode: true` + `fileSize` to `gpmf-extract` instead. Same
  fix already applied to the Windows Electron app
  (`gopro-telemetry-tool-win`).
- Prints the input file size in GiB before extraction starts.

## 1.0.9

- Added `--formats fmt1,fmt2,...` flag to `extract.js` so you can export
  only the formats you want instead of always generating all of them.
  Accepts `--formats gpx,srt` or `--formats=gpx,srt`. Unknown format names
  abort with an error before any extraction work starts. No flag = same
  behavior as before (export everything).
- `node extract.js --help` (or `-h`) now prints usage, including the list
  of valid format keys.
- README: documented the new flag with examples.

## 1.0.8

- Added `.srt` output (DJI Format B telemetry subtitle) for direct import
  into OVRLEY as an activity file. Cue timecode = elapsed video position,
  `HOME(...)` line = real GPS wall-clock time — same field split used by
  `gpx_to_dji_srt.py` in the video+GPX pipeline repo.
- `extract.js` now gives a clear `[SKIP]` message with a pointer to
  `gpmf2gpx.py` when MGJSON fails on MAX2 footage, instead of a raw error.
- README: documented the MAX2/MGJSON limitation and the SRT output format,
  added a "Related repos" section.

## 1.0.7

- Previous release.
