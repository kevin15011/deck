import type { RunnerAdapter } from '@deck/core';
import { withIdleRunnerMutation } from '@deck/session-host';
export type RunnerMutationAdmission = <T>(effect: () => T | Promise<T>) => Promise<T>;
/** CLI production composition: every runner write, including direct install/repair/replacement. */
export function guardRunnerAdapter(adapter: RunnerAdapter, admission: RunnerMutationAdmission = withIdleRunnerMutation): RunnerAdapter {
  const writes = new Set<PropertyKey>(['runAction','applyDeveloperTeamInstall','writeMcpConfig','cleanupLegacyInstall','rollbackDeveloperTeamFiles']);
  return new Proxy(adapter, {get(target,key) {
    const value = Reflect.get(target,key,target);
    if (typeof value !== 'function') return value;
    return writes.has(key) ? (...args: unknown[]) => admission(()=>value.apply(target,args)) : value.bind(target);
  }});
}
