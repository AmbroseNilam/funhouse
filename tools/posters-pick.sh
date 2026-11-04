#!/usr/bin/env bash
# Turns the chosen candidates from tools/posters.ts into shelf posters: crops the painted paper
# edge, scales to 600 px wide and saves WebP under screen/public/art/posters/.
# Usage: tools/posters-pick.sh <candidateDir>
set -euo pipefail
from="$1"
out="$(dirname "$0")/../screen/public/art/posters"
mkdir -p "$out"
picks="twentyDoors:1 quizmaster:2 werewolf:2 leadingQuestions:1 whoFits:1 twoTakes:2 pastTheGate:1 offByAMile:2 mindTheGap:2 tinCanTelephone:1 wrongRoom:2 strayWord:2 underTheCup:1 magpiePockets:2 nameTag:1 coldRead:1 blankVerdict:2 lonelyClues:1 pantomimePanic:1 blankTruth:1 ghostWriter:1 paintedWhispers:1 clueGallery:2 samePage:2 threeClaims:2"
for pick in $picks; do
    id="${pick%%:*}"
    magick "$from/$id-${pick##*:}.webp" -gravity center -crop 86%x86%+0+0 +repage -resize 600x -quality 78 -define webp:method=6 "$out/$id.webp"
done
