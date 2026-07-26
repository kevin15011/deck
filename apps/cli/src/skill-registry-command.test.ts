import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { createAdapterRegistry, type RunnerAdapter } from "@deck/core";
import type {
  SkillDiscoveryDigestV1,
  SkillDiscoverySourceBindingV1,
  SkillDiscoverySourceDeclarationV1,
  SkillDiscoverySourceProviderV1,
  SkillDiscoverySourceSetV1,
  SkillRegistryWritePlanV1,
  SkillRegistryWriterV1,
} from "@deck/core";
import type { SkillDiscoveryObservationV1 } from "../../../packages/core/src/skill-discovery/discovery";

import {
  runSkillRegistryCommand,
  type SkillRegistryCommandDependencies,
} from "./skill-registry-command";
import {
  canonicalizeSkillRegistry,
  parseSkillRegistryDocument,
} from "../../../packages/core/src/skill-discovery/registry";

describe("skill-registry CLI command", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deck-skill-registry-cli-"));
    await fs.writeFile(path.join(projectRoot, ".gitignore"), "/.atl/\n", "utf8");
    await fs.mkdir(path.join(projectRoot, ".agents", "skills", "core"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, ".agents", "skills", "core", "SKILL.md"),
      "---\nname: core-agent\ndescription: Core agent helper\n---\n# Core agent helper\n",
      "utf8",
    );
    await fs.mkdir(path.join(projectRoot, ".skills", "api"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, ".skills", "api", "SKILL.md"),
      "---\nname: api\ndescription: API helper\n---\n# API helper\n",
      "utf8",
    );
    await fs.mkdir(path.join(projectRoot, ".opencode-fixture-skills", "runner"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, ".opencode-fixture-skills", "runner", "SKILL.md"),
      "---\nname: opencode-runner\ndescription: OpenCode fixture helper\n---\n# OpenCode fixture helper\n",
      "utf8",
    );
    await fs.mkdir(path.join(projectRoot, ".pi", "skills", "pi-only"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, ".pi", "skills", "pi-only", "SKILL.md"),
      "---\nname: pi-only\ndescription: Other runner helper\n---\n# Other runner helper\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  test("discovers only sources declared by the selected runner", async () => {
    const { adapterRegistry } = createTestRegistry();

    const result = await runSkillRegistryCommand(
      {
        command: "skill-registry-discover",
        flags: { runner: "opencode", root: projectRoot, json: true },
      },
      { adapterRegistry, isInteractive: false },
    );

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      command: "deck skill-registry discover",
      outcome: "complete",
      candidate_count: 3,
      locators: [
        "project:.agents/skills/core/SKILL.md",
        "project:.opencode-fixture-skills/runner/SKILL.md",
        "project:.skills/api/SKILL.md",
      ],
    });
    expect(result.json).not.toHaveProperty("root");
    expect(result.json).not.toHaveProperty("project_root");
  });

  test("refreshes an OpenCode registry with the complete generic and runner source scope", async () => {
    const { adapterRegistry } = createTestRegistry();
    let capturedPlan: SkillRegistryWritePlanV1 | undefined;
    const committedDigest = `sha256:${"a".repeat(64)}` as SkillDiscoveryDigestV1;

    const result = await runSkillRegistryCommand(
      {
        command: "skill-registry-refresh",
        flags: { runner: "opencode", root: projectRoot, json: true },
      },
      {
        adapterRegistry,
        isInteractive: false,
        createWriter: () => ({
          commit: async (plan) => {
            capturedPlan = plan;
            return {
              outcome: "committed",
              registry_digest: committedDigest,
              gitignore_changed: false,
              diagnostics: [],
            };
          },
        } satisfies SkillRegistryWriterV1),
      },
    );

    expect(result.json).toMatchObject({ outcome: "committed", status: "ready" });
    const parsed = parseSkillRegistryDocument(capturedPlan?.candidate_document ?? "");
    expect(parsed.ok).toBe(true);
    expect(parsed.frontmatter?.source_scope_hash).toBe(
      "sha256:18c7b581942f33f366740594478b7935274ca798d34cf0aa4de2c8fb84660545",
    );
  });

  test("refreshes a Pi registry with generic and Pi-only sources", async () => {
    const { adapterRegistry } = createPiTestRegistry(true);
    let capturedPlan: SkillRegistryWritePlanV1 | undefined;
    const committedDigest = `sha256:${"b".repeat(64)}` as SkillDiscoveryDigestV1;

    const result = await runSkillRegistryCommand(
      {
        command: "skill-registry-refresh",
        flags: { runner: "pi", root: projectRoot, json: true },
      },
      {
        adapterRegistry,
        isInteractive: false,
        createWriter: () => ({
          commit: async (plan) => {
            capturedPlan = plan;
            return {
              outcome: "committed",
              registry_digest: committedDigest,
              gitignore_changed: false,
              diagnostics: [],
            };
          },
        } satisfies SkillRegistryWriterV1),
      },
    );

    expect(result.json).toMatchObject({ outcome: "committed", status: "ready", active_runner_id: "pi" });
    const parsed = parseSkillRegistryDocument(capturedPlan?.candidate_document ?? "");
    expect(parsed.ok).toBe(true);
    expect(parsed.frontmatter?.source_scope_hash).toBe(
      "sha256:db86a369c6ec8d342cbdd4e0d452f1f401c66dec2127de57c9460a451340450c",
    );
    expect(parsed.document).not.toContain("name: opencode-runner");
  });

  test("does not report a provider-only stored registry as ready", async () => {
    const providerOnly = canonicalizeSkillRegistry({
      activeRunnerId: "opencode",
      sourceDeclarations: [opencodeFixtureDeclaration()],
      observations: [
        registryObservation("core-agent", "project:.agents/skills/core/SKILL.md", "project_local"),
        registryObservation("api", "project:.skills/api/SKILL.md", "project_local"),
        registryObservation("opencode-runner", "project:.opencode-fixture-skills/runner/SKILL.md", "project_runner", "opencode"),
      ],
      diagnostics: [],
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    await fs.mkdir(path.join(projectRoot, ".atl"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, ".atl", "skill-registry.md"), providerOnly.document, "utf8");

    const result = await runSkillRegistryCommand(
      {
        command: "skill-registry-validate",
        flags: { runner: "opencode", root: projectRoot, json: true },
      },
      { adapterRegistry: createTestRegistry().adapterRegistry, isInteractive: false },
    );

    expect(result.json).toMatchObject({ status: "stale", reason_code: "fingerprint_mismatch" });
  });

  test("validates read-only without creating a missing registry", async () => {
    const { adapterRegistry } = createTestRegistry();
    const ignoreBefore = await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8");

    const result = await runSkillRegistryCommand(
      {
        command: "skill-registry-validate",
        flags: { runner: "opencode", root: projectRoot, json: true },
      },
      { adapterRegistry, isInteractive: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      command: "deck skill-registry validate",
      status: "missing",
      reason_code: "file_absent",
      registry_path: ".atl/skill-registry.md",
    });
    await expect(fs.stat(path.join(projectRoot, ".atl", "skill-registry.md"))).rejects.toThrow();
    expect(await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8")).toBe(ignoreBefore);
  });

  test("refreshes with an existing empty .gitignore", async () => {
    const { adapterRegistry } = createTestRegistry();
    await fs.writeFile(path.join(projectRoot, ".gitignore"), "", "utf8");

    const result = await runSkillRegistryCommand(
      {
        command: "skill-registry-refresh",
        flags: { runner: "opencode", root: projectRoot, json: true },
      },
      { adapterRegistry, isInteractive: false },
    );

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      command: "deck skill-registry refresh",
      outcome: "committed",
      status: "ready",
      gitignore_changed: true,
      possible_targets: [".gitignore", ".atl/skill-registry.md"],
    });
    expect(await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8")).toBe(
      "/.atl/skill-registry.md\n",
    );
    expect(await fs.stat(path.join(projectRoot, ".atl", "skill-registry.md"))).toBeDefined();
  });

  test("refresh requires explicit authorization bound to the exact runner and targets", async () => {
    const { adapterRegistry } = createTestRegistry();
    const authorizationInputs: unknown[] = [];
    const dependencies: SkillRegistryCommandDependencies = {
      adapterRegistry,
      isInteractive: false,
      mintRefreshAuthority: (input) => {
        authorizationInputs.push(input);
        return undefined;
      },
    };

    const result = await runSkillRegistryCommand(
      {
        command: "skill-registry-refresh",
        flags: { runner: "opencode", root: projectRoot, json: true },
      },
      dependencies,
    );

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      command: "deck skill-registry refresh",
      outcome: "rejected",
      reason_code: "authorization_required",
    });
    expect(authorizationInputs).toHaveLength(1);
    expect(authorizationInputs[0]).toMatchObject({
      action: "migration",
      activeRunnerId: "opencode",
      allowedTargets: [".atl/skill-registry.md"],
    });
    await expect(fs.stat(path.join(projectRoot, ".atl", "skill-registry.md"))).rejects.toThrow();
  });

  test("refresh composes one active runner and atomically delegates the write", async () => {
    const { adapterRegistry } = createTestRegistry();

    const result = await runSkillRegistryCommand(
      {
        command: "skill-registry-refresh",
        flags: { runner: "opencode", root: projectRoot, json: false },
      },
      { adapterRegistry, isInteractive: false },
    );

    expect(result.exitCode).toBe(0);
    expect(result.human).toContain("deck skill-registry refresh");
    expect(result.human).toContain("committed");
    const registry = await fs.readFile(path.join(projectRoot, ".atl", "skill-registry.md"), "utf8");
    expect(registry).toContain("schema: skill-registry-v1");
    expect(registry).toContain("candidate_count: 3");
    expect(registry).toContain("name: core-agent");
    expect(registry).toContain("name: api");
    expect(registry).toContain("name: opencode-runner");
    expect(registry).not.toContain("name: pi-only");

    const validation = await runSkillRegistryCommand(
      {
        command: "skill-registry-validate",
        flags: { runner: "opencode", root: projectRoot, json: true },
      },
      { adapterRegistry, isInteractive: false },
    );
    expect(validation.exitCode).toBe(0);
    expect(validation.json).toMatchObject({
      status: "ready",
      reason_code: "fingerprint_match",
      registry_path: ".atl/skill-registry.md",
    });
  });

  test("refuses ambiguous non-interactive refresh before adapter or filesystem I/O", async () => {
    let getCalls = 0;
    let listCalls = 0;
    const adapterRegistry = {
      get: () => {
        getCalls += 1;
        throw new Error("must not resolve a runner");
      },
      list: () => {
        listCalls += 1;
        return [];
      },
    } as unknown as ReturnType<typeof createAdapterRegistry>;

    const result = await runSkillRegistryCommand(
      {
        command: "skill-registry-refresh",
        flags: { json: true },
      },
      { adapterRegistry, isInteractive: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      command: "deck skill-registry refresh",
      outcome: "rejected",
      reason_code: "runner_required",
    });
    expect(getCalls).toBe(0);
    expect(listCalls).toBe(0);
  });

  test("allows interactive refresh to select exactly one registered runner", async () => {
    const { adapterRegistry } = createTestRegistry();

    const result = await runSkillRegistryCommand(
      {
        command: "skill-registry-refresh",
        flags: { root: projectRoot, json: false },
      },
      {
        adapterRegistry,
        isInteractive: true,
        selectRunner: (runnerIds) => {
          expect(runnerIds).toEqual(["opencode"]);
          return "opencode";
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      command: "deck skill-registry refresh",
      outcome: "committed",
      active_runner_id: "opencode",
    });
  });

  test("bounds source bindings end to end across discover, refresh, and status", async () => {
    for (const count of [499, 500, 501, 10_000]) {
      const counters = { indexedReads: 0, iteratorCalls: 0 };
      let activeSources: readonly SkillDiscoverySourceBindingV1[] = countedSourceBindings(count, counters);
      const { adapterRegistry } = createTestRegistry(() => activeSources);

      const discovered = await runSkillRegistryCommand(
        {
          command: "skill-registry-discover",
          flags: { runner: "opencode", root: projectRoot, json: true },
        },
        { adapterRegistry, isInteractive: false },
      );

      expect(discovered.json.outcome).toBe(count <= 500 ? "complete" : "indeterminate");
      expect(counters.indexedReads).toBe(Math.min(count, 501));
      expect(counters.iteratorCalls).toBe(0);

      if (count <= 500) {
        resetSourceCounters(counters);
        const refreshed = await runSkillRegistryCommand(
          {
            command: "skill-registry-refresh",
            flags: { runner: "opencode", root: projectRoot, json: true },
          },
          { adapterRegistry, isInteractive: false },
        );
        expect(refreshed.json).toMatchObject({ outcome: "committed", status: "ready" });
        expect(counters.indexedReads).toBe(count);
        expect(counters.iteratorCalls).toBe(0);

        resetSourceCounters(counters);
        const validated = await runSkillRegistryCommand(
          {
            command: "skill-registry-validate",
            flags: { runner: "opencode", root: projectRoot, json: true },
          },
          { adapterRegistry, isInteractive: false },
        );
        expect(validated.json).toMatchObject({ status: "ready", reason_code: "fingerprint_match" });
        expect(counters.indexedReads).toBe(count);
        expect(counters.iteratorCalls).toBe(0);
        continue;
      }

      const baselineCounters = { indexedReads: 0, iteratorCalls: 0 };
      activeSources = countedSourceBindings(500, baselineCounters);
      const baselineRefresh = await runSkillRegistryCommand(
        {
          command: "skill-registry-refresh",
          flags: { runner: "opencode", root: projectRoot, json: true },
        },
        { adapterRegistry, isInteractive: false },
      );
      expect(baselineRefresh.json).toMatchObject({ outcome: "committed", status: "ready" });

      activeSources = countedSourceBindings(count, counters);
      resetSourceCounters(counters);
      const validated = await runSkillRegistryCommand(
        {
          command: "skill-registry-validate",
          flags: { runner: "opencode", root: projectRoot, json: true },
        },
        { adapterRegistry, isInteractive: false },
      );
      expect(validated.json).toMatchObject({ status: "indeterminate", reason_code: "truncated_output" });
      expect(counters.indexedReads).toBe(501);
      expect(counters.iteratorCalls).toBe(0);
    }
  });

  test("never invokes a pathological source iterator on the composed CLI path", async () => {
    const counters = { indexedReads: 0, iteratorCalls: 0 };
    const sources = countedSourceBindings(1, counters, true);
    const { adapterRegistry } = createTestRegistry(sources);

    const refreshed = await runSkillRegistryCommand(
      {
        command: "skill-registry-refresh",
        flags: { runner: "opencode", root: projectRoot, json: true },
      },
      { adapterRegistry, isInteractive: false },
    );

    expect(refreshed.json).toMatchObject({ outcome: "committed", status: "ready" });
    expect(counters.indexedReads).toBe(1);
    expect(counters.iteratorCalls).toBe(0);
  });
});

