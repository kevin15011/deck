import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contributionHash, readRunnerContributions } from "@deck/core";
import { installOpenCodeTools } from "./install-tools";
import { OPENCODE_INSTALLABLE_TOOLS } from "./installation-plan";

// These fixtures model the default HOME layout, independent of CI/user overrides.
const environmentKeys = ["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME", "RTK_INSTALL_DIR"] as const;
let savedEnvironment: Array<string | undefined>;
beforeEach(() => {
  savedEnvironment = environmentKeys.map(key => process.env[key]);
  for (const key of environmentKeys) delete process.env[key];
});
afterEach(() => {
  environmentKeys.forEach((key, index) => {
    const value = savedEnvironment[index];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

const tool = OPENCODE_INSTALLABLE_TOOLS.find(tool => tool.id === "rtk")!;
const script = `mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/rtk" <<'RTK'
#!/bin/sh
mkdir -p "$HOME/.config/opencode/plugins"
printf 'export default {}\\n' > "$HOME/.config/opencode/plugins/rtk.ts"
RTK
chmod +x "$HOME/.local/bin/rtk"
`;

test("existing RTK shell/init path accounts actual outputs and preserves unrelated config", async () => {
  const home = mkdtempSync(join(tmpdir(), "deck-rtk-receipt-"));
  try {
    const root = join(home, ".config/opencode"); mkdirSync(root, { recursive: true });
    const config = join(root, "opencode.json"); writeFileSync(config, '{"permission":{"bash":"ask"}}');
    const options = { homeDirectory: home, downloadScript: async () => script };
    const previousPath = process.env.PATH;
    // The subprocess must inherit the selected isolated HOME, including init.
    process.env.PATH = join(home, ".local/bin") + ":" + previousPath;
    try {
      const [result] = await installOpenCodeTools("opencode", [tool], () => {}, undefined, options);
      expect(result?.success).toBe(true);
      const manifest = readRunnerContributions(join(root, "deck/manifest.json"))!;
      expect(manifest.contributions).toHaveLength(2);
      for (const entry of manifest.contributions) expect(entry.hash).toBe(contributionHash(readFileSync(entry.path)));
      expect(readFileSync(config, "utf8")).toBe('{"permission":{"bash":"ask"}}');
      expect((await installOpenCodeTools("opencode", [tool], () => {}, undefined, options))[0]?.success).toBe(true);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("failed RTK writes remain accounted and can retry without adopting user artifacts", async () => {
  const home = mkdtempSync(join(tmpdir(), "deck-rtk-partial-"));
  try {
    const binary = join(home, ".local/bin/rtk");
    const manifestPath = join(home, ".config/opencode/deck/manifest.json");
    const [failed] = await installOpenCodeTools("opencode", [tool], () => {}, undefined,
      { homeDirectory: home, downloadScript: async () => script + "exit 19\n" });
    expect(failed?.success).toBe(false);
    expect(readRunnerContributions(manifestPath)?.contributions[0]?.hash).toBe(contributionHash(readFileSync(binary)));
    const [retried] = await installOpenCodeTools("opencode", [tool], () => {}, async () => {
      const plugins = join(home, ".config/opencode/plugins"); mkdirSync(plugins, { recursive: true });
      writeFileSync(join(plugins, "rtk.ts"), "verified retry plugin");
      return { exitCode: 0, stdout: "", stderr: "" };
    }, { homeDirectory: home, downloadScript: async () => script });
    expect(retried?.success).toBe(true);
    expect(readRunnerContributions(manifestPath)?.contributions).toHaveLength(2);
    writeFileSync(binary, "user edit");
    const [blocked] = await installOpenCodeTools("opencode", [tool], () => {}, undefined,
      { homeDirectory: home, downloadScript: async () => script });
    expect(blocked?.success).toBe(false);
    expect(blocked?.diagnostic?.code).toBe("rtk-unowned-installation-conflict");
    expect(readFileSync(binary, "utf8")).toBe("user edit");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
