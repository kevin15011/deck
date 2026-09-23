import { describe, expect, test } from "bun:test";

import type {
  SkillDiscoverySourceProviderV1,
  SkillRegistryRecordV1,
} from "./contracts";
import { createTaskScopedSkillDiscoveryRuntime } from "./runtime";

const singleRecord: SkillRegistryRecordV1 = {
  name: "api-helper",
  source_category: "user_runner",
  scope: "user",
  locator: "runner:opencode:opencode-config-skills/api-helper%2FSKILL.md",
  observation_id: "sha256:api-helper",
  runner_id: "opencode",
  description: "API contract helper",
  task_signals: ["api", "contract"],
  technology_signals: ["typescript"],
  path_signals: ["packages/core/**/*.ts"],
};

function provider(resolveCalls: string[] = []): SkillDiscoverySourceProviderV1 {
  return {
    schema: "skill-discovery-source-provider-v1",
    runnerId: "opencode",
    listSources: async () => ({ outcome: "complete", sources: [], diagnostics: [] }),
    resolveLocator: async ({ locator }) => {
      resolveCalls.push(locator);
      return { status: "available", loadReference: "private-native-reference" };
    },
  };
}

describe("task-scoped skill discovery runtime", () => {
  test("searches a ready registry without exposing locators and binds exact selection to its task", async () => {
    let directDiscoveryCalls = 0;
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-1",
      taskId: "lead-task",
      registryStatus: "ready",
      readRegistry: async () => [singleRecord],
      discoverDirectly: async () => {
        directDiscoveryCalls += 1;
        return { outcome: "complete", observations: [], diagnostics: [] };
      },
      provider: provider(),
    });

    const search = await runtime.search({ schema: "skill-candidate-query-v1", terms: ["API"], limit: 5 });
    expect(search.source_mode).toBe("registry");
    expect(search.candidates).toHaveLength(1);
    expect(search.candidates[0]).not.toHaveProperty("locator");
    expect(directDiscoveryCalls).toBe(0);

    const selection = runtime.select({ observation_id: "sha256:api-helper" });
    expect(selection.outcome).toBe("selected");
    if (selection.outcome !== "selected") throw new Error("expected a selection");
    expect(selection.reference.task_id).toBe("lead-task");
    expect(selection.reference.session_id).toBe("session-1");
    expect(selection.reference).not.toHaveProperty("load_reference");
  });

  test("falls back to direct discovery, rejects name ambiguity, and reports unsupported native loading honestly", async () => {
    const resolveCalls: string[] = [];
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-2",
      taskId: "specialist-task",
      registryStatus: "stale",
      discoverDirectly: async () => ({
        outcome: "complete",
        diagnostics: [],
        observations: [
          {
            name: "duplicate",
            source_category: "user_runner",
            scope: "user",
            locator: singleRecord.locator,
            runner_id: "opencode",
            task_signals: ["api"],
            technology_signals: [],
            path_signals: [],
          },
          {
            name: "duplicate",
            source_category: "user_runner",
            scope: "user",
            locator: "runner:opencode:opencode-config-skills/duplicate%2FSKILL.md",
            runner_id: "opencode",
            task_signals: ["api"],
            technology_signals: [],
            path_signals: [],
          },
        ],
      }),
      provider: provider(resolveCalls),
    });

    const search = await runtime.search({ schema: "skill-candidate-query-v1", terms: ["api"], limit: 5 });
    expect(search.source_mode).toBe("direct_discovery");
    expect(runtime.select({ name: "duplicate" })).toEqual({ outcome: "ambiguous" });

    const exact = runtime.select({ observation_id: search.candidates[0]!.observation_id });
    if (exact.outcome !== "selected") throw new Error("expected an exact selection");
    const preparation = await runtime.prepare(exact.reference);
    expect(resolveCalls).toHaveLength(1);
    expect(preparation).toEqual({ outcome: "unsupported" });
    expect(await runtime.load(exact.reference)).toEqual({ outcome: "unobserved" });
  });

  test("revalidates the exact observation immediately before native loading", async () => {
    let resolutions = 0;
    const nativeLoads: string[] = [];
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-3",
      taskId: "lead-task",
      registryStatus: "ready",
      readRegistry: async () => [singleRecord],
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider: {
        ...provider(),
        resolveLocator: async () => ({
          status: "available" as const,
          loadReference: ++resolutions === 1 ? "first-observation" : "different-observation",
        }),
      },
      nativeLoader: {
        schema: "skill-native-load-port-v1",
        prepare: async () => ({ outcome: "loadable" }),
        load: async ({ loadReference }) => {
          nativeLoads.push(loadReference);
          return { outcome: "loaded" };
        },
      },
    });

    const search = await runtime.search({ schema: "skill-candidate-query-v1", terms: ["api"], limit: 1 });
    const selection = runtime.select({ observation_id: search.candidates[0]!.observation_id });
    if (selection.outcome !== "selected") throw new Error("expected an exact selection");

    expect(await runtime.prepare(selection.reference)).toEqual({ outcome: "loadable" });
    expect(await runtime.load(selection.reference)).toEqual({ outcome: "unobserved" });
    expect(resolutions).toBe(2);
    expect(nativeLoads).toEqual([]);
  });

  test("rejects project records outside their declared generic skill roots", async () => {
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-project-root",
      taskId: "task-project-root",
      registryStatus: "ready",
      readRegistry: async () => [{ ...singleRecord, locator: "project:packages/core/src/skill-discovery/runtime.ts" }],
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider: provider(),
    });
    const search = await runtime.search({ schema: "skill-candidate-query-v1", terms: ["api"], limit: 1 });
    const selection = runtime.select({ observation_id: search.candidates[0]!.observation_id });
    if (selection.outcome !== "selected") throw new Error("expected a selection");

    expect(await runtime.prepare(selection.reference)).toEqual({ outcome: "rejected" });
  });

  test("invalidates an earlier preparation when a later preparation is denied", async () => {
    let attempts = 0;
    const loads: string[] = [];
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-reprepare",
      taskId: "task-reprepare",
      registryStatus: "ready",
      readRegistry: async () => [singleRecord],
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider: provider(),
      nativeLoader: {
        schema: "skill-native-load-port-v1",
        prepare: async () => ++attempts === 1 ? { outcome: "loadable" } : { outcome: "denied" },
        load: async ({ loadReference }) => {
          loads.push(loadReference);
          return { outcome: "loaded" };
        },
      },
    });
    const search = await runtime.search({ schema: "skill-candidate-query-v1", terms: ["api"], limit: 1 });
    const selection = runtime.select({ observation_id: search.candidates[0]!.observation_id });
    if (selection.outcome !== "selected") throw new Error("expected a selection");

    expect(await runtime.prepare(selection.reference)).toEqual({ outcome: "loadable" });
    expect(await runtime.prepare(selection.reference)).toEqual({ outcome: "denied" });
    expect(await runtime.load(selection.reference)).toEqual({ outcome: "unobserved" });
    expect(loads).toEqual([]);
  });

  test("does not hide same-name ambiguity behind a result limit", async () => {
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-name-limit",
      taskId: "task-name-limit",
      registryStatus: "ready",
      readRegistry: async () => [
        { ...singleRecord, name: "duplicate", observation_id: "sha256:duplicate-one" },
        { ...singleRecord, name: "duplicate", observation_id: "sha256:duplicate-two", locator: "runner:opencode:opencode-config-skills/duplicate%2FSKILL.md" },
      ],
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider: provider(),
    });

    const search = await runtime.search({ schema: "skill-candidate-query-v1", terms: ["api"], limit: 1 });
    expect(search.candidates).toHaveLength(1);
    expect(runtime.select({ name: "duplicate" })).toEqual({ outcome: "ambiguous" });
  });

  test("keeps same-name ambiguity even when only one observation is relevance-matched", async () => {
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-filtered-name",
      taskId: "task-filtered-name",
      registryStatus: "ready",
      readRegistry: async () => [
        { ...singleRecord, name: "shared", observation_id: "sha256:shared-api", task_signals: ["api"] },
        {
          ...singleRecord,
          name: "shared",
          observation_id: "sha256:shared-other",
          description: undefined,
          task_signals: ["unrelated"],
          technology_signals: ["python"],
          path_signals: ["packages/python/**/*.py"],
        },
      ],
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider: provider(),
    });

    const search = await runtime.search({ schema: "skill-candidate-query-v1", terms: ["api"], limit: 5 });
    expect(search.candidates.map((candidate) => candidate.observation_id)).toEqual(["sha256:shared-api"]);
    expect(runtime.select({ name: "shared" })).toEqual({ outcome: "ambiguous" });
    expect(runtime.select({ observation_id: "sha256:shared-api" }).outcome).toBe("selected");
  });

  test("rejects malformed query filters without broadening candidate matching", async () => {
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-invalid-query",
      taskId: "task-invalid-query",
      registryStatus: "ready",
      readRegistry: async () => [singleRecord],
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider: provider(),
    });

    const result = await runtime.search({
      schema: "skill-candidate-query-v1",
      terms: [],
      target_paths: "packages/core" as unknown as string[],
      limit: 1,
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid_candidate_query" })]),
    );
  });

  test("matches target paths and extensions against declared path signals", async () => {
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-paths",
      taskId: "task-paths",
      registryStatus: "ready",
      readRegistry: async () => [
        singleRecord,
        { ...singleRecord, name: "python-helper", observation_id: "sha256:python-helper", path_signals: ["packages/core/**/*.py"] },
      ],
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider: provider(),
    });

    const result = await runtime.search({
      schema: "skill-candidate-query-v1",
      terms: [],
      target_paths: ["packages/core/src/skill-discovery/runtime.ts"],
      target_extensions: [".ts"],
      limit: 5,
    } as unknown as Parameters<typeof runtime.search>[0]);

    expect(result.candidates.map((candidate) => candidate.name)).toEqual(["api-helper"]);
  });

  test("rejects hostile glob patterns with bounded deterministic matching", async () => {
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-hostile-glob",
      taskId: "task-hostile-glob",
      registryStatus: "ready",
      readRegistry: async () => [
        { ...singleRecord, path_signals: [`${"*a".repeat(20)}b`] },
      ],
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider: provider(),
    });

    const result = await runtime.search({
      schema: "skill-candidate-query-v1",
      terms: [],
      target_paths: ["a".repeat(80) + "c"],
      limit: 1,
    });

    expect(result.candidates).toEqual([]);
  });

  test("preserves single-star and globstar directory-component semantics", async () => {
    const patterns = ["src/*.ts", "**/foo.ts", "src/**/foo.ts"];
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-glob-components",
      taskId: "task-glob-components",
      registryStatus: "ready",
      readRegistry: async () => patterns.map((pattern, index) => ({
        ...singleRecord,
        name: `glob-${index}`,
        observation_id: `sha256:glob-${index}`,
        path_signals: [pattern],
        technology_signals: [`glob-${index}`],
      })),
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider: provider(),
    });
    const search = async (path: string, technology: string) => (await runtime.search({
      schema: "skill-candidate-query-v1",
      terms: [],
      target_paths: [path],
      technologies: [technology],
      limit: 5,
    })).candidates.map((candidate) => candidate.name);

    expect(await search("src/a.ts", "glob-0")).toEqual(["glob-0"]);
    expect(await search("src/.ts", "glob-0")).toEqual(["glob-0"]);
    expect(await search("src/sub/a.ts", "glob-0")).toEqual([]);
    expect(await search("foo.ts", "glob-1")).toEqual(["glob-1"]);
    expect(await search("dir/foo.ts", "glob-1")).toEqual(["glob-1"]);
    expect(await search("prefixfoo.ts", "glob-1")).toEqual([]);
    expect(await search("src/prefixfoo.ts", "glob-2")).toEqual([]);
  });

  test("discards an older search that completes after a newer search", async () => {
    let resolveFirst: ((value: Awaited<ReturnType<typeof directResult>>) => void) | undefined;
    let calls = 0;
    const directResult = (name: string) => ({
      outcome: "complete" as const,
      diagnostics: [],
      observations: [{
        name,
        source_category: "user_runner" as const,
        scope: "user" as const,
        locator: `runner:opencode:opencode-config-skills/${name}%2FSKILL.md`,
        runner_id: "opencode",
        task_signals: [],
        technology_signals: [],
        path_signals: [],
      }],
    });
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-race",
      taskId: "task-race",
      registryStatus: "stale",
      discoverDirectly: () => {
        calls += 1;
        if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
        return Promise.resolve(directResult("newer"));
      },
      provider: provider(),
    });

    const older = runtime.search({ schema: "skill-candidate-query-v1", terms: ["older"], limit: 1 });
    const newer = await runtime.search({ schema: "skill-candidate-query-v1", terms: ["newer"], limit: 1 });
    resolveFirst?.(directResult("older"));
    const stale = await older;

    expect(newer.candidates.map((candidate) => candidate.name)).toEqual(["newer"]);
    expect(stale.candidates).toEqual([]);
    expect(runtime.select({ observation_id: newer.candidates[0]!.observation_id }).outcome).toBe("selected");
  });

  test("converts direct-discovery failures into bounded indeterminate results", async () => {
    const runtime = createTaskScopedSkillDiscoveryRuntime({
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      sessionId: "session-direct-failure",
      taskId: "task-direct-failure",
      registryStatus: "missing",
      discoverDirectly: async () => { throw new Error("private provider failure"); },
      provider: provider(),
    });

    await expect(runtime.search({ schema: "skill-candidate-query-v1", terms: ["api"], limit: 1 })).resolves.toEqual(
      expect.objectContaining({
        completeness: "indeterminate",
        candidates: [],
        diagnostics: expect.arrayContaining([expect.objectContaining({ code: "direct_discovery_unavailable" })]),
      }),
    );
  });
});
