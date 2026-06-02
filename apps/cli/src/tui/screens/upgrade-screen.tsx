import React from "react";
import { Box, Text } from "ink";

import type { ReleaseItem } from "../../upgrade-command/release-descriptor";
import { getCurrentPlatformTriple } from "../../upgrade-command/release-descriptor";
import { MenuList } from "../components/menu-list";

export type UpgradeConfirmScreenProps = {
  cursor: number;
  /** Target version the upgrade would install. */
  version: string;
  /** Tag of the target release (e.g. "v1.2.0"). */
  tag?: string;
  /** Items the release ships, used to build the install plan preview. */
  items: readonly ReleaseItem[];
  /** Channel of the release (stable/beta/dev). */
  channel?: "stable" | "beta" | "dev";
  /** When true, the binary cannot be replaced (e.g. Homebrew). */
  binarySkipped?: boolean;
  /** Optional rollback hint to surface if the previous upgrade failed. */
  rollbackHint?: string;
};

/**
 * Upgrade confirm screen.
 *
 * Shows the target version, an item-by-item preview (kinds, required
 * flag, platform for binary items), and a Yes / Cancel prompt. The
 * `apply` callback is invoked from `app.tsx`; the screen itself is
 * pure / presentation-only and the parent owns the `useInput` flow.
 */
export function UpgradeConfirmScreen({
  cursor,
  version,
  tag,
  items,
  channel,
  binarySkipped = false,
  rollbackHint,
}: UpgradeConfirmScreenProps) {
  const ordered = [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const platform = safePlatformTriple();
  const requiredCount = ordered.filter((i) => i.required).length;

  return (
    <Box flexDirection="column">
      <Text bold>Update Deck to v{version}{tag ? ` (${tag})` : ""}</Text>
      {channel ? <Text dimColor>Channel: {channel}</Text> : null}
      {binarySkipped ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>Binary replacement skipped</Text>
          <Text dimColor>Your Deck install is owned by a package manager. Content sync may still run.</Text>
        </Box>
      ) : null}
      {rollbackHint ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="red" bold>Previous upgrade failed</Text>
          <Text dimColor>{rollbackHint}</Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Release items</Text>
        {ordered.length === 0 ? (
          <Text dimColor>This release ships no item for this platform.</Text>
        ) : (
          ordered.map((item) => (
            <ItemRow key={item.id} item={item} platform={platform} />
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {requiredCount > 0
            ? `${requiredCount} required item${requiredCount === 1 ? "" : "s"} will be applied.`
            : "All items are optional."}
        </Text>
      </Box>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={[
            { id: "apply", label: "Apply update" },
            { id: "cancel", label: "Cancel" },
          ]}
        />
      </Box>
    </Box>
  );
}

const KIND_ORDER: ReleaseItem["kind"][] = [
  "advisory",
  "migration",
  "binary",
  "content",
  "channel_eol",
];

function ItemRow({ item, platform }: { item: ReleaseItem; platform: string }) {
  const flag = item.required ? <Text color="yellow">[required]</Text> : <Text dimColor>[optional]</Text>;
  if (item.kind === "binary") {
    const platformHint =
      item.platform === platform
        ? <Text color="green"> (this platform)</Text>
        : <Text dimColor> ({item.platform})</Text>;
    return (
      <Text>
        {"  "}• <Text color="cyan">binary</Text> · {item.id}{platformHint} {flag}
      </Text>
    );
  }
  if (item.kind === "content") {
    return (
      <Text>
        {"  "}• <Text color="cyan">content</Text> · {item.id} ({item.content_kinds.join(", ")}) {flag}
      </Text>
    );
  }
  if (item.kind === "advisory") {
    return (
      <Text>
        {"  "}• <Text color="cyan">advisory</Text> · {item.id} ({item.severity}) {flag}
      </Text>
    );
  }
  if (item.kind === "channel_eol") {
    return (
      <Text>
        {"  "}• <Text color="cyan">channel_eol</Text> · {item.id} ({item.channel} → {item.successor_channel ?? "—"}) {flag}
      </Text>
    );
  }
  // migration
  return (
    <Text>
      {"  "}• <Text color="cyan">migration</Text> · {item.id} {flag}
    </Text>
  );
}

function safePlatformTriple(): string {
  try {
    return getCurrentPlatformTriple();
  } catch {
    return "linux-x64";
  }
}
