/** Independent operator effects for the four published pre-adapter epochs.
 * This module is harness-only; it never grants product ownership of these files.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertFixtureHome } from './retirement-matrix-fixture';
import { publishedManualHashes, matchesPublishedManualOutcome, manualNativeCommands, manualProvisioningGaps } from './retirement-publication-contract';
import { fixtureSharedCodebase, pinnedDownload, upstreamPins } from './retirement-historical-effects';

export const manualFixtureModel = 'manual-external-tool-fixture-v1';
export const needsManualFixture = (version: string, runner: string) =>
  ['0.0.1', '0.0.2'].includes(version) && ['pi', 'opencode'].includes(runner);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');


/** Preserve the original manual result, including Pi's success:true/status:manual. */
export async function probePublishedManualEpoch(source: string, runner: string) {
  const inputs = [
    ['core', 'packages/core/src/index.ts'],
    [`${runner}/catalog`, `packages/adapter-${runner}/src/installation-plan.ts`],
    [`${runner}/installer`, `packages/adapter-${runner}/src/install-tools.ts`],
  ].map(([key, path]) => {
    const sha256 = hash(readFileSync(join(source, path!)));
    if (sha256 !== publishedManualHashes[key!]) throw Error('Unmapped manual epoch source');
    return { path, sha256 };
  });
  const catalog = await import(join(source, `packages/adapter-${runner}/src/installation-plan.ts`));
  const tools = catalog[runner === 'pi' ? 'PI_INSTALLABLE_TOOLS' : 'OPENCODE_INSTALLABLE_TOOLS'];
  const tool = tools.find((item: any) => item.id === 'codebase-memory');
  if (tools.some((item: any) => item.id === 'serena') || tool?.installKind !== 'external') throw Error('Manual epoch catalog changed');
  const installer = await import(join(source, `packages/adapter-${runner}/src/install-tools.ts`));
  let commands = 0;
  const outcome = await installer[runner === 'pi' ? 'installPiTools' : 'installOpenCodeTools'](
    process.execPath, [tool], () => {}, async () => { commands++; throw Error('Manual installer unexpectedly executed a command'); });
  if (commands || outcome.length !== 1 || !matchesPublishedManualOutcome(runner, outcome)) throw Error('Original manual installer behavior changed');
  return { inputs, serenaInCatalog: false, codebaseInstallKind: 'external', commands, outcome, historicalDeckInstallEffect: false };
}

/** Native format shared by provisioning and its independently checked postimage. */
function manualConfigPostimage(before: string | undefined, runner: string, commands: Record<string, string[]>) {
  const config = before === undefined ? {} : JSON.parse(before);
  const container = runner === 'pi' ? 'mcpServers' : 'mcp';
  config[container] ??= {};
  for (const [id, command] of Object.entries(commands)) {
    if (config[container][id]) throw Error('Manual fixture native configuration collision');
    config[container][id] = runner === 'pi' ? { command: command[0], args: command.slice(1) } : { type: 'local', command, enabled: true };
  }
  return JSON.stringify(config, null, 2);
}

/** The actual operator publication effect, isolated from Linux acquisition. */
export function publishManualNativeConfiguration(source: string, runner: string, home: string, artifacts: {capability:string;path:string}[]) {
  if (!['pi', 'opencode'].includes(runner)) throw Error('Unsupported manual native format');
  const path = join(home, runner === 'pi' ? '.pi/agent/mcp.json' : '.config/opencode/opencode.json');
  assertFixtureHome(home, path);
  const beforeContent = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const commands = manualNativeCommands(artifacts.find(item => item.capability === 'serena')!.path, artifacts.find(item => item.capability === 'codebase-memory')!.path);
  const content = manualConfigPostimage(beforeContent, runner, commands);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  const formatPath = `packages/adapter-${runner}/src/${runner === 'pi' ? 'pi-mcp-config' : 'opencode-mcp-config'}.ts`;
  return { path, sha256: hash(Buffer.from(content)), beforeContent,
    container: runner === 'pi' ? 'mcpServers' : 'mcp', commands, historicalDeckInstallEffect: false,
    publishedFormatSource: { path: formatPath, sha256: hash(readFileSync(join(source, formatPath))) } };
}

/** Validate before any migration effects. Never rewrite historical attribution or
 * authorize any other edited file. Review still checks these exact bytes again.
 */
