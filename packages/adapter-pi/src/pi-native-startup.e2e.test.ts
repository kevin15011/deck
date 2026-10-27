import { writeExplicitCodebaseConfig } from "./__fixtures__/explicit-codebase";
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createPiHarness } from "./pi-cli-harness";
import { createEmptyPiManifest, hashJsonValue } from "./pi-manifest";

const sdkDir = dirname(import.meta.resolve("@earendil-works/pi-coding-agent").replace("file://", ""));
const command = [Bun.which("node")!, join(sdkDir, "cli.js")];
for (const fault of ["ownership", "integrity", "missing"] as const) {
  test(`stock Pi 1.0.0 startup: ${fault}`, async () => {
    expect(Bun.spawnSync([...command, "--version"]).stdout.toString().trim()).toBe("1.0.0");
    const h = createPiHarness({}, { command });
    writeExplicitCodebaseConfig(h.home);
    try {
      const ownedRoot = join(h.root, "codebase-native-v0.11.0", `${process.platform}-${process.arch}`);
      const marker = join(h.root, "binary-executed");
      const executable = fault === "integrity" ? join(ownedRoot, "codebase-memory-mcp") : join(h.root, "missing/codebase-memory-mcp");
      if (fault === "integrity") {
        mkdirSync(ownedRoot, { recursive: true, mode: 0o700 });
        writeFileSync(executable, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');\n`, { mode: 0o700 });
      }
      const entry = { command: executable, args: [], exposure: "direct" };
      writeFileSync(join(h.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { "codebase-memory": entry } }));
      const manifestPath = join(h.agentDir, "deck/manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.mcp.servers["codebase-memory"] = hashJsonValue(entry);
      writeFileSync(manifestPath, fault === "ownership" ? "invalid" : JSON.stringify(manifest));
      const before = readFileSync(join(h.agentDir, "mcp.json"));
      const requests = join(h.root, "requests.jsonl"), ready = join(h.root, "session-started");
      const result = await h.run(["startup probe"], { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", DECK_PI_MEMORY: "disabled", FAUX_LOG: requests, FAUX_READY_FILE: ready }, { timeoutMs: 15000 });
      expect(readFileSync(join(h.agentDir, "mcp.json"))).toEqual(before);
      expect(existsSync(marker)).toBe(false);
      if (fault === "missing") {
        expect(result.code).toBe(0);
        expect(existsSync(requests)).toBe(true);
        expect(result.stderr).toContain("Codebase Memory is unavailable");
        expect(JSON.stringify(result.events.filter(event => event.type === "tool_execution_start"))).not.toContain("codebase_memory");
      } else {
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("Failed to load extension");
        expect(result.stderr).toContain(fault === "ownership" ? "pi-codebase-ownership-invalid" : "codebase-memory-integrity-failed");
        expect(existsSync(requests)).toBe(false);
        expect(existsSync(ready)).toBe(false);
        expect(result.events.filter(event => event.type === "agent_start")).toEqual([]);
      }
    } finally { h.cleanup(); }
  }, 20000);
}
