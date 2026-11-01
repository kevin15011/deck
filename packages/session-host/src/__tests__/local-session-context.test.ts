import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { EventLog } from '../event-log';
import { readLocalContext, localContextWatermark } from '../local-session-context';
import { cleanupTempDirs, tempDir } from './test-helpers';
afterEach(cleanupTempDirs);

// Protects immediate cross-runner context from remote capture latency. Oracle:
// the durable public records survive restart, keep source identity/order, and
// never turn private reasoning, credentials or historical text into authority.
test('public observations survive failure/restart and remain ordered with explicit paging', () => {
  const dir=join(tempDir(),'events'); let log=EventLog.open({dir,sessionId:'s'});
  log.append({kind:'message.completed',source:{taskId:'a',memberId:'quality',runnerId:'codex'},data:{attempt:2,role:'assistant',text:'Use violet. api_key=FAKE_PRIVATE'}});
  log.append({kind:'reasoning.delta',data:{text:'PRIVATE_REASONING'}});
  log.append({kind:'message.completed',data:{internal:true,text:'PRIVATE_INTERNAL'}});
  log.append({kind:'tool.completed',source:{taskId:'a',runnerId:'codex'},data:{attempt:2,text:'All observations count.'}});
  log.append({kind:'turn.completed',source:{taskId:'a'},data:{attempt:2,status:'failed'}});
  log.close(); log=EventLog.open({dir,sessionId:'s'});
  try {
    const page=readLocalContext(log,{});
    expect(page.records.map(r=>r.seq)).toEqual([1,4,5]);
    expect(page.records[0]).toMatchObject({source:{taskId:'a',memberId:'quality',runnerId:'codex'},attempt:2});
    expect(JSON.stringify(page)).toContain('Use violet');
    expect(JSON.stringify(page)).not.toContain('FAKE_PRIVATE');
    expect(JSON.stringify(page)).not.toContain('PRIVATE_REASONING');
    expect(JSON.stringify(page)).not.toContain('PRIVATE_INTERNAL');
    for(let i=0;i<80;i++)log.append({kind:'message.completed',data:{text:`correction ${i}`}});
    const last=readLocalContext(log,{}); expect(last.before).toBeDefined();
    const previous=readLocalContext(log,{before:last.before});
    expect(previous.records.at(-1)!.seq).toBeLessThan(last.records[0]!.seq);
    expect(new Set([...previous.records,...last.records].map(r=>r.seq)).size).toBe(previous.records.length+last.records.length);
  } finally {log.close();}
});

// Protects exact delivery accounting, including native identity changes. No
// provider writes or semantic text matching may suppress changed observations.
test('only confirmed same-native-context delivery advances the resume watermark', () => {
  const log=EventLog.open({dir:join(tempDir(),'events'),sessionId:'s'});
  try {
    log.append({kind:'diagnostic',source:{taskId:'t',runnerId:'codex',nativeSessionId:'native'},data:{code:'session.context-delivered',through:9,attempt:1}});
    expect(localContextWatermark(log,'t','codex','native')).toBe(9);
    expect(localContextWatermark(log,'t','claude','native')).toBe(0);
    expect(localContextWatermark(log,'other','codex','native')).toBe(0);
    expect(localContextWatermark(log,'t','codex')).toBe(0);
  } finally {log.close();}
});

// Protects availability rather than guessing that a preview is complete, and
// prevents a secret question answer from leaking through the history read tool.
test('long records are explicitly pageable and legacy secret answers stay excluded', () => {
  const log=EventLog.open({dir:join(tempDir(),'events'),sessionId:'s'});
  try {
    const text='Observation '.repeat(600);
    log.append({kind:'message.completed',data:{text}});
    log.append({kind:'question.requested',data:{questionId:'q',questions:[{id:'public',secret:false},{id:'secret',secret:true}]}});
    log.append({kind:'question.resolved',data:{questionId:'q',outcome:'answered',by:'user',answers:{public:['violet'],secret:['SECRET_ANSWER']}}});
    const page=readLocalContext(log,{}); expect(page.records[0]!.nextOffset).toBeDefined();
    let content='',offset=0;
    for(;;){const row=readLocalContext(log,{eventSeq:1,offset}).records[0]!;content+=row.content;if(row.nextOffset===undefined)break;offset=row.nextOffset;}
    expect(JSON.parse(content)).toEqual({text});
    expect(JSON.stringify(page)).toContain('violet');expect(JSON.stringify(page)).not.toContain('SECRET_ANSWER');
    expect(readLocalContext(log,{eventSeq:2}).records[0]!.content).toContain('"id":"public"');
    expect(readLocalContext(log,{eventSeq:2}).records[0]!.content).not.toContain('"id":"secret"');
    expect(()=>readLocalContext(log,{before:NaN})).toThrow('context-cursor-invalid');
    expect(()=>readLocalContext(log,{offset:1})).toThrow('context-cursor-invalid');
    expect(readLocalContext(log,{before:0}).records).toEqual([]);
  } finally {log.close();}
});
