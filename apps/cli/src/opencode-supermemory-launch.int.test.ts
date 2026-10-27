import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeRunnerLaunchPlan } from "./runner-launch-command";
import {
  authorizeOpenCodeSupermemoryLaunch,
  buildOpenCodeSupermemoryLaunchOverlay,
} from "./opencode-supermemory-launch";

const ownedPaths = {
  installRoot: "/data/deck/opencode/supermemory/2.0.15",
  packageDirectory: "/data/deck/opencode/supermemory/2.0.15/node_modules/opencode-supermemory",
  loaderPath: "/data/deck/opencode/supermemory/2.0.15/opencode-supermemory-loader.mjs",
  loaderLocator: "file:///data/deck/opencode/supermemory/2.0.15/opencode-supermemory-loader.mjs",
} as const;

const readyEffects = {
  inspectOwned: () => ({ ready: true as const, code: "ready" as const, diagnostic: "verified", paths: ownedPaths }),
  inspectRegistrations: () => ({ ok: true as const, conflicts: [] }),
};

function initGitProject(root: string): string {
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/project.git"], { cwd: root, stdio: "ignore" });
  const nested = join(root, "apps", "service");
  mkdirSync(nested, { recursive: true });
  return nested;
}

function initLinkedGitProject(root: string): { mainRoot: string; projectRoot: string; linkedRoot: string } {
  const mainRoot = join(root, "main");
  const linkedRoot = join(root, "linked");
  mkdirSync(mainRoot, { recursive: true });
  execFileSync("git", ["init"], { cwd: mainRoot, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/project.git"], { cwd: mainRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: mainRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Deck Test"], { cwd: mainRoot, stdio: "ignore" });
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], { cwd: mainRoot, stdio: "ignore" });
  execFileSync("git", ["worktree", "add", linkedRoot], { cwd: mainRoot, stdio: "ignore" });
  const projectRoot = join(linkedRoot, "apps", "service");
  mkdirSync(projectRoot, { recursive: true });
  return { mainRoot, projectRoot, linkedRoot };
}

