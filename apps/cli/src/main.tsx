import { formatLaunchDiagnostic, formatPlainDiagnostic, isQuietDiagnostic, shouldColorStderr } from "./launch-diagnostic-format";
import React from "react";
import { render, renderToString } from "ink";

import { parseArgs } from "./cli-args";
import { getBuildInfo } from "./runtime/build-info";
import { resolveProjectRoot } from "./project-root";
import { createDefaultAdapterRegistry } from "./runner-adapters";
import { createNodeRunnerProcessEffects, executeRunnerLaunchPlan, runRunnerLaunch } from "./runner-launch-command";
import { buildClaudeLaunchPlan } from "./claude-launch-plan";
import { INTERNAL_SERENA_MCP_PROBE_TOKEN, runInternalSerenaMcp } from "./internal-serena-mcp";
import { DeckApp } from "./tui/app";
import { ScreenFrame } from "./tui/screen-frame";
import { HomeScreen } from "./tui/screens/home-screen";
import { inspectStandaloneWebSearchReadiness, isStandaloneWebSearchSmokeSuccessful } from "./standalone-web-search-smoke";
import { createDeckConfigStoreFromEnvironment } from "./deck-config-store";

// One authoritative operational registry is shared by direct commands and the TUI.
// Version and other standalone commands must not instantiate runner adapters:
// release smoke checks deliberately run without HOME or runner configuration.
let adapterRegistry: ReturnType<typeof createDefaultAdapterRegistry> | undefined;
const getAdapterRegistry = () => adapterRegistry ??= createDefaultAdapterRegistry();

// Drop the runtime/script args — Bun passes them as argv[0] and argv[1]
const userArgs = process.argv.slice(2);
const parsed = parseArgs(userArgs);
const configStore = createDeckConfigStoreFromEnvironment({ projectRoot: resolveProjectRoot() ?? process.cwd() });

if (parsed.command === "error") {
  console.error(parsed.message);
  process.exit(1);
}

// Deliberately opt-in runtime hook for release verification. It is exercised
// from an isolated directory after `bun build --compile`; no provider call or
// MCP installation is performed.
if (process.env.DECK_STANDALONE_WEB_SEARCH_SMOKE === "1") {
  const report = await inspectStandaloneWebSearchReadiness({
    projectRoot: resolveProjectRoot() ?? process.cwd(),
    adapters: getAdapterRegistry().list(),
    deckConfig: configStore.readRequired(),
  });
  console.log(JSON.stringify(report));
  process.exit(isStandaloneWebSearchSmokeSuccessful(report) ? 0 : 1);
}

if (parsed.command === "internal-serena-mcp") {
  if (parsed.probe) {
    console.log(INTERNAL_SERENA_MCP_PROBE_TOKEN);
    process.exit(0);
  }
  const result = await runInternalSerenaMcp();
  if (result.signal) {
    process.kill(process.pid, result.signal);
    process.exit(1);
  }
  process.exit(result.exitCode);
}

if (parsed.command === "internal-supermemory-runtime-smoke") {
  const { runInternalSupermemoryRuntimeSmoke } = await import("./internal-supermemory-runtime-smoke");
  const result = await runInternalSupermemoryRuntimeSmoke();
  console.log(result.output);
  process.exit(result.exitCode);
}

if (parsed.command === "internal-codex-memory-hook") {
  const { runInternalCodexMemoryHook } = await import("./internal-codex-memory-hook");
  const result = await runInternalCodexMemoryHook();
  if (result.output) process.stdout.write(result.output);
  process.exit(result.exitCode);
}

if (parsed.command === "internal-memory-mcp") {
  // Deck-owned stdio MCP server for Codex explicit memory tools; stdout carries only JSON-RPC frames.
  const { runCodexMemoryMcpStdio } = await import("@deck/adapter-codex");
  await runCodexMemoryMcpStdio({ input: process.stdin, write: (line) => { process.stdout.write(`${line}\n`); } });
  process.exit(0);
}