function createTestRegistry(
  sourceInput?: readonly SkillDiscoverySourceBindingV1[] | (() => readonly SkillDiscoverySourceBindingV1[]),
): {
  adapterRegistry: ReturnType<typeof createAdapterRegistry>;
  provider: SkillDiscoverySourceProviderV1;
} {
  const provider: SkillDiscoverySourceProviderV1 = {
    schema: "skill-discovery-source-provider-v1",
    runnerId: "opencode",
    async listSources(input): Promise<SkillDiscoverySourceSetV1> {
      if (sourceInput) {
        return {
          outcome: "complete",
          sources: typeof sourceInput === "function" ? sourceInput() : sourceInput,
          diagnostics: [],
        };
      }
      return {
        outcome: "complete",
        sources: [
          {
            kind: "filesystem",
            declaration: {
              ...opencodeFixtureDeclaration(),
            },
            absoluteRoot: path.join(input.projectRoot, ".opencode-fixture-skills"),
            descriptorBasename: "SKILL.md",
          },
        ],
        diagnostics: [],
      };
    },
    async resolveLocator() {
      return { status: "missing" };
    },
  };

  const adapter = {
    runnerId: "opencode",
    displayName: "OpenCode",
    environmentIds: ["opencode"],
    skillDiscovery: provider,
  } as unknown as RunnerAdapter;
  const adapterRegistry = createAdapterRegistry();
  adapterRegistry.register("opencode", adapter);
  return { adapterRegistry, provider };
}

