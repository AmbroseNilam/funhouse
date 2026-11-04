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
rsvg-convert -w 16 -h 16 "$HERE/favicon.svg" -o "$OUT/favicon-16.png"
# Launch screens for installed iPhones: width, height and scale of each current screen.
for size in 375x667x2 375x812x3 390x844x3 393x852x3 402x874x3 414x896x2 414x896x3 420x912x3 428x926x3 430x932x3 440x956x3; do
    IFS=x read -r width height scale <<< "$size"
    x=$(( (width - 150) / 2 )); y=$(( (height - 218) / 2 ))
    sed -e "s/@WIDTH@/$width/g" -e "s/@HEIGHT@/$height/g" -e "s/@X@/$x/g" -e "s/@Y@/$y/g" "$HERE/splash.svg" | rsvg-convert -w $(( width * scale )) -h $(( height * scale )) -o "$OUT/splash-${width}x${height}@${scale}.png"
done
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,630 --virtual-time-budget=4000 --screenshot="$OUT/share.png" "file://$HERE/share.html" >/dev/null 2>&1
