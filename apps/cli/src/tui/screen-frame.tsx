import React, { type ReactNode } from "react";
import { Box, Text } from "ink";

type ScreenFrameProps = {
  title: string;
  help: string;
  children: ReactNode;
  width?: number;
  height?: number;
  logs?: string[];
};

export function ScreenFrame({ title, help, children, width, height, logs }: ScreenFrameProps) {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      width={width ?? 72}
      height={height}
    >
      <Box flexDirection="column">
        <Text bold color="cyan">{title}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {children}
      </Box>

      {logs && logs.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          {logs.slice(-5).map((log, i) => (
            <Text key={i} dimColor fontSize={9}>{log}</Text>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>{help}</Text>
      </Box>
    </Box>
  );
}
