import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";

import { HomeScreen } from "./home-screen";
import type { ReleaseCheckState } from "../release-check";

describe("HomeScreen release-check banner (T3.3)", () => {
  test("renders the menu with no banner when no release check is provided", () => {
    const output = renderToString(<HomeScreen cursor={0} />);
    expect(output).toContain("Your AI environment, configured.");
    expect(output).toContain("Start installation");
    expect(output).toContain("Update Deck");
    expect(output).not.toContain("Upgrade available");
    expect(output).not.toContain("Advisory");
    expect(output).not.toContain("Channel deprecation");
  });

  test("renders no banner while release check is pending", () => {
    const state: ReleaseCheckState = { kind: "pending" };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).not.toContain("Upgrade available");
    expect(output).not.toContain("Advisory");
  });

  test("renders no banner when release check result is `none`", () => {
    const state: ReleaseCheckState = { kind: "none" };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).not.toContain("Upgrade available");
  });

  test("renders no banner when release check failed with a network error", () => {
    const state: ReleaseCheckState = { kind: "network-error", error: "boom" };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).not.toContain("Upgrade available");
    expect(output).not.toContain("Advisory");
  });

  test("renders upgrade available banner with version and item summary when newer release is found", () => {
    const state: ReleaseCheckState = {
      kind: "available",
      version: "1.2.0",
      tag: "v1.2.0",
      channel: "stable",
      reason: "newer-version",
      items: [
        {
          id: "binary-1",
          kind: "binary",
          required: true,
          platform: "linux-x64",
          asset_name: "deck_v1.2.0_linux-x64.tar.gz",
          url: "https://example.com/a.tar.gz",
          sha256: "a".repeat(64),
          notes: "",
        },
        {
          id: "content-1",
          kind: "content",
          required: false,
          asset_name: "deck_v1.2.0_content.tar.gz",
          url: "https://example.com/c.tar.gz",
          sha256: "b".repeat(64),
          notes: "",
          content_kinds: ["prompts"],
        },
      ],
      descriptor: null,
    };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).toContain("Upgrade available: v1.2.0");
    expect(output).toContain("binary + content");
    expect(output).toContain("1 required");
    // The "Update Deck → 1.2.0" label is also rendered in the menu.
    expect(output).toContain("Update Deck → 1.2.0");
  });

  test("renders the upgrade banner with `no binary for this platform` when only a foreign-platform binary ships", () => {
    const state: ReleaseCheckState = {
      kind: "available",
      version: "1.2.0",
      tag: "v1.2.0",
      channel: "stable",
      reason: "newer-version",
      items: [
        {
          id: "binary-darwin",
          kind: "binary",
          required: true,
          platform: "darwin-arm64",
          asset_name: "deck_v1.2.0_darwin-arm64.tar.gz",
          url: "https://example.com/a.tar.gz",
          sha256: "a".repeat(64),
          notes: "",
        },
      ],
      descriptor: null,
    };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).toContain("Upgrade available: v1.2.0");
    expect(output).toContain("no binary for this platform");
  });

  test("renders the upgrade banner with `all optional` when no required items ship", () => {
    const state: ReleaseCheckState = {
      kind: "available",
      version: "1.2.0",
      tag: "v1.2.0",
      channel: "stable",
      reason: "newer-version",
      items: [
        {
          id: "content-1",
          kind: "content",
          required: false,
          asset_name: "deck_v1.2.0_content.tar.gz",
          url: "https://example.com/c.tar.gz",
          sha256: "b".repeat(64),
          notes: "",
          content_kinds: ["prompts"],
        },
      ],
      descriptor: null,
    };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).toContain("all optional");
  });

  test("renders a red advisory banner with severity when an advisory item ships", () => {
    const state: ReleaseCheckState = {
      kind: "available",
      version: "1.2.0",
      tag: "v1.2.0",
      channel: "stable",
      reason: "newer-version",
      items: [],
      descriptor: null,
      advisory: {
        id: "advisory-1",
        kind: "advisory",
        required: false,
        asset_name: "deck_v1.2.0_advisory.json",
        sha256: "a".repeat(64),
        notes: "Security flaw in the binary upgrade path.",
        severity: "critical",
        affected_versions: [">=1.0.0"],
        url: "https://example.com/advisory",
      },
    };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).toContain("Advisory (critical)");
    expect(output).toContain("Security flaw in the binary upgrade path.");
    expect(output).toContain("https://example.com/advisory");
  });

  test("renders a channel EOL deprecation notice when a channel_eol item ships", () => {
    const state: ReleaseCheckState = {
      kind: "available",
      version: "1.2.0",
      tag: "v1.2.0",
      channel: "beta",
      reason: "newer-version",
      items: [],
      descriptor: null,
      channelEol: {
        id: "channel-eol-1",
        kind: "channel_eol",
        required: false,
        asset_name: "deck_v1.2.0_channel_eol.json",
        sha256: "b".repeat(64),
        notes: "The beta channel is being retired.",
        channel: "beta",
        successor_channel: "stable",
      },
    };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).toContain("Channel deprecation notice");
    expect(output).toContain("The beta channel is being retired.");
    expect(output).toContain("stable");
  });

  test("advisory banner takes priority over the channel EOL banner", () => {
    const state: ReleaseCheckState = {
      kind: "available",
      version: "1.2.0",
      tag: "v1.2.0",
      channel: "stable",
      reason: "newer-version",
      items: [],
      descriptor: null,
      advisory: {
        id: "advisory-1",
        kind: "advisory",
        required: false,
        asset_name: "deck_v1.2.0_advisory.json",
        sha256: "a".repeat(64),
        notes: "Migrate to the new release channel.",
        severity: "warning",
        affected_versions: [">=1.0.0"],
      },
      channelEol: {
        id: "channel-eol-1",
        kind: "channel_eol",
        required: false,
        asset_name: "deck_v1.2.0_channel_eol.json",
        sha256: "b".repeat(64),
        notes: "beta is being retired.",
        channel: "beta",
        successor_channel: "stable",
      },
    };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).toContain("Advisory (warning)");
    expect(output).toContain("Migrate to the new release channel.");
    // Channel EOL banner is hidden when an advisory is present.
    expect(output).not.toContain("Channel deprecation notice");
  });

  test("renders 'New build available' for same-version-different-commit", () => {
    const state: ReleaseCheckState = {
      kind: "available",
      version: "1.2.0",
      tag: "v1.2.0",
      channel: "stable",
      reason: "same-version-different-commit",
      currentCommit: "abc1234",
      latestCommit: "def5678",
      items: [
        {
          id: "binary-1",
          kind: "binary",
          required: true,
          platform: "linux-x64",
          asset_name: "deck_v1.2.0_linux-x64.tar.gz",
          url: "https://example.com/a.tar.gz",
          sha256: "a".repeat(64),
          notes: "",
        },
      ],
      descriptor: null,
    };
    const output = renderToString(<HomeScreen cursor={0} releaseCheck={state} />);
    expect(output).toContain("New build available: v1.2.0");
    expect(output).toContain("def5678");
  });
});
