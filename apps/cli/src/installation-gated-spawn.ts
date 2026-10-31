import { spawn, type SpawnOptions } from 'node:child_process';
import type { Writable } from 'node:stream';

/** Keep the child behind a pipe gate until its birth-bound installation lease exists.
 * Parent death before registration closes the pipe, so the command cannot execute.
 * Call register synchronously, before yielding or using the child streams.
 */
export function spawnInstallationGated(
  command: string, args: readonly string[],
  options: { cwd: string; env: Record<string,string>; stdio: Exclude<SpawnOptions['stdio'], string | undefined>;
    onSpawn?: (pid: number) => (() => void) | undefined },
  spawner: typeof spawn = spawn,
) {
  const gated = !!options.onSpawn;
  const child = spawner(gated ? '/bin/sh' : command, gated
    ? ['-c', 'IFS= read -r grant <&3 && [ "$grant" = launch ] || exit 125; exec 3<&-; exec "$@"', 'deck-launch-gate', command, ...args]
    : [...args], {cwd: options.cwd, env: options.env, stdio: [...options.stdio, ...(gated ? ['pipe' as const] : [])]});
  const gate = child.stdio[3] as Writable | null;
  gate?.on('error', () => {});
  return {child, register() {
    if (!gated) return undefined;
    let release: (() => void) | undefined;
    try {
      if (child.pid === undefined) throw new Error('native-child-pid-unavailable');
      release = options.onSpawn!(child.pid);
      if (!release) throw new Error('native-child-lease-unavailable');
      gate!.end('launch\n');
      return release;
    } catch (error) {
      gate?.end();
      child.kill();
      child.once('error', () => {});
      child.once('close', () => release?.());
      throw error;
    }
  }};
}
