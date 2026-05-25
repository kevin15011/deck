import React from "react";
import { render, renderToString } from "ink";

import { parseArgs } from "./cli-args";
import { getBuildInfo } from "./runtime/build-info";
import { spawnInherited } from "./runtime/process";
import { runPiLaunch } from "./pi-launch-command";
import { resolveProjectRoot } from "./project-root";
import { createRunnerCapabilityRegistry, type RunnerCapabilityCatalog } from "./runner-capability-registry";
import { DeckApp } from "./tui/app";
import { ScreenFrame } from "./tui/screen-frame";
import { HomeScreen } from "./tui/screens/home-screen";

// Create the runner capability catalog at composition time
const runnerCatalog: RunnerCapabilityCatalog = createRunnerCapabilityRegistry();

// Drop the runtime/script args — Bun passes them as argv[0] and argv[1]
const userArgs = process.argv.slice(2);
const parsed = parseArgs(userArgs);

if (parsed.command === "error") {
  console.error(parsed.message);
  process.exit(1);
}

if (parsed.command === "doctor") {
  try {
    const { runDoctorDiagnostics, renderDoctorReport, shouldExitWithError } = await import("./doctor-command");
    const result = await runDoctorDiagnostics();
    renderDoctorReport(result);
    process.exit(shouldExitWithError(result) ? 1 : 0);
  } catch (err) {
    console.error("deck doctor failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (parsed.command === "version") {
  const info = getBuildInfo();
  console.log(`deck ${info.version}`);
  console.log(`commit: ${info.commit}`);
  console.log(`date: ${info.date}`);
  console.log(`target: ${info.target}`);
  console.log(`channel: ${info.channel}`);
  process.exit(0);
}

if (parsed.command === "upgrade") {
  try {
    const { runUpgrade } = await import("./upgrade-command/index.js");
    const flags = parsed.flags;

    // Build args array for upgrade command
    const args: string[] = [];
    if (flags.yes) {
      args.push("--yes");
    }

    const exitCode = await runUpgrade(args);
    process.exit(exitCode);
  } catch (err) {
    console.error("deck upgrade failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
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
  const child = spawnInherited(plan.command, plan.args, {
    cwd: plan.cwd,
    env: plan.env,
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });
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