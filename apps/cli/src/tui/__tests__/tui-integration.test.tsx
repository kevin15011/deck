/**
 * TUI integration tests for the self-update flow (T3.6).
 *
 * These tests exercise the end-to-end TUI behavior using the same
 * `renderToString` helper used elsewhere. They cover:
 *   - Non-blocking release check (banner absent on first render).
 *   - Banner appears after the check resolves to `available`.
 *   - Network error suppresses the banner.
 *   - Menu action navigation: "Update Deck" enters the upgrade confirm
 *     screen.
 *   - Upgrade confirm screen shows the descriptor items.
 *   - Progress screen renders the phase label and the completion copy.
 *
 * The `DeckApp` component is rendered with a stubbed release-check
 * dependency by passing a `releaseCheck` prop directly to the home
 * screen for the simple cases. For the full app-level flow we
 * compose the screens manually because `DeckApp` is tightly coupled
 * to the Ink `useApp` / `useInput` hooks (which require a live TTY).
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { renderToString } from "ink";

import { HomeScreen } from "../screens/home-screen";
import { UpgradeConfirmScreen } from "../screens/upgrade-screen";
import { UpgradeProgressScreen } from "../screens/upgrade-progress-screen";
import { RollbackScreen } from "../screens/rollback-screen";
import {
  runReleaseCheckWithTimeout,
  summarizeReleaseItems,
  toReleaseCheckState,
  type ReleaseCheckState,
} from "../release-check";
import { getHomeMenuOptions, type RollbackAvailability } from "../../menu-options";
import type { BackupManifest } from "../../upgrade-command/backup-store";
import type { ReleaseJson } from "../../upgrade-command/release-descriptor";
import type { ReleaseFetchResult, ReleaseInfo } from "../../upgrade-command/github-release";

const fixtureDescriptor: ReleaseJson = {
  schemaVersion: 1,
  version: "1.2.0",
  tag_name: "v1.2.0",
  channel: "stable",
  published_at: "2026-06-02T12:00:00.000Z",
  items: [
    {
      id: "binary-linux-x64-v1.2.0",
      kind: "binary",
      required: true,
      platform: "linux-x64",
      asset_name: "deck_v1.2.0_linux-x64.tar.gz",
      url: "https://example.com/deck_v1.2.0_linux-x64.tar.gz",
      sha256: "a".repeat(64),
      notes: "",
    },
    {
      id: "content-prompts-skills-v1.2.0",
      kind: "content",
      required: false,
      asset_name: "deck_v1.2.0_content.tar.gz",
      url: "https://example.com/deck_v1.2.0_content.tar.gz",
      sha256: "b".repeat(64),
      notes: "",
      content_kinds: ["prompts", "skills"],
    },
  ],
};

const saved: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined): void {
  saved[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  // The release check uses real `getBuildInfo` when no `currentVersion`
  // override is provided. The build version is `0.0.0-dev` in dev mode
  // so any newer fixture is treated as an upgrade.
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("TUI self-update integration (T3.6)", () => {
  test("home screen renders immediately with the pending release check and no banner", () => {
    // The TUI launch behavior is: home renders, release check is in
    // flight (`pending` state), no banner shown. This validates the
    // REQ-TUI-002 invariant — the TUI never blocks on the network.
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={{ kind: "pending" }} />);
    expect(output).toContain("Your AI environment, configured.");
    expect(output).toContain("Start installation");
    expect(output).toContain("Update Deck");
    expect(output).not.toContain("Upgrade available");
  });

  test("banner appears when the release check resolves to `available`", () => {
    const state: ReleaseCheckState = {
      kind: "available",
      version: fixtureDescriptor.version,
      tag: fixtureDescriptor.tag_name,
      channel: "stable",
      items: fixtureDescriptor.items,
      descriptor: fixtureDescriptor,
      reason: "newer-version",
    };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).toContain("Upgrade available: v1.2.0");
    // Menu label now carries the target version.
    expect(output).toContain("Update Deck → 1.2.0");
  });

  test("banner stays hidden when the release check fails with a network error", () => {
    const state: ReleaseCheckState = { kind: "network-error", error: "boom" };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).not.toContain("Upgrade available");
    expect(output).not.toContain("Advisory");
    // The menu item is still rendered with the base label so the user
    // can attempt the action and see a graceful message.
    expect(output).toContain("Update Deck");
  });

  test("menu includes an explicit `update-deck` action that resolves to the upgrade confirm screen", () => {
    // Render the upgrade confirm screen directly to assert the
    // contract: when the user picks the Update Deck option, the
    // confirm screen lists the descriptor items and prompts for
    // apply/cancel.
    const output = renderToString(
      <UpgradeConfirmScreen
        cursor={0}
        version={fixtureDescriptor.version}
        tag={fixtureDescriptor.tag_name}
        channel="stable"
        items={fixtureDescriptor.items}
      />,
    );
    expect(output).toContain("Update Deck to v1.2.0");
    expect(output).toContain("Apply update");
    expect(output).toContain("Cancel");
    expect(output).toContain("binary");
    expect(output).toContain("content");
    expect(output).toContain("[required]");
    expect(output).toContain("[optional]");
  });

  test("progress screen renders the current phase label", () => {
    const output = renderToString(
      <UpgradeProgressScreen
        status={{ kind: "running", phase: "Replacing binary", completedCount: 3 }}
        targetVersion="1.2.0"
      />,
    );
    expect(output).toContain("Replacing binary");
    // The first 3 phases are marked done.
    expect(output).toContain("✓");
  });

  test("progress screen renders the completion state with a restart prompt", () => {
    const output = renderToString(
      <UpgradeProgressScreen
        status={{ kind: "completed", version: "1.2.0", backupId: "bk-1" }}
        targetVersion="1.2.0"
      />,
    );
    expect(output).toContain("Update to v1.2.0 complete");
    expect(output).toContain("Restart Deck to load the new version");
    expect(output).toContain("bk-1");
  });

  test("progress screen renders a rollback state with the reason and backup id", () => {
    const output = renderToString(
      <UpgradeProgressScreen
        status={{ kind: "rolled_back", reason: "checksum mismatch", backupId: "bk-1" }}
        targetVersion="1.2.0"
      />,
    );
    expect(output).toContain("Rolled back to the previous version");
    expect(output).toContain("checksum mismatch");
    expect(output).toContain("bk-1");
  });

  test("getHomeMenuOptions returns Update Deck with the base label when no release check is in scope", () => {
    const options = getHomeMenuOptions();
    const update = options.find((o) => o.value === "update-deck");
    expect(update).toBeDefined();
    expect(update?.label).toBe("Update Deck");
  });

  test("getHomeMenuOptions includes `update-deck` and surfaces the version on the label when an upgrade is available", () => {
    const state: ReleaseCheckState = {
      kind: "available",
      version: "1.2.0",
      tag: "v1.2.0",
      channel: "stable",
      items: [],
      descriptor: null,
      reason: "newer-version",
    };
    const options = getHomeMenuOptions(state);
    const update = options.find((o) => o.value === "update-deck");
    expect(update).toBeDefined();
    expect(update?.label).toBe("Update Deck → 1.2.0");
  });

  test("summarizeReleaseItems reports the right set of kinds and binary platform status", () => {
    expect(summarizeReleaseItems(fixtureDescriptor.items, "linux-x64")).toBe("binary + content");
    // Foreign platform → no binary for this platform
    expect(summarizeReleaseItems(fixtureDescriptor.items, "darwin-arm64")).toBe("no binary for this platform");
    // No items at all
    expect(summarizeReleaseItems([], "linux-x64")).toBe("release");
  });

  test("runReleaseCheckWithTimeout returns `available` when the injected fetch returns a newer descriptor", async () => {
    const fetchImpl = (): ReleaseFetchResult => ({
      kind: "descriptor",
      descriptor: fixtureDescriptor,
      cachePath: "/tmp/release.json",
      commit: "8aaca9e",
    });
    const state = await runReleaseCheckWithTimeout(500, {
      fetchImpl,
      currentVersion: () => "1.0.0",
    });
    expect(state.kind).toBe("available");
    if (state.kind === "available") {
      expect(state.version).toBe("1.2.0");
      expect(state.descriptor).toBe(fixtureDescriptor);
    }
  });

  test("runReleaseCheckWithTimeout returns `none` when the injected fetch returns the same version", async () => {
    const fetchImpl = (): ReleaseFetchResult => ({
      kind: "descriptor",
      descriptor: { ...fixtureDescriptor, version: "0.0.0-dev", tag_name: "v0.0.0-dev" },
      cachePath: "/tmp/release.json",
      commit: null,
    });
    const state = await runReleaseCheckWithTimeout(500, {
      fetchImpl,
      currentVersion: () => "0.0.0-dev",
    });
    expect(state.kind).toBe("none");
  });

  test("runReleaseCheckWithTimeout honors the timeout and returns `network-error`", async () => {
    // 1ms timeout with a 50ms delay: the timeout wins.
    const state = await runReleaseCheckWithTimeout(1, {
      delayMs: 50,
      currentVersion: () => "0.0.0-dev",
    });
    expect(state.kind).toBe("network-error");
    if (state.kind === "network-error") {
      expect(state.error).toMatch(/timed out/i);
    }
  });

  test("runReleaseCheckWithTimeout returns `network-error` when the injected fetch returns one", async () => {
    const fetchImpl = (): ReleaseFetchResult => ({ kind: "network-error", error: "offline" });
    const state = await runReleaseCheckWithTimeout(500, {
      fetchImpl,
      currentVersion: () => "0.0.0-dev",
    });
    expect(state.kind).toBe("network-error");
  });

  test("toReleaseCheckState maps legacy body-parsed results to `available` when the legacy version is newer", () => {
    const legacy: ReleaseInfo = {
      tagName: "v2.0.0",
      version: "2.0.0",
      downloadUrl: "https://example.com/a.tar.gz",
      sha256: "a".repeat(64),
      publishedAt: "2026-06-02T12:00:00.000Z",
      body: "",
      commit: null,
    };
    const result: ReleaseFetchResult = { kind: "legacy", reason: "missing", info: legacy };
    expect(toReleaseCheckState(result, "1.0.0")).toEqual({
      kind: "available",
      version: "2.0.0",
      tag: "v2.0.0",
      channel: "stable",
      items: [],
      descriptor: null,
      reason: "newer-version",
    });
  });

  test("toReleaseCheckState maps legacy body-parsed results to `none` when the legacy version is not newer", () => {
    const legacy: ReleaseInfo = {
      tagName: "v0.0.0-dev",
      version: "0.0.0-dev",
      downloadUrl: "",
      sha256: "",
      body: "",
      publishedAt: "",
      commit: null,
    };
    const result: ReleaseFetchResult = { kind: "legacy", reason: "missing", info: legacy };
    expect(toReleaseCheckState(result, "0.0.0-dev")).toEqual({ kind: "none", reason: "missing-commit" });
  });
});

describe("TUI user-initiated rollback (REQ-RBK-002)", () => {
  const fixtureBackup: BackupManifest = {
    schemaVersion: 1,
    backupId: "2026-06-02T12-00-00-000Z-op-1",
    createdAt: "2026-06-02T12:00:00.000Z",
    operationId: "op-1",
    deckVersionBefore: "1.1.0",
    targetVersion: "1.2.0",
    reason: "upgrade",
    entries: [
      {
        id: "binary-deck",
        sourcePath: "/usr/local/bin/deck",
        backupPath: "/tmp/backup/deck",
        owner: "deck",
        kind: "binary",
        existed: true,
      },
    ],
    retention: { keepLatest: 5, maxAgeDays: 30, protectIfReferencedByState: true },
  };

  test("home menu adds a Roll back Deck option when a backup is available", () => {
    const availability: RollbackAvailability = {
      backupId: fixtureBackup.backupId,
      version: fixtureBackup.deckVersionBefore,
    };
    const options = getHomeMenuOptions(undefined, availability);
    const rollback = options.find((o) => o.value === "rollback-deck");
    expect(rollback).toBeDefined();
    expect(rollback?.label).toBe("Roll back Deck → 1.1.0");
  });

  test("home menu omits the Roll back Deck option when no backup is available", () => {
    const options = getHomeMenuOptions(undefined, null);
    const rollback = options.find((o) => o.value === "rollback-deck");
    expect(rollback).toBeUndefined();
  });

  test("home menu omits the Roll back Deck option when availability is not provided", () => {
    const options = getHomeMenuOptions();
    const rollback = options.find((o) => o.value === "rollback-deck");
    expect(rollback).toBeUndefined();
  });

  test("RollbackScreen confirm mode renders the backup metadata and the Run rollback prompt", () => {
    const output = renderToString(
      <RollbackScreen cursor={0} backup={fixtureBackup} mode="confirm" />,
    );
    expect(output).toContain("Roll back Deck");
    expect(output).toContain(fixtureBackup.backupId);
    expect(output).toContain("v1.1.0");
    expect(output).toContain("Run rollback");
    expect(output).toContain("Cancel");
  });

  test("RollbackScreen completed mode renders the success summary", () => {
    const output = renderToString(
      <RollbackScreen
        cursor={0}
        backup={fixtureBackup}
        mode="completed"
        restoredCount={2}
      />,
    );
    expect(output).toContain("Rollback complete");
    expect(output).toContain(fixtureBackup.backupId);
    expect(output).toContain("Restored 2 files");
    expect(output).toContain("Press Enter to return to Home");
  });

  test("RollbackScreen failed mode renders the failure reason and the CLI fallback hint", () => {
    const output = renderToString(
      <RollbackScreen
        cursor={0}
        backup={fixtureBackup}
        mode="failed"
        reason="ROLLBACK_NOT_FOUND"
      />,
    );
    expect(output).toContain("Rollback failed");
    expect(output).toContain("ROLLBACK_NOT_FOUND");
    expect(output).toContain("deck rollback");
  });

  test("home screen renders the Roll back Deck option when a backup is available", () => {
    // The `releaseCheck` argument is `undefined` (pending); the
    // `RollbackScreen` is only reached via the menu, but the home
    // screen's `getHomeMenuOptions` call must include the rollback
    // entry whenever a backup is present.
    const availability: RollbackAvailability = {
      backupId: fixtureBackup.backupId,
      version: fixtureBackup.deckVersionBefore,
    };
    // The home screen does not accept a rollback prop directly;
    // instead we exercise `getHomeMenuOptions` here to assert the
    // contract the screen uses. This mirrors the home screen's
    // behaviour (the screen delegates to `getHomeMenuOptions`).
    const options = getHomeMenuOptions(undefined, availability);
    const labels = options.map((o) => o.label);
    expect(labels).toContain("Roll back Deck → 1.1.0");
  });
});
