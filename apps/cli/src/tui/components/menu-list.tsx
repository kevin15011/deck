import React from "react";
import { Box, Text } from "ink";

export type MenuItem = {
  id?: string;
  label: string;
  hint?: string;
  checked?: boolean;
};

type MenuListProps = {
  items: MenuItem[];
  cursor: number;
  multiselect?: boolean;
};

export function MenuList({ items, cursor, multiselect = false }: MenuListProps) {
  return (
    <Box flexDirection="column">
      {items.map((item, index) => {
        const focused = index === cursor;
        const prefix = focused ? "❯" : " ";
        const checkbox = multiselect ? (item.checked ? "[x] " : "[ ] ") : "";

        return (
          <Text key={item.id ?? `${item.label}-${index}`} color={focused ? "cyan" : undefined}>
            {prefix} {checkbox}{item.label}{item.hint ? <Text color="yellow"> {item.hint}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}
