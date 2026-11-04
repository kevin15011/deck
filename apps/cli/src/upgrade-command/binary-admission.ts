import { existsSync } from 'node:fs';
import { withIdleRunnerMutation } from '@deck/session-host';
import { withInstallationMutation } from '../../../../packages/core/src/installation-use';
/** Reserve all installed native roots across the atomic executable swap; native children retain their leases. */
export function withBinaryUpgradeAdmission<T>(roots: readonly string[], effect: () => Promise<T>, admit: <R>(effect: () => Promise<R>) => Promise<R> = withIdleRunnerMutation): Promise<T> {
 const installed = [...new Set(roots)].filter(root=>existsSync(root)).sort();
 const reserve = (index: number): Promise<T> => index === installed.length ? effect() : withInstallationMutation(installed[index]!,()=>reserve(index+1));
 return admit(()=>reserve(0));
}
