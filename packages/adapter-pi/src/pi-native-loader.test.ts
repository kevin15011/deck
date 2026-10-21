import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpExtension, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { buildPiGlobalMaterialization } from "./global-materialization";
import { applyPiGlobalPlan, createNodePiFileIO, planPiGlobalInstall } from "./pi-global-install";

test("native resource loader replaces the duplicate built-in connector only in Deck sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-pi-native-loader-"));
  const agentDir = join(root, "agent"), cwd = join(root, "project");
  mkdirSync(cwd);
  const saved = { DECK_PI_SESSION: process.env.DECK_PI_SESSION, DECK_PI_CHILD: process.env.DECK_PI_CHILD, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  try {
    const io = createNodePiFileIO();
    const materialization = buildPiGlobalMaterialization({ agentDir, projectRoot: cwd, legacyDeckEvidence: false });
    applyPiGlobalPlan(planPiGlobalInstall(materialization.desired, io), io);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    delete process.env.DECK_PI_CHILD;
    for (const session of ["0", "1"]) {
      process.env.DECK_PI_SESSION = session;
      const loader = new DefaultResourceLoader({ cwd, agentDir,
        extensionFactories: [{ name: "mcp", factory: createMcpExtension(), builtin: true, replaceable: true }],
      });
      await loader.reload();
      const loaded = loader.getExtensions();
      expect(loaded.errors).toEqual([]);
      const connectors = loaded.extensions.filter(extension => extension.commands.has("mcp"));
      expect(connectors).toHaveLength(1);
      expect(connectors[0]!.path === "builtin:mcp").toBe(session === "0");
      if (session === "1") expect(connectors[0]!.path).toContain("deck-tool-policy");
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  }
});
