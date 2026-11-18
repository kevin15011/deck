#!/usr/bin/env python3
"""Freeze and verify one connected-session candidate without changing personal state."""
import datetime, hashlib, json, os, pathlib, shutil, subprocess, time
root=pathlib.Path(__file__).resolve().parents[1]
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def inputs():
 paths=[root/n for n in ['.gitignore','Cargo.toml','Cargo.lock','rust-toolchain.toml','package.json','bun.lock','tsconfig.json']]
 for name in ['crates','frontend','scripts']:
  paths.extend(p for p in (root/name).rglob('*') if p.is_file() and 'node_modules' not in p.parts and '__pycache__' not in p.parts)
 return {str(p.relative_to(root)):sha(p) for p in sorted(paths)}
before=inputs();candidate=hashlib.sha256(json.dumps(before,sort_keys=True,separators=(',',':')).encode()).hexdigest();out=root/'target'/('review-session-'+candidate[:8]);out.mkdir(parents=True,exist_ok=True)
commands=[('cargo fmt --all --check',240),('cargo clippy --locked --workspace --all-targets -- -D warnings',240),('cargo test --locked --workspace',240),('bun test ./frontend/src',240),('bash scripts/build.sh',360),('python3 scripts/ordinary-schema-boundary.py',240),('node scripts/session-parity-browser.cjs',240),('node scripts/session-parity-live-browser.cjs',720),('node scripts/layout-motion-browser.cjs',240),('node scripts/s8c-browser-acceptance.cjs',240),('node scripts/s8b-browser-acceptance.cjs',240),('node scripts/motion-regressions.cjs',240),('node scripts/entrance-regression.cjs dist/deck2 '+str(out/'entrance.json'),240),('node scripts/s6-queue-regression.cjs',240)]
records=[]
for i,(command,timeout) in enumerate(commands):
 assert before==inputs(),'Candidate changed before command'
 log=out/f'gate-{i}.log';env={**os.environ,'CARGO_BUILD_JOBS':'2','DECK2_EVIDENCE_DIR':str(out/f'exercise-{i}')};start=time.monotonic()
 with log.open('w') as f:
  try:
   run=subprocess.run(['bash','-c','source scripts/env.sh\nnice -n 10 '+command],cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=timeout);code=run.returncode
  except subprocess.TimeoutExpired:code=124
 record={'command':command,'source':'Cargo/package manifests, original session contract, retained layout and affected packaged regressions','scope':'required gate' if i<5 else 'packaged integration','candidate':candidate,'exit_code':code,'duration_s':round(time.monotonic()-start,3),'log':str(log.relative_to(root))};records.append(record);(out/'records.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(record),flush=True)
 if code:raise SystemExit(code)
assert before==inputs(),'Candidate changed during verification'
for n,h in before.items():
 target=out/'source'/n;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/n,target);assert sha(target)==h
shutil.copy2(root/'dist/deck2',out/'deck2');shutil.copytree(root/'dist/assets',out/'assets',dirs_exist_ok=True)
manifest={'candidate':candidate,'recipe':'SHA256 of sorted compact JSON mapping implementation paths to SHA256; unborn Git head; docs excluded','captured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'inputs':before,'binary_sha256':sha(out/'deck2'),'assets':{str(p.relative_to(out/'assets')):sha(p) for p in sorted((out/'assets').rglob('*')) if p.is_file()}}
(out/'candidate.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Frozen candidate '+str(out),flush=True)
