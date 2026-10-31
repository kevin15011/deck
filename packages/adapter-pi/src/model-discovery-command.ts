import { acquireInstallationUse } from '../../core/src/installation-use';
import { resolvePiAgentDir } from './agent-dir';
/** Inventory never loads extensions, even when the installation is absent or customized. */
export function runPiModelDiscovery<T>(command: string, args: string[], run: (command: string, args: string[]) => T, env: NodeJS.ProcessEnv = process.env): T {
 const resolved=resolvePiAgentDir(env,env.HOME ?? '');
 if(!resolved.ok)throw new Error(resolved.message);
 const held=acquireInstallationUse(resolved.dir);
 try { return run(command,[...args,'--no-extensions','--no-skills','--no-context-files','--no-prompt-templates']); }
 finally { held.release(); }
}
