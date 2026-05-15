import React from "react";
import { Box, Text } from "ink";

import { getHomeMenuOptions } from "../../menu-options";
import { MenuList } from "../components/menu-list";

type HomeScreenProps = {
  cursor: number;
};

export function HomeScreen({ cursor }: HomeScreenProps) {
  return (
    <Box flexDirection="column">
      <Text>Your AI environment, configured.</Text>
      <Box marginTop={1}>
        <Text bold>Menu</Text>
      </Box>
      <Box marginTop={1}>
        <MenuList items={getHomeMenuOptions().map((option) => ({ label: option.label }))} cursor={cursor} />
      </Box>
    </Box>
  );
}
