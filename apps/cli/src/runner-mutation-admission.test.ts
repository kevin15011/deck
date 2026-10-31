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
