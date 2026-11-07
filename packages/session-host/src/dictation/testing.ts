import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ModelStore} from './model-store';
import {MODEL_CATALOG} from './catalog';
export function dictationFixture(fullCatalog=false){
 const root=mkdtempSync(join(tmpdir(),'deck-dictation-')),dir=join(root,'dictation');mkdirSync(dir,{mode:0o700});
 const bytes=Buffer.from('fixture weights, never actual inference');const artifact={...MODEL_CATALOG[0]!,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const runtime=join(root,'whisper-cli');writeFileSync(runtime,`#!/bin/sh\nif [ "$1" = "-h" ]; then echo ' -m -f -l -t -nt -np -mc -sns -oj -of ' >&2; exit 0; fi\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-of" ]; then shift; out="$1"; fi; shift; done\nprintf '%s' '{"transcription":[{"text":" local fixture transcript"}]}' > "$out.json"\n`,{mode:0o700});
 const store=new ModelStore(dir,(async()=>new Response(bytes)) as unknown as typeof fetch,fullCatalog?[artifact,...MODEL_CATALOG.slice(1)]:[artifact]);
 return{root,dir,bytes,artifact,runtime,store,clean:()=>rmSync(root,{recursive:true,force:true})};
}
