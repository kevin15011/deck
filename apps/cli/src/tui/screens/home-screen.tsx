import React from "react";
import { Box, Text } from "ink";

import { getHomeMenuOptions } from "../../menu-options";
import { MenuList } from "../components/menu-list";
import type { ReleaseCheckState } from "../release-check";
import { summarizeReleaseItems } from "../release-check";
import { getCurrentPlatformTriple } from "../../upgrade-command/release-descriptor";

type HomeScreenProps = {
  cursor: number;
  /**
   * Optional release-check result. When present and `available`, a
   * non-blocking banner is rendered above the menu. `network-error` and
   * `none` produce no banner (REQ-TUI-007).
   */
  releaseCheck?: ReleaseCheckState;
};

/**
 * Home screen.
 *
 * Always renders the menu immediately so the TUI never blocks on
 * the release check. A red advisory banner (REQ-TUI-005) or a yellow
 * channel EOL banner (REQ-TUI-006) is rendered above the menu when
 * applicable; the upgrade available banner only appears for `available`
 * results.
 */
export function HomeScreen({ cursor, releaseCheck }: HomeScreenProps) {
  return (
    <Box flexDirection="column">
      <Text>Your AI environment, configured.</Text>
      {releaseCheck ? <ReleaseCheckBanner releaseCheck={releaseCheck} /> : null}
      <Box marginTop={1}>
        <Text bold>Menu</Text>
      </Box>
      <Box marginTop={1}>
        <MenuList items={getHomeMenuOptions(releaseCheck).map((option) => ({ label: option.label }))} cursor={cursor} />
      </Box>
    </Box>
  );
}

function ReleaseCheckBanner({ releaseCheck }: { releaseCheck: ReleaseCheckState }) {
  if (releaseCheck.kind === "pending") return null;
  if (releaseCheck.kind === "none") return null;
  if (releaseCheck.kind === "network-error") return null;
  if (releaseCheck.kind === "available") {
    return <AvailableBanner releaseCheck={releaseCheck} />;
  }
  return null;
}

function AvailableBanner({ releaseCheck }: { releaseCheck: Extract<ReleaseCheckState, { kind: "available" }> }) {
  // The advisory banner takes priority over both the channel EOL banner
  // and the upgrade banner (REQ-TUI-005).
  if (releaseCheck.advisory) {
    const severity = releaseCheck.advisory.severity;
    const color = severity === "critical" ? "red" : severity === "warning" ? "yellow" : "cyan";
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>Advisory ({severity})</Text>
        <Text color={color}>{releaseCheck.advisory.notes}</Text>
        {releaseCheck.advisory.url ? <Text dimColor>More info: {releaseCheck.advisory.url}</Text> : null}
      </Box>
    );
  }
  if (releaseCheck.channelEol) {
    const eol = releaseCheck.channelEol;
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow" bold>Channel deprecation notice</Text>
        <Text>{eol.notes}</Text>
        {eol.successor_channel ? (
          <Text dimColor>Switch to the <Text color="yellow">{eol.successor_channel}</Text> channel.</Text>
        ) : null}
      </Box>
    );
  }
  const summary = summarizeReleaseItems(releaseCheck.items, safePlatformTriple());
  const requiredCount = releaseCheck.items.filter((i) => i.required).length;
  const requiredLabel = requiredCount > 0 ? `${requiredCount} required` : "all optional";
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
      <Text color="green" bold>Upgrade available: v{releaseCheck.version}</Text>
      <Text dimColor>{summary} · {requiredLabel}</Text>
    </Box>
  );
}

function safePlatformTriple(): string {
  try {
    return getCurrentPlatformTriple();
  } catch {
    return "linux-x64";
  }
}
