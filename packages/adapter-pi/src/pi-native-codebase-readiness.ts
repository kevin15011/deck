import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { McpServerEntry } from "@earendil-works/pi-coding-agent";
import { isCompatibleCodebaseExecutable, inspectOwnedCodebase, pinnedOwnedCodebaseRelease, OWNED_CODEBASE_VERSION } from "../../core/src/owned-tools/codebase-native-artifact";
import { hashJsonValue, parsePiManifest } from "./pi-manifest";
import { inspectCodebaseGuardEntry } from "./pi-codebase-guard-command";
import { loadMcpConfig } from "./pi-extensions/tool-policy/native-config.pinned";

function ownedHash(agentDir: string): string | undefined {
  let fd: number;
  try { fd = openSync(join(agentDir, "deck/manifest.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  try {
    const limit = 1024 * 1024;
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(limit)) throw new Error("pi-codebase-ownership-invalid");
    const buffer = Buffer.alloc(limit + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (count === 0) break;
      bytes += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (bytes > limit || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error("pi-codebase-ownership-invalid");
    const parsed = parsePiManifest(buffer.subarray(0, bytes).toString("utf8"));
    if (!parsed.ok) throw new Error("pi-codebase-ownership-invalid");
    return parsed.manifest.mcp.servers["codebase-memory"];
  } finally { closeSync(fd); }
}

export type NativeCodebaseClassification = { status: "ready" | "unavailable" | "custom"; owned: boolean; binary?: string; guarded?: boolean };

export function readNativeCodebaseSelection(agentDir: string): McpServerEntry | null {
  const loaded = loadMcpConfig({ agentDir, cwd: agentDir, projectTrusted: false });
  if (loaded.errors.length) throw new Error("pi-codebase-configuration-invalid");
  return loaded.servers.find((entry: McpServerEntry) => entry.name === "codebase-memory") ?? null;
}

/** Shared launch/factory/runtime classifier. Startup deliberately examines global ownership without project trust. */
export function classifyNativeCodebase(input: { agentDir: string; entry?: McpServerEntry | null; compatible?: (command: string) => boolean; signal?: AbortSignal }): NativeCodebaseClassification {
  input.signal?.throwIfAborted();
  const owned = ownedHash(input.agentDir);
  let entry = input.entry;
  if (entry === undefined) {
    entry = readNativeCodebaseSelection(input.agentDir);
  }
  if (!entry) return { status: "unavailable", owned: false };
  if (entry.scope !== "global" || resolve(entry.source) !== resolve(input.agentDir, "mcp.json") || owned !== hashJsonValue(entry.config)) return { status: "custom", owned: false };
  const guard = inspectCodebaseGuardEntry(entry.config, input.agentDir);
  const binary = guard?.binary ?? ("command" in entry.config ? entry.config.command : undefined);
  const compatible = input.compatible ?? ((command: string) => {
    if (basename(dirname(dirname(command))) === `codebase-native-v${OWNED_CODEBASE_VERSION}`) {
      const release = pinnedOwnedCodebaseRelease();
      if (release && inspectOwnedCodebase(dirname(command), release) === "conflict") throw new Error("codebase-memory-integrity-failed");
    }
    return isCompatibleCodebaseExecutable(command);
  });
  const ready = entry.config.enabled !== false && binary !== undefined && compatible(binary);
  input.signal?.throwIfAborted();
  if (ready && !guard) throw new Error("pi-codebase-guard-invalid");
  return { status: ready ? "ready" : "unavailable", owned: true, ...(guard ? { binary, guarded: true } : {}) };
}

export function nativeCodebaseFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return ["pi-codebase-ownership-invalid", "codebase-memory-integrity-failed", "pi-codebase-configuration-invalid", "pi-codebase-guard-invalid"].includes(message) ? message : "pi-codebase-control-failed";
}
export function nativeCodebaseProtectedDiagnostic(error: unknown): string {
  return `Deck blocked Codebase tools (${nativeCodebaseFailureCode(error)}). Repair the reviewed installation or ownership metadata, then reload. Model turns are not blocked after startup.`;
}
