import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginRunnerContributions } from "@deck/core";
import { buildOpenCodeDeveloperTeamInstallPlan, applyOpenCodeDeveloperTeamInstall, backupDeveloperTeamFiles, rollbackDeveloperTeamFiles } from "./developer-team-install";

for (const kind of ["owned", "modified", "unowned"] as const) test(`retired skill sync preserves ownership: ${kind}`, () => {
  const root = mkdtempSync(join(tmpdir(), "deck-retired-"));
  try {
    const path = join(root, "skills/test-driven-development/SKILL.md");
    const tx = kind !== "unowned" ? beginRunnerContributions({ runnerId: "opencode", root, manifestPath: join(root, "deck/manifest.json"), deckVersion: "test", targets: [{ path, selector: { kind: "file" } }] }) : undefined;
    mkdirSync(join(root, "skills/test-driven-development"), { recursive: true });
    writeFileSync(path, "old skill"); tx?.commit();
    if (kind === "modified") writeFileSync(path, "user edit");
    const plan = buildOpenCodeDeveloperTeamInstallPlan(root, { configDir: root });
    const backup = backupDeveloperTeamFiles(plan);
    applyOpenCodeDeveloperTeamInstall(plan, { configDir: root });
    expect(existsSync(path)).toBe(kind !== "owned");
    if (kind === "owned") { rollbackDeveloperTeamFiles(backup); expect(existsSync(path)).toBe(true); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
