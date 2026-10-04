/**
 * Process-local handoff of the memory loopback coordinates between Deck extensions that share one Pi process.
 * `deck-memory` publishes the endpoint and the token-FILE path (never the bearer token) before it scrubs the
 * environment, so `deck-subagents` can forward them explicitly to children without leaving them in `process.env`.
 */
export type MemoryHandoff = Readonly<{ endpoint?: string; tokenFile?: string }>;

const KEY = Symbol.for("deck.pi.memory-handoff");
type Store = { [KEY]?: MemoryHandoff };

export function publishMemoryHandoff(handoff: MemoryHandoff): void {
  (globalThis as Store)[KEY] = Object.freeze({ ...handoff });
}

export function readPublishedMemoryHandoff(): MemoryHandoff | undefined {
  return (globalThis as Store)[KEY];
}

export function clearPublishedMemoryHandoff(): void {
  delete (globalThis as Store)[KEY];
}

/** Explicit launch coordinates first; reuse a scrubbed handoff only for its surviving matching endpoint. */
export function resolveMemoryHandoff(env: Readonly<Record<string, string | undefined>>): MemoryHandoff | undefined {
  if (env.DECK_PI_MEMORY === "disabled") return undefined;
  const endpoint = env.DECK_RUNNER_MEMORY_ENDPOINT?.trim();
  const tokenFile = env.DECK_RUNNER_MEMORY_TOKEN_FILE?.trim();
  // An explicit token-file field, even empty/undefined, is a new launch handoff.
  // Never complete partial replacement coordinates with a previous bridge.
  if (Object.prototype.hasOwnProperty.call(env, "DECK_RUNNER_MEMORY_TOKEN_FILE")) {
    return endpoint && tokenFile ? { endpoint, tokenFile } : undefined;
  }
  // Memory scrubs the file coordinate but leaves the endpoint. Only that exact
  // surviving endpoint can reuse the process-local file path on resource reload.
  const published = readPublishedMemoryHandoff();
  return endpoint && endpoint === published?.endpoint && published.tokenFile ? published : undefined;
}