describe("OpenCode Supermemory process-local launch", () => {
  test("registers the pinned plugin and selected token only in the child environment", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-supermemory-process-overlay-"));
    let childEnv: Record<string, string> | undefined;
    try {
      initGitProject(projectRoot);
      await executeRunnerLaunchPlan(authorizeOpenCodeSupermemoryLaunch({
        command: "opencode",
        args: [projectRoot],
        cwd: projectRoot,
        stdio: "inherit",
        stdin: "inherit",
      }, { token: "sm_selected", projectRoot, canonicalRepoTag: "sm_project_v1_acme_project" }, readyEffects), {
        inheritedEnv: {
          PATH: "/usr/bin",
          SUPERMEMORY_API_KEY: "sm_inherited",
          SUPERMEMORY_REPO_TAG: "sm_inherited_wrong",
          OPENCODE_DECK_INVOCATION_AUTHORIZATION: "static-compatible",
          SUPERMEMORY_API_URL: "https://attacker.invalid",
          OPENCODE_CONFIG_CONTENT: '{"plugin":["untrusted-memory-plugin"]}',
        },
        spawn: async (_command, _args, options) => {
          childEnv = options.env;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      });

      expect(childEnv?.SUPERMEMORY_API_KEY).toBe("sm_selected");
      expect(childEnv?.SUPERMEMORY_API_URL).toBe("https://api.supermemory.ai");
      expect(childEnv?.SUPERMEMORY_REPO_TAG).toBe("sm_project_v1_acme_project");
      expect(JSON.parse(childEnv?.OPENCODE_CONFIG_CONTENT ?? "{}").plugin).toEqual([ownedPaths.loaderLocator]);
      expect(JSON.stringify(childEnv)).not.toContain("sm_inherited");
      expect(JSON.stringify(childEnv)).not.toContain("untrusted-memory-plugin");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("marks the credential sensitive so child output is redacted", async () => {
    const outcome = await executeRunnerLaunchPlan(authorizeOpenCodeSupermemoryLaunch({
      command: "opencode",
      args: ["/tmp/project"],
      cwd: "/tmp/project",
      stdio: "pipe",
      stdin: "closed",
    }, { token: "sm_selected", projectRoot: "/tmp/project" }, readyEffects), {
      inheritedEnv: { PATH: "/usr/bin" },
      spawn: async () => ({ exitCode: 1, stdout: "sm_selected", stderr: "sm_selected" }),
    });

    expect(outcome.stdout).toBe("[REDACTED]");
    expect(outcome.stderr).toBe("[REDACTED]");
  });

  test("blocks launch when the owned package is missing or changed", () => {
    expect(() => buildOpenCodeSupermemoryLaunchOverlay({ token: "sm_selected", projectRoot: "/tmp/project" }, {
      ...readyEffects,
      inspectOwned: () => ({ ready: false, code: "artifact-digest-mismatch", diagnostic: "artifact mismatch", paths: ownedPaths }),
    })).toThrow("artifact mismatch");
  });

  test("blocks direct or conflicting Supermemory registrations while preserving unrelated plugins", () => {
    expect(() => buildOpenCodeSupermemoryLaunchOverlay({ token: "sm_selected", projectRoot: "/tmp/project" }, {
      ...readyEffects,
      inspectRegistrations: () => ({
        ok: false,
        conflicts: [{ source: "/tmp/project/opencode.json", registration: "opencode-supermemory@2.0.15" }],
      }),
    })).toThrow("conflicting external Supermemory plugin registration");
  });

  test("blocks canonical tag enforcement when the official plugin's higher-priority project override conflicts", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-supermemory-tag-conflict-"));
    try {
      initGitProject(projectRoot);
      const directory = join(projectRoot, ".claude", ".supermemory-claude");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "config.json"), JSON.stringify({ repoContainerTag: "repo_conflicting" }));

      expect(() => buildOpenCodeSupermemoryLaunchOverlay({
        token: "sm_selected",
        projectRoot,
        canonicalRepoTag: "sm_project_v1_acme_project",
      }, readyEffects)).toThrow("higher-priority project repoContainerTag conflicts");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("accepts an identical higher-priority project tag and rejects an unsafe override path", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-supermemory-tag-safe-"));
    try {
      const matchingRoot = join(root, "matching");
      mkdirSync(matchingRoot);
      initGitProject(matchingRoot);
      const matchingDirectory = join(matchingRoot, ".claude", ".supermemory-claude");
      mkdirSync(matchingDirectory, { recursive: true });
      writeFileSync(join(matchingDirectory, "config.json"), JSON.stringify({ repoContainerTag: "sm_project_v1_acme_project" }));
      expect(buildOpenCodeSupermemoryLaunchOverlay({
        token: "sm_selected",
        projectRoot: matchingRoot,
        canonicalRepoTag: "sm_project_v1_acme_project",
      }, readyEffects).SUPERMEMORY_REPO_TAG?.value).toBe("sm_project_v1_acme_project");

      const unsafeRoot = join(root, "unsafe");
      mkdirSync(unsafeRoot);
      initGitProject(unsafeRoot);
      const unsafeDirectory = join(unsafeRoot, ".claude", ".supermemory-claude");
      mkdirSync(unsafeDirectory, { recursive: true });
      const outside = join(root, "outside.json");
      writeFileSync(outside, JSON.stringify({ repoContainerTag: "sm_project_v1_acme_project" }));
      symlinkSync(outside, join(unsafeDirectory, "config.json"));
      expect(() => buildOpenCodeSupermemoryLaunchOverlay({
        token: "sm_selected",
        projectRoot: unsafeRoot,
        canonicalRepoTag: "sm_project_v1_acme_project",
      }, readyEffects)).toThrow("could not be inspected safely");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses the Git top-level override when OpenCode launches from a nested working directory", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-supermemory-nested-conflict-"));
    try {
      const projectRoot = initGitProject(root);
      const directory = join(root, ".claude", ".supermemory-claude");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "config.json"), JSON.stringify({ repoContainerTag: "repo_conflicting" }));

      expect(() => buildOpenCodeSupermemoryLaunchOverlay({
        token: "sm_selected",
        projectRoot,
        canonicalRepoTag: "sm_project_v1_acme_project",
      }, readyEffects)).toThrow("higher-priority project repoContainerTag conflicts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("accepts a matching Git top-level override from a nested working directory", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-supermemory-nested-match-"));
    try {
      const projectRoot = initGitProject(root);
      const directory = join(root, ".claude", ".supermemory-claude");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "config.json"), JSON.stringify({ repoContainerTag: "sm_project_v1_acme_project" }));

      const plan = authorizeOpenCodeSupermemoryLaunch({
        command: "opencode",
        args: [projectRoot],
        cwd: projectRoot,
        stdio: "inherit",
        stdin: "inherit",
      }, {
        token: "sm_selected",
        projectRoot,
        canonicalRepoTag: "sm_project_v1_acme_project",
      }, readyEffects);
      expect(plan.cwd).toBe(projectRoot);
      expect(plan.envOverlay?.SUPERMEMORY_REPO_TAG?.value).toBe("sm_project_v1_acme_project");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("blocks an unsafe Git top-level override from a nested working directory", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-supermemory-nested-unsafe-"));
    try {
      const projectRoot = initGitProject(root);
      const directory = join(root, ".claude", ".supermemory-claude");
      mkdirSync(directory, { recursive: true });
      const outside = join(root, "outside.json");
      writeFileSync(outside, JSON.stringify({ repoContainerTag: "sm_project_v1_acme_project" }));
      symlinkSync(outside, join(directory, "config.json"));

      expect(() => buildOpenCodeSupermemoryLaunchOverlay({
        token: "sm_selected",
        projectRoot,
        canonicalRepoTag: "sm_project_v1_acme_project",
      }, readyEffects)).toThrow("could not be inspected safely");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ignores a nested repoContainerTag that the official plugin does not load", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-supermemory-nested-ignored-"));
    try {
      const projectRoot = initGitProject(root);
      const directory = join(projectRoot, ".claude", ".supermemory-claude");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "config.json"), JSON.stringify({ repoContainerTag: "repo_nested_false_positive" }));

      expect(buildOpenCodeSupermemoryLaunchOverlay({
        token: "sm_selected",
        projectRoot,
        canonicalRepoTag: "sm_project_v1_acme_project",
      }, readyEffects).SUPERMEMORY_REPO_TAG?.value).toBe("sm_project_v1_acme_project");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses the main checkout override for a linked-worktree launch", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-supermemory-linked-conflict-"));
    try {
      const { mainRoot, projectRoot } = initLinkedGitProject(root);
      const directory = join(mainRoot, ".claude", ".supermemory-claude");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "config.json"), JSON.stringify({ repoContainerTag: "repo_conflicting" }));

      expect(() => buildOpenCodeSupermemoryLaunchOverlay({
        token: "sm_selected",
        projectRoot,
        canonicalRepoTag: "sm_project_v1_acme_project",
      }, readyEffects)).toThrow("higher-priority project repoContainerTag conflicts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("accepts a matching main checkout override for a linked-worktree launch", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-supermemory-linked-match-"));
    try {
      const { mainRoot, projectRoot } = initLinkedGitProject(root);
      const directory = join(mainRoot, ".claude", ".supermemory-claude");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "config.json"), JSON.stringify({ repoContainerTag: "sm_project_v1_acme_project" }));

      const plan = authorizeOpenCodeSupermemoryLaunch({
        command: "opencode",
        args: [projectRoot],
        cwd: projectRoot,
        stdio: "inherit",
        stdin: "inherit",
      }, {
        token: "sm_selected",
        projectRoot,
        canonicalRepoTag: "sm_project_v1_acme_project",
      }, readyEffects);
      expect(plan.cwd).toBe(projectRoot);
      expect(plan.envOverlay?.SUPERMEMORY_REPO_TAG?.value).toBe("sm_project_v1_acme_project");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("blocks an unsafe main checkout override for a linked-worktree launch", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-supermemory-linked-unsafe-"));
    try {
      const { mainRoot, projectRoot } = initLinkedGitProject(root);
      const directory = join(mainRoot, ".claude", ".supermemory-claude");
      mkdirSync(directory, { recursive: true });
      const outside = join(root, "outside.json");
      writeFileSync(outside, JSON.stringify({ repoContainerTag: "sm_project_v1_acme_project" }));
      symlinkSync(outside, join(directory, "config.json"));

      expect(() => buildOpenCodeSupermemoryLaunchOverlay({
        token: "sm_selected",
        projectRoot,
        canonicalRepoTag: "sm_project_v1_acme_project",
      }, readyEffects)).toThrow("could not be inspected safely");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ignores a linked-worktree-only override that the pinned plugin does not load", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-supermemory-linked-ignored-"));
    try {
      const { linkedRoot, projectRoot } = initLinkedGitProject(root);
      const directory = join(linkedRoot, ".claude", ".supermemory-claude");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "config.json"), JSON.stringify({ repoContainerTag: "repo_linked_false_positive" }));

      expect(buildOpenCodeSupermemoryLaunchOverlay({
        token: "sm_selected",
        projectRoot,
        canonicalRepoTag: "sm_project_v1_acme_project",
      }, readyEffects).SUPERMEMORY_REPO_TAG?.value).toBe("sm_project_v1_acme_project");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("allows the official plugin's native project override when no canonical identity is available", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-supermemory-tag-native-"));
    try {
      const directory = join(projectRoot, ".claude", ".supermemory-claude");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "config.json"), JSON.stringify({ repoContainerTag: "repo_plugin_native" }));

      const overlay = buildOpenCodeSupermemoryLaunchOverlay({ token: "sm_selected", projectRoot }, readyEffects);
      expect(overlay).not.toHaveProperty("SUPERMEMORY_REPO_TAG");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("does not inherit Supermemory credentials or process-local OpenCode config when no overlay is selected", async () => {
    let childEnv: Record<string, string> | undefined;
    await executeRunnerLaunchPlan({
      command: "opencode",
      args: ["/tmp/project"],
      cwd: "/tmp/project",
      stdio: "inherit",
      stdin: "inherit",
    }, {
      inheritedEnv: {
        PATH: "/usr/bin",
        SUPERMEMORY_API_KEY: "sm_inherited",
        SUPERMEMORY_REPO_TAG: "sm_inherited_wrong",
        OPENCODE_CONFIG_CONTENT: '{"plugin":["opencode-supermemory"]}',
      },
      spawn: async (_command, _args, options) => {
        childEnv = options.env;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(childEnv?.SUPERMEMORY_API_KEY).toBeUndefined();
    expect(childEnv?.SUPERMEMORY_REPO_TAG).toBeUndefined();
    expect(childEnv?.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(childEnv?.OPENCODE_DECK_INVOCATION_AUTHORIZATION).toBeUndefined();
  });

  test("drops an unbound Supermemory credential overlay", async () => {
    let childEnv: Record<string, string> | undefined;
    await executeRunnerLaunchPlan({
      command: "opencode",
      args: [],
      cwd: "/tmp/project",
      stdio: "inherit",
      stdin: "inherit",
      envOverlay: { SUPERMEMORY_API_KEY: { value: "sm_unbound", sensitive: true } },
    }, {
      inheritedEnv: { PATH: "/usr/bin" },
      spawn: async (_command, _args, options) => {
        childEnv = options.env;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(childEnv?.SUPERMEMORY_API_KEY).toBeUndefined();
  });
});
