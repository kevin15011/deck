import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToString } from "ink";
import { validateDeckConfig } from "@deck/core";
import { createPiRunnerAdapter } from "@deck/adapter-pi";
import { buildPiGlobalMaterialization } from "../../../../../packages/adapter-pi/src/global-materialization";
import { applyPiGlobalPlan, createNodePiFileIO, planPiGlobalInstall } from "../../../../../packages/adapter-pi/src/pi-global-install";
import { buildPiRunnerReviewPlan } from "../../../../../packages/adapter-pi/src/capability-plan";
import { ALL_PI_RUNNER_CAPABILITY_IDS } from "../../../../../packages/adapter-pi/src/capability-catalog";
import { createDefaultRunnerDashboardState } from "../runner-dashboard/state";
import { runRunnerReviewPlan } from "../runner-dashboard/action-runner";
import { RunnerDashboardScreens } from "../screens/runner-dashboard-screens";

test("Review & Install Run install upgrades managed subagent assets through the normal team action", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-pi-tui-background-install-"));
  try {
    const projectRoot = join(root, "project"); const agentDir = join(root, "agent"); mkdirSync(projectRoot);
    const previous = buildPiGlobalMaterialization({ agentDir, projectRoot, legacyDeckEvidence: false });
    const impl = previous.desired.files.find(f => f.relPath === "deck/package/extensions/deck-subagents/impl.js")!;
    impl.content = "// fixture: previous managed synchronous subagents\nexport default function () {}\n";
    const io = createNodePiFileIO(); applyPiGlobalPlan(planPiGlobalInstall(previous.desired, io), io);
    const adapter = createPiRunnerAdapter({ homeDirectory: join(root, "home"), env: { PI_CODING_AGENT_DIR: agentDir }, piVersionProbe: () => ({ exitCode: 0, stdout: "1.0.0", stderr: "" }) });
    const plan = buildPiRunnerReviewPlan({ runnerScope: "pi", teams: { "developer-team": { selected: true } }, selectedCapabilities: {}, adaptiveMemory: { provider: "none" } }, Object.fromEntries(ALL_PI_RUNNER_CAPABILITY_IDS.map(id => [id, { capabilityId: id, status: "ready" }])) as never);
    const state = createDefaultRunnerDashboardState({ runnerScope: "pi", runnerDisplayName: "Pi", screen: "review-plan", plan: plan as never });
    expect(renderToString(<RunnerDashboardScreens state={state} canRunPlan />)).toContain("Run install");
    const results = await runRunnerReviewPlan(plan as never, { projectRoot, runnerId: "pi", installTeamBundle: async () => {
      const install = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "pi-development", deckConfig: validateDeckConfig({}) });
      expect(install.blocked).toBeFalsy();
      await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan: install });
      expect((await adapter.verifyDeveloperTeamInstall(install)).valid).toBe(true);
      return { results: [] };
    } });
    expect(results.find(r => r.actionId === "team.developer-team.apply")?.status).toBe("executed");
    const installed = readFileSync(join(agentDir, impl.relPath), "utf8");
    expect(installed).toContain("BackgroundJobs"); expect(installed).toContain("nonCapturing: true"); expect(installed).toContain("followUp");
    expect(installed).toBe(readFileSync(join(import.meta.dir, "../../../../../packages/adapter-pi/assets/pi/extensions/deck-subagents.generated.js"), "utf8"));
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30000);
