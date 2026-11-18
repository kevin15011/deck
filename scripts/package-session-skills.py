from pathlib import Path
import json,hashlib,re,argparse
parser=argparse.ArgumentParser(description='Package the finite licensed canonical skill source; never install or execute resources.')
parser.add_argument('--source',type=Path,required=True)
args=parser.parse_args()
source=args.source.resolve()
entries=[]
for folder in sorted(source.iterdir()):
 main=folder/'SKILL.md'
 if not folder.is_dir() or not main.is_file():continue
 text=main.read_text()
 description=re.search(r'^description:\s*(.*)',text,re.M)
 resources={}
 for p in sorted(folder.rglob('*')):
  if p.is_symlink() or not p.is_file() or p.suffix not in ['.md','.json','.txt']:continue
  if not p.resolve().is_relative_to(folder.resolve()):continue
  b=p.read_bytes()
  if len(b)>256*1024:continue
  try:body=b.decode()
  except UnicodeError:continue
  resources[p.relative_to(folder).as_posix()]={'text':body,'sha256':hashlib.sha256(b).hexdigest()}
 entries.append({'name':folder.name,'description':description[1].strip(' \"\'') if description else folder.name,'source':'deck/skills/external/'+folder.name,'resources':resources})
p=Path('crates/host/assets/session-skills.json');p.write_text(json.dumps({'version':1,'skills':entries},ensure_ascii=False,separators=(',',':'))+'\n')
print(len(entries),'skills;',sum(len(e['resources']) for e in entries),'resources;',p.stat().st_size,'bytes')
