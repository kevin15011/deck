import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { canonicalizeSkillRegistry } from "./registry";
import {
  computeSkillRegistryPersistenceDigest,
  createSkillRegistryWriteAuthority,
  createSkillRegistryWriter,
  type AtomicReplacePortV1,
  type SkillRegistryWriteAuthorityMintInputV1,
  type SkillRegistryWriteFailpointV1,
  type SkillRegistryWritePlanV1,
} from "./persistence";
import type {
  SkillDiscoveryDigestV1,
  SkillRegistryWriteTargetsV1,
} from "./contracts";

const PROJECT_ROOT_DIGEST = `sha256:${"a".repeat(64)}` as SkillDiscoveryDigestV1;
const CREATED_PROJECT_ROOTS: string[] = [];

describe("authorized skill registry persistence", () => {
  let cleanupPaths: string[] = [];

  beforeEach(() => {
    cleanupPaths = [];
  });

  afterEach(async () => {
    while (cleanupPaths.length > 0) {
      const target = cleanupPaths.pop();
      if (target) await fs.rm(target, { force: true, recursive: true }).catch(() => undefined);
    }
    while (CREATED_PROJECT_ROOTS.length > 0) {
      const target = CREATED_PROJECT_ROOTS.pop();
      if (target) await fs.rm(target, { force: true, recursive: true }).catch(() => undefined);
    }
  });

  test("atomically commits a complete candidate without editing covered ignore rules", async () => {
    const projectRoot = await createProject({
      ignore: "/.atl/\n",
      registry: registryDocument("old"),
    });
    const oldDocument = await readRegistry(projectRoot);
    const candidate = registryDocument("new");
    const writer = createSkillRegistryWriter({ projectRoot });

    const result = await writer.commit(
      writePlan(projectRoot, candidate, {
        expected_registry_digest: computeSkillRegistryPersistenceDigest(oldDocument),
      }),
      authority(projectRoot),
    );

    expect(result.outcome).toBe("committed");
    expect(result.registry_digest).toBe(computeSkillRegistryPersistenceDigest(candidate));
    expect(result.gitignore_changed).toBe(false);
    expect(await readRegistry(projectRoot)).toBe(candidate);
    expect(await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8")).toBe("/.atl/\n");
  });

  test("adds only the root-anchored ignore rule when coverage is absent", async () => {
    const projectRoot = await createProject({ ignore: "*.log\n" });
    const candidate = registryDocument("new");

    const result = await createSkillRegistryWriter({ projectRoot }).commit(
      writePlan(projectRoot, candidate, {
        allowed_targets: [".gitignore", ".atl/skill-registry.md"],
        expected_registry_digest: "missing",
        expected_gitignore_digest: computeSkillRegistryPersistenceDigest("*.log\n"),
      }),
      authority(projectRoot, {
        allowedTargets: [".gitignore", ".atl/skill-registry.md"],
      }),
    );

    expect(result.outcome).toBe("committed");
    expect(result.gitignore_changed).toBe(true);
    expect(await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8")).toBe(
      "*.log\n/.atl/skill-registry.md\n",
    );
    expect(await readRegistry(projectRoot)).toBe(candidate);
  });

  test("refuses creation when ignore coverage cannot be established", async () => {
    const projectRoot = await createProject({ ignore: undefined });
    const candidate = registryDocument("new");

    const result = await createSkillRegistryWriter({ projectRoot }).commit(
      writePlan(projectRoot, candidate, { expected_registry_digest: "missing" }),
      authority(projectRoot),
    );

    expect(result.outcome).toBe("rejected");
    expect(result.reason_code).toBe("gitignore_unavailable");
    await expect(fs.stat(path.join(projectRoot, ".atl", "skill-registry.md"))).rejects.toThrow();
  });

  test("warns and refuses replacement of a tracked registry without Git remediation", async () => {
    const projectRoot = await createProject({
      ignore: "/.atl/\n",
      registry: registryDocument("old"),
    });
    const oldDocument = await readRegistry(projectRoot);
    const result = await createSkillRegistryWriter({
      projectRoot,
      isTracked: async () => true,
    }).commit(
      writePlan(projectRoot, registryDocument("new"), {
        expected_registry_digest: computeSkillRegistryPersistenceDigest(oldDocument),
      }),
      authority(projectRoot),
    );

    expect(result.outcome).toBe("rejected");
    expect(result.reason_code).toBe("tracked_registry");
    expect(await readRegistry(projectRoot)).toBe(oldDocument);
  });

  test("rejects invalid or partial candidates and preserves the last valid bytes", async () => {
    const projectRoot = await createProject({
      ignore: "/.atl/\n",
      registry: registryDocument("old"),
    });
    const oldDocument = await readRegistry(projectRoot);
    const candidate = "---\nschema: skill-registry-v1\n---\npartial\n";

    const result = await createSkillRegistryWriter({ projectRoot }).commit(
      writePlan(projectRoot, candidate, {
        expected_registry_digest: computeSkillRegistryPersistenceDigest(oldDocument),
      }),
      authority(projectRoot),
    );

    expect(result.outcome).toBe("rejected");
    expect(result.reason_code).toBe("candidate_invalid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(await readRegistry(projectRoot)).toBe(oldDocument);
  });

  test("rejects stale compare-and-swap plans before writing", async () => {
    const projectRoot = await createProject({
      ignore: "/.atl/\n",
      registry: registryDocument("old"),
    });
    const stale = registryDocument("old");
    await fs.writeFile(path.join(projectRoot, ".atl", "skill-registry.md"), registryDocument("changed"));

    const result = await createSkillRegistryWriter({ projectRoot }).commit(
      writePlan(projectRoot, registryDocument("new"), {
        expected_registry_digest: computeSkillRegistryPersistenceDigest(stale),
      }),
      authority(projectRoot),
    );

    expect(result.outcome).toBe("rejected");
    expect(result.reason_code).toBe("stale_registry");
    expect(await readRegistry(projectRoot)).toBe(registryDocument("changed"));
  });

  test("binds authority to one exact action, runner, project, and target set", async () => {
    const projectRoot = await createProject({
      ignore: "/.atl/\n",
      registry: registryDocument("old"),
    });
    const oldDocument = await readRegistry(projectRoot);
    const candidate = registryDocument("new");
    const basePlan = writePlan(projectRoot, candidate, {
      expected_registry_digest: computeSkillRegistryPersistenceDigest(oldDocument),
    });

    const mismatches: Array<[string, SkillRegistryWritePlanV1]> = [
      ["wrong_target", { ...basePlan, allowed_targets: [".gitignore", ".atl/skill-registry.md"] } as SkillRegistryWritePlanV1],
      ["wrong_action", { ...basePlan, action: "migration" } as SkillRegistryWritePlanV1],
      ["wrong_runner", { ...basePlan, active_runner_id: "pi" } as SkillRegistryWritePlanV1],
    ];

    for (const [reasonCode, plan] of mismatches) {
      const result = await createSkillRegistryWriter({ projectRoot }).commit(plan, authority(projectRoot));
      expect(result.outcome).toBe("rejected");
      expect(result.reason_code).toBe(reasonCode);
      expect(await readRegistry(projectRoot)).toBe(oldDocument);
    }

    const replayAuthority = authority(projectRoot);
    const first = await createSkillRegistryWriter({ projectRoot }).commit(basePlan, replayAuthority);
    expect(first.outcome).toBe("committed");
    const replay = await createSkillRegistryWriter({ projectRoot }).commit(
      { ...basePlan, expected_registry_digest: computeSkillRegistryPersistenceDigest(candidate) },
      replayAuthority,
    );
    expect(replay.outcome).toBe("rejected");
    expect(replay.reason_code).toBe("authority_replayed");

    const flagOnly = await createSkillRegistryWriter({ projectRoot }).commit(
      { ...basePlan, expected_registry_digest: computeSkillRegistryPersistenceDigest(candidate) },
      { activeRunnerId: "opencode", action: "regeneration" } as never,
    );
    expect(flagOnly.outcome).toBe("rejected");
    expect(flagOnly.reason_code).toBe("authority_invalid");
  });

  test("rejects an escaping target directory before any write", async () => {
    const projectRoot = await createProject({ ignore: "/.atl/\n" });
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deck-registry-outside-"));
    cleanupPaths.push(outsideRoot);
    await fs.symlink(outsideRoot, path.join(projectRoot, ".atl"));

    const result = await createSkillRegistryWriter({ projectRoot }).commit(
      writePlan(projectRoot, registryDocument("new"), { expected_registry_digest: "missing" }),
      authority(projectRoot),
    );

    expect(result.outcome).toBe("rejected");
    expect(result.reason_code).toBe("path_containment");
    expect(await fs.readdir(outsideRoot)).toEqual([]);
  });

  test("preserves the prior registry for every persistence failpoint", async () => {
    const failpoints: SkillRegistryWriteFailpointV1[] = [
      "before_candidate_validation",
      "after_candidate_validation",
      "before_ignore_update",
      "after_ignore_update",
      "before_temp_write",
      "after_temp_write",
      "before_fsync",
      "after_fsync",
      "before_reparse",
      "after_reparse",
      "before_replace",
      "after_replace",
      "before_directory_sync",
      "after_directory_sync",
    ];

    for (const failpoint of failpoints) {
      const projectRoot = await createProject({
        ignore: "*.log\n",
        registry: registryDocument("old"),
      });
      const oldDocument = await readRegistry(projectRoot);
      const candidate = registryDocument(`new-${failpoint}`);

      const result = await createSkillRegistryWriter({
        projectRoot,
        failpoint: async (current) => {
          if (current === failpoint) throw new Error(`injected ${failpoint}`);
        },
      }).commit(
        writePlan(projectRoot, candidate, {
          allowed_targets: [".gitignore", ".atl/skill-registry.md"],
          expected_registry_digest: computeSkillRegistryPersistenceDigest(oldDocument),
          expected_gitignore_digest: computeSkillRegistryPersistenceDigest("*.log\n"),
        }),
        authority(projectRoot, { allowedTargets: [".gitignore", ".atl/skill-registry.md"] }),
      );

      expect(result.outcome, failpoint).toBe("rejected");
      expect(await readRegistry(projectRoot), failpoint).toBe(oldDocument);
      const files = await fs.readdir(path.join(projectRoot, ".atl"));
      expect(files, failpoint).toEqual(["skill-registry.md"]);
      await fs.rm(projectRoot, { force: true, recursive: true });
      cleanupPaths = cleanupPaths.filter((candidatePath) => candidatePath !== projectRoot);
    }
  });

  test("surfaces recovery-required when restoring the prior registry fails", async () => {
    const projectRoot = await createProject({
      ignore: "/.atl/\n",
      registry: registryDocument("old"),
    });
    const oldDocument = await readRegistry(projectRoot);
    const candidate = registryDocument("new");
    let replaceAttempts = 0;
    let syncAttempts = 0;
    const atomicReplace: AtomicReplacePortV1 = {
      async replace(tempPath, targetPath) {
        if (path.basename(targetPath) === "skill-registry.md") {
          replaceAttempts += 1;
          if (replaceAttempts === 1) {
            await fs.rename(tempPath, targetPath);
            return;
          }
          throw new Error("injected restore replacement failure");
        }
        await fs.rename(tempPath, targetPath);
      },
      async syncDirectory() {
        syncAttempts += 1;
        if (syncAttempts === 1) throw new Error("injected directory sync failure");
      },
    };

    const result = await createSkillRegistryWriter({ projectRoot, atomicReplace }).commit(
      writePlan(projectRoot, candidate, {
        expected_registry_digest: computeSkillRegistryPersistenceDigest(oldDocument),
      }),
      authority(projectRoot),
    );

    expect(result.outcome).toBe("rejected");
    expect(result.reason_code).toBe("recovery_required");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["directory_sync_failed", "restore_failed"]),
    );
    expect(replaceAttempts).toBe(2);
    expect(await readRegistry(projectRoot)).toBe(candidate);
  });

  test("preserves prior .gitignore bytes after an injected partial replacement", async () => {
    const priorIgnore = "existing-rule\n# preserve this comment\n";
    const projectRoot = await createProject({
      ignore: priorIgnore,
      registry: registryDocument("old"),
    });
    const oldDocument = await readRegistry(projectRoot);
    const operations: string[] = [];
    const atomicReplace: AtomicReplacePortV1 = {
      async replace(tempPath, targetPath) {
        if (path.basename(targetPath) === ".gitignore") {
          if (path.basename(tempPath).includes(".backup-")) {
            operations.push("ignore-restore");
            await fs.rename(tempPath, targetPath);
            return;
          }
          operations.push("ignore-replace");
          const candidateBytes = await fs.readFile(tempPath);
          await fs.writeFile(targetPath, candidateBytes.subarray(0, Math.max(1, candidateBytes.length - 1)));
          throw new Error("injected partial ignore replacement");
        }
        operations.push("registry-replace");
        throw new Error("registry replacement should not be reached");
      },
      async syncDirectory() {
        operations.push("sync-directory");
      },
    };

    const result = await createSkillRegistryWriter({ projectRoot, atomicReplace }).commit(
      writePlan(projectRoot, registryDocument("new"), {
        allowed_targets: [".gitignore", ".atl/skill-registry.md"],
        expected_registry_digest: computeSkillRegistryPersistenceDigest(oldDocument),
        expected_gitignore_digest: computeSkillRegistryPersistenceDigest(priorIgnore),
      }),
      authority(projectRoot, { allowedTargets: [".gitignore", ".atl/skill-registry.md"] }),
    );

    expect(result.outcome).toBe("rejected");
    expect(await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8")).toBe(priorIgnore);
    expect(result.reason_code).toBe("gitignore_replace_failed");
    expect(await readRegistry(projectRoot)).toBe(oldDocument);
    expect(operations).toEqual(["ignore-replace", "ignore-restore"]);
  });

  test("does not unlink the target before an injected atomic replacement", async () => {
    const projectRoot = await createProject({
      ignore: "/.atl/\n",
      registry: registryDocument("old"),
    });
    const oldDocument = await readRegistry(projectRoot);
    const operations: string[] = [];
    const atomicReplace: AtomicReplacePortV1 = {
      async replace(tempPath, targetPath) {
        operations.push("replace");
        throw new Error(`replace refused: ${tempPath} -> ${targetPath}`);
      },
      async syncDirectory() {
        operations.push("sync-directory");
      },
    };

    const result = await createSkillRegistryWriter({ projectRoot, atomicReplace }).commit(
      writePlan(projectRoot, registryDocument("new"), {
        expected_registry_digest: computeSkillRegistryPersistenceDigest(oldDocument),
      }),
      authority(projectRoot),
    );

    expect(result.outcome).toBe("rejected");
    expect(result.reason_code).toBe("atomic_replace_failed");
    expect(operations).toEqual(["replace"]);
    expect(await readRegistry(projectRoot)).toBe(oldDocument);
  });

  test("keeps read-only modules independent from the writer and forbidden Git operations absent", async () => {
    const registrySource = await fs.readFile(path.join(process.cwd(), "packages/core/src/skill-discovery/registry.ts"), "utf8");
    const discoverySource = await fs.readFile(path.join(process.cwd(), "packages/core/src/skill-discovery/discovery.ts"), "utf8");
    const persistenceSource = await fs.readFile(path.join(process.cwd(), "packages/core/src/skill-discovery/persistence.ts"), "utf8");

    expect(registrySource).not.toContain("./persistence");
    expect(discoverySource).not.toContain("./persistence");
    expect(persistenceSource).not.toMatch(/git\s+(add|rm|reset|restore|checkout|clean|commit|push)/);
    expect(persistenceSource).not.toMatch(/unlink[^\n]*(?:registry|target)|(?:registry|target)[^\n]*unlink/);
  });
});

function registryDocument(name: string): string {
  return canonicalizeSkillRegistry({
    activeRunnerId: "opencode",
    sourceDeclarations: [],
    observations: [{
      name,
      source_category: "project_local",
      scope: "project",
      locator: `project:.skills/${name}/SKILL.md`,
      task_signals: [],
      technology_signals: [],
      path_signals: [],
    }],
    diagnostics: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
  }).document;
}

async function createProject(input: { ignore?: string; registry?: string }): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deck-registry-persistence-"));
  CREATED_PROJECT_ROOTS.push(projectRoot);
  if (input.ignore !== undefined) await fs.writeFile(path.join(projectRoot, ".gitignore"), input.ignore);
  if (input.registry !== undefined) {
    await fs.mkdir(path.join(projectRoot, ".atl"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, ".atl", "skill-registry.md"), input.registry);
  }
  return projectRoot;
}