export function historicalMigrationPreimages(home: string, runner: string, captured: {path:string;content:string}[], manual: any) {
  if (!manual) return captured;
  const gaps = manualProvisioningGaps(manual);
  if (gaps.length || manual.runner !== runner) throw Error('Manual fixture provenance mismatch: ' + gaps.join('; '));
  const path = join(home, runner === 'pi' ? '.pi/agent/mcp.json' : '.config/opencode/opencode.json');
  assertFixtureHome(home, path);
  if (manual.configuration.path !== path || manual.configuration.container !== (runner === 'pi' ? 'mcpServers' : 'mcp')) throw Error('Manual fixture native path mismatch');
  const original = captured.filter(entry => entry.path === path);
  if (original.length > 1 || runner === 'opencode' && original.length !== 1 || original.length === 1 && original[0]!.content !== manual.configuration.beforeContent) throw Error('Manual fixture original attribution mismatch');
  for (const artifact of manual.artifacts) {
    const expected = join(home, artifact.capability === 'serena' ? 'fixture-prerequisites/serena/venv/bin/serena' : 'fixture-prerequisites/codebase/codebase-memory-mcp');
    if (artifact.path !== expected) throw Error('Manual fixture artifact path mismatch');
    for (const item of [artifact, ...(artifact.capability === 'serena' ? [{path:artifact.lockPath,sha256:artifact.lockSha256}] : [])]) {
      assertFixtureHome(home, item.path);
      if (hash(readFileSync(item.path)) !== item.sha256) throw Error('Manual fixture preimage changed');
    }
  }
  const content = readFileSync(path, 'utf8');
  if (hash(Buffer.from(content)) !== manual.configuration.sha256 || content !== manualConfigPostimage(manual.configuration.beforeContent, runner, manual.configuration.commands)) throw Error('Manual fixture configuration postimage changed');
  return captured.map(entry => entry.path === path ? {...entry, content} : entry);
}

/** Acquires a hash-locked Python dependency inventory before any installation.
 * The exact root pin and UV bytes are retained inputs; the generated transitive
 * lock is retained evidence, not a claim of a previously verified online lock.
 */
export async function provisionManualFixture(source: string, runner: string, home: string) {
  assertFixtureHome(home);
  const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
  if (!needsManualFixture(version, runner)) throw Error('Manual fixture mapping is limited to 0.0.1/0.0.2 Pi/OpenCode');
  if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('Manual fixture acquisition requires Linux x64');
  const historicalProbe = await probePublishedManualEpoch(source, runner);
  const root = join(home, 'fixture-prerequisites/serena');
  assertFixtureHome(home, root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const archive = join(root, 'uv.tar.gz');
  writeFileSync(archive, await pinnedDownload(upstreamPins.uv), { flag: 'wx' });
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { cwd: home, env: { ...process.env, UV_CACHE_DIR: join(root, 'cache'), UV_PYTHON_PREFERENCE: 'only-managed', UV_PYTHON_INSTALL_DIR: join(root, 'python') }, encoding: 'utf8', timeout: 120000 });
    if (result.status !== 0) throw Error('Manual prerequisite command failed; installation is incomplete');
    return result.stdout;
  };
  run('tar', ['-xzf', archive, '--strip-components=1', '-C', root]);
  const uv = join(root, 'uv');
  if (hash(readFileSync(uv)) !== upstreamPins.uvBinarySha256) throw Error('Manual UV binary identity mismatch');
  const input = join(root, 'requirements.in'), lock = join(root, 'requirements.txt');
  writeFileSync(input, upstreamPins.serena + '\n', { flag: 'wx' });
  run(uv, ['pip', 'compile', '--python-version', '3.13.7', '--generate-hashes', input, '--output-file', lock]);
  if (!readFileSync(lock, 'utf8').includes('--hash=sha256:')) throw Error('Manual dependency lock has no hashes');
  run(uv, ['venv', '--python', '3.13.7', join(root, 'venv')]);
  run(uv, ['pip', 'install', '--require-hashes', '--python', join(root, 'venv/bin/python'), '-r', lock]);
  const serena = join(root, 'venv/bin/serena');
  const installed = run(join(root, 'venv/bin/python'), ['-c', 'import importlib.metadata; print(importlib.metadata.version("serena-agent"))']).trim();
  if (installed !== upstreamPins.serena.split('==')[1]) throw Error('Manual Serena version mismatch');
  run(serena, ['--help']);
  const codebase = await fixtureSharedCodebase(home);
  run(codebase.path, ['--version']);
  const artifacts = [
    { capability: 'serena', path: serena, sha256: hash(readFileSync(serena)), pin: upstreamPins.serena, lockPath: lock, lockSha256: hash(readFileSync(lock)), pythonVersion: '3.13.7', pythonSha256: hash(readFileSync(join(root, 'venv/bin/python'))), uvSha256: upstreamPins.uvBinarySha256 },
    { capability: 'codebase-memory', path: codebase.path, sha256: codebase.sha256, exposedAs: codebase.exposedAs, pin: 'codebase-memory-mcp@0.11.0' },
  ].map(artifact => ({ ...artifact, method: 'fixture-provisioned-shared-prerequisite', historicalDeckInstallEffect: false, probeStatus: 0, preserveWhenDisabled: true }));
  const configuration = publishManualNativeConfiguration(source, runner, home, artifacts);
  const evidence = { model: manualFixtureModel, version, runner, historicalProbe, artifacts, configuration };
  writeFileSync(join(home, 'manual-external-tool-fixture.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' });
  return evidence;
}