if (parsed.command === "doctor") {
  try {
    const { runDoctorDiagnostics, renderDoctorReport, shouldExitWithError } = await import("./doctor-command");
    const result = await runDoctorDiagnostics({ configStore }, resolveProjectRoot() ?? undefined);
    renderDoctorReport(result);
    process.exit(shouldExitWithError(result) ? 1 : 0);
  } catch (err) {
    console.error("deck doctor failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (parsed.command === "supermemory-migration-dry-run") {
  const { runSupermemoryMigrationDryRun } = await import("./supermemory-migration-command");
  const result = runSupermemoryMigrationDryRun({
    destinationScope: parsed.flags.destinationScope,
    inventoryPath: parsed.flags.inventoryPath,
  });
  const write = result.exitCode === 0 ? console.log : console.error;
  write(result.output);
  process.exit(result.exitCode);
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

if (parsed.command === "rollback") {
  // `deck rollback` — REQ-RBK-001. Restore the most-recent backup, or
  // a specific one if `--backup <id>` is supplied.
  try {
    const { rollbackLatest, rollbackBackup, resolveLatestBackupForCli } = await import(
      "./upgrade-command/rollback.js"
    );
    const { readBackupManifest } = await import("./upgrade-command/backup-store.js");
    const flags = parsed.flags;
    const currentVersion = getBuildInfo().version;
    if (flags.backupId) {
      const manifest = readBackupManifest(flags.backupId);
      const result = rollbackBackup(manifest, currentVersion, {
        force: flags.force === true,
      });
      console.log(
        `Rolled back from ${result.rolledBackFrom} to ${result.rolledBackTo} ` +
          `(restored ${result.restoredCount}, deleted ${result.deletedCount})`,
      );
      process.exit(0);
    }
    const latest = resolveLatestBackupForCli();
    if (!latest) {
      console.error("No backup available to roll back to.");
      process.exit(1);
    }
    const result = rollbackLatest(currentVersion, {
      force: flags.force === true,
    });
    console.log(
      `Rolled back from ${result.rolledBackFrom} to ${result.rolledBackTo} ` +
        `(restored ${result.restoredCount}, deleted ${result.deletedCount})`,
    );
    process.exit(0);
  } catch (err) {
    console.error("deck rollback failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (parsed.command === "openspec-validate") {
  try {
    const { runOpenspecValidate } = await import("./openspec-validate-command");
    const result = await runOpenspecValidate(parsed);

    // Output based on mode
    if (parsed.flags.json && result.json) {
      console.log(JSON.stringify(result.json, null, 2));
    } else if (result.human) {
      console.log(result.human);
    } else if (result.error) {
      console.error(result.error);
    }

    process.exit(result.exitCode);
  } catch (err) {
    console.error("deck openspec validate failed:", err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

if (
  parsed.command === "skill-registry-validate" ||
  parsed.command === "skill-registry-discover" ||
  parsed.command === "skill-registry-refresh"
) {
  try {
    const { runSkillRegistryCommand } = await import("./skill-registry-command");
    const result = await runSkillRegistryCommand(parsed);
    if (parsed.flags.json) {
      console.log(JSON.stringify(result.json, null, 2));
    } else {
      console.log(result.human);
    }
    process.exit(result.exitCode);
  } catch {
    // Keep runtime failures bounded; command internals already return safe
    // structured status/reason output for expected failures.
    console.error("deck skill-registry failed.");
    process.exit(2);
  }
}

if (parsed.command === "claude-native-launch") {
  try {
    const projectRoot = resolveProjectRoot() ?? process.cwd();
    const planned = buildClaudeLaunchPlan({ ...parsed.launch, projectRoot, teamId: "developer-team", deckConfig: configStore.readRequired() });
    if (planned.status !== "ready") {
      console.error(planned.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
      process.exit(planned.status === "blocked" ? 1 : 2);
    }
    for (const diagnostic of planned.diagnostics) console.error(formatLaunchDiagnostic(diagnostic, shouldColorStderr()));
    const outcome = await executeRunnerLaunchPlan(planned.plan, createNodeRunnerProcessEffects());
    if (outcome.stderr) console.error(outcome.stderr);
    if (outcome.signal) process.kill(process.pid, outcome.signal);
    process.exit(outcome.exitCode);
  } catch (error) {
    console.error("Claude native launch failed:", error instanceof Error ? error.message : "unknown error");
    process.exit(1);
  }
}

if (parsed.command === "claude-team-launch") {
  try {
    const adapter = getAdapterRegistry().get("claude");
    const launch = await adapter.buildLaunchPlan!({ mode: "interactive", projectRoot: resolveProjectRoot() ?? process.cwd(), teamId: "developer-team", deckConfig: configStore.readRequired() });
    if (launch.status !== "ready") {
      console.error(launch.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
      process.exit(launch.status === "blocked" ? 1 : 2);
    }
    for (const diagnostic of launch.diagnostics) console.error(formatLaunchDiagnostic(diagnostic, shouldColorStderr()));
    const outcome = await executeRunnerLaunchPlan(launch.plan, createNodeRunnerProcessEffects());
    if (outcome.stderr) console.error(outcome.stderr);
    if (outcome.signal) process.kill(process.pid, outcome.signal);
    process.exit(outcome.exitCode);
  } catch (error) {
    console.error("Claude plugin session failed:", error instanceof Error ? error.message : "unknown error");
    process.exit(1);
  }
}

if (parsed.command === "runner-launch") {
  const projectRoot = resolveProjectRoot() ?? process.cwd();
  const deckConfig = configStore.readRequired();
  const adapter = getAdapterRegistry().get(parsed.runnerId);
  const launch = { ...parsed.launch, projectRoot, teamId: parsed.teamId, deckConfig };
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const presented: string[] = [];
  const result = await runRunnerLaunch({
    adapter,
    launch,
    installOnly: parsed.installOnly,
    dryRun: parsed.dryRun,
    yes: parsed.yes,
    localOnly: parsed.localOnly,
    cleanupLegacy: parsed.cleanupLegacy,
    cliMemoryProvider: parsed.memoryProvider,
    interactive,
    confirm: interactive ? async (question) => {
      const { createInterface } = await import("node:readline/promises");
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await prompt.question(`${question} `);
        return /^(y|yes)$/i.test(answer.trim());
      } finally {
        prompt.close();
      }
    } : undefined,
    verbose: parsed.verbose,
    // Human status goes to stderr for exec runs so stdout carries only the runner's own output.
    presentPreview: async (preview) => { presented.push(preview); (parsed.launch.mode === "exec" ? console.error : console.log)(preview); },
    processEffects: createNodeRunnerProcessEffects(),
  });
  if (result.status === "blocked") {
    console.error(result.message);
    process.exit(1);
  }
  if (result.status === "unsupported") {
    console.error(result.message);
    process.exit(2);
  }
  if (result.status === "dry-run" || result.status === "installed") {
    // The dry-run preview was already presented once through presentPreview; only verification output is new.
    if (result.status === "installed") for (const diagnostic of result.diagnostics) console.log(diagnostic);
    process.exit(0);
  }
  if (result.status === "launched") {
    // Each warning is printed once: anything already shown in the pre-launch preview is not repeated.
    const shown = presented.join("\n");
    for (const diagnostic of result.launch.diagnostics) {
      if (shown.includes(diagnostic.message)) continue;
      if (parsed.verbose) console.error(formatLaunchDiagnostic(diagnostic, shouldColorStderr()));
      else if (!isQuietDiagnostic(diagnostic)) console.error(formatPlainDiagnostic(diagnostic));
    }
    if (result.outcome.stdout) process.stdout.write(result.outcome.stdout);
    if (result.outcome.stderr) process.stderr.write(result.outcome.stderr);
    if (result.outcome.truncated) console.error("Runner output was truncated; it is not complete verification evidence.");
    process.exit(result.outcome.exitCode);
  }
} else if (parsed.command === "pi-launch") {
  const projectRoot = resolveProjectRoot() ?? process.cwd();
  const deckConfig = configStore.readRequired();
  const adapter = getAdapterRegistry().get("pi");
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const result = await runRunnerLaunch({
    adapter,
    launch: { projectRoot, teamId: parsed.teamId, mode: "interactive", runnerNative: parsed.flags, deckConfig },
    cliMemoryProvider: parsed.memoryProvider,
    cleanupLegacy: parsed.cleanupLegacy,
    interactive,
    yes: !interactive,
    confirm: interactive ? async (question) => {
      const { createInterface } = await import("node:readline/promises");
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await prompt.question(`${question} `);
        return /^(y|yes)$/i.test(answer.trim());
      } finally {
        prompt.close();
      }
    } : undefined,
    presentPreview: async (preview) => { console.log(preview); },
    processEffects: createNodeRunnerProcessEffects(),
  });

  if (result.status === "blocked") {
    console.error(result.message);
    process.exit(1);
  }
  if (result.status === "unsupported") {
    console.error(result.message);
    process.exit(2);
  }
  if (result.status === "dry-run" || result.status === "installed") {
    // The dry-run preview was already presented once through presentPreview; only verification output is new.
    if (result.status === "installed") for (const diagnostic of result.diagnostics) console.log(diagnostic);
    process.exit(0);
  }
  if (result.status === "launched") {
    for (const diagnostic of result.launch.diagnostics) console.error(formatLaunchDiagnostic(diagnostic, shouldColorStderr()));
    if (result.outcome.stdout) process.stdout.write(result.outcome.stdout);
    if (result.outcome.stderr) process.stderr.write(result.outcome.stderr);
    if (result.outcome.truncated) console.error("Runner output was truncated; it is not complete verification evidence.");
    process.exit(result.outcome.exitCode);
  }
} else if (process.stdin.isTTY) {
  render(<DeckApp adapterRegistry={getAdapterRegistry()} configStore={configStore} />, {
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
