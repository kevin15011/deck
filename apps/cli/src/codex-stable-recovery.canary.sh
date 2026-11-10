#!/usr/bin/env bash
# Run from the repository root. Builds an isolated canary and opens the real TUI.
# Select Codex, Context7 and Developer Team, review recovery paths, then confirm.
# Repeat Review & Install before exiting. Pass --without-config for first install.
set -euo pipefail
canary_root=$(mktemp -d /tmp/deck-recovery-canary.XXXXXX)
export DECK_RECOVERY_CANARY_ROOT="$canary_root"
canary_env() {
  env -i PATH="$PATH" TERM="${TERM:-xterm-256color}" \
    HOME="$canary_root/home" CODEX_HOME="$canary_root/home/.codex" \
    XDG_CONFIG_HOME="$canary_root/config" XDG_STATE_HOME="$canary_root/state" \
    XDG_CACHE_HOME="$canary_root/cache" XDG_DATA_HOME="$canary_root/data" \
    DECK_RECOVERY_CANARY_ROOT="$canary_root" "$@"
}
bun run canary:install -- --dir "$canary_root/bin"
canary_env bun - "$@" <<'JS'
import {mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {getDefaultDeckConfig, contributionHash} from './packages/core/src/index.ts';
const root = process.env.DECK_RECOVERY_CANARY_ROOT;
const home = process.env.HOME, codex = process.env.CODEX_HOME;
const config = join(process.env.XDG_CONFIG_HOME, 'deck');
const fences = join(process.env.XDG_STATE_HOME, 'deck/runner-fences');
for (const path of [home, codex, config, fences]) mkdirSync(path, {recursive:true, mode:0o700});
writeFileSync(join(config, 'config.json'), JSON.stringify(getDefaultDeckConfig()), {mode:0o600});
if (!process.argv.includes('--without-config')) {
 writeFileSync(join(codex, 'config.toml'), '[foreign]\nvalue = "preserve"\n', {mode:0o600});
 writeFileSync(join(root, 'with-config'), 'true');
}
writeFileSync(join(codex, 'auth.json'), '{"fixture":"preserve"}\n', {mode:0o600});
const writer = {semver:'0.15.1', commit:'2ff95a7', channel:'stable'};
const prior = JSON.stringify({fenceSchema:1,stateSchema:1,epoch:1,writer,pending:{epoch:2,writer,stateSchema:1,journals:[]}})+'\n';
writeFileSync(join(fences, `codex-${contributionHash(resolve(codex)).slice(0,16)}.json`), prior, {mode:0o600});
writeFileSync(join(root, 'original-fence.json'), prior, {mode:0o600});
JS
printf 'Isolated canary: %s\n' "$canary_root"
canary_env "$canary_root/bin/deck-canary"
canary_env bun - <<'JS'
import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {strict as assert} from 'node:assert';
const root = process.env.DECK_RECOVERY_CANARY_ROOT, codex = process.env.CODEX_HOME;
const fences = join(process.env.XDG_STATE_HOME, 'deck/runner-fences');
const fence = readdirSync(fences).find(name => name.startsWith('codex-') && name.endsWith('.json'));
assert(fence, 'Expected Codex fence');
assert(!JSON.parse(readFileSync(join(fences, fence), 'utf8')).pending, 'Recovery is still pending');
const archiveRoot = join(fences, 'recovery-archive');
const archives = readdirSync(archiveRoot).map(name => join(archiveRoot, name));
const original = readFileSync(join(root, 'original-fence.json'), 'utf8');
assert(archives.some(path => JSON.parse(readFileSync(path, 'utf8')).originalBytes === original), 'Original evidence must survive');
for (const path of archives) assert.equal(statSync(path).mode & 0o777, 0o600);
assert.equal(readFileSync(join(codex, 'auth.json'), 'utf8'), '{"fixture":"preserve"}\n');
const config = readFileSync(join(codex, 'config.toml'), 'utf8');
assert(config.includes('mcp_servers.context7'), 'Context7 configuration must exist');
if (existsSync(join(root, 'with-config'))) assert.equal(Bun.TOML.parse(config).foreign.value, 'preserve');
console.log('Recovery settled; original evidence and credentials preserved. Inspect UI retry and runtime readiness evidence separately.');
JS
