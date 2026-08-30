#!/usr/bin/env bash
#
# gopro_extract_gnss.sh - batch wrapper around extract.js for GoPro .360 files
#
# GoPro names chaptered files GSccnnnn.360, where cc = chapter number and
# nnnn = file number. When a single recording gets too large, it's split
# into multiple files that share the same file number but get different
# chapter numbers (e.g. GS010068.360, GS020068.360 are chapters 1 and 2 of
# the same recording, file number 0068). This script:
#
#   1. Processes files in (file number, chapter) order, not alphabetical
#      order - GS020068 alphabetically sorts before GS010069, even though
#      GS010069 is chronologically later. Sorting by filename alone gets
#      this wrong.
#   2. Warns loudly if it looks like an unquoted glob has silently dropped
#      chapter files - the classic gotcha where 'GS01*.360' (unquoted, so
#      the shell expands it before the script ever sees it) only matches
#      chapter 01 and silently misses GS02*.360, GS03*.360, etc. of the
#      same recording.
#
# Usage:
#   gopro_extract_gnss.sh [options] <file-or-pattern>...
#
# Options:
#   --output-dir DIR     Output directory for all generated files (default: ./telemetry)
#   --formats LIST       Passed through to extract.js, e.g. gpx,srt
#   --extract-js PATH    Path to extract.js (default: $HOME/dev/gopro-telemetry-tool/extract.js,
#                         or set the EXTRACT_JS environment variable)
#   -y, --yes            Don't ask for confirmation if a possible dropped
#                         chapter is detected - process the given files anyway
#   -h, --help           Show this help
#
# Examples:
#   gopro_extract_gnss.sh 'GS0*.360'
#   gopro_extract_gnss.sh --formats gpx,srt --output-dir ./out /mnt/e/GoPro_SD_Card/100GOPRO/*.360
#
# Quote glob patterns you type directly ('GS0*.360') so the shell doesn't
# expand them before this script gets a chance to see the full set — same
# advice as for the other GoPro pipeline scripts.

set -euo pipefail

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^#\{1,2\} \{0,1\}//'
}

EXTRACT_JS="${EXTRACT_JS:-$HOME/dev/gopro-telemetry-tool/extract.js}"
OUTPUT_DIR="./telemetry"
FORMATS=""
ASSUME_YES=0
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      OUTPUT_DIR="$2"; shift 2 ;;
    --formats)
      FORMATS="$2"; shift 2 ;;
    --extract-js)
      EXTRACT_JS="$2"; shift 2 ;;
    -y|--yes)
      ASSUME_YES=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do FILES+=("$1"); shift; done
      ;;
    -*)
      echo "[ERROR] Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      FILES+=("$1"); shift ;;
  esac
done

if [[ ${#FILES[@]} -eq 0 ]]; then
  usage
  exit 1
fi

# Expand each argument as a glob pattern ourselves. This means both an
# already-expanded file list AND a quoted pattern like 'GS0*.360' work -
# quoting is what lets us see (and warn about) the full set instead of
# whatever the shell already narrowed it down to.
RAW_ARGS=("${FILES[@]}")
FILES=()
shopt -s nullglob
for pat in "${RAW_ARGS[@]}"; do
  matches=( $pat )
  if [[ ${#matches[@]} -eq 0 ]]; then
    echo "[ERROR] No files matched: $pat" >&2
    exit 1
  fi
  FILES+=("${matches[@]}")
done
shopt -u nullglob

if [[ ! -f "$EXTRACT_JS" ]]; then
  echo "[ERROR] extract.js not found at: $EXTRACT_JS" >&2
  echo "        Pass --extract-js PATH or set the EXTRACT_JS environment variable." >&2
  exit 1
fi

# ──────────────────────────────────────────────
# Filename parsing: GSccnnnn.360 -> CHAPTER, FILENUM
# ──────────────────────────────────────────────
parse_name() {
  local base
  base=$(basename -- "$1")
  if [[ "$base" =~ ^GS([0-9]{2})([0-9]{4})\.360$ ]]; then
    CHAPTER="${BASH_REMATCH[1]}"
    FILENUM="${BASH_REMATCH[2]}"
    return 0
  fi
  return 1
}

for f in "${FILES[@]}"; do
  if ! parse_name "$f"; then
    echo "[ERROR] Doesn't look like a GoPro chaptered filename (expected GSccnnnn.360): $f" >&2
    exit 1
  fi
  if [[ ! -f "$f" ]]; then
    echo "[ERROR] File not found: $f" >&2
    exit 1
  fi
done

# ──────────────────────────────────────────────
# Glob-drop detection
# ──────────────────────────────────────────────
# For every directory the given files live in, list every GSccnnnn.360
# file actually present there, and check whether any file number in our
# list has a sibling chapter in that directory that we DON'T have.
declare -A have_chapters   # key: "dir|nnnn" -> " cc1 cc2 ..." we were given
declare -A seen_dirs

for f in "${FILES[@]}"; do
  d=$(dirname -- "$f")
  seen_dirs["$d"]=1
  parse_name "$f"
  key="${d}|${FILENUM}"
  have_chapters["$key"]="${have_chapters[$key]:-} $CHAPTER"
done

missing_found=0
for d in "${!seen_dirs[@]}"; do
  shopt -s nullglob
  for full in "$d"/GS??????.360; do
    parse_name "$full" || continue
    key="${d}|${FILENUM}"
    if [[ -n "${have_chapters[$key]:-}" ]] && [[ " ${have_chapters[$key]} " != *" $CHAPTER "* ]]; then
      echo "!! WARNING: $full (chapter $CHAPTER, file number $FILENUM) exists in $d" >&2
      echo "!!          but wasn't included in your file list. This usually means an" >&2
      echo "!!          unquoted glob dropped it, e.g. GS01*.360 instead of 'GS0*.360'." >&2
      missing_found=1
    fi
  done
  shopt -u nullglob
done

if [[ $missing_found -eq 1 && $ASSUME_YES -eq 0 ]]; then
  read -rp "Continue with only the files you listed anyway? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

# ──────────────────────────────────────────────
# Sort by (file number, chapter), not alphabetically
# ──────────────────────────────────────────────
# GS020068 must come after GS010069 chronologically even though it sorts
# alphabetically before it - sort on the numeric (nnnn, cc) key instead.
sorted_lines=""
for f in "${FILES[@]}"; do
  parse_name "$f"
  sorted_lines+="${FILENUM}${CHAPTER}"$'\t'"$f"$'\n'
done

mapfile -t SORTED_FILES < <(printf '%s' "$sorted_lines" | sort -n | cut -f2-)

mkdir -p "$OUTPUT_DIR"

total=${#SORTED_FILES[@]}
i=0
failed=()
for f in "${SORTED_FILES[@]}"; do
  i=$((i + 1))
  echo ""
  echo "=== [$i/$total] $(basename -- "$f") ==="
  if [[ -n "$FORMATS" ]]; then
    node "$EXTRACT_JS" "$f" "$OUTPUT_DIR" --formats "$FORMATS" || failed+=("$f")
  else
    node "$EXTRACT_JS" "$f" "$OUTPUT_DIR" || failed+=("$f")
  fi
done

echo ""
echo "Done: $((total - ${#failed[@]}))/$total succeeded."
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "Failed:"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
