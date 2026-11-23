#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
[[ "$(bun --version)" == "1.4.0" ]] || { echo 'Build requires Bun 1.4.0' >&2; exit 1; }
bun install --frozen-lockfile --omit optional
bun run typecheck
bun run build
cargo build --locked -p deck2 --release
cp target/release/deck2 dist/.deck2-next
mv -f dist/.deck2-next dist/deck2
