import type { RunnerAdmissionResult } from '@deck/core';
import type { CodexTools } from './tools';
import { inspectCodexOwnedHookIds } from './codex-config';
import { isCodexOfficialSupermemoryConfigured, isDeckManagedCodexMcpServer } from './mcp-config';

/** Local artifact policy shared by plan, install verification, admission and launch. No credential/network effects. */
export function inspectCodexSupermemoryReadiness(source: string, tools: CodexTools): RunnerAdmissionResult['checks'] {
 const nodeCommand=tools.node.command(),script=tools.supermemory.proxy();
 const required: [string,boolean][] = [
  ['supermemory-plugin-unavailable',tools.supermemory.state()==='ready'],
  ['supermemory-node-unavailable',nodeCommand!==undefined],
  ['supermemory-hooks-missing',inspectCodexOwnedHookIds(source).includes('supermemory')],
  ['supermemory-proxy-unconfigured',!!nodeCommand&&!!script&&isCodexOfficialSupermemoryConfigured(source,{nodeCommand,script})],
  ['legacy-memory-mcp-present',!isDeckManagedCodexMcpServer(source,'deck-memory')],
 ];
 return required.filter(([,ready])=>!ready).map(([id])=>({id,status:'fail',required:true,remediation:id==='supermemory-node-unavailable'?'install-node':'run-review-install'}));
}
