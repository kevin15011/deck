import { InstallationBusyError, withInstallationMutation } from '../../../packages/core/src/installation-use';
import { decideRunnerWrite, compareReleaseVersions, recoverRunnerFence, readRunnerFence, withRunnerFence, type BuildIdentity, type RunnerAdmissionResult, type RunnerFenceRead, type RunnerAdapter } from '@deck/core';
export class RunnerWriteSkippedError extends Error {
  readonly code = 'runner-write-not-applied';
  constructor(readonly reason: string, readonly admission?: RunnerAdmissionResult) {
    super(`Runner update not applied: ${reason}. ${admission?.verdict === 'blocked' ? 'The installed state requires Review & Install.' : 'Compatible installed content remains available read-only.'}`);
  }
}
export type RunnerFenceOptions = { path: string; self: BuildIdentity; stateSchema: number };
import { withIdleRunnerMutation, RunnerMutationDeferredError } from '@deck/session-host';
export type RunnerMutationAdmission = <T>(effect: () => T | Promise<T>) => Promise<T>;
/** CLI production composition: every runner write, including direct install/repair/replacement. */
export function guardRunnerAdapter(adapter: RunnerAdapter, admission: RunnerMutationAdmission = withIdleRunnerMutation, refreshSkills?: (projectRoot: string) => Promise<void>, fence?: RunnerFenceOptions): RunnerAdapter {
  const recover = async () => {
    if (!fence || !adapter.recoverPendingMutation) return;
    const record = readRunnerFence(fence.path);
    if (!record || record === 'unreadable' || !record.pending || record.pending.stateSchema > fence.stateSchema || compareReleaseVersions(record.pending.writer.semver,fence.self.semver) > 0) return;
    await recoverRunnerFence(fence.path,pending=>pending.journals ? adapter.recoverPendingMutation!(pending.journals) : Promise.resolve(undefined));
  };
  // The inner reservation drains adapter descendants before fence settlement;
  // the outer reservation keeps exclusivity through the fence write itself.
  const reserve = <T>(effect: () => Promise<T>): Promise<T> => adapter.mutationRoot ? withInstallationMutation(adapter.mutationRoot, effect) : effect();
  const plans = new WeakMap<object, RunnerFenceRead>();
  const writes = new Set<PropertyKey>(['runAction','applyDeveloperTeamInstall','writeMcpConfig','rollbackDeveloperTeamFiles']);
  return new Proxy(adapter, {get(target,key) {
    const value = Reflect.get(target,key,target);
    if (typeof value !== 'function') return value;
    if (key === 'buildDeveloperTeamInstallPlan' && fence) return (...args: unknown[]) => {
      const epoch = readRunnerFence(fence.path);
      const plan = value.apply(target, args);
      if (plan && typeof plan === 'object') plans.set(plan, epoch);
      return plan;
    };
    if (key === 'prepareSessionNativeRole' && ['codex', 'opencode', 'pi'].includes(target.runnerId)) return async (...args: unknown[]) => {
      try { return await admission(async () => {
        if (!fence || !args[1]) return value.apply(target, args);
        await recover();
        const installed = await target.evaluateSessionAdmission?.({roleId: args[0] as string, config: args[1] as never});
        const record = readRunnerFence(fence.path);
        const decision = decideRunnerWrite(record, fence.self, 'refresh', !!installed && installed.verdict !== 'blocked', fence.stateSchema);
        if (decision !== 'write') {
          const role = await value.call(target, args[0]);
          return decision === 'compatible-installed-state' ? role : {...role, preparation:[...role.preparation ?? [], {kind:'W',code:`${target.runnerId}-refresh-deferred`,item:'installation',message:`Refresh deferred: ${decision}. Using validated installed content.`}]};
        }
        let before: unknown;
        try { before = target.readPreparationGeneration?.(); } catch { /* Broken installed state may be repaired by the admitted transaction. */ }
        return reserve(() => withRunnerFence({...fence, expected: record, effect: () => reserve(() => value.apply(target,args)), changed: () => {
          try { return before !== target.readPreparationGeneration?.(); } catch { return true; }
        }}));
      }); }
      catch (error) {
        if (!(error instanceof RunnerMutationDeferredError) && !(error instanceof InstallationBusyError)) throw error;
        const role = await value.call(target, args[0]);
        return { ...role, preparation: [...role.preparation ?? [], { kind: 'W', code: `${target.runnerId}-refresh-deferred`, item: `${target.runnerId}-installation`, message: 'Using the installed role while another invocation is active. Owned content will refresh at the next idle preparation.' }] };
      }
    };
    return writes.has(key) ? (...args: unknown[]) => admission(async () => {
      let result;
      if (fence) {
        await recover();
        const record = readRunnerFence(fence.path);
        const installed = await target.evaluateSessionAdmission?.();
        const decision = decideRunnerWrite(record, fence.self, 'explicit', !!installed && installed.verdict !== 'blocked', fence.stateSchema);
        if (decision !== 'write') throw new RunnerWriteSkippedError(decision, installed);
        const plan = key === 'applyDeveloperTeamInstall' ? (args[0] as {plan?: object})?.plan : undefined;
        if (plan && plans.has(plan) && JSON.stringify(plans.get(plan)) !== JSON.stringify(record)) throw new RunnerWriteSkippedError('runner-fence-changed', installed);
        result = await reserve(() => withRunnerFence({...fence, expected:record, effect: () => reserve(() => value.apply(target,args)), changed: (r: any) => typeof r?.changedCount === 'number' ? r.changedCount > 0 : r?.status !== 'unchanged'}));
      } else result = await value.apply(target, args);
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
