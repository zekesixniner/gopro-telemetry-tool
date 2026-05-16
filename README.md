# GoPro MAX2 Telemetry Tool

Extracts telemetry data from GoPro MAX2 `.360` files and saves to multiple formats simultaneously.

Built on top of [gopro-telemetry](https://github.com/JuanIrache/gopro-telemetry) and [gpmf-extract](https://github.com/JuanIrache/gpmf-extract) by Juan Irache.

---

## Output formats

| Format | Extension | Description |
|---|---|---|
| GPX | `.gpx` | GPS Exchange Format – compatible with most map systems |
| KML | `.kml` | Keyhole Markup Language – Google Earth (with absolute altitude) |
| GeoJSON | `.geojson` | Open standard for geographic features – GIS tools |
| CSV | `.csv` | Comma Separated Values – Excel and spreadsheet software |
| MGJSON | `.mgjson` | Adobe After Effects – data-driven animations |
| VIRB | `.virb.gpx` | Garmin Virb Edit compatible GPX |

---

## Requirements

### Node.js 18 or later

```bash
# Install via NodeSource (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
```

Verify:
```bash
node --version   # v20.x.x
npm --version    # 10.x.x
```

---

## Installation

```bash
git clone https://github.com/zekesixniner/gopro-telemetry-tool
cd gopro-telemetry-tool
npm install
```

---

## Usage

```bash
node extract.js <input.360> <output-directory>
```

### Example

```bash
node extract.js GS010004.360 ~/telemetry/GS010004
```

This creates the output directory if it does not exist and saves all six formats:

```
~/telemetry/GS010004/
├── GS010004.gpx
├── GS010004.kml
├── GS010004.geojson
├── GS010004.csv
├── GS010004.mgjson
└── GS010004.virb.gpx
```

---

## Options

The following filters are applied by default in `extract.js`:

| Option | Value | Description |
|---|---|---|
| `GPSFix` | `3` | Only keep points with 3D GPS lock |
| `GPSPrecision` | `500` | Filter out points with DOP > 500 |
| `WrongSpeed` | `120` | Filter out points generating speeds above 120 m/s (~430 km/h) |
| `smooth` | `3` | Smooth each sample using 3 adjacent samples on each side |

To adjust these, edit the `options` object in `extract.js`.

---

## Notes

- The KML output has `<altitudeMode>absolute</altitudeMode>` injected automatically, so the flight path renders at correct altitude in Google Earth.
- Tested with GoPro MAX2, firmware H24.02.01.22.00.
- Works with any GoPro camera supported by `gopro-telemetry` (Hero5 and later).

---

## Tested with

- GoPro MAX2, firmware H24.02.01.22.00
- Ubuntu 24.04 / WSL1 on Windows 11
- Node.js v20.20.2
- npm 10.8.2
