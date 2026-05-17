import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { Box, Text } from "ink";

import { ScreenFrame } from "./screen-frame";
import {
  DeveloperTeamReviewScreen,
  DeveloperTeamInstallingScreen,
} from "./screens/developer-team-screens";

import { getTeamsForEnvironment } from "@deck/adapter-pi";
import { MenuList } from "./components/menu-list";

function TeamSelectionScreen({ cursor, selected }: { cursor: number; selected: string[] }) {
  const teams = getTeamsForEnvironment("pi-development");
  return (
    <ScreenFrame title="Select teams" help="help">
      <Box flexDirection="column">
        <MenuList
          cursor={cursor}
          multiselect
          items={teams.map((team) => ({
            id: team.id,
            label: team.displayName,
            hint: team.description,
            checked: selected.includes(team.id),
          }))}
        />
      </Box>
    </ScreenFrame>
  );
}

describe("Developer Team TUI screens", () => {
  describe("DeveloperTeamReviewScreen", () => {
    test("renders target path and agent list", () => {
      const output = renderToString(
        <ScreenFrame title="Developer Team" help="help">
          <DeveloperTeamReviewScreen
            projectRoot="/tmp/my-project"
            cursor={0}
          />
        </ScreenFrame>,
      );

      expect(output).toContain("/tmp/my-project/.pi/agents");
      expect(output).toContain("Orchestrator Agent");
      expect(output).toContain("Archive Agent");
      expect(output).toContain("deck-developer-orchestrator.md");
    });

    test("renders install and skip options", () => {
      const output = renderToString(
        <ScreenFrame title="Developer Team" help="help">
          <DeveloperTeamReviewScreen
            projectRoot="/tmp/my-project"
            cursor={0}
          />
        </ScreenFrame>,
      );

      expect(output).toContain("Install Developer Team now");
      expect(output).toContain("Skip Developer Team");
    });

    test("cursor highlights Install when cursor=0", () => {
      const output = renderToString(
        <ScreenFrame title="Developer Team" help="help">
          <DeveloperTeamReviewScreen
            projectRoot="/tmp/my-project"
            cursor={0}
          />
        </ScreenFrame>,
      );

      // The first menu item (Install) should have the cursor indicator
      // MenuList uses ❯ for focused item
      const installIdx = output.indexOf("Install Developer Team now");
      const skipIdx = output.indexOf("Skip Developer Team");
      // The ❯ should appear before the Install option
      const cursorBeforeInstall = output.lastIndexOf("❯", installIdx);
      expect(cursorBeforeInstall).toBeGreaterThan(-1);
      expect(cursorBeforeInstall).toBeLessThan(installIdx);
    });

    test("cursor highlights Skip when cursor=1", () => {
      const output = renderToString(
        <ScreenFrame title="Developer Team" help="help">
          <DeveloperTeamReviewScreen
            projectRoot="/tmp/my-project"
            cursor={1}
          />
        </ScreenFrame>,
      );

      const skipIdx = output.indexOf("Skip Developer Team");
      const cursorBeforeSkip = output.lastIndexOf("❯", skipIdx);
      expect(cursorBeforeSkip).toBeGreaterThan(-1);
      expect(cursorBeforeSkip).toBeLessThan(skipIdx);
    });
  });

  describe("DeveloperTeamInstallingScreen", () => {
    test("renders installing message", () => {
      const output = renderToString(
        <ScreenFrame title="Installing Developer Team" help="help">
          <DeveloperTeamInstallingScreen />
        </ScreenFrame>,
      );

      expect(output).toContain("Installing Developer Team");
    });

    test("renders unified bundle progress", () => {
      const output = renderToString(
        <ScreenFrame title="Installing Developer Team" help="help">
          <DeveloperTeamInstallingScreen />
        </ScreenFrame>,
      );

      expect(output).toContain("Developer Team bundle");
    });
  });

  describe("TeamSelectionScreen", () => {
    test("renders Developer Team as selectable with checkbox", () => {
      const output = renderToString(
        <TeamSelectionScreen cursor={0} selected={["developer-team"]} />,
      );

      expect(output).toContain("Developer Team");
      expect(output).toContain("[x]");
      expect(output).toContain("exploration");
      expect(output).toContain("archive");
    });

    test("renders unchecked when Developer Team not selected", () => {
      const output = renderToString(
        <TeamSelectionScreen cursor={0} selected={[]} />,
      );

      expect(output).toContain("[ ]");
    });

    test("shows cursor indicator on focused team", () => {
      const output = renderToString(
        <TeamSelectionScreen cursor={0} selected={["developer-team"]} />,
      );

      const teamIdx = output.indexOf("Developer Team");
      const cursorBeforeTeam = output.lastIndexOf("❯", teamIdx);
      expect(cursorBeforeTeam).toBeGreaterThan(-1);
      expect(cursorBeforeTeam).toBeLessThan(teamIdx);
    });
  });
});
