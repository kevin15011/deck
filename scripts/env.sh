#!/usr/bin/env bash
# Source from the repository root or call scripts/build.sh.
export RUSTUP_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.tools/rustup"
export CARGO_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.tools/cargo"
export PATH="$CARGO_HOME/bin:$PATH"
