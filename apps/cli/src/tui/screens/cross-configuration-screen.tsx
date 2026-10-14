import React from "react";
import { Box, Text } from "ink";
import type { CrossRunnerConfig } from "@deck/core";
import { CROSS_MEMBERS, buildCrossReview, type CrossRunnerReadiness } from "../cross-config";
import { MenuList, type MenuItem } from "../components/menu-list";
export type CrossStage = "members" | "runners" | "loading" | "providers" | "models" | "thinking" | "review";
export function CrossConfigurationScreen({ stage, cursor, draft, runners, items, error }: {
  stage: CrossStage; cursor: number; draft: CrossRunnerConfig; runners: readonly CrossRunnerReadiness[]; items: MenuItem[]; error?: string;
}) {
  const review = buildCrossReview(draft, runners);
  const menu = stage === "members" ? [
    ...CROSS_MEMBERS.map(id => ({ label: `${id}: ${draft.members[id] ? `${draft.members[id]!.runnerId} / ${draft.members[id]!.modelId}` : "Not assigned"}` })),
    { label: "Review configuration" },
  ] : stage === "runners" ? runners.map(row => ({ label: row.label, hint: row.ready ? "Installed · session driver available" : `Blocked: ${row.reason}` }))
    : stage === "review" ? [
      { label: "Save cross configuration", hint: review.blockers.length ? "Blocked" : undefined },
      { label: "Back to members" },
    ] : items;
  return <Box flexDirection="column">
    <Text bold>Cross runner · {stage}</Text>
    <Text dimColor>Configure members for local cross sessions. No installation actions.</Text>
    {stage === "loading" ? <Text>Checking runner prerequisites and model inventory…</Text> : null}
    {stage === "members" ? <Text dimColor>Missing members cannot receive delegated tasks. Lead is required. Delete clears the selected member.</Text> : null}
    {stage === "review" ? <>
      {Object.entries(draft.members).map(([id, value]) => <Text key={id}>{id}: {value.runnerId} / {value.modelId}{value.thinking ? ` / ${value.thinking}` : ""}</Text>)}
      <Text dimColor>Missing members cannot receive delegated tasks.</Text>
      <Text bold>Prerequisite runners</Text>
      {[...new Set(Object.values(draft.members).map(value => value.runnerId))].map(id => {
        const runner = runners.find(row => row.runnerId === id);
        return <Text key={id}>{runner?.label ?? id}: {runner?.ready ? "Installed · session driver available" : `Blocked: ${runner?.reason ?? "Runner unavailable"}`}</Text>;
      })}
      {review.blockers.map(message => <Text color="yellow" key={message}>{message}</Text>)}
    </> : null}
    {error ? <Text color="red">{error}</Text> : null}
    <MenuList items={menu} cursor={cursor} />
  </Box>;
}
