import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureMarker } from './retirement-matrix-fixture';
import { probeFallbackMcpSearch } from './retirement-live-search';

function fixture(error = false) {
  const home = mkdtempSync(join(tmpdir(), 'nrp-search-contract-'));
  writeFileSync(join(home, '.retirement-fixture'), fixtureMarker);
  const server = join(home, 'fake-mcp.ts');
  writeFileSync(server, `import { appendFileSync } from 'node:fs';
    const lines = (await import('node:readline')).createInterface({ input: process.stdin });
    for await (const line of lines) {
      const request = JSON.parse(line);
      appendFileSync(process.env.HOME + '/requests.jsonl', line + '\\n');
      if (!('id' in request)) continue;
      const result = request.method === 'initialize' ? {protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}
        : request.method === 'tools/list' ? {tools:[{name:'tavily_search',inputSchema:{type:'object'}}]}
        : {isError:${error},content:[{type:'text',text:'${error ? 'SYNTHETIC-secret' : 'https://bun.sh/docs'}'}]};
      console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
    }`);
  return { home, command: [process.execPath, server] };
}

test('fallback search executes MCP initialization, tool discovery and the actual tool call', async () => {
  const { home, command } = fixture();
  const result = await probeFallbackMcpSearch(home, command, { ...process.env, HOME: home }, 5000);
  expect(result.status).toBe('verified');
  expect(result.evidence).toBe('real-provider-query');
  const requests = readFileSync(join(home, 'requests.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(requests.map(r => r.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  expect(requests.at(-1).params.name).toBe('tavily_search');
  expect(JSON.stringify(result)).not.toContain('https://bun.sh/docs');
});

test('fallback MCP errors fail without disclosing tool response content', async () => {
  const { home, command } = fixture(true);
  await expect(probeFallbackMcpSearch(home, command, { ...process.env, HOME: home }, 5000)).rejects.toThrow('Search MCP tool failed');
});
