import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export function readExplicitPiCapabilities(environment: Readonly<Record<string, string | undefined>> = process.env): { codebase: boolean; search: boolean; provider?: string } {
  try {
    const raw = JSON.parse(readFileSync(join(environment.XDG_CONFIG_HOME ?? join(environment.HOME ?? '', '.config'), 'deck/config.json'), 'utf8'));
    const intent = raw.capabilities?.['codebase-memory'];
    return { codebase: (typeof intent?.runners?.pi === 'boolean' ? intent.runners.pi : intent?.enabled) === true,
      search: raw.webSearch?.enabled === true, provider: raw.webSearch?.provider };
  } catch { return { codebase: false, search: false }; }
}
