import React from "react";
import { render, renderToString } from "ink";

import { parseArgs, SUPPORTED_MEMORY_PROVIDERS } from "./cli-args";
import { createEngramMemoryProvider } from "@deck/adapter-engram";
import type { AdaptiveMemoryProvider } from "@deck/core/memory/adaptive-memory";
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

/**
 * Resolve a memory provider string from CLI args to an AdaptiveMemoryProvider instance.
 *
 * Returns undefined if no provider is selected. Emits a diagnostic and returns
 * undefined for unsupported provider strings (fail-closed: REQ-AMI-003).
 */
function resolveMemoryProvider(providerString?: string): AdaptiveMemoryProvider | undefined {
  if (!providerString) return undefined;

  if (providerString === "engram") {
    // Experimental warning — Engram provider has not been validated against
    // the actual Engram MCP server runtime. Tool bindings may change.
    console.warn("[memory] ⚠️  Engram memory provider is experimental. Tool bindings have not been validated against the Engram runtime and may change.");
    return createEngramMemoryProvider();
  }

  // This shouldn't happen because parseArgs validates, but handle defensively.
  console.error(`Unsupported memory provider: ${providerString}. Available providers: ${SUPPORTED_MEMORY_PROVIDERS.join(", ")}`);
  return undefined;
}

if (parsed.command === "pi-launch") {
  const memoryProvider = resolveMemoryProvider(parsed.memoryProvider);
  const projectRoot = resolveProjectRoot();
  const result = runPiLaunch({
    teamId: parsed.teamId,
    projectRoot,
    flags: parsed.flags,
    supportedMemoryProviderIds: SUPPORTED_MEMORY_PROVIDERS,
    ...(memoryProvider ? { memoryProvider } : {}),
  });

  if (result.status === "error") {
    console.error(result.message);
    process.exit(1);
  }

  // Report memory diagnostics if any
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
