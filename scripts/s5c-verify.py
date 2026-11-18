#!/usr/bin/env python3
"""Capture implementation identity and run S5c's manifest-derived package gates.
Native service and provider/browser journeys are separately opt-in and recorded.
"""
import datetime, hashlib, json, os, pathlib, shlex, subprocess, time
root = pathlib.Path(__file__).resolve().parent.parent
out = root / os.environ.get('DECK2_EVIDENCE_DIR', 'target/s5c-production/final')
out.mkdir(parents=True, exist_ok=True)
def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()
def inputs():
    paths = [root / n for n in ['.gitignore','Cargo.toml','Cargo.lock','rust-toolchain.toml','package.json','bun.lock','tsconfig.json']]
    for name in ['crates','frontend','scripts']:
        paths.extend(p for p in (root / name).rglob('*') if p.is_file() and 'node_modules' not in p.parts and '__pycache__' not in p.parts)
    return {str(p.relative_to(root)):digest(p) for p in sorted(paths)}
before = inputs()
candidate = hashlib.sha256(json.dumps(before, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
commands = [
    'cargo fmt --all --check',
    'cargo clippy --locked --workspace --all-targets -- -D warnings',
    'cargo test --locked --workspace -- --test-threads=2',
    'bun test ./frontend/src',
    'bash scripts/build.sh',
    f'python3 scripts/s5c-schema-boundary.py --output {shlex.quote(str(out / "schema"))}', 
    'python3 scripts/recovery-regression.py',
    'python3 scripts/session-origin-regression.py',
    f'node scripts/entrance-regression.cjs dist/deck2 {shlex.quote(str(out / "entrance.json"))}', 
    'node scripts/motion-regressions.cjs',
]
records = []
for i, command in enumerate(commands):
    start = time.monotonic()
    log = out / f'gate-{i}.log'
    with log.open('w') as stream:
        completed = subprocess.run(['bash', '-c', 'source scripts/env.sh\nexport CARGO_BUILD_JOBS=2\nexec nice -n 10 bash -c '+__import__('shlex').quote(command)], cwd=root, stdout=stream, stderr=subprocess.STDOUT, timeout=240)
    record = dict(command=command,source='Cargo manifests, package.json, scripts/build.sh and S5c brief',scope='final candidate',exit_code=completed.returncode,duration_s=round(time.monotonic()-start,3),candidate=candidate,log=str(log.relative_to(root)))
    records.append(record)
    (out / 'gates.json').write_text(json.dumps(records,indent=2)+'\n')
    print(json.dumps(record),flush=True)
    if completed.returncode:
        raise SystemExit(completed.returncode)
assert before == inputs(), 'Implementation inputs changed during gates'
manifest = dict(candidate=candidate,recipe='SHA256 of UTF-8 JSON inputs map, sorted keys, compact separators; each input is file SHA256',scope='implementation/build/tests/assets only; Lead docs and generated target/dist excluded',captured_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),inputs=before,binary_sha256=digest(root/'dist/deck2'),assets={str(p.relative_to(root/'dist/assets')):digest(p) for p in sorted((root/'dist/assets').rglob('*')) if p.is_file()})
(out/'candidate.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Candidate captured: '+candidate,flush=True)
