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

/** Published handoff first; otherwise the (unscrubbed) environment, for sessions where `deck-memory` is absent. */
export function resolveMemoryHandoff(env: Readonly<Record<string, string | undefined>>): MemoryHandoff | undefined {
  const published = readPublishedMemoryHandoff();
  if (published?.endpoint && published.tokenFile) return published;
  const endpoint = env.DECK_RUNNER_MEMORY_ENDPOINT?.trim();
  const tokenFile = env.DECK_RUNNER_MEMORY_TOKEN_FILE?.trim();
  return endpoint && tokenFile ? { endpoint, tokenFile } : undefined;
}