function createPiTestRegistry(includeOtherRunner = false): {
  adapterRegistry: ReturnType<typeof createAdapterRegistry>;
  provider: SkillDiscoverySourceProviderV1;
} {
  const provider: SkillDiscoverySourceProviderV1 = {
    schema: "skill-discovery-source-provider-v1",
    runnerId: "pi",
    async listSources(input): Promise<SkillDiscoverySourceSetV1> {
      const sources: SkillDiscoverySourceBindingV1[] = [
        {
          kind: "filesystem",
          declaration: piSourceDeclaration("pi-project-skills", "project_relative", ".pi/skills"),
          absoluteRoot: path.join(input.projectRoot, ".pi", "skills"),
          descriptorBasename: "SKILL.md",
        },
        {
          kind: "filesystem",
          declaration: piSourceDeclaration("pi-user-agent-skills", "runner_relative", "pi-user-agent-skills"),
          absoluteRoot: path.join(input.projectRoot, ".pi-agent-skills"),
          descriptorBasename: "SKILL.md",
        },
        {
          kind: "filesystem",
          declaration: piSourceDeclaration("pi-user-skills", "runner_relative", "pi-user-skills"),
          absoluteRoot: path.join(input.projectRoot, ".pi-user-skills"),
          descriptorBasename: "SKILL.md",
        },
      ];
      if (includeOtherRunner) {
        sources.push({
          kind: "filesystem",
          declaration: opencodeFixtureDeclaration(),
          absoluteRoot: path.join(input.projectRoot, ".opencode-fixture-skills"),
          descriptorBasename: "SKILL.md",
        });
      }
      return { outcome: "complete", sources, diagnostics: [] };
    },
    async resolveLocator() {
      return { status: "missing" };
    },
  };
  const adapter = {
    runnerId: "pi",
    displayName: "Pi",
    environmentIds: ["pi"],
    skillDiscovery: provider,
  } as unknown as RunnerAdapter;
  const adapterRegistry = createAdapterRegistry();
  adapterRegistry.register("pi", adapter);
  return { adapterRegistry, provider };
}

