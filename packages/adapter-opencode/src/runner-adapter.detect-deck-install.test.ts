/**
 * Unit tests for the opencode runner adapter's `detectDeckInstall` method
 * added by `add-self-update-system` / T2.10.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createOpenCodeRunnerAdapter } from "./runner-adapter";

describe("opencode / detectDeckInstall (T2.10)", () => {
  let tmpHome: string;
  const savedHome = process.env.HOME;
  const savedXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "deck-opencode-detect-"));
    process.env.HOME = tmpHome;
    process.env.XDG_CONFIG_HOME = tmpHome;
  });

  afterEach(() => {
    if (savedHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = savedHome;
    }
    if (savedXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = savedXdg;
    }
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns installed=false when no opencode config root exists", async () => {
    const adapter = createOpenCodeRunnerAdapter();
    const status = await adapter.detectDeckInstall!({});
    expect(status.installed).toBe(false);
    expect(status.managedPaths).toEqual([]);
    expect(status.diagnostics?.length).toBeGreaterThan(0);
  });

  it("returns installed=false when the opencode dir exists but has no Deck artifacts", async () => {
    const root = join(tmpHome, ".config", "opencode");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "some-other-file.txt"), "x");

    const adapter = createOpenCodeRunnerAdapter();
    const status = await adapter.detectDeckInstall!({});
    expect(status.installed).toBe(false);
    expect(status.managedPaths).toEqual([]);
  });

  it("returns installed=true with managed paths when opencode.json is present", async () => {
    const root = join(tmpHome, ".config", "opencode");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "opencode.json"), "{}");

    const adapter = createOpenCodeRunnerAdapter();
    const status = await adapter.detectDeckInstall!({});
    expect(status.installed).toBe(true);
    expect(status.managedPaths).toContain(join(root, "opencode.json"));
  });

  it("returns installed=true when AGENTS.md is present", async () => {
    const root = join(tmpHome, ".config", "opencode");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "# agents");

    const adapter = createOpenCodeRunnerAdapter();
    const status = await adapter.detectDeckInstall!({});
    expect(status.installed).toBe(true);
    expect(status.managedPaths).toContain(join(root, "AGENTS.md"));
  });

  it("returns installed=true when the skills/ directory is present", async () => {
    const root = join(tmpHome, ".config", "opencode");
    mkdirSync(join(root, "skills"), { recursive: true });

    const adapter = createOpenCodeRunnerAdapter();
    const status = await adapter.detectDeckInstall!({});
    expect(status.installed).toBe(true);
    expect(status.managedPaths).toContain(join(root, "skills"));
  });

  it("scans the projectRoot-relative config dir when provided", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-project-"));
    const root = join(projectRoot, ".config", "opencode");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "opencode.json"), "{}");

    const adapter = createOpenCodeRunnerAdapter();
    const status = await adapter.detectDeckInstall!({ projectRoot });
    expect(status.installed).toBe(true);
    expect(status.managedPaths).toContain(join(root, "opencode.json"));

    rmSync(projectRoot, { recursive: true, force: true });
  });
});
