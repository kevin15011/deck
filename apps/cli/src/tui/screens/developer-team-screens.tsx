import React from "react";
import { Box, Text } from "ink";

import { DEVELOPER_TEAM_AGENTS } from "@deck/adapter-pi";
import { MenuList } from "../components/menu-list";

type DeveloperTeamReviewScreenProps = {
  projectRoot: string;
  cursor: number;
};

export function DeveloperTeamReviewScreen({ projectRoot, cursor }: DeveloperTeamReviewScreenProps) {
  return (
    <Box flexDirection="column">
      <Text bold>Developer Team will be installed to:</Text>
      <Text color="cyan">  {projectRoot}/.pi/agents/</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Included agents ({DEVELOPER_TEAM_AGENTS.length})</Text>
        {DEVELOPER_TEAM_AGENTS.map((agent) => (
          <Text key={agent.id}>
            {"  "}{agent.displayName} <Text dimColor>({agent.id}.md)</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={[
            { id: "install", label: "Install Developer Team now" },
            { id: "skip", label: "Skip Developer Team" },
          ]}
        />
      </Box>
    </Box>
  );
}

export function DeveloperTeamInstallingScreen() {
  return (
    <Box flexDirection="column">
      <Text color="cyan">Installing Developer Team...</Text>
      <Text dimColor>Writing the Developer Team bundle to the project.</Text>
    </Box>
  );
}