function opencodeFixtureDeclaration(): SkillDiscoverySourceDeclarationV1 {
  return {
    schema: "skill-discovery-source-v1",
    sourceId: "opencode-fixture-skills",
    sourceCategory: "project_runner",
    scope: "project",
    runnerId: "opencode",
    locatorStrategy: "project_relative",
    expectedContent: "skill_md",
    safeLocatorBase: ".opencode-fixture-skills",
  };
}

function piSourceDeclaration(
  sourceId: string,
  locatorStrategy: "project_relative" | "runner_relative",
  safeLocatorBase: string,
): SkillDiscoverySourceDeclarationV1 {
  return {
    schema: "skill-discovery-source-v1",
    sourceId,
    sourceCategory: locatorStrategy === "project_relative" ? "project_runner" : "user_runner",
    scope: locatorStrategy === "project_relative" ? "project" : "user",
    runnerId: "pi",
    locatorStrategy,
    expectedContent: "skill_md",
    safeLocatorBase,
  };
}

function registryObservation(
  name: string,
  locator: string,
  sourceCategory: SkillDiscoveryObservationV1["source_category"],
  runnerId?: string,
): SkillDiscoveryObservationV1 {
  return {
    name,
    source_category: sourceCategory,
    scope: sourceCategory === "project_local" || sourceCategory === "project_runner" ? "project" : "runner",
    locator,
    ...(runnerId ? { runner_id: runnerId } : {}),
    task_signals: [],
    technology_signals: [],
    path_signals: [],
  };
}

