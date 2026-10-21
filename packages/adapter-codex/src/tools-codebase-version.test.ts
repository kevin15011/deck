import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexTools } from "./tools";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each(["0.10.8", "0.11.0-beta", "0.11.1", "0.12.0", "1.0.0", "99.0.0"])("Codex refuses an unreviewed shared Codebase Memory version %s", (version) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "deck-codex-version-"))); roots.push(home);
  const binary = join(home, "codebase-memory-mcp");
  writeFileSync(binary, `#!/bin/sh\nprintf 'codebase-memory-mcp ${version}\\n'\n`); chmodSync(binary, 0o700);
  const tools = createCodexTools({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: (name) => name === "codebase-memory-mcp" ? binary : undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true });
  expect(tools.codebase.existing()).toBeUndefined();
});

test("Codex reuses the exact reviewed shared Codebase Memory release", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "deck-codex-version-"))); roots.push(home);
  const binary = join(home, "codebase-memory-mcp");
  writeFileSync(binary, "#!/bin/sh\nprintf 'codebase-memory-mcp 0.11.0\\n'\n"); chmodSync(binary, 0o700);
  const tools = createCodexTools({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: (name) => name === "codebase-memory-mcp" ? binary : undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true });
  expect(tools.codebase.existing()).toBeUndefined();
  const content = readFileSync(binary);
  const verified = createCodexTools({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: () => binary, nodeCommand: process.execPath, verifyNodeRuntime: () => true, codebaseReleaseOverride: { asset: "fixture", archiveBytes: 0, archiveSha256: "", binaryBytes: content.length, binarySha256: createHash("sha256").update(content).digest("hex") } });
  expect(verified.codebase.existing()).toBe(binary);
});
