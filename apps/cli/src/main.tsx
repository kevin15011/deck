import React from "react";
import { render, renderToString } from "ink";

import { parseArgs } from "./cli-args";
import { getBuildInfo } from "./runtime/build-info";
import { spawnInherited } from "./runtime/process";
import { runPiLaunch } from "./pi-launch-command";
import { resolveProjectRoot } from "./project-root";
import { createDefaultAdapterRegistry } from "./runner-adapters";
import { createNodeRunnerProcessEffects, runRunnerLaunch } from "./runner-launch-command";
import { INTERNAL_SERENA_MCP_PROBE_TOKEN, runInternalSerenaMcp } from "./internal-serena-mcp";
import { DeckApp } from "./tui/app";
import { ScreenFrame } from "./tui/screen-frame";
import { HomeScreen } from "./tui/screens/home-screen";
import { inspectStandaloneWebSearchReadiness, isStandaloneWebSearchSmokeSuccessful } from "./standalone-web-search-smoke";
import { createDeckConfigStoreFromEnvironment } from "./deck-config-store";

// One authoritative operational registry is shared by direct commands and the TUI.
const adapterRegistry = createDefaultAdapterRegistry();

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
    adapters: adapterRegistry.list(),
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

if (parsed.command === "doctor") {
  try {
    const { runDoctorDiagnostics, renderDoctorReport, shouldExitWithError } = await import("./doctor-command");
    const result = await runDoctorDiagnostics({ configStore });
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

if (parsed.command === "runner-launch") {
  const projectRoot = resolveProjectRoot() ?? process.cwd();
  const deckConfig = configStore.readRequired();
  const adapter = adapterRegistry.get(parsed.runnerId);
  const launch = { ...parsed.launch, projectRoot, teamId: parsed.teamId, deckConfig };
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const result = await runRunnerLaunch({
    adapter,
    launch,
    installOnly: parsed.installOnly,
    dryRun: parsed.dryRun,
    yes: parsed.yes,
    localOnly: parsed.localOnly,
    interactive,
    confirm: interactive ? async (summary) => {
      const { createInterface } = await import("node:readline/promises");
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await prompt.question(`${summary}. Apply these project changes? [y/N] `);
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
    for (const diagnostic of result.diagnostics) console.log(diagnostic);
    process.exit(0);
  }
  if (result.status === "launched") {
    for (const diagnostic of result.launch.diagnostics) console.error(`[${diagnostic.code}] ${diagnostic.message}`);
    if (result.outcome.stdout) process.stdout.write(result.outcome.stdout);
    if (result.outcome.stderr) process.stderr.write(result.outcome.stderr);
    if (result.outcome.truncated) console.error("Runner output was truncated; it is not complete verification evidence.");
    process.exit(result.outcome.exitCode);
  }
} else if (parsed.command === "pi-launch") {
  const projectRoot = resolveProjectRoot() ?? process.cwd();
  const result = await runPiLaunch({
    teamId: parsed.teamId,
    projectRoot,
    flags: parsed.flags,
    cliMemoryProvider: parsed.memoryProvider,
    deckConfig: configStore.readRequired(),
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
  render(<DeckApp adapterRegistry={adapterRegistry} configStore={configStore} />, {
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
