/** Deck-owned OpenCode plugin. Discover runner variants without blocking plugin initialization. */
import { mkdirSync, renameSync, unlinkSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

type Model = { id?: string; variants?: Record<string, { disabled?: boolean }>; thinking_levels?: string[] };
type Provider = { id: string; models: Record<string, Model> };
type Input = { client: { provider: { list(options: { signal: AbortSignal }): Promise<{ data?: { all: Provider[] } }> } } };

export default async function DeckModelVariants({ client }: Input) {
  const controller = new AbortController();
  const cacheDir = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'deck', 'opencode');
  let pending: Promise<void> | undefined;
  let disposed = false;
  const refresh = async () => {
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const result = await client.provider.list({ signal: controller.signal });
      if (disposed || controller.signal.aborted || !result.data) return;
      const providers: Record<string, Record<string, string[]>> = Object.create(null);
      for (const provider of result.data.all) {
        const models: Record<string, string[]> = Object.create(null);
        for (const [key, model] of Object.entries(provider.models)) {
          const variants = model.variants
            ? Object.entries(model.variants).filter(([, value]) => !value.disabled).map(([name]) => name)
            : model.thinking_levels ?? [];
          if (variants.length) models[model.id ?? key] = [...new Set(variants)];
        }
        if (Object.keys(models).length) providers[provider.id] = models;
      }
      mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
      const path = join(cacheDir, 'model-variants.json');
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, runner: 'opencode', generatedAt: new Date().toISOString(), providers }), { flag: 'wx', mode: 0o600 });
        renameSync(temporary, path);
      } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    } catch { /* Optional cache enrichment must not prevent native startup. */ }
    finally { clearTimeout(timeout); }
  };
  return {
    config: async () => {
      // provider.list may itself wait for Plugin.init: never await it from a startup hook.
      if (!disposed && !pending) pending = refresh();
    },
    dispose: async () => { disposed = true; controller.abort(); },
  };
}
