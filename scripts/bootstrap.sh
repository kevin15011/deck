#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
mkdir -p .tools
if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
  installer=$(mktemp)
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --tlsv1.2 -fLsS https://sh.rustup.rs -o "$installer"
  sh "$installer" -y --no-modify-path --profile minimal --default-toolchain 1.92.0
fi
rustup toolchain install 1.92.0 --profile minimal --component clippy,rustfmt
