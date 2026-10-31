import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { assertNoContributionSymlink, contributionHash } from './runner-contributions';

export type RunnerGenerationReference = { root: string; selectionPath: string; selectionHash: string };
const paths = (root: string) => ({ gate: join(dirname(root), `.${basename(root)}.retiring`), references: join(dirname(root), '.launch-references', basename(root)) });

/** A shared gate prevents a collector and a Deck launch from crossing their checks. */
export function acquireRunnerGenerationReference(reference: RunnerGenerationReference): () => void {
  const { root, selectionPath, selectionHash } = reference;
  assertNoContributionSymlink(root); assertNoContributionSymlink(selectionPath);
  const { gate, references } = paths(root);
  assertNoContributionSymlink(references); assertNoContributionSymlink(gate);
  if (existsSync(gate)) throw new Error('Plugin generation is being retired; prepare a new launch.');
  mkdirSync(references, { recursive: true, mode: 0o700 });
  const lease = join(references, `${process.pid}-${randomUUID()}.json`);
  writeFileSync(lease, JSON.stringify({ pid: process.pid, root: resolve(root) }), { flag: 'wx', mode: 0o600 });
  try {
    if (existsSync(gate) || !existsSync(root) || contributionHash(readFileSync(selectionPath)) !== selectionHash) throw new Error('Plugin selection changed; prepare a new launch.');
  } catch (error) { unlinkSync(lease); throw error; }
  // An interrupted supervisor leaves evidence for explicit recovery, never an inferred unused generation.
  return () => { assertNoContributionSymlink(lease); unlinkSync(lease); };
}

/** Only PID/plugin arguments are inspected. No native database, history, environment or credential reads. */
export function inspectRunnerGenerationReferences(root: string, selectionPath: string): string[] {
  const reasons: string[] = [];
  try {
    assertNoContributionSymlink(root); assertNoContributionSymlink(selectionPath);
    if (existsSync(selectionPath)) {
      const selection = JSON.parse(readFileSync(selectionPath, 'utf8'));
      if (typeof selection.plugin !== 'string' || !/^developer-team-v\d+(?:-[a-f0-9]+)?$/.test(selection.plugin)) throw new Error('Invalid selection');
      if (join(dirname(root), selection.plugin) === resolve(root)) reasons.push('Current plugin selection references this generation; publish and verify a replacement first');
    }
    if (existsSync(join(dirname(root), 'manifest.json.pending'))) reasons.push('Plugin publication is pending recovery');
    const { references } = paths(root); assertNoContributionSymlink(references);
    if (existsSync(references) && readdirSync(references).length) reasons.push('Launch reference receipts remain; active or interrupted launches must finish/recover before collection');
  } catch { reasons.push('Plugin selection or launch references cannot be safely inspected'); }
  // Covers launches made before reference receipts existed, and independently launched native processes.
  if (process.platform !== 'linux' || !existsSync('/proc')) return [...reasons, 'Native process reference inspection is unavailable on this platform'];
  try {
    for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      try {
        if (typeof process.getuid === 'function' && lstatSync(`/proc/${pid}`).uid !== process.getuid()) continue;
        const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
        const pluginPaths: string[] = [];
        for (let index = 0; index < args.length; index++) {
          if (args[index]?.startsWith('--plugin-dir=')) pluginPaths.push(args[index]!.slice('--plugin-dir='.length));
          else if (args[index] === '--plugin-dir') {
            while (args[index + 1] && !args[index + 1]!.startsWith('-')) pluginPaths.push(args[++index]!);
          }
        }
        if (pluginPaths.some(path => {
          const candidate = resolve(path.startsWith('/') ? '/' : readlinkSync(`/proc/${pid}/cwd`), path);
          try { return realpathSync(candidate) === resolve(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
        })) reasons.push(`Native process ${pid} references this plugin generation`);
      } catch (error) { if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    }
  } catch { reasons.push('Native process references cannot be completely inspected'); }
  return reasons;
}

/** Apply must take the gate and repeat read-only reference checks, even for an approved old plan. */
export function guardRunnerGenerationRetirement(root: string, selectionPath: string): () => void {
  const { gate } = paths(root); assertNoContributionSymlink(gate);
  writeFileSync(gate, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
  try {
    const reasons = inspectRunnerGenerationReferences(root, selectionPath);
    if (reasons.length) throw new Error(`Plugin generation remains referenced: ${reasons.join('; ')}`);
  } catch (error) { unlinkSync(gate); throw error; }
  return () => { assertNoContributionSymlink(gate); unlinkSync(gate); };
}
