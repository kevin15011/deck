#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
image=deck-linux-install-sandbox:local
name=deck-install-sandbox
mode=${1:-help}
if [[ $# -gt 1 ]]; then echo 'Expected one mode.' >&2; exit 2; fi
case "$mode" in
  with-deck|without-deck|update) ;;
  help|--help|-h)
    echo 'Usage: bun sandbox | bun sandbox:clean | bun sandbox:update'
    echo 'with-deck builds this checkout into a temporary deck-canary; DECK_SANDBOX_CANARY can supply an existing Linux binary.'
    exit 0 ;;
  *) echo "Unknown mode: $mode" >&2; exit 2 ;;
esac
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
docker info >/dev/null
if [[ "$mode" == update ]]; then
  docker build --pull --build-arg "RUNNER_REFRESH=$(date +%s)-$$" -t "$image" "$repo_root/sandbox/linux-install"
  exit
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build -t "$image" "$repo_root/sandbox/linux-install"
fi
# A second invocation must not remove or overwrite another active session.
if docker container inspect "$name" >/dev/null 2>&1; then
  echo "Container $name already exists. Inspect it with docker exec -it $name bash, or exit its original shell." >&2
  exit 1
fi
canary_dir=''
created=false
cleanup() {
  if [[ "$created" == true ]]; then docker rm -f "$name" >/dev/null 2>&1 || true; fi
  if [[ -n "$canary_dir" ]]; then rm -rf -- "$canary_dir"; fi
}
trap cleanup EXIT
if [[ "$mode" == with-deck ]]; then
  candidate=${DECK_SANDBOX_CANARY:-}
  if [[ -z "$candidate" ]]; then
    [[ $(uname -s) == Linux ]] || { echo 'Build or supply a Linux canary using DECK_SANDBOX_CANARY.' >&2; exit 1; }
    canary_dir=$(mktemp -d "${TMPDIR:-/tmp}/deck-sandbox-canary.XXXXXX")
    (cd "$repo_root" && bun run canary:install -- --dir "$canary_dir/bin")
    candidate="$canary_dir/bin/deck-canary"
  fi
  [[ -f "$candidate" && -x "$candidate" ]] || { echo 'Canary must be an executable Linux binary.' >&2; exit 1; }
  # Dereference the installer alias before Docker copies it.
  candidate=$(readlink -f "$candidate")
fi
docker create --rm -it --name "$name" --hostname deck-sandbox "$image" >/dev/null
created=true
if [[ "$mode" == with-deck ]]; then
  docker cp "$candidate" "$name:/home/tester/.local/bin/deck-canary"
fi
printf '\nInspect this session from another terminal/agent:\ndocker exec -it %s bash\ndocker cp %s:/home/tester ./sandbox-evidence\n\n' "$name" "$name"
docker start -ai "$name"
