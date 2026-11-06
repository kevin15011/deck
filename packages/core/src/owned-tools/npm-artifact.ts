import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assertNoContributionSymlink } from '../runner-contributions';
import { withInstallationMutation } from '../installation-use';
/** Provider composition supplies immutable package pins; acquisition policy stays generic. */
export type OwnedNpmSpec = { lock: { packages: { '': unknown } }; command: string; package: string };
/** Privileged acquisition seam with integrity-checked, script-free semantics. */
export type NpmArtifactEffects = { acquire?: (stage: string) => Promise<void> };
export function createOwnedNpmTools<Id extends string>(specs: Record<Id, OwnedNpmSpec>) {
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const receiptName = '.deck-npm-receipt.json';
  const limit = 256 * 1024 * 1024;
  const inside = (root: string, path: string) => {
    const rel = relative(root, path);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  const lockText = (id: Id) => JSON.stringify(specs[id].lock, null, 2) + '\n';
  const packageText = (id: Id) => JSON.stringify(specs[id].lock.packages[''], null, 2) + '\n';
  function ownedNpmRoot(toolsRoot: string, id: Id): string {
    return join(toolsRoot, `npm-${id}-${hash(lockText(id)).slice(0, 16)}`);
  }
  function privateDirectory(path: string) {
    assertNoContributionSymlink(path);
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.mode & 0o077 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw Error('Npm directory is unsafe.');
  }
  /** Bounded complete tree identity, including modes and link targets. Never follows directory links. */
  function tree(root: string, metadata = false): string {
    privateDirectory(root);
    const entries: unknown[] = []; let bytes = 0, count = 0;
    const visit = (path: string) => {
      if (++count > 40_000) throw Error('Npm tree exceeds file bound.');
      const before = lstatSync(path, { bigint: true });
      const name = relative(root, path);
      const key = (s: typeof before) => [s.dev, s.ino, s.mode, s.size, s.mtimeNs, s.ctimeNs, s.uid].join(':');
      if (typeof process.getuid === 'function' && before.uid !== BigInt(process.getuid())) throw Error('Npm tree owner is unsafe.');
      if (before.isDirectory()) {
        entries.push([name, 'directory', Number(before.mode & 0o777n), ...(metadata ? [key(before)] : [])]);
        for (const child of readdirSync(path).sort()) {
          if (!metadata && path === root && child === receiptName) continue;
          visit(join(path, child));
        }
      } else if (before.isFile()) {
        if (before.size > BigInt(limit - bytes)) throw Error('Npm tree exceeds backup bound.');
        const content = readFileSync(path); bytes += content.length;
        if (content.length !== Number(before.size) || bytes > limit) throw Error('Npm tree changed during inspection.');
        entries.push([name, 'file', Number(before.mode & 0o777n), hash(content), ...(metadata ? [key(before)] : [])]);
      } else if (before.isSymbolicLink()) {
        const link = readlinkSync(path);
        if (isAbsolute(link) || !inside(root, resolve(path, '..', link))) throw Error('Npm tree contains an escaping link.');
        // A link chain must terminate inside this tree too, including intermediate directory links.
        if (!inside(root, realpathSync(path))) throw Error('Npm tree contains an escaping link.');
        entries.push([name, 'link', link, ...(metadata ? [key(before)] : [])]);
      } else throw Error('Npm tree contains unsupported content.');
      if (key(lstatSync(path, { bigint: true })) !== key(before)) throw Error('Npm tree changed during inspection.');
    };
    visit(root); return hash(JSON.stringify(entries));
  }
  function snapshot(root: string): string | undefined {
    assertNoContributionSymlink(root);
    return existsSync(root) ? tree(root, true) : undefined;
  }
  function verifyPins(root: string, id: Id) {
    for (const [name, expected] of [['package.json', packageText(id)], ['package-lock.json', lockText(id)]]) {
      const path = join(root, name!); assertNoContributionSymlink(path);
      if (!lstatSync(path).isFile() || readFileSync(path, 'utf8') !== expected) throw Error('Npm acquisition changed pinned inputs.');
    }
    const bin = join(root, 'node_modules', '.bin', specs[id].command);
    const actual = realpathSync(bin), packageRoot = join(root, 'node_modules', specs[id].package);
    const stat = lstatSync(actual);
    if (!inside(packageRoot, actual) || !stat.isFile() || !(stat.mode & 0o111)) throw Error('Npm executable is outside its pinned package.');
  }
  function ownedNpmCommand(toolsRoot: string, id: Id): string | undefined {
    const root = ownedNpmRoot(toolsRoot, id);
    try {
      assertNoContributionSymlink(root);
      const receiptPath = join(root, receiptName); assertNoContributionSymlink(receiptPath);
      const stat = lstatSync(receiptPath);
      if (!stat.isFile() || stat.size > 1024 || stat.mode & 0o077) return undefined;
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      verifyPins(root, id);
      if (receipt.schema !== 1 || receipt.lock !== hash(lockText(id)) || receipt.tree !== tree(root)) return undefined;
      return join(root, 'node_modules', '.bin', specs[id].command);
    } catch { return undefined; }
  }
  async function acquire(stage: string, work: string): Promise<void> {
    // No inherited npm credentials/configuration, package scripts, mutable dependency resolution or
    // shared cache. npm ci verifies every downloaded tarball against the shipped integrity lock.
    const config = join(work, 'user.npmrc'), globalConfig = join(work, 'global.npmrc');
    for (const path of [config, globalConfig]) writeFileSync(path, '', { mode: 0o600, flag: 'wx' });
    const command = typeof Bun !== 'undefined' ? Bun.which('npm') : undefined;
    if (!command) throw Error('Pinned npm acquisition requires npm.');
    await new Promise<void>((done, reject) => {
      const child = spawn(command, ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', '--userconfig', config, '--globalconfig', globalConfig, '--cache', join(work, 'cache')], {
        cwd: stage, env: { HOME: work, PATH: process.env.PATH ?? '', TMPDIR: work }, stdio: 'ignore',
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); code === 0 ? done() : reject(Error('Pinned npm acquisition failed.')); });
    });
  }
  /** Only the enumerated per-tool generated root is replaced. Native tools and historical shared
   * node_modules are preserved. The caller additionally holds its runner admission/fence scope. */
  async function installOwnedNpmTool(input: { toolsRoot: string; id: Id; effects?: NpmArtifactEffects; publishReceipt?: (root: string) => void }): Promise<'installed' | 'unchanged'> {
    return withInstallationMutation(input.toolsRoot, async () => {
      privateDirectory(input.toolsRoot);
      const root = ownedNpmRoot(input.toolsRoot, input.id);
      if (ownedNpmCommand(input.toolsRoot, input.id)) {
        input.publishReceipt?.(root); return 'unchanged';
      }
      const before = snapshot(root);
      const token = `${Date.now()}-${randomUUID()}`;
      const stage = join(input.toolsRoot, `.npm-stage-${token}`), work = join(input.toolsRoot, `.npm-work-${token}`);
      mkdirSync(stage, { mode: 0o700 }); mkdirSync(work, { mode: 0o700 });
      let backup: string | undefined, backupIdentity: string | undefined, published: string | undefined;
      try {
        writeFileSync(join(stage, 'package.json'), packageText(input.id), { flag: 'wx', mode: 0o600 });
        writeFileSync(join(stage, 'package-lock.json'), lockText(input.id), { flag: 'wx', mode: 0o600 });
        await (input.effects?.acquire ? input.effects.acquire(stage) : acquire(stage, work));
        verifyPins(stage, input.id);
        const digest = tree(stage);
        writeFileSync(join(stage, receiptName), JSON.stringify({ schema: 1, lock: hash(lockText(input.id)), tree: digest }), { mode: 0o600, flag: 'wx' });
        if (snapshot(root) !== before) throw Error('Npm destination changed during acquisition.');
        if (before !== undefined) {
          const backups = join(input.toolsRoot, '.npm-replaced');
          assertNoContributionSymlink(backups); mkdirSync(backups, { mode: 0o700, recursive: true }); privateDirectory(backups);
          const prefix = `npm-${input.id}-`;
          const prior = readdirSync(backups).filter(name => new RegExp(`^${prefix}[0-9]{13}-[a-f0-9-]{36}$`).test(name)).sort();
          // Validate every retained preimage before pruning. Never follow links while deleting.
          for (const name of prior) tree(join(backups, name), true);
          while (prior.length >= 2) rmSync(join(backups, prior.shift()!), { recursive: true });
          backup = join(backups, `${prefix}${token}`);
          if (snapshot(root) !== before) throw Error('Npm destination changed before publication.');
          renameSync(root, backup); backupIdentity = snapshot(backup);
        }
        // No await between final comparison, directory publication and receipt accounting.
        renameSync(stage, root); published = snapshot(root);
        if (!ownedNpmCommand(input.toolsRoot, input.id)) throw Error('Npm publication verification failed.');
        input.publishReceipt?.(root);
        return 'installed';
      } catch (error) {
        // Restore only this invocation's exact postimage; concurrent edits retain private evidence.
        if (published !== undefined && snapshot(root) === published) rmSync(root, { recursive: true });
        if (backup && !existsSync(root) && snapshot(backup) === backupIdentity) renameSync(backup, root);
        throw error;
      } finally {
        // Stage/work are unique acquisition-owned roots; destination and backups are never swept.
        rmSync(stage, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true });
      }
    });
  }

  return { ownedNpmRoot, ownedNpmCommand, installOwnedNpmTool };
}