function countedSourceBindings(
  count: number,
  counters: { indexedReads: number; iteratorCalls: number },
  pathologicalIterator = false,
): readonly SkillDiscoverySourceBindingV1[] {
  const values: SkillDiscoverySourceBindingV1[] = Array.from({ length: count }, (_, index) => ({
    kind: "filesystem",
    declaration: {
      schema: "skill-discovery-source-v1",
      sourceId: `other-runner-${index}`,
      sourceCategory: "project_runner",
      scope: "project",
      runnerId: "pi",
      locatorStrategy: "project_relative",
      expectedContent: "skill_md",
      safeLocatorBase: `other-runner-${index}`,
    },
    absoluteRoot: `/tmp/t-rr-008-other-runner-${index}`,
    descriptorBasename: "SKILL.md",
  }));

  Object.defineProperty(values, Symbol.iterator, {
    configurable: true,
    value(this: readonly SkillDiscoverySourceBindingV1[]) {
      counters.iteratorCalls += 1;
      if (pathologicalIterator) throw new Error("pathological iterator must not be invoked");
      return Array.prototype[Symbol.iterator].call(this);
    },
  });

  return new Proxy(values, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^(?:0|[1-9][0-9]*)$/.test(property)) {
        counters.indexedReads += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function resetSourceCounters(counters: { indexedReads: number; iteratorCalls: number }): void {
  counters.indexedReads = 0;
  counters.iteratorCalls = 0;
}
