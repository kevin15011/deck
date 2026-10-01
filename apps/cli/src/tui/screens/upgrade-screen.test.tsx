import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";

import { UpgradeConfirmScreen } from "./upgrade-screen";
import type { ReleaseItem } from "../../upgrade-command/release-descriptor";
import { getCurrentPlatformTriple } from "../../upgrade-command/release-descriptor";

const currentPlatform = getCurrentPlatformTriple();
const foreignPlatform = currentPlatform === "darwin-arm64" ? "linux-x64" : "darwin-arm64";

const baseItems: readonly ReleaseItem[] = [
  {
    id: "binary-linux-x64",
    kind: "binary",
    required: true,
    platform: currentPlatform,
    asset_name: `deck_v1.2.0_${currentPlatform}.tar.gz`,
    url: "https://example.com/b.tar.gz",
    sha256: "a".repeat(64),
    notes: "",
  },
  {
    id: "content-prompts",
    kind: "content",
    required: false,
    asset_name: "deck_v1.2.0_content.tar.gz",
    url: "https://example.com/c.tar.gz",
    sha256: "b".repeat(64),
    notes: "",
    content_kinds: ["prompts", "skills"],
  },
];

describe("UpgradeConfirmScreen (T3.4)", () => {
  test("renders target version, channel, and item list with required/optional flags", () => {
    const output = renderToString(
      <UpgradeConfirmScreen
        cursor={0}
        version="1.2.0"
        tag="v1.2.0"
        channel="stable"
        items={baseItems}
      />,
    );
    expect(output).toContain("Update Deck to v1.2.0");
    expect(output).toContain("v1.2.0");
    expect(output).toContain("Channel: stable");
    expect(output).toContain("binary");
    expect(output).toContain("content");
    expect(output).toContain("[required]");
    expect(output).toContain("[optional]");
    expect(output).toContain("this platform");
    expect(output).toContain("Apply update");
    expect(output).toContain("Cancel");
    expect(output).toContain("1 required item");
  });

  test("highlights a non-platform binary as not applicable to this platform", () => {
    const output = renderToString(
      <UpgradeConfirmScreen
        cursor={0}
        version="1.2.0"
        items={[
          {
            id: "binary-darwin",
            kind: "binary",
            required: true,
            platform: foreignPlatform,
            asset_name: `deck_v1.2.0_${foreignPlatform}.tar.gz`,
            url: "https://example.com/a.tar.gz",
            sha256: "a".repeat(64),
            notes: "",
          },
        ]}
      />,
    );
    expect(output).toContain(foreignPlatform);
    expect(output).not.toContain("this platform");
  });

  test("renders advisory, migration, and channel_eol rows when present", () => {
    const items: readonly ReleaseItem[] = [
      {
        id: "m1",
        kind: "migration",
        required: true,
        asset_name: "deck_v1.2.0_migration.tar.gz",
        sha256: "1".repeat(64),
        notes: "",
        from_schema_version: 1,
        to_schema_version: 2,
      },
      {
        id: "a1",
        kind: "advisory",
        required: false,
        asset_name: "deck_v1.2.0_advisory.json",
        sha256: "2".repeat(64),
        notes: "Migrate to the new release channel.",
        severity: "warning",
        affected_versions: [">=1.0.0"],
      },
      {
        id: "e1",
        kind: "channel_eol",
        required: false,
        asset_name: "deck_v1.2.0_channel_eol.json",
        sha256: "3".repeat(64),
        notes: "beta is being retired.",
        channel: "beta",
        successor_channel: "stable",
      },
    ];
    const output = renderToString(
      <UpgradeConfirmScreen cursor={0} version="1.2.0" items={items} />,
    );
    expect(output).toContain("migration");
    expect(output).toContain("advisory");
    expect(output).toContain("channel_eol");
    expect(output).toContain("warning");
    expect(output).toContain("beta");
    expect(output).toContain("stable");
    // 1 of 3 is required (the migration item).
    expect(output).toContain("1 required item");
  });
});
