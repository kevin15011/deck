import { describe, expect, test } from "bun:test";
import {
  collectOpenCodeDiscoveryContext,
  enumerateOpenCodeConfigCandidates,
  parseJsonc,
} from "./model-discovery-context";

import { buildDiscoveryFingerprint } from "./model-inventory-cache";

describe("OpenCode production discovery context", () => {
  const collect = (config: string, env: Record<string, string | undefined> = {}, resolvePluginEntry: (reference: string, fromDirectory: string) => Promise<string | null> = async () => null) => collectOpenCodeDiscoveryContext({
    projectRoot: "/workspace/project",
    executable: "/bin/opencode",
    version: "1.17.18",
    env,
    homeDir: "/home/fixture",
    xdgConfigHome: "/home/fixture/.config",
    xdgDataHome: "/home/fixture/.local/share",
    resolveWorkspaceRoot: async () => "/workspace",
    resolvePluginEntry,
    fs: {
      realpath: async (path) => path,
      stat: async () => ({ size: 1, mtimeMs: 2, ctimeMs: 2, mode: 0o600 }),
      readFile: async (path) => path.endsWith("opencode.json") ? config : "",
      mkdir: async () => {}, writeFile: async () => {}, rename: async () => {},
    },
  });
  const configDigest = (context: Awaited<ReturnType<typeof collect>>) => context.configCandidates.find((candidate) => candidate.logicalPath.endsWith("opencode.json"))?.safeDigest;

  test("collects only secret-safe identity, configuration, auth, plugin, and relevant credential presence", async () => {
    const context = await collect(
      '{"providers":{"openai":{"env":"OPENAI_API_KEY","token":"secret-one"}},"plugin":["./plugin.ts"]}',
      { OPENAI_API_KEY: "secret-one", UNRELATED: "changed" },
    );
    expect(context.schema).toBe(2);
    expect(JSON.stringify(context)).not.toContain("secret-one");
    expect(context.credentialEnvironment).toEqual([{ name: "OPENAI_API_KEY", present: true }]);
    expect(context.configCandidates.some((candidate) => candidate.logicalPath.endsWith("opencode.json"))).toBe(true);
  });

  test("same-stat provider options preserve approved semantic model, plugin, path, and control changes", async () => {
    const [first, changed] = await Promise.all([
      collect('{"providers":{"custom":{"options":{"model":"model-a","plugin":"plugin-a","configPath":"/models/a","endpoint":"https://one.example"}}}}'),
      collect('{"providers":{"custom":{"options":{"model":"model-b","plugin":"plugin-b","configPath":"/models/b","endpoint":"https://two.example"}}}}'),
    ]);

    expect(configDigest(first)).not.toBe(configDigest(changed));
  });

  test("unknown provider credential values do not influence a digest", async () => {
    const [first, changed] = await Promise.all([
      collect('{"providers":{"custom":{"bearer":"unknown-secret-one"}}}'),
      collect('{"providers":{"custom":{"bearer":"unknown-secret-two"}}}'),
    ]);

    expect(configDigest(first)).toBe(configDigest(changed));
    expect(JSON.stringify({ first, changed })).not.toContain("unknown-secret-one");
    expect(JSON.stringify({ first, changed })).not.toContain("unknown-secret-two");
  });

  test("virtual config contributes its environment and plugin references", async () => {
    const context = await collect(
      '{}',
      { OPENCODE_CONFIG_CONTENT: '{// JSONC is supported\n"providers":{"custom":{"env":"CUSTOM_PROVIDER_TOKEN"}},"plugins":["./virtual-plugin.ts"]}' },
      async (reference, fromDirectory) => `${fromDirectory}/${reference.slice(2)}`,
    );

    expect(context.credentialEnvironment).toEqual([{ name: "CUSTOM_PROVIDER_TOKEN", present: false }]);
    expect(context.pluginFiles.map((file) => file.logicalPath)).toContain("/workspace/project/virtual-plugin.ts");
  });


  test("records embedded references from raw JSON and JSONC before redaction", async () => {
    const [jsonPresent, jsonAbsent, jsonValueChanged, jsoncPresent] = await Promise.all([
      collect('{"providers":{"custom":{"apiKey":"prefix-{env:JSON_EMBEDDED_TOKEN}-suffix"}}}', { JSON_EMBEDDED_TOKEN: "first-secret" }),
      collect('{"providers":{"custom":{"apiKey":"prefix-{env:JSON_EMBEDDED_TOKEN}-suffix"}}}'),
      collect('{"providers":{"custom":{"apiKey":"prefix-{env:JSON_EMBEDDED_TOKEN}-suffix"}}}', { JSON_EMBEDDED_TOKEN: "second-secret" }),
      collect('{// JSONC\n"providers":{"custom":{"headers":{"authorization":"Bearer {env:JSONC_EMBEDDED_TOKEN}"}}}}', { JSONC_EMBEDDED_TOKEN: "jsonc-secret" }),
    ]);

    expect(jsonPresent.credentialEnvironment).toEqual([{ name: "JSON_EMBEDDED_TOKEN", present: true }]);
    expect(jsoncPresent.credentialEnvironment).toEqual([{ name: "JSONC_EMBEDDED_TOKEN", present: true }]);
    await expect(buildDiscoveryFingerprint(jsonPresent)).resolves.not.toBe(await buildDiscoveryFingerprint(jsonAbsent));
    await expect(buildDiscoveryFingerprint(jsonPresent)).resolves.toBe(await buildDiscoveryFingerprint(jsonValueChanged));
    expect(JSON.stringify({ jsonPresent, jsonAbsent, jsonValueChanged, jsoncPresent })).not.toContain("first-secret");
    expect(JSON.stringify({ jsonPresent, jsonAbsent, jsonValueChanged, jsoncPresent })).not.toContain("second-secret");
    expect(JSON.stringify({ jsonPresent, jsonAbsent, jsonValueChanged, jsoncPresent })).not.toContain("jsonc-secret");
  });

  test("records embedded references from OPENCODE_CONFIG_CONTENT", async () => {
    const raw = '{"providers":{"virtual":{"options":{"token":"{env:VIRTUAL_EMBEDDED_TOKEN}"}}}}';
    const [present, absent, valueChanged] = await Promise.all([
      collect("{}", { OPENCODE_CONFIG_CONTENT: raw, VIRTUAL_EMBEDDED_TOKEN: "first-virtual-secret" }),
      collect("{}", { OPENCODE_CONFIG_CONTENT: raw }),
      collect("{}", { OPENCODE_CONFIG_CONTENT: raw, VIRTUAL_EMBEDDED_TOKEN: "second-virtual-secret" }),
    ]);

    expect(present.credentialEnvironment).toEqual([{ name: "VIRTUAL_EMBEDDED_TOKEN", present: true }]);
    await expect(buildDiscoveryFingerprint(present)).resolves.not.toBe(await buildDiscoveryFingerprint(absent));
    await expect(buildDiscoveryFingerprint(present)).resolves.toBe(await buildDiscoveryFingerprint(valueChanged));
    expect(JSON.stringify({ present, absent, valueChanged })).not.toContain("first-virtual-secret");
    expect(JSON.stringify({ present, absent, valueChanged })).not.toContain("second-virtual-secret");
  });

  test("preserves semantic config changes while excluding secret values", async () => {
    const [first, changedModel, changedSecret, jsonc] = await Promise.all([
      collect('{"providers":{"openai":{"model":"gpt-4.1","apiKey":"secret-one"}}}'),
      collect('{"providers":{"openai":{"model":"gpt-4.2","apiKey":"secret-one"}}}'),
      collect('{"providers":{"openai":{"model":"gpt-4.1","apiKey":"secret-two"}}}'),
      collect('{// supported JSONC\n"providers":{"openai":{"model":"gpt-4.1"}}}'),
    ]);

    expect(configDigest(first)).not.toBe(configDigest(changedModel));
    expect(configDigest(first)).toBe(configDigest(changedSecret));
    expect(jsonc.configCandidates.find((candidate) => candidate.logicalPath.endsWith("opencode.json"))?.digestDisposition).toBe("sanitized");
    expect(JSON.stringify({ first, changedModel, changedSecret, jsonc })).not.toContain("secret-one");
    expect(JSON.stringify({ first, changedModel, changedSecret, jsonc })).not.toContain("secret-two");
  });

  test("enumerates the authoritative local config layers in precedence order", () => {
    expect(enumerateOpenCodeConfigCandidates({
      projectRoot: "/workspace/project",
      workspaceRoot: "/workspace",
      homeDir: "/home/fixture",
      env: {
        XDG_CONFIG_HOME: "/fixture/config",
        OPENCODE_CONFIG: "overrides/custom.jsonc",
        OPENCODE_CONFIG_DIR: "/fixture/alternate",
      },
    }).map((candidate) => candidate.path)).toEqual([
      "/fixture/config/opencode/opencode.json",
      "/fixture/config/opencode/opencode.jsonc",
      "/workspace/project/overrides/custom.jsonc",
      "/workspace/opencode.json",
      "/workspace/opencode.jsonc",
      "/workspace/project/opencode.json",
      "/workspace/project/opencode.jsonc",
      "/workspace/project/.opencode/opencode.json",
      "/workspace/project/.opencode/opencode.jsonc",
      "/fixture/alternate/opencode.json",
      "/fixture/alternate/opencode.jsonc",
    ]);
  });

  test("honors project-disable and pure controls without evaluating config content", () => {
    const base = {
      projectRoot: "/workspace/project",
      workspaceRoot: "/workspace",
      homeDir: "/home/fixture",
      env: { OPENCODE_CONFIG: "custom.json", OPENCODE_CONFIG_DIR: "/fixture/alternate" },
    };

    expect(enumerateOpenCodeConfigCandidates({
      ...base,
      env: { ...base.env, OPENCODE_DISABLE_PROJECT_CONFIG: "1" },
    }).map((candidate) => candidate.path)).toEqual([
      "/home/fixture/.config/opencode/opencode.json",
      "/home/fixture/.config/opencode/opencode.jsonc",
      "/workspace/project/custom.json",
      "/fixture/alternate/opencode.json",
      "/fixture/alternate/opencode.jsonc",
    ]);
    expect(enumerateOpenCodeConfigCandidates({
      ...base,
      env: { ...base.env, OPENCODE_PURE: "1" },
    })).toEqual([]);
  });

  test("parses comments and trailing commas through the shared JSONC parser", () => {
    expect(parseJsonc('{\n  // local-only fixture\n  "mcp": { "codebase-memory": {}, },\n}')).toEqual({
      mcp: { "codebase-memory": {} },
    });
  });
});
