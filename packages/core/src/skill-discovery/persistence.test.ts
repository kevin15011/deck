import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { acquireRegistryLease } from "./registry-lease";

import { canonicalizeSkillRegistry } from "./registry";
import {
  computeSkillRegistryPersistenceDigest,
  createSkillRegistryWriteAuthority,
  createSkillRegistryWriter as createWriter,
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

  test("serializes processes across state roots and releases after rollback", async () => {
    const root = await createProject({ ignore: "*.log\n", registry: "old bytes" });
    const candidate = registryDocument("race");
    const fixture = path.join(root, "input.json");
    await fs.writeFile(fixture, JSON.stringify({ root, candidate, module: path.join(import.meta.dir, "persistence.ts") }));
    const program = `
      const {root,candidate,module} = JSON.parse(await Bun.file(process.argv[1]).text());
      const {createSkillRegistryWriter,createSkillRegistryWriteAuthority,computeSkillRegistryPersistenceDigest: hash} = await import(module);
      const targets = [".gitignore", ".atl/skill-registry.md"], digest = "sha256:" + "a".repeat(64);
      const plan = {schema:"skill-registry-write-plan-v1",action:"regeneration",active_runner_id:"opencode",project_root_digest:digest,allowed_targets:targets,expected_registry_digest:hash("old bytes"),expected_gitignore_digest:hash("*.log\\n"),candidate_document:candidate,candidate_digest:hash(candidate)};
      const auth = createSkillRegistryWriteAuthority({projectRoot:root,projectRootDigest:digest,action:"regeneration",activeRunnerId:"opencode",allowedTargets:targets});
      const first = process.argv[2] === "hold";
      const writer = createSkillRegistryWriter({projectRoot:root,stateRoot:process.argv[3],registryLockRoot:root+"/locks",isTracked:async()=>{if(first){console.log("held"); for await (const _ of process.stdin) break;} return false;},failpoint: stage=>{if(first && stage === "after_replace") throw Error("injected");}});
      console.log(JSON.stringify(await writer.commit(plan,auth)));
    `;
    const stateA = path.join(root, "state-a"), stateB = path.join(root, "state-b");
    const env = { ...process.env, HOME: root, XDG_STATE_HOME: path.join(root, "xdg") };
    const first = Bun.spawn([process.execPath, "-e", program, fixture, "hold", stateA], { env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const reader = first.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("held");
    const second = Bun.spawn([process.execPath, "-e", program, fixture, "try", stateB], { env, stdout: "pipe", stderr: "pipe" });
    const secondOutput = await new Response(second.stdout).text();
    expect(await second.exited).toBe(0);
    expect(JSON.parse(secondOutput).reason_code).toBe("registry_busy");
    expect(await readRegistry(root)).toBe("old bytes");
    expect(await fs.readFile(path.join(root, ".gitignore"), "utf8")).toBe("*.log\n");
    await expect(fs.stat(stateB)).rejects.toThrow();
    first.stdin.write("continue\n"); first.stdin.end();
    const remaining = await reader.read();
    expect(JSON.parse(new TextDecoder().decode(remaining.value)).outcome).toBe("rejected");
    expect(await first.exited).toBe(0);
    expect(await readRegistry(root)).toBe("old bytes");
    // The failed transaction may have installed the narrow ignore rule; retry uses its current digest.
    const ignore = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    const result = await createSkillRegistryWriter({ projectRoot: root, stateRoot: stateB, isTracked: () => false }).commit(
      writePlan(root, candidate, { allowed_targets: [".gitignore", ".atl/skill-registry.md"], expected_registry_digest: computeSkillRegistryPersistenceDigest("old bytes"), expected_gitignore_digest: computeSkillRegistryPersistenceDigest(ignore) }),
      authority(root, { allowedTargets: [".gitignore", ".atl/skill-registry.md"] }),
    );
    expect(result.outcome).toBe("committed");
  });

  test("holds the lease through rollback", async () => {
    // Protects restoration from a competing writer; oracle: contention during replacement and restored bytes.
    const root = await createProject({ ignore: "/.atl/\n", registry: "old bytes" });
    const candidate = registryDocument("rollback-held");
    let sawBusy = false;
    const result = await createSkillRegistryWriter({ projectRoot: root, isTracked: () => false,
      failpoint: async stage => {
        if (stage !== "after_replace") return;
        const contender = await acquireRegistryLease(root, { lockRoot: path.join(root, "locks"), waitMs: 0 });
        sawBusy = !contender.ok && contender.reason === "busy";
        if (contender.ok) contender.lease.release();
        throw new Error("force rollback");
      },
    }).commit(writePlan(root, candidate, { expected_registry_digest: computeSkillRegistryPersistenceDigest("old bytes") }), authority(root));
    expect(sawBusy).toBe(true);
    expect(result.outcome).toBe("rejected");
    expect(await readRegistry(root)).toBe("old bytes");
    const retry = await acquireRegistryLease(root, { lockRoot: path.join(root, "locks"), waitMs: 0 });
    expect(retry.ok).toBe(true);
    if (retry.ok) retry.lease.release();
  });

  for (const rollback of [false, true]) test(`reports lease cleanup failure after ${rollback ? "rollback" : "commit"}`, async () => {
    // Protects transaction outcome when release reports failure; oracle: bytes and retry.
    const root = await createProject({ ignore: "/.atl/\n", registry: "old bytes" });
    const candidate = registryDocument("cleanup");
    const result = await createSkillRegistryWriter({ projectRoot: root, isTracked: () => false,
      acquireLease: async (project, deps) => {
        const acquired = await acquireRegistryLease(project, deps);
        if (!acquired.ok) return acquired;
        return { ok: true, lease: { held: acquired.lease.held, release() { acquired.lease.release(); throw new Error("injected EIO"); } } };
      },
      failpoint: stage => { if (rollback && stage === "after_replace") throw new Error("injected EIO"); },
    }).commit(writePlan(root, candidate, { expected_registry_digest: computeSkillRegistryPersistenceDigest("old bytes") }), authority(root));
    expect(result.outcome).toBe(rollback ? "rejected" : "committed");
    expect(result.diagnostics.some(d => d.code === "registry_cleanup_failed")).toBe(true);
    expect(await readRegistry(root)).toBe(rollback ? "old bytes" : candidate);
    const retry = await acquireRegistryLease(await fs.realpath(root), { lockRoot: path.join(root, "locks"), waitMs: 0 });
    expect(retry.ok).toBe(true);
    if (retry.ok) retry.lease.release();
  });

  for (const rejectedWrite of [false, true]) test(`reports retained cleanup files after ${rejectedWrite ? "rejection" : "commit"}`, async () => {
    // Protects actual transaction outcome and cleanup reporting; oracle: file bytes and a fresh lease.
    const root = await createProject({ ignore: "/.atl/\n", registry: "old bytes" });
    const candidate = registryDocument("cleanup-files");
    const attempted: string[] = [];
    const result = await createSkillRegistryWriter({ projectRoot: root, stateRoot: path.join(root, "state"), isTracked: () => false,
      failpoint: stage => {
        if (rejectedWrite && stage === "before_replace") throw new Error("reject");
        if (stage === "before_temp_cleanup" || stage === "before_backup_cleanup") { attempted.push(stage); throw new Error("injected EIO"); }
      },
    }).commit(writePlan(root, candidate, { expected_registry_digest: computeSkillRegistryPersistenceDigest("old bytes") }), authority(root));
    expect(result.outcome).toBe(rejectedWrite ? "rejected" : "committed");
    expect(result.diagnostics.some(d => d.code === "registry_cleanup_failed")).toBe(true);
    expect(await readRegistry(root)).toBe(rejectedWrite ? "old bytes" : candidate);
    const files = await fs.readdir(path.join(root, ".atl"));
    const backup = files.find(file => file.includes(".backup-"));
    expect(backup).toBeDefined();
    expect(await fs.readFile(path.join(root, ".atl", backup!), "utf8")).toBe("old bytes");
    expect(attempted).toContain("before_backup_cleanup");
    if (rejectedWrite) {
      const temporary = files.find(file => file.endsWith(".tmp") && !file.includes(".backup-"));
      expect(temporary).toBeDefined();
      expect(await fs.readFile(path.join(root, ".atl", temporary!), "utf8")).toBe(candidate);
      expect(attempted).toContain("before_temp_cleanup");
    }
    const release = await acquireRegistryLease(await fs.realpath(root), { lockRoot: path.join(root, "locks"), waitMs: 0 });
    expect(release.ok).toBe(true);
    if (release.ok) release.lease.release();
  });

  test("reports retained backup after rollback", async () => {
    // Protects rollback outcome and cleanup diagnostics; oracle: restored bytes and released lease.
    const root = await createProject({ ignore: "/.atl/\n", registry: "old bytes" });
    const candidate = registryDocument("cleanup-rollback");
    const result = await createSkillRegistryWriter({ projectRoot: root, stateRoot: path.join(root, "state"), isTracked: () => false,
      atomicReplace: { async replace(from, to) { if (path.basename(from).includes(".backup-")) await fs.copyFile(from, to); else await fs.rename(from, to); }, async syncDirectory() {} },
      failpoint: stage => { if (stage === "after_replace" || stage === "before_backup_cleanup") throw new Error("injected EIO"); },
    }).commit(writePlan(root, candidate, { expected_registry_digest: computeSkillRegistryPersistenceDigest("old bytes") }), authority(root));
    expect(result.outcome).toBe("rejected");
    expect(result.diagnostics.some(d => d.code === "registry_cleanup_failed")).toBe(true);
    expect(await readRegistry(root)).toBe("old bytes");
    const backup = (await fs.readdir(path.join(root, ".atl"))).find(file => file.includes(".backup-"));
    expect(backup).toBeDefined();
    expect(await fs.readFile(path.join(root, ".atl", backup!), "utf8")).toBe("old bytes");
    const release = await acquireRegistryLease(await fs.realpath(root), { lockRoot: path.join(root, "locks"), waitMs: 0 });
    expect(release.ok).toBe(true);
    if (release.ok) release.lease.release();
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

    const result = await createSkillRegistryWriter({ isTracked: () => false, projectRoot }).commit(
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

    const result = await createSkillRegistryWriter({ isTracked: () => false, projectRoot }).commit(
      writePlan(projectRoot, candidate, { expected_registry_digest: "missing" }),
      authority(projectRoot),
    );

    expect(result.outcome).toBe("rejected");
    expect(result.reason_code).toBe("gitignore_unavailable");
    await expect(fs.stat(path.join(projectRoot, ".atl", "skill-registry.md"))).rejects.toThrow();
  });

  test("regenerates a tracked registry and reports its tracking status", async () => {
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

    expect(result.outcome).toBe("committed");
    expect(result.diagnostics.some(d => d.code === "deck-generated-file-tracked")).toBe(true);
    expect(await readRegistry(projectRoot)).toBe(registryDocument("new"));
  });

  test("backs up invalid bytes privately before replacing them", async () => {
    const projectRoot = await createProject({ ignore: "/.atl/\n", registry: "broken registry" });
    const stateRoot = path.join(projectRoot, "private-state");
    const candidate = registryDocument("new");
    const result = await createSkillRegistryWriter({ projectRoot, stateRoot, isTracked: () => false }).commit(
      writePlan(projectRoot, candidate, { expected_registry_digest: computeSkillRegistryPersistenceDigest("broken registry") }), authority(projectRoot),
    );
    expect(result.outcome).toBe("committed");
    const [directory] = await fs.readdir(path.join(stateRoot, "replaced"));
    const [file] = await fs.readdir(path.join(stateRoot, "replaced", directory!));
    const backup = path.join(stateRoot, "replaced", directory!, file!);
    expect((await fs.stat(backup)).mode & 0o077).toBe(0);
    expect(Buffer.from(JSON.parse(await fs.readFile(backup, "utf8")).entries[0].content, "base64").toString()).toBe("broken registry");
    expect(await readRegistry(projectRoot)).toBe(candidate);
  });

  test("leaves registry and ignore bytes unchanged if private backup fails", async () => {
    const projectRoot = await createProject({ ignore: "*.log\n", registry: "edited" });
    const stateRoot = path.join(projectRoot, "not-a-directory");
    await fs.writeFile(stateRoot, "occupied");
    const candidate = registryDocument("new");
    const result = await createSkillRegistryWriter({ projectRoot, stateRoot, isTracked: () => false }).commit(
      writePlan(projectRoot, candidate, { allowed_targets: [".gitignore", ".atl/skill-registry.md"], expected_registry_digest: computeSkillRegistryPersistenceDigest("edited"), expected_gitignore_digest: computeSkillRegistryPersistenceDigest("*.log\n") }),
      authority(projectRoot, { allowedTargets: [".gitignore", ".atl/skill-registry.md"] }),
    );
    expect(result.outcome).toBe("rejected");
    expect(await readRegistry(projectRoot)).toBe("edited");
    expect(await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8")).toBe("*.log\n");
  });

  test("preserves a registry declaring a newer schema", async () => {
    const newer = "---\nschema: skill-registry-v3\nschema_version: 3\n---\nfuture\n";
    const projectRoot = await createProject({ ignore: "/.atl/\n", registry: newer });
    const result = await createSkillRegistryWriter({ projectRoot, isTracked: () => false }).commit(
      writePlan(projectRoot, registryDocument("new"), { expected_registry_digest: computeSkillRegistryPersistenceDigest(newer) }),
      authority(projectRoot),
    );
    expect(result.outcome).toBe("rejected");
    expect(result.reason_code).toBe("managed-by-newer-schema");
    expect(await readRegistry(projectRoot)).toBe(newer);
  });

  test("rejects invalid or partial candidates and preserves the last valid bytes", async () => {
    const projectRoot = await createProject({
      ignore: "/.atl/\n",
      registry: registryDocument("old"),
    });
    const oldDocument = await readRegistry(projectRoot);
    const candidate = "---\nschema: skill-registry-v1\n---\npartial\n";

    const result = await createSkillRegistryWriter({ isTracked: () => false, projectRoot }).commit(
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

    const result = await createSkillRegistryWriter({ isTracked: () => false, projectRoot }).commit(
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
      const result = await createSkillRegistryWriter({ isTracked: () => false, projectRoot }).commit(plan, authority(projectRoot));
      expect(result.outcome).toBe("rejected");
      expect(result.reason_code).toBe(reasonCode);
      expect(await readRegistry(projectRoot)).toBe(oldDocument);
    }

    const replayAuthority = authority(projectRoot);
    const first = await createSkillRegistryWriter({ isTracked: () => false, projectRoot }).commit(basePlan, replayAuthority);
    expect(first.outcome).toBe("committed");
    const replay = await createSkillRegistryWriter({ isTracked: () => false, projectRoot }).commit(
      { ...basePlan, expected_registry_digest: computeSkillRegistryPersistenceDigest(candidate) },
      replayAuthority,
    );
    expect(replay.outcome).toBe("rejected");
    expect(replay.reason_code).toBe("authority_replayed");

    const flagOnly = await createSkillRegistryWriter({ isTracked: () => false, projectRoot }).commit(
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

    const result = await createSkillRegistryWriter({ isTracked: () => false, projectRoot }).commit(
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

      const result = await createSkillRegistryWriter({ isTracked: () => false,
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

    const result = await createSkillRegistryWriter({ isTracked: () => false, projectRoot, atomicReplace }).commit(
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

  // Protects external edits from being mistaken for a partially committed registry candidate.
  test.each([false, true])("preserves a concurrent registry after rejected replacement (existing=%s)", async existing => {
    const prior = registryDocument("old");
    const projectRoot = await createProject({ ignore: "/.atl/\n", ...(existing ? { registry: prior } : {}) });
    const concurrent = registryDocument("external-editor");
    const result = await createSkillRegistryWriter({ isTracked: () => false, projectRoot, atomicReplace: {
      async replace(_temporary, target) { await fs.writeFile(target, concurrent); throw new Error("replacement rejected after concurrent edit"); },
      async syncDirectory() {},
    } }).commit(writePlan(projectRoot, registryDocument("candidate"), {
      expected_registry_digest: existing ? computeSkillRegistryPersistenceDigest(prior) : "missing",
    }), authority(projectRoot));
    expect(result).toMatchObject({ outcome: "rejected", reason_code: "recovery_required" });
    expect(await readRegistry(projectRoot)).toBe(concurrent);
  });

  // Protects non-registry targets: failed replacement does not own later external bytes.
  test("preserves concurrent .gitignore edits after a rejected replacement", async () => {
    const priorIgnore = "existing-rule\n";
    const projectRoot = await createProject({ ignore: priorIgnore, registry: registryDocument("old") });
    const concurrent = "external-editor-rule\n";
    const result = await createSkillRegistryWriter({ isTracked: () => false, projectRoot, atomicReplace: {
      async replace(temporary, target) {
        if (path.basename(temporary).includes(".backup-")) { await fs.rename(temporary, target); return; }
        await fs.writeFile(target, concurrent);
        throw new Error("replacement failed after concurrent edit");
      },
      async syncDirectory() {},
    } }).commit(writePlan(projectRoot, registryDocument("new"), {
      allowed_targets: [".gitignore", ".atl/skill-registry.md"],
      expected_registry_digest: computeSkillRegistryPersistenceDigest(registryDocument("old")),
      expected_gitignore_digest: computeSkillRegistryPersistenceDigest(priorIgnore),
    }), authority(projectRoot, { allowedTargets: [".gitignore", ".atl/skill-registry.md"] }));
    expect(await fs.readFile(path.join(projectRoot, ".gitignore"), "utf8")).toBe(concurrent);
    expect(result).toMatchObject({ outcome: "rejected", reason_code: "recovery_required" });
    expect(await readRegistry(projectRoot)).toBe(registryDocument("old"));
  });

  // Unknown partial bytes cannot safely be distinguished from a concurrent edit.
  test("preserves unknown partial .gitignore bytes for explicit recovery", async () => {
    const priorIgnore = "existing-rule\n# preserve this comment\n";
    const projectRoot = await createProject({
      ignore: priorIgnore,
      registry: registryDocument("old"),
    });
    const oldDocument = await readRegistry(projectRoot);
    const operations: string[] = [];
    let partialBytes: Buffer | undefined;
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
          partialBytes = candidateBytes.subarray(0, Math.max(1, candidateBytes.length - 1));
          await fs.writeFile(targetPath, partialBytes);
          throw new Error("injected partial ignore replacement");
        }
        operations.push("registry-replace");
        throw new Error("registry replacement should not be reached");
      },
      async syncDirectory() {
        operations.push("sync-directory");
      },
    };

    const result = await createSkillRegistryWriter({ isTracked: () => false, projectRoot, atomicReplace }).commit(
      writePlan(projectRoot, registryDocument("new"), {
        allowed_targets: [".gitignore", ".atl/skill-registry.md"],
        expected_registry_digest: computeSkillRegistryPersistenceDigest(oldDocument),
        expected_gitignore_digest: computeSkillRegistryPersistenceDigest(priorIgnore),
      }),
      authority(projectRoot, { allowedTargets: [".gitignore", ".atl/skill-registry.md"] }),
    );

    expect(result.outcome).toBe("rejected");
    expect((await fs.readFile(path.join(projectRoot, ".gitignore"))).toString("hex")).toBe(partialBytes!.toString("hex"));
    expect(result.reason_code).toBe("recovery_required");
    expect(await readRegistry(projectRoot)).toBe(oldDocument);
    expect(operations).toEqual(["ignore-replace"]);
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

    const result = await createSkillRegistryWriter({ isTracked: () => false, projectRoot, atomicReplace }).commit(
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
  const projectRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "deck-registry-persistence-")));
  CREATED_PROJECT_ROOTS.push(projectRoot);
  if (input.ignore !== undefined) await fs.writeFile(path.join(projectRoot, ".gitignore"), input.ignore);
  if (input.registry !== undefined) {
    await fs.mkdir(path.join(projectRoot, ".atl"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, ".atl", "skill-registry.md"), input.registry);
  }
  return projectRoot;
}

function createSkillRegistryWriter(options: Parameters<typeof createWriter>[0]): ReturnType<typeof createWriter> {
  const root = options.projectRoot;
  if (!CREATED_PROJECT_ROOTS.includes(root)) throw new Error("writer requires a private project fixture");
  const stateRoot = options.stateRoot ?? path.join(root, "private-state");
  if (!stateRoot.startsWith(`${root}${path.sep}`)) throw new Error("writer requires a private state root");
  return createWriter({ ...options, stateRoot, registryLockRoot: path.join(root, "locks") });
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
