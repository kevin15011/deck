import { InstallationBusyError, withInstallationMutation } from '../../../packages/core/src/installation-use';
import { withRunnerFenceRecovery, decideRunnerWrite, compareReleaseVersions, recoverRunnerFence, readRunnerFence, withRunnerFence, type BuildIdentity, type RunnerAdmissionResult, type RunnerFenceRead, type RunnerAdapter, type DeveloperTeamAdapterInstallInput } from '@deck/core';
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
export function guardRunnerAdapter<T extends RunnerAdapter>(adapter: T, admission: RunnerMutationAdmission = withIdleRunnerMutation, refreshSkills?: (projectRoot: string) => Promise<void>, fence?: RunnerFenceOptions): T {
  const recover = async (input?: DeveloperTeamAdapterInstallInput, intent: 'refresh' | 'explicit' = 'explicit') => {
    if (!fence) return;
    const record = readRunnerFence(fence.path);
    if (!record || record === 'unreadable' || !record.pending || record.stateSchema > fence.stateSchema || compareReleaseVersions(record.writer.semver,fence.self.semver) > 0 || record.pending.stateSchema > fence.stateSchema || compareReleaseVersions(record.pending.writer.semver,fence.self.semver) > 0) return;
    const references = record.pending.journals ?? [];
    // In-process rollback proof remains valid, including operations predating scope.
    const proven = adapter.recoverPendingMutation && await recoverRunnerFence(fence.path, pending =>
      adapter.recoverPendingMutation!(pending.journals?.filter(j => j.kind !== 'deck-scope-v1') ?? []));
    if (proven) return 'rollback' as const;
    if (!input || !adapter.prepareCanonicalRecovery || !adapter.mutationRoot || !references.some(j => j.kind === 'deck-scope-v1')) return;
    const recovery = await adapter.prepareCanonicalRecovery(input, references, fence.self);
    await withRunnerFenceRecovery({ ...fence, expected: record, mutationRoot: adapter.mutationRoot,
      context: { intent, ...(intent === 'explicit' ? { projectRoot: input.projectRoot } : {}) },
      ...recovery });
    return 'canonical' as const;
  };
  // The inner reservation drains adapter descendants before fence settlement;
  // the outer reservation keeps exclusivity through the fence write itself.
  const reserve = <T>(effect: () => Promise<T>): Promise<T> => adapter.mutationRoot ? withInstallationMutation(adapter.mutationRoot, effect) : effect();
  const assertNoExplicitRecovery = () => {
    if (adapter.runnerId !== 'codex' || !fence) return;
    const record = readRunnerFence(fence.path);
    if (record && record !== 'unreadable' && record.pending?.journals?.some(j => j.kind === 'canonical-recovery-v1')) throw new RunnerWriteSkippedError('runner-write-recovery-required');
  };
  const plans = new WeakMap<object, RunnerFenceRead>();
  const inputs = new WeakMap<object, DeveloperTeamAdapterInstallInput>();
  const writes = new Set<PropertyKey>(['runAction','applyDeveloperTeamInstall','writeMcpConfig','rollbackDeveloperTeamFiles']);
  return new Proxy(adapter, {get(target,key,receiver) {
    const value = Reflect.get(target,key,target);
    if (typeof value !== 'function') return value;
    if (key === 'buildDeveloperTeamInstallPlan' && fence) return (...args: unknown[]) => {
      const epoch = readRunnerFence(fence.path);
      const plan = value.apply(target, args);
      if (plan && typeof plan === 'object') { plans.set(plan, epoch); inputs.set(plan, structuredClone(args[0] as DeveloperTeamAdapterInstallInput)); }
      return plan;
    };
    // Explicit canonical recovery cannot use the ordinary static/read-only launch fallback.
    if (key === 'buildLaunchPlan' && target.runnerId === 'codex' && fence) return async (...args: unknown[]) => {
      const record = readRunnerFence(fence.path);
      if (record && record !== 'unreadable' && record.pending?.journals?.some(j => j.kind === 'canonical-recovery-v1')) throw new RunnerWriteSkippedError('runner-write-recovery-required');
      return value.apply(target, args);
    };
    if ((key === 'prepareSessionNativeRole' && ['codex', 'opencode', 'pi'].includes(target.runnerId)) || (key === 'prepareSessionNativeSkills' && target.runnerId === 'claude')) return async (...args: unknown[]) => {
      if (target.runnerId === 'codex' && fence) {
        const record = readRunnerFence(fence.path);
        if (record && record !== 'unreadable' && record.pending?.journals?.some(j => j.kind === 'canonical-recovery-v1')) throw new RunnerWriteSkippedError('runner-write-recovery-required');
      }
      const skills = key === 'prepareSessionNativeSkills';
      const config = args[skills ? 0 : 1];
      const readOnlyArgs = skills ? [] : [args[0]];
      try { return await admission(() => reserve(async () => {
        assertNoExplicitRecovery();
        if (!fence || !config) return value.apply(target, args);
        await recover({ projectRoot: target.mutationRoot!,
          environmentId: `${target.runnerId}-development`, deckConfig: config as DeveloperTeamAdapterInstallInput['deckConfig'] }, 'refresh');
        const installed = await target.evaluateSessionAdmission?.({roleId: skills ? undefined : args[0] as string, config: config as never});
        const record = readRunnerFence(fence.path);
        if (target.runnerId === 'codex' && record && record !== 'unreadable' && record.pending?.journals?.some(j => j.kind === 'canonical-recovery-v1')) throw new RunnerWriteSkippedError('runner-write-recovery-required', installed);
        const managedDrift = await target.readManagedContentDrift?.(config as never) ?? false;
        const decision = decideRunnerWrite(record, fence.self, 'refresh', !!installed && installed.verdict !== 'blocked', fence.stateSchema, managedDrift);
        if (decision !== 'write') {
          const role = await value.apply(target, readOnlyArgs);
          return decision === 'compatible-installed-state' ? role : {...role, preparation:[...role.preparation ?? [], {kind:'W',code:`${target.runnerId}-refresh-deferred`,item:'installation',message:`Refresh deferred: ${decision}. Using validated installed content.`}]};
        }
        target.precheckPendingMutation?.({ projectRoot: target.mutationRoot!, environmentId: `${target.runnerId}-development`, deckConfig: config as DeveloperTeamAdapterInstallInput['deckConfig'] });
        let before: unknown;
        try { before = target.readPreparationGeneration?.(); } catch { /* Broken installed state may be repaired by the admitted transaction. */ }
        return reserve(() => withRunnerFence({...fence, expected: record, effect: () => reserve(() => value.apply(target,args)), changed: () => {
          try { return managedDrift || before !== target.readPreparationGeneration?.(); } catch { return true; }
        }}));
      })); }
      catch (error) {
        if (!(error instanceof RunnerMutationDeferredError) && !(error instanceof InstallationBusyError)) throw error;
        assertNoExplicitRecovery();
        const role = await value.apply(target, readOnlyArgs);
        return { ...role, preparation: [...role.preparation ?? [], { kind: 'W', code: `${target.runnerId}-refresh-deferred`, item: `${target.runnerId}-installation`, message: 'Using the installed role while another invocation is active. Owned content will refresh at the next idle preparation.' }] };
      }
    };
    // Launch preparation must resolve guarded methods through the public adapter.
    if (key === 'buildLaunchPlan' && target.runnerId === 'claude') return value.bind(receiver);
    return writes.has(key) ? (...args: unknown[]) => admission(() => reserve(async () => {
      let result;
      if (fence) {
        const beforeRecovery = readRunnerFence(fence.path);
        const suppliedPlan = key === 'applyDeveloperTeamInstall' ? (args[0] as { plan?: object })?.plan : undefined;
        const recoveryInput = suppliedPlan ? inputs.get(suppliedPlan) : undefined;
        const recovered = await recover(recoveryInput);
        // Recovery invalidates all pre-restart plans; rebuild from saved caller inputs.
        if (recovered === 'canonical' && recoveryInput) {
          args[0] = { ...(args[0] as object), plan: target.buildDeveloperTeamInstallPlan(recoveryInput) };
        }
        const record = readRunnerFence(fence.path);
        if (record !== 'unreadable' && !record?.pending && recoveryInput) target.precheckPendingMutation?.(recoveryInput);
        const installed = await target.evaluateSessionAdmission?.();
        const decision = decideRunnerWrite(record, fence.self, 'explicit', !!installed && installed.verdict !== 'blocked', fence.stateSchema);
        if (decision !== 'write') throw new RunnerWriteSkippedError(decision, installed);
        const plan = key === 'applyDeveloperTeamInstall' ? (args[0] as {plan?: object})?.plan : undefined;
        if (plan && plans.has(plan) && JSON.stringify(plans.get(plan)) !== JSON.stringify(record) && !(recovered && JSON.stringify(plans.get(plan)) === JSON.stringify(beforeRecovery))) throw new RunnerWriteSkippedError('runner-fence-changed', installed);
        result = await reserve(() => withRunnerFence({...fence, expected:record, effect: () => reserve(() => value.apply(target,args)), changed: (r: any) => typeof r?.changedCount === 'number' ? r.changedCount > 0 : r?.status !== 'unchanged'}));
      } else result = await value.apply(target, args);
      const root = key === 'applyDeveloperTeamInstall' ? (args[0] as { projectRoot: string }).projectRoot
        : key === 'runAction' && result?.status === 'executed' ? (args[1] as { projectRoot: string }).projectRoot : undefined;
      if (root && refreshSkills) {
        try { await refreshSkills(root); }
        catch { console.warn('Skill catalog refresh unavailable; ordinary work can continue with direct discovery.'); }
      }
      return result;
    })) : value.bind(target);
  }});
}
