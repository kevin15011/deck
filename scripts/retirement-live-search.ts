/** A live check, never part of mocked unit gates and never a model/session call. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { assertFixtureHome } from './retirement-matrix-fixture';
import { pinnedDownload } from './retirement-historical-effects';

const pin = {
  url: 'https://raw.githubusercontent.com/anomalyco/opencode/v1.1.4/packages/opencode/src/tool/websearch.ts',
  sha256: '72c693e29135b94db95e5f05316cbb6de762a62b00893ecc82418f904fd9249f', maxBytes: 20000,
};

export async function probeOpenCodeLiveSearch(home: string) {
  assertFixtureHome(home);
  const source = await pinnedDownload(pin), path = join(home, 'pinned-native-websearch.ts');
  writeFileSync(path, source);
  const built = await Bun.build({ entrypoints: [path], target: 'bun', plugins: [{ name: 'fixture-tool-host', setup(builder) {
    // The original execute body, HTTP transport and response parser run intact.
    // Replace only the runner's registration/description boundary; fixture
    // permission consent is supplied below, without modifying runner trust.
    builder.onResolve({ filter: /^\.\/tool$/ }, () => ({ path: 'host', namespace: 'fixture' }));
    builder.onResolve({ filter: /^\.\/websearch\.txt$/ }, () => ({ path: 'description', namespace: 'fixture' }));
    builder.onResolve({ filter: /^zod$/ }, () => ({ path: require.resolve('zod') }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'host'
      ? 'export const Tool = { define: (_id, definition) => definition };'
      : 'export default "Pinned native search live fixture";' }));
  } }] });
  if (!built.success || built.outputs.length !== 1) throw Error('Pinned native tool build failed');
  const bundle = join(home, 'native-websearch-live.mjs');
  await Bun.write(bundle, built.outputs[0]!);
  const tool = (await import(bundle)).WebSearchTool;
  const query = 'Bun JavaScript runtime official documentation';
  let permissionChecked = false;
  const result = await tool.execute({ query, numResults: 1, type: 'fast', contextMaxCharacters: 1000 }, {
    abort: new AbortController().signal,
    ask: async (request: any) => {
      if (request.permission !== 'websearch' || request.patterns?.length !== 1 || request.patterns[0] !== query) throw Error('Unexpected fixture permission request');
      permissionChecked = true;
    },
  });
  if (!permissionChecked || typeof result.output !== 'string' || !/https:\/\//.test(result.output)) throw Error('Live native search returned no verifiable result');
  return { status: 'verified', evidence: 'real-provider-query', source: pin, query, permission: 'explicit-isolated-fixture-query',
    responseSha256: createHash('sha256').update(result.output).digest('hex'), responseCharacters: result.output.length,
    scope: 'Pinned official native execute body and real Exa provider; registration host/permission context supplied by fixture; no native/model session' };
}

/** Exercise the configured fallback command over its real stdio MCP protocol. */
export async function probeFallbackMcpSearch(home: string, command: readonly string[], environment: NodeJS.ProcessEnv, timeoutMs = 60000) {
  assertFixtureHome(home);
  if (environment.HOME !== home || !command[0]) throw Error('Isolated search process required');
  const { spawn } = await import('node:child_process');
  const { createInterface } = await import('node:readline');
  const child = spawn(command[0], command.slice(1), { cwd: home, env: environment, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let failure: Error | undefined, sequence = 0, received = 0;
  const fail = (message: string) => {
    failure ??= Error(message);
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
    child.kill('SIGKILL');
  };
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    received += Buffer.byteLength(line);
    if (received > 1024 * 1024) return fail('Search MCP response exceeded fixture limit');
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(Error('Search MCP request failed'));
      else request.resolve(message.result);
    } catch { fail('Invalid search MCP response'); }
  });
  child.once('error', () => fail('Search MCP process failed'));
  child.once('close', () => { if (pending.size) fail('Search MCP process exited before its response'); });
  child.stdin.on('error', () => fail('Search MCP input failed'));
  const timer = setTimeout(() => fail('Search MCP query timed out'), timeoutMs);
  const request = (method: string, params: any) => new Promise<any>((resolve, reject) => {
    if (failure) return reject(failure);
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'deck-retirement-fixture', version: '1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const inventory = await request('tools/list', {});
    if (!inventory?.tools?.some((tool: any) => tool.name === 'tavily_search')) throw Error('Configured search MCP tool is unavailable');
    const query = 'Bun JavaScript runtime official documentation';
    const result = await request('tools/call', { name: 'tavily_search', arguments: { query, max_results: 1, search_depth: 'basic', include_raw_content: false } });
    if (result?.isError) throw Error('Search MCP tool failed');
    const output = JSON.stringify(result?.content);
    if (!output || !/https:\/\//.test(output)) throw Error('Search MCP returned no verifiable result');
    return { status: 'verified', evidence: 'real-provider-query', transport: 'stdio-mcp', command, query,
      responseSha256: createHash('sha256').update(output).digest('hex'), responseCharacters: output.length,
      scope: 'Configured installed fallback command and real provider query; no model session' };
  } finally {
    clearTimeout(timer); lines.close(); child.stdin.destroy(); child.kill('SIGKILL'); await closed;
  }
}
