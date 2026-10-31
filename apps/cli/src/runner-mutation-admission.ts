import type { RunnerAdapter } from '@deck/core';
import { withIdleRunnerMutation, RunnerMutationDeferredError } from '@deck/session-host';
export type RunnerMutationAdmission = <T>(effect: () => T | Promise<T>) => Promise<T>;
/** CLI production composition: every runner write, including direct install/repair/replacement. */
export function guardRunnerAdapter(adapter: RunnerAdapter, admission: RunnerMutationAdmission = withIdleRunnerMutation, refreshSkills?: (projectRoot: string) => Promise<void>): RunnerAdapter {
  const writes = new Set<PropertyKey>(['runAction','applyDeveloperTeamInstall','writeMcpConfig','rollbackDeveloperTeamFiles']);
  return new Proxy(adapter, {get(target,key) {
    const value = Reflect.get(target,key,target);
    if (typeof value !== 'function') return value;
    if (key === 'prepareSessionNativeRole' && target.runnerId === 'codex') return async (...args: unknown[]) => {
      try { return await admission(() => value.apply(target, args)); }
      catch (error) {
        if (!(error instanceof RunnerMutationDeferredError)) throw error;
        const role = await value.call(target, args[0]);
        return { ...role, preparation: [...role.preparation ?? [], { kind: 'W', code: 'codex-refresh-deferred', item: 'codex-installation', message: 'Using the installed role while another invocation is active. Owned content will refresh at the next idle preparation.' }] };
      }
    };
    return writes.has(key) ? (...args: unknown[]) => admission(async () => {
      const result = await value.apply(target, args);
      const root = key === 'applyDeveloperTeamInstall' ? (args[0] as { projectRoot: string }).projectRoot
        : key === 'runAction' && result?.status === 'executed' ? (args[1] as { projectRoot: string }).projectRoot : undefined;
      if (root && refreshSkills) {
        try { await refreshSkills(root); }
        catch { console.warn('Skill catalog refresh unavailable; ordinary work can continue with direct discovery.'); }
      }
      return result;
    }) : value.bind(target);
  }});
}
