/** Process-level wiring for `deck cross developer` / `deck session ...`: real daemon connection, stdin and stdout. */
import { realpathSync } from "node:fs";
import { ControlClient, ensureDaemon, pingDaemon, resolveStatePaths, spawnDetachedDaemon } from "@deck/session-host";
import type { ParsedArgs } from "./cli-args";
import type { DeckConfigStore } from "./deck-config-store";
import { LineQueue } from "./line-queue";
import { deckInternalCommand } from "./runner-adapters";
import { getBuildInfo } from "./runtime/build-info";
import { runCrossLaunch, runSessionCommand, type SessionCommandDeps, type SessionConnection } from "./session-commands";

export async function connectToSessionDaemon(options: { ensure: boolean; env?: NodeJS.ProcessEnv; version?: string }): Promise<SessionConnection | undefined> {
  const env = options.env ?? process.env;
  const version = options.version ?? getBuildInfo().version;
  const paths = resolveStatePaths({ env });
  if (options.ensure) {
    await ensureDaemon({ paths, clientVersion: version, spawnDaemon: () => spawnDetachedDaemon(deckInternalCommand("session-daemon"), env) });
  } else if (!(await pingDaemon(paths.socket.path))) {
    return undefined;
  }
  const client = await ControlClient.connect(paths.socket.path);
  await client.hello(version);
  return { client, paths };
}

export async function runSessionCli(parsed: Extract<ParsedArgs, { command: "cross-launch" | "session" }>, deps: { configStore: DeckConfigStore; projectRoot: () => string | null }): Promise<number> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const lines = new LineQueue(process.stdin, (prompt) => { process.stdout.write(prompt); });
  const commandDeps: SessionCommandDeps = {
    write: (text) => { process.stdout.write(text); },
    writeErr: (text) => { process.stderr.write(text); },
    connect: ({ ensure }) => connectToSessionDaemon({ ensure }),
    configStore: deps.configStore,
    projectRoot: () => { const root = deps.projectRoot() ?? process.cwd(); try { return realpathSync(root); } catch { return root; } },
    stdinLines: () => lines,
    readLine: async (prompt) => (await lines.next(prompt)) ?? "",
    interactive,
    openBrowser: async (url) => {
      const argv = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
      const child = Bun.spawn(argv, {stdin:"ignore",stdout:"ignore",stderr:"ignore"});
      if (await child.exited !== 0) throw new Error("Unable to open default browser");
    },
    env: process.env,
  };
  try {
    return parsed.command === "cross-launch" ? await runCrossLaunch(commandDeps, parsed.flags) : await runSessionCommand(commandDeps, parsed.sub);
  } finally {
    lines.dispose();
  }
}
