import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { resolveCanonicalSupermemoryProjectScope, type RunnerLaunchInput } from "@deck/core";

export type DeckRuntimeSessionResolution = Readonly<{
  sessionId: string;
  diagnostics: readonly string[];
  persist: () => readonly string[];
}>;

type SessionMap = Record<string, string>;

export function createFreshDeckSessionId(): string {
  return `deck-session-${randomUUID()}`;
}

export function deterministicResumeSessionId(nativeSessionId: string): string {
  return `runner-resume:${nativeSessionId}`;
}

export function resolveDeckRuntimeSessionId(
  input: RunnerLaunchInput,
  options: { runnerId: string; stateHome?: string } = { runnerId: "unknown" },
): DeckRuntimeSessionResolution {
  const path = sessionMapPath(options.stateHome);
  const diagnostics: string[] = [];
  const key = sessionMapKey(input.projectRoot, input.teamId, options.runnerId);
  if (!key) {
    diagnostics.push("Deck runtime session continuity skipped because no verified project identity was available.");
    return { sessionId: createFreshDeckSessionId(), diagnostics, persist: () => [] };
  }
  const map = readMap(path, diagnostics);
  if (input.mode === "resume-by-id") {
    const nativeKey = nativeSessionMapKey(input.projectRoot, input.teamId, options.runnerId, input.sessionId);
    const native = nativeKey ? map[nativeKey] : undefined;
    return { sessionId: native ?? deterministicResumeSessionId(input.sessionId), diagnostics, persist: () => [] };
  }
  if (input.mode === "resume-latest" && map[key]) return { sessionId: map[key], diagnostics, persist: () => [] };

  const sessionId = createFreshDeckSessionId();
  const persist = () => {
    const persistDiagnostics: string[] = [];
    const latest = readMap(path, persistDiagnostics);
    latest[key] = sessionId;
    writeMap(path, latest, persistDiagnostics);
    return persistDiagnostics;
  };
  if (input.mode === "exec" || input.mode === "interactive") {
    map[key] = sessionId;
    return { sessionId, diagnostics, persist };
  }
  return { sessionId, diagnostics, persist: () => [] };
}

export function persistNativeDeckRuntimeSessionMapping(input: {
  projectRoot: string;
  teamId: string;
  runnerId: string;
  nativeSessionId: string;
  deckSessionId: string;
  stateHome?: string;
}): readonly string[] {
  const diagnostics: string[] = [];
  if (!input.nativeSessionId || /[\0\r\n]/.test(input.nativeSessionId)) return ["Deck runtime native session id was invalid; resume-by-id continuity was not updated."];
  const key = nativeSessionMapKey(input.projectRoot, input.teamId, input.runnerId, input.nativeSessionId);
  if (!key) return ["Deck runtime native session continuity skipped because no verified project identity was available."];
  const path = sessionMapPath(input.stateHome);
  const map = readMap(path, diagnostics);
  map[key] = input.deckSessionId;
  writeMap(path, map, diagnostics);
  return diagnostics;
}

function sessionMapPath(stateHome?: string): string {
  return join(stateHome ?? process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "deck", "supermemory-sessions.json");
}

function sessionMapKey(projectRoot: string, teamId: string, runnerId: string): string | undefined {
  const scope = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });
  if (!scope.ok) return undefined;
  return createHash("sha256").update(JSON.stringify({ project: scope.scope, teamId, runnerId })).digest("hex");
}

function nativeSessionMapKey(projectRoot: string, teamId: string, runnerId: string, nativeSessionId: string): string | undefined {
  const scope = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });
  if (!scope.ok) return undefined;
  return createHash("sha256").update(JSON.stringify({ project: scope.scope, teamId, runnerId, nativeSessionId })).digest("hex");
}

function readMap(path: string, diagnostics: string[]): SessionMap {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string" && value.startsWith("deck-session-"))) as SessionMap;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") diagnostics.push(`Deck runtime session map could not be read; resume-latest will start a fresh top-level memory session. ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function writeMap(path: string, map: SessionMap, diagnostics: string[]): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    diagnostics.push(`Deck runtime session map could not be written; resume-latest continuity is unavailable. ${error instanceof Error ? error.message : String(error)}`);
  }
}
