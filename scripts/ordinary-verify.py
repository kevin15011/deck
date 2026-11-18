#!/usr/bin/env python3
"""One final candidate gate, manifest-derived; no private-state or personal update checks."""
import datetime,hashlib,json,os,pathlib,subprocess,time
root=pathlib.Path(__file__).resolve().parent.parent;out=root/os.environ.get('DECK2_EVIDENCE_DIR','target/ordinary/final-gates');out.mkdir(parents=True,exist_ok=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def inputs():
 paths=[root/n for n in ['.gitignore','Cargo.toml','Cargo.lock','rust-toolchain.toml','package.json','bun.lock','tsconfig.json']]
 for name in ['crates','frontend','scripts']:
  paths.extend(p for p in (root/name).rglob('*') if p.is_file() and 'node_modules' not in p.parts and '__pycache__' not in p.parts)
 return {str(p.relative_to(root)):sha(p) for p in sorted(paths)}
before=inputs();candidate=hashlib.sha256(json.dumps(before,sort_keys=True,separators=(',',':')).encode()).hexdigest();records=[]
commands=[('cargo fmt --all --check',240),('cargo clippy --locked --workspace --all-targets -- -D warnings',240),('cargo test --locked --workspace',240),('bun test ./frontend/src',240),('bash scripts/build.sh',360),('python3 scripts/ordinary-schema-boundary.py',240),('DECK2_EVIDENCE_DIR=target/ordinary/git node scripts/s8c-browser-acceptance.cjs',240),('DECK2_EVIDENCE_DIR=target/ordinary/images node scripts/s8b-browser-acceptance.cjs',240),('node scripts/motion-regressions.cjs',240),('node scripts/entrance-regression.cjs dist/deck2 target/ordinary/entrance.json',240),('DECK2_EVIDENCE_DIR=target/ordinary/queue node scripts/s6-queue-regression.cjs',240)]
for i,(command,timeout) in enumerate(commands):
 assert before==inputs(), "Inputs changed before gate command"
 start=time.monotonic();log=out/f'gate-{i}.log'
 with log.open('w') as f:r=subprocess.run(['bash','-c','source scripts/env.sh\nexport CARGO_BUILD_JOBS=2\nnice -n 10 '+command] if not command.startswith('DECK2_') else ['bash','-c','source scripts/env.sh\nexport CARGO_BUILD_JOBS=2\n'+command],cwd=root,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 record={'command':command,'source':'Cargo/package manifests, build.sh and ordinary-session acceptance','scope':'final required gate' if i<5 else 'affected packaged regression','exit_code':r.returncode,'duration_s':round(time.monotonic()-start,3),'candidate':candidate,'log':str(log.relative_to(root))};records.append(record);(out/'records.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(record),flush=True)
 if r.returncode:raise SystemExit(r.returncode)
assert before==inputs(),'Inputs changed during gate'
manifest={'candidate':candidate,'recipe':'SHA256 of sorted compact JSON mapping implementation paths to SHA256, unborn Git head; docs/generated outputs excluded','captured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'inputs':before,'binary_sha256':sha(root/'dist/deck2'),'assets':{str(p.relative_to(root/'dist/assets')):sha(p) for p in sorted((root/'dist/assets').rglob('*')) if p.is_file()}}
(out/'candidate.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Candidate '+candidate,flush=True)
