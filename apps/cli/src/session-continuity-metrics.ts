/** Offline usage: bun run apps/cli/src/session-continuity-metrics.ts <session-events-dir> [output.json]
 * Reads existing event segments only. Does not open a daemon, driver or provider. */
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {validateSessionEvent,type SessionEvent} from '@deck/core/session/events';
import {projectTaskContinuityMetrics} from '@deck/session-host';
export function readContinuityMetrics(eventsDir:string){
 function* events():Generator<SessionEvent>{
  for(const name of readdirSync(eventsDir).filter(n=>/^\d{6}\.jsonl$/.test(n)).sort())for(const line of readFileSync(join(eventsDir,name),'utf8').split('\n'))if(line.trim()){
   const parsed=validateSessionEvent(JSON.parse(line));if(!parsed.ok)throw new Error(`Invalid event segment ${name}: ${parsed.errors.join(', ')}`);yield parsed.value;
  }
 }
 return projectTaskContinuityMetrics(events());
}
if(import.meta.main){
 const [eventsDir,output]=process.argv.slice(2);if(!eventsDir)throw new Error('Usage: session-continuity-metrics.ts <session-events-dir> [output.json]');
 const report=JSON.stringify(readContinuityMetrics(eventsDir),null,2)+'\n';
 if(output)writeFileSync(output,report,{mode:0o600,flag:'wx'});else process.stdout.write(report);
}