async function readRegistry(projectRoot: string): Promise<string> {
  return fs.readFile(path.join(projectRoot, ".atl", "skill-registry.md"), "utf8");
}

function writePlan(
  projectRoot: string,
  candidate: string,
  overrides: Partial<SkillRegistryWritePlanV1> = {},
): SkillRegistryWritePlanV1 {
  const allowedTargets = overrides.allowed_targets ?? [".atl/skill-registry.md"];
  const basePlan: SkillRegistryWritePlanV1 = {
    schema: "skill-registry-write-plan-v1",
    action: "regeneration",
    active_runner_id: "opencode",
    project_root_digest: PROJECT_ROOT_DIGEST,
    allowed_targets: allowedTargets as SkillRegistryWriteTargetsV1,
    expected_registry_digest: "missing",
    candidate_document: candidate,
    candidate_digest: computeSkillRegistryPersistenceDigest(candidate),
  };
  return {
    ...basePlan,
    ...overrides,
    candidate_document: overrides.candidate_document ?? candidate,
    candidate_digest: overrides.candidate_digest ?? computeSkillRegistryPersistenceDigest(candidate),
  };
}

function authority(
  projectRoot: string,
  overrides: Partial<SkillRegistryWriteAuthorityMintInputV1> = {},
): ReturnType<typeof createSkillRegistryWriteAuthority> {
  return createSkillRegistryWriteAuthority({
    projectRoot,
    projectRootDigest: PROJECT_ROOT_DIGEST,
    action: "regeneration",
    activeRunnerId: "opencode",
    allowedTargets: [".atl/skill-registry.md"],
    ...overrides,
  });
}
