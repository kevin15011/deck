// Protects production CLI composition: executor changes do not alternate catalog contents.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdapterRegistry } from "../../../packages/core/src/adapter-registry";
import type { RunnerAdapter } from "@deck/core";
import { createDeclaredSkillProvider } from "../../../packages/core/src/skill-discovery/declared-provider";
import { createSkillRegistryWriter } from "../../../packages/core/src/skill-discovery/persistence";
import { parseSkillRegistryDocument } from "../../../packages/core/src/skill-discovery/registry";
import { runSkillRegistryCommand } from "./skill-registry-command";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
test("CLI merges all configured providers and repeat refresh is unchanged", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cli-shared-registry-"))); roots.push(root);
  writeFileSync(join(root, ".gitignore"), "/.atl/skill-registry.md\n");
  const registry = createAdapterRegistry();
  for (const runnerId of ["claude", "codex", "opencode", "pi"]) {
    const skillRoot = join(root, runnerId); mkdirSync(join(skillRoot, "example"), { recursive: true });
    writeFileSync(join(skillRoot, "example/SKILL.md"), `---\nname: ${runnerId}-skill\n---\n`);
    registry.register(runnerId, { runnerId, environmentIds: [runnerId], skillDiscovery: createDeclaredSkillProvider(runnerId, {
      roots: () => [{ id: "skills", root: skillRoot, category: "user_runner", scope: "user" }],
    }) } as unknown as RunnerAdapter);
  }
  const dependencies = { adapterRegistry: registry, isInteractive: false, createWriter: ({ projectRoot }: { projectRoot: string }) => createSkillRegistryWriter({ projectRoot, stateRoot: join(root, "private-state"), isTracked: () => false }) };
  const run = (runner: string) => runSkillRegistryCommand({ command: "skill-registry-refresh", flags: { runner, root } }, dependencies);
  const first = await run("codex");
  expect(first.exitCode, JSON.stringify(first.json)).toBe(0);
  expect(first.json.status).toBe("indeterminate");
  const bytes = readFileSync(join(root, ".atl/skill-registry.md"), "utf8");
  for (const runner of ["claude", "codex", "opencode", "pi"]) expect(bytes).toContain(`${runner}-skill`);
  const second = await run("claude");
  expect(second.json.outcome, JSON.stringify(second.json)).toBe("unchanged");
  expect(parseSkillRegistryDocument(readFileSync(join(root, ".atl/skill-registry.md"), "utf8")).frontmatter?.fingerprint).toBe(parseSkillRegistryDocument(bytes).frontmatter?.fingerprint);
  writeFileSync(join(root, ".atl/skill-registry.md"), "invalid and edited");
  const repaired = await run("codex");
  expect(repaired.json.outcome, JSON.stringify(repaired.json)).toBe("committed");
  expect(parseSkillRegistryDocument(readFileSync(join(root, ".atl/skill-registry.md"), "utf8")).frontmatter?.fingerprint).toBe(parseSkillRegistryDocument(bytes).frontmatter?.fingerprint);
});
