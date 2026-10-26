#!/bin/bash
# 720p capacity test for the LiveKit on your VM. Run it from ANOTHER machine:
# simulated viewers download real video (6 x 30 x 1.3 Mbps ~ 135 Mbps), which a
# home connection can't take, and running it on the VM itself would steal CPU
# from the SFU and your other apps. A throwaway e2-standard-8 in the same zone
# costs well under a dollar for the half hour this takes (the tester needs
# ~3-5 cores of its own for the bigger scenarios).
#
# On the VM meanwhile:   docker stats connect-livekit
# The SFU is capped at cpus: 1.75 (e2-standard-2), so 175% there = whole budget.
#
# Usage: LIVEKIT_URL=wss://live.example.com LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
#        ./infra/loadtest.sh
set -euo pipefail
: "${LIVEKIT_URL:?}" "${LIVEKIT_API_KEY:?}" "${LIVEKIT_API_SECRET:?}"

lk() {
  docker run --rm -e LIVEKIT_URL -e LIVEKIT_API_KEY -e LIVEKIT_API_SECRET \
    livekit/livekit-cli:v2.18.8 load-test --duration 60s --video-resolution high "$@" \
    2>&1 | grep -E "Starting|│ Total"
}
STREAM30="--video-publishers 1 --subscribers 30"
MEET25="--video-publishers 25 --subscribers 25 --layout 3x3"

echo "== 6 streams x 30 viewers, at the same time"
for i in 1 2 3 4 5 6; do lk --room "lt-stream-$i" $STREAM30 & done; wait

echo "== 1 meeting of 25 (everyone on camera, 3x3 grid) + 3 streams x 30"
lk --room lt-meet $MEET25 &
for i in 1 2 3; do lk --room "lt-mix-$i" $STREAM30 & done; wait

echo "== 1 streamer -> 250 viewers"
lk --room lt-stream250 --video-publishers 1 --subscribers 250 --num-per-second 15
