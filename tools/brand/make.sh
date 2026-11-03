#!/usr/bin/env bash
# Draws every icon and the share image from the sources in this folder. Run it after changing
# the name in shared/brand.ts. Needs rsvg-convert and Google Chrome. No AI paintings go into
# these files, because they get re-encoded here and the paintings' provenance data must survive.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../landing/public/brand"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

mkdir -p "$OUT"
cp "$HERE/favicon.svg" "$OUT/favicon.svg"
rsvg-convert -w 32 -h 32 "$HERE/favicon.svg" -o "$OUT/favicon-32.png"
rsvg-convert -w 180 -h 180 "$HERE/icon.svg" -o "$OUT/apple-touch-icon.png"
rsvg-convert -w 192 -h 192 "$HERE/icon.svg" -o "$OUT/icon-192.png"
rsvg-convert -w 512 -h 512 "$HERE/icon.svg" -o "$OUT/icon-512.png"
rsvg-convert -w 512 -h 512 "$HERE/icon-maskable.svg" -o "$OUT/icon-maskable-512.png"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,630 --virtual-time-budget=4000 --screenshot="$OUT/share.png" "file://$HERE/share.html" >/dev/null 2>&1
