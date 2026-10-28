import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCodebaseMemoryEnabled, type RunnerAdapter, type RunnerLaunchInput, type RunnerLaunchResult } from '@deck/core';
import { issueCodebaseAvailability } from '@deck/core/session/codebase-availability';
import { Supervisor } from '@deck/session-host';
import { validateClaudeSessionIntent } from '../../../packages/adapter-claude/src/session-skills';
import { prepareSessionNativeSkills } from './session-native-skills';
import { withNativeProjectReadiness } from './native-project-readiness';
import { SessionCodebaseReadiness, SessionCodebaseReadinessError } from './session-codebase-readiness';
import { deckInternalCommand } from './runner-adapters';

/** No managed resolver is consulted: inspect only the verified installed native declaration. */
export function attachClaudeCodebaseObservation(adapter: RunnerAdapter, input: RunnerLaunchInput, result: Extract<RunnerLaunchResult, { status: 'ready' }>,
  observer?: Pick<SessionCodebaseReadiness, 'observeNative'>, readConfig: () => RunnerLaunchInput['deckConfig'] = () => input.deckConfig): typeof result {
  let observed: "ready" | "unavailable" | "unverified" = "unverified";
  const previous = result.plan.launchLifecycle;
  result.plan.launchLifecycle = {
    async beforeSpawn(environment, signal = new AbortController().signal) {
      await previous?.beforeSpawn(environment, signal);
      signal.throwIfAborted();
      const currentConfig = readConfig();
      const skills = await prepareSessionNativeSkills(adapter, currentConfig);
      if (!skills || skills.root !== result.plan.generationReference?.root || skills.selectionHash !== result.plan.generationReference.selectionHash) throw new Error("claude-generation-changed");
      validateClaudeSessionIntent(skills, readConfig());
      if (!isCodebaseMemoryEnabled(currentConfig, 'claude')) return;
      const declaration = JSON.parse(readFileSync(join(skills.root, '.mcp.json'), 'utf8')).mcpServers?.['codebase-memory'];
      if (!declaration || typeof declaration.command !== 'string' || (declaration.args !== undefined && !Array.isArray(declaration.args))) throw new Error('claude-codebase-declaration-unverified');
      const service = observer ?? new SessionCodebaseReadiness({ supervisor: new Supervisor({ anchorCommand: deckInternalCommand('child-anchor') }), environment });
      const invocationId = randomUUID();
      let availability: ReturnType<typeof issueCodebaseAvailability> | undefined;
      try { await service.observeNative({ ...declaration, args: declaration.args ?? [], env: declaration.env ?? {} }, input.projectRoot, signal); }
      catch (error) {
        if (!(error instanceof SessionCodebaseReadinessError) || error.kind === 'cancelled' || signal.aborted) throw error;
        availability = issueCodebaseAvailability({ skills, projectRoot: input.projectRoot, invocationId, route: 'native', reason: error.kind, signal });
      }
      validateClaudeSessionIntent(skills, readConfig());
      signal.throwIfAborted();
      const checked = await adapter.buildLaunchPlan!({ ...input, deckConfig: readConfig(), codebaseAvailability: availability, codebaseInvocationId: invocationId });
      if (checked.status !== 'ready') throw new Error(checked.code);
      const withoutCodebaseDenial = (args: readonly string[]) => {
        const normalized = [...args], position = normalized.indexOf('--settings');
        if (position >= 0) {
          const settings = JSON.parse(normalized[position + 1]!);
          if (settings.deniedMcpServers) {
            settings.deniedMcpServers = settings.deniedMcpServers.filter((entry: { serverName: string }) => entry.serverName !== 'plugin:deck-developer-team:codebase-memory');
            if (!settings.deniedMcpServers.length) delete settings.deniedMcpServers;
          }
          normalized[position + 1] = JSON.stringify(settings);
        }
        return JSON.stringify(normalized);
      };
      if (withoutCodebaseDenial(checked.plan.args) !== withoutCodebaseDenial(result.plan.args)
        || JSON.stringify(checked.plan.envOverlay) !== JSON.stringify(result.plan.envOverlay)) throw new Error('claude-launch-inputs-changed');
      // Rebuilding applies the same exact-denial policy as managed launch; unrelated settings survive.
      result.plan.args = checked.plan.args;
      observed = availability ? 'unavailable' : 'ready';
    },
    afterExit() { previous?.afterExit(); },
  };
  result.plan = withNativeProjectReadiness(result.plan, "claude", readConfig, () => observed, config => adapter.readPreparationCapabilities?.(config) ?? {});
  return result;
}
