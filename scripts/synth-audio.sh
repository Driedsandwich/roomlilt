#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec ./node_modules/.bin/tsx scripts/synth-audio.ts "$@"
