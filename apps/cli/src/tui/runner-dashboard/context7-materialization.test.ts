import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultDeckConfig, type DashboardState } from '@deck/core';
import { createPiRunnerAdapter } from '@deck/adapter-pi';
import { createPiTools } from '../../../../../packages/adapter-pi/src/pi-owned-tools';
import { runRunnerReviewPlan } from './action-runner';

// Protects the observed package-present/MCP-absent upgrade: selected Setup must
// materialize Context7 in the package transaction before preparation observes it.
test('Pi selected Context7 review materializes the absent entry and preparation evidence', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pi-context7-review-')));
  try {
    const agent = join(home, '.pi/agent'), pi = join(home, 'pi'), npx = join(home, 'npx');
    mkdirSync(agent, { recursive: true });
    writeFileSync(pi, '#!/bin/sh\nif [ "$1" = --version ]; then echo 1.0.0; else echo @upstash/context7-mcp; fi\n', { mode: 0o700 });
    writeFileSync(npx, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    writeFileSync(join(agent, 'mcp.json'), JSON.stringify({ mcpServers: { personal: { command: 'personal' } } }));
    const tools = createPiTools({ homeDir: home, env: { HOME: home }, dataRoot: join(home, 'data/deck'), resolveCommand: name => name === 'npx' ? npx : undefined });
    const adapter = createPiRunnerAdapter({ homeDirectory: home, env: { HOME: home }, piCommand: pi, piTools: tools });
    const config = getDefaultDeckConfig();
    const input = { projectRoot: home, runnerId: 'pi', environmentId: 'pi-development', deckConfig: config };
    const inventory = await adapter.getCapabilityInventory(input);
    // Other required capabilities are satisfied fixture prerequisites; this test
    // exercises Context7 selection and materialization, not their acquisition.
    for (const capability of inventory.capabilities) if (capability.capabilityId !== "context7") Object.assign(capability, { isInstalled: true, isBlocked: false });
    const state = { runnerId: 'pi', environmentId: 'pi-development', selectedCapabilities: { context7: true }, packageInstructions: {}, teams: { 'developer-team': { selected: true } } } as unknown as DashboardState;
    const review = adapter.buildReviewPlan(state, inventory);
    let applied = false;
    const results = await runRunnerReviewPlan(review as never, {
      projectRoot: home, runnerId: 'pi', dashboardState: state,
      runnerAdapter: { runAction: (action: any, context: any) => adapter.runAction(action, context) },
      installPackages: async (_command: any, packages: any[]) => packages.map(pkg => ({ id: pkg.id, outcome: 'already-present', success: true, message: 'Fixture package present' })),
      writeMcpConfig: async (options: any) => {
        const result = await adapter.runAction({ id: 'context7.mcp', kind: 'write-pi-mcp-config', title: 'Configure Context7', capabilityId: options.serverName, status: 'ready' }, { ...input, dashboardState: state } as any);
        return { ok: result.status === 'executed', path: join(agent, 'mcp.json'), diagnostics: result.diagnostics };
      },
      installTeamBundle: async (_root: string, options: any) => {
        expect(options.capabilityIds).toContain('context7');
        const plan = adapter.buildDeveloperTeamInstallPlan({ ...input, capabilityIds: options.capabilityIds });
        expect(plan.blocked).toBe(false);
        const result = await adapter.applyDeveloperTeamInstall({ ...input, plan });
        expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
        applied = true;
        return result;
      },
    } as any);
    expect(results.filter(result => result.status === 'failed')).toEqual([]);
    expect(applied).toBe(true);
    const servers = JSON.parse(readFileSync(join(agent, 'mcp.json'), 'utf8')).mcpServers;
    expect(servers.context7.command).toBe(npx);
    expect(servers.personal).toEqual({ command: 'personal' });
    expect(adapter.readPreparationCapabilities?.(config).context7).toMatchObject({ enabled: true, prerequisites: 'present', availability: 'unverified' });
  } finally { rmSync(home, { recursive: true, force: true }); }
});
