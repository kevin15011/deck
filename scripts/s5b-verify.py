#!/usr/bin/env python3
"""Capture exact implementation inputs and run the manifest-derived S5b gates."""
import datetime,hashlib,json,os,pathlib,subprocess,time
root=pathlib.Path(__file__).resolve().parent.parent;out=root/os.environ.get('DECK2_EVIDENCE_DIR','target/s5b-verification/final');out.mkdir(parents=True,exist_ok=True)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def inputs():
 paths=[root/n for n in ['.gitignore','Cargo.toml','Cargo.lock','rust-toolchain.toml','package.json','bun.lock','tsconfig.json']]
 for name in ['crates','frontend','scripts']:
  paths.extend(p for p in (root/name).rglob('*') if p.is_file() and 'node_modules' not in p.parts and '__pycache__' not in p.parts)
 return {str(p.relative_to(root)):digest(p) for p in sorted(paths)}
before=inputs();candidate='unborn-head:implementation-sha256:'+hashlib.sha256(json.dumps(before,sort_keys=True,separators=(',',':')).encode()).hexdigest();records=[]
commands=['cargo fmt --all --check','cargo clippy --locked --workspace --all-targets -- -D warnings','cargo test --locked --workspace','bun test ./frontend/src/api.test.ts ./frontend/src/configuration-pending.test.ts','bash scripts/build.sh','python3 scripts/recovery-regression.py','python3 scripts/session-origin-regression.py']
for i,command in enumerate(commands):
 start=time.monotonic();log=out/f'gate-{i}.log'
 with log.open('w') as f:r=subprocess.run(['bash','-c','source scripts/env.sh\n'+command],cwd=root,stdout=f,stderr=subprocess.STDOUT)
 record={'command':command,'source':'Cargo manifests, package.json, scripts/build.sh and S5b handoff','scope':'full candidate' if i<5 else 'affected packaged regression','exit_code':r.returncode,'duration_s':round(time.monotonic()-start,3),'candidate':candidate,'log':str(log.relative_to(root))};records.append(record);(out/'gates.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(record),flush=True)
 if r.returncode:raise SystemExit(r.returncode)
assert before==inputs(),'Implementation inputs changed during gates'
manifest={'candidate':candidate,'recipe':'SHA256 of UTF-8 JSON inputs map, sorted keys, compact separators; each input is file SHA256','scope':'implementation/build/tests/assets only; Lead docs and generated target/dist excluded','captured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'inputs':before,'binary_sha256':digest(root/'dist/deck2'),'assets':{str(p.relative_to(root/'dist/assets')):digest(p) for p in sorted((root/'dist/assets').rglob('*')) if p.is_file()}}
(out/'candidate.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Candidate captured: '+candidate,flush=True)
