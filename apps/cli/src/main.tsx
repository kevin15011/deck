import React from "react";
import { render, renderToString } from "ink";

import { parseArgs } from "./cli-args";
import { runPiLaunch } from "./pi-launch-command";
import { resolveProjectRoot } from "./project-root";
import { DeckApp } from "./tui/app";
import { ScreenFrame } from "./tui/screen-frame";
import { HomeScreen } from "./tui/screens/home-screen";

// Drop the runtime/script args — Bun passes them as argv[0] and argv[1]
const userArgs = process.argv.slice(2);
const parsed = parseArgs(userArgs);

if (parsed.command === "error") {
  console.error(parsed.message);
  process.exit(1);
}

if (parsed.command === "pi-launch") {
  const projectRoot = resolveProjectRoot();
  const result = runPiLaunch({
    teamId: parsed.teamId,
    projectRoot,
    flags: parsed.flags,
  });

  if (result.status === "error") {
    console.error(result.message);
    process.exit(1);
  }

  // Spawn Pi with the launch plan
  const plan = result.plan;
  const child = Bun.spawn([plan.command, ...plan.args], {
    cwd: plan.cwd,
    env: plan.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await child.exited;
  process.exit(exitCode);
} else if (process.stdin.isTTY) {
  render(<DeckApp />, {
    alternateScreen: true,
    exitOnCtrlC: true,
    incrementalRendering: true,
    patchConsole: false,
  });
} else {
  console.log(
    renderToString(
      <ScreenFrame title="Deck" help="Run in an interactive terminal to navigate.">
        <HomeScreen cursor={0} />
      </ScreenFrame>,
    ),
  );
}
