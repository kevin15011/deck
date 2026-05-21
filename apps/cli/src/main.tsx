import React from "react";
import { render, renderToString } from "ink";

import { parseArgs } from "./cli-args";
import { runOpenCodeLaunch } from "./opencode-launch-command";
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

if (parsed.command === "opencode-launch") {
  const projectRoot = resolveProjectRoot();
  const result = await runOpenCodeLaunch({
    teamId: parsed.teamId,
    projectRoot,
    cliMemoryProvider: parsed.memoryProvider,
  });

  if (result.status === "error") {
    console.error(result.message);
    process.exit(1);
  }

  if (result.memoryDiagnostics.length > 0) {
    for (const diagnostic of result.memoryDiagnostics) {
      console.error(`[memory] ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  if (result.status === "launched") {
    const child = Bun.spawn([result.plan.command, ...result.plan.args], {
      cwd: result.plan.cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await child.exited;
    process.exit(exitCode);
  }
}

if (parsed.command === "pi-launch") {
  const projectRoot = resolveProjectRoot();
  const result = await runPiLaunch({
    teamId: parsed.teamId,
    projectRoot,
    flags: parsed.flags,
    cliMemoryProvider: parsed.memoryProvider,
  });

  if (result.status === "error") {
    console.error(result.message);
    process.exit(1);
  }

  // Report memory diagnostics if any. Diagnostics are produced without memory
  // content or credentials; Supermemory token/header values must remain redacted.
  if (result.memoryDiagnostics.length > 0) {
    for (const diagnostic of result.memoryDiagnostics) {
      console.error(`[memory] ${diagnostic.code}: ${diagnostic.message}`);
    }
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
