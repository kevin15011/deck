/** Legacy opt-in acknowledgement command; retained for compatibility and never required to start a session. */
import type { DeckConfigStore } from "./deck-config-store";

export const CLAUDE_TOS_NOTICE = [
  "Deck cross-runner sessions drive the Claude Code CLI you already signed in to: Deck starts the unmodified `claude -p`",
  "as your OS user, on your machine, for your own work. Deck never reads or touches Claude credential files or OAuth",
  "tokens, never proxies authentication, never uses `--bare` or an API-key substitute, and offers no multi-user features.",
  "",
  "Residual risk: Anthropic has not confirmed whether an orchestrator spawning `claude -p` under a consumer",
  "subscription counts as ordinary individual use. Use this only for your own personal work, and check Anthropic's",
  "current terms if in doubt. This legacy acknowledgement is optional and does not affect session readiness.",
  "",
].join("\n");

export function isClaudeTosAcknowledged(store: Pick<DeckConfigStore, "read">): boolean {
  try { return Boolean(store.read().crossRunner?.claudeTosAcknowledgedAt); } catch { return false; }
}

/** Records the acknowledgement once; an existing one is kept. Returns the recorded timestamp. */
export function acknowledgeClaudeTos(store: Pick<DeckConfigStore, "read" | "write">, now: Date = new Date()): string {
  const existing = store.read().crossRunner?.claudeTosAcknowledgedAt;
  if (existing) return existing;
  const at = now.toISOString();
  store.write({ crossRunner: { claudeTosAcknowledgedAt: at } });
  return at;
}

export type AckClaudeTosOptions = {
  store: Pick<DeckConfigStore, "read" | "write">;
  yes: boolean;
  interactive: boolean;
  write: (text: string) => void;
  readLine: (prompt: string) => Promise<string>;
  now?: () => Date;
};

export async function runAckClaudeTos(options: AckClaudeTosOptions): Promise<number> {
  const { store, write } = options;
  const existing = (() => { try { return store.read().crossRunner?.claudeTosAcknowledgedAt; } catch { return undefined; } })();
  if (existing) { write(`Claude personal-use notice already acknowledged at ${existing}.\n`); return 0; }
  write(`${CLAUDE_TOS_NOTICE}\n`);
  if (!options.yes) {
    if (!options.interactive) {
      write("Not recording: run `deck session ack-claude-tos` in a terminal, or pass --yes to acknowledge non-interactively.\n");
      return 1;
    }
    const answer = (await options.readLine("Type \"yes\" to acknowledge: ")).trim().toLowerCase();
    if (answer !== "yes") { write("Not acknowledged.\n"); return 1; }
  }
  const at = acknowledgeClaudeTos(store, options.now?.());
  write(`Acknowledged at ${at}.\n`);
  return 0;
}
