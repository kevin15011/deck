import { expect, test } from "bun:test";
import type { RunnerAdapter } from "@deck/core";
import { guardRunnerAdapter } from "./runner-mutation-admission";
// Protects: refresh is read-only follow-up to admitted effects, never an authority bypass.
test("install and reinstall refresh only after admitted success, and refresh failure preserves the install result", async () => {
 let installed = false;
 let refreshed = 0;
 const result = { results: [], changedCount: 1, unchangedCount: 0 };
 const adapter = { applyDeveloperTeamInstall: async () => { installed = true; return result; } } as unknown as RunnerAdapter;
 const denied = guardRunnerAdapter(adapter, async () => { throw new Error("busy"); }, async () => { refreshed++; });
 await expect(denied.applyDeveloperTeamInstall({ projectRoot: "/project" } as never)).rejects.toThrow("busy");
 expect(installed).toBe(false);
 expect(refreshed).toBe(0);
 const guarded = guardRunnerAdapter(adapter, async effect => effect(), async root => {
  expect(root).toBe("/project"); expect(installed).toBe(true); refreshed++;
 });
 expect(await guarded.applyDeveloperTeamInstall({ projectRoot: "/project" } as never)).toBe(result);
 expect(await guarded.applyDeveloperTeamInstall({ projectRoot: "/project" } as never)).toBe(result);
 expect(refreshed).toBe(2);
 const unavailable = guardRunnerAdapter(adapter, async effect => effect(), async () => { throw new Error("unavailable"); });
 expect(await unavailable.applyDeveloperTeamInstall({ projectRoot: "/project" } as never)).toBe(result);
});

// Protects active invocation bytes: a busy daemon cannot authorize refresh writes.
test("Codex preparation defers writes while active and exposes the preservation warning", async () => {
 const { RunnerMutationDeferredError } = await import('@deck/session-host');
 let writes = 0;
 const adapter = { runnerId: 'codex', prepareSessionNativeRole: async (_role: string, config?: unknown) => {
  if (config) writes++;
  return { runnerId: 'codex', roleId: 'deck-quality', preparation: [] };
 } } as unknown as RunnerAdapter;
 const guarded = guardRunnerAdapter(adapter, async () => { throw new RunnerMutationDeferredError(); });
 const role = await guarded.prepareSessionNativeRole!('deck-quality', {} as never);
 expect(writes).toBe(0);
 expect(role.preparation?.some(item => item.code === 'codex-refresh-deferred')).toBe(true);
});
