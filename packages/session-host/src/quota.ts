import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { SessionEvent } from '@deck/core/session/events';
import type { QuotaRunner, QuotaSnapshot, QuotaState, QuotaWindow } from '@deck/core/session/quota';
export type QuotaRefresh = (runner: QuotaRunner, signal: AbortSignal) => Promise<unknown>;
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const reset = (value: unknown): number | undefined => finite(value) && value > 0 && value * 1000 <= 8.64e15 ? value * 1000 : undefined;
const status = (value: unknown): string | undefined => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,39}$/i.test(value) ? value : undefined;
/** Deliberate allowlist: native account IDs, credits and raw payloads never cross this boundary. */
export function quotaSnapshot(runnerId: QuotaRunner, input: unknown, updatedAt: number): QuotaSnapshot {
  const data = obj(input), windows: QuotaWindow[] = [];
  const add = (id: QuotaWindow['id'], used: unknown, resetsAt: unknown) => {
    if (!finite(used) || used < 0 || used > 100 || windows.some(w => w.id === id)) return;
    const at = reset(resetsAt);
    windows.push({ id, usedPercent: Math.round(used * 10) / 10, ...(at ? { resetsAt: at } : {}) });
  };
  if (runnerId === 'codex') {
    for (const key of ['primary', 'secondary']) {
      const window = obj(data[key]);
      if (window.windowDurationMins === 300) add('five-hour', window.usedPercent, window.resetsAt);
      if (window.windowDurationMins === 10080) add('seven-day', window.usedPercent, window.resetsAt);
    }
  } else {
    const unified = obj(data.unifiedWindows);
    for (const [key, id] of [['five_hour', 'five-hour'], ['seven_day', 'seven-day']] as const) {
      const window = obj(unified[key]);
      add(id, finite(window.utilization) ? window.utilization * 100 : undefined, window.resetsAt);
    }
    // Older Claude versions report only the active window.
    if (!windows.length && ['five_hour','seven_day'].includes(String(data.rateLimitType)))
      add(data.rateLimitType === 'five_hour' ? 'five-hour' : 'seven-day', finite(data.utilization) ? data.utilization * 100 : undefined, data.resetsAt);
  }
  const plan = runnerId === 'codex' ? status(data.planType) : undefined;
  const overageStatus = runnerId === 'claude' ? status(data.overageStatus) : undefined;
  return { runnerId, updatedAt, windows, ...(plan ? { plan } : {}), ...(overageStatus ? { overageStatus } : {}) };
}
/** Retain sequence/cursor continuity without native quota secrets on browser event feeds. */
export function quotaEventForWeb(event: SessionEvent): SessionEvent {
  if (event.kind !== 'rate-limit') return event;
  const { raw: _raw, ...canonical } = event;
  const runner = event.source.runnerId ?? event.raw?.runnerId;
  return { ...canonical, data: runner === 'claude' || runner === 'codex' ? { ...quotaSnapshot(runner, event.data, Date.parse(event.ts)) } : {} };
}
export class QuotaStore {
  private readonly snapshots = new Map<QuotaRunner, QuotaSnapshot>();
  private readonly after = new Map<QuotaRunner, number>();
  private readonly busy = new Set<QuotaRunner>();
  private readonly abort = new AbortController();
  private readonly now: () => number;
  constructor(private readonly options: { refresh?: QuotaRefresh; now?: () => number }) { this.now = options.now ?? Date.now; }
  observe(event: SessionEvent): void {
    if (event.kind !== 'rate-limit') return;
    const runner = event.source?.runnerId ?? event.raw?.runnerId;
    if (runner !== 'claude' && runner !== 'codex') return;
    const ts = Date.parse(event.ts);
    if (!Number.isFinite(ts) || ts < (this.snapshots.get(runner)?.updatedAt ?? -Infinity)) return;
    // Historical Claude events dropped unifiedWindows; read only that native info,
    // then run it through the same browser-safe allowlist.
    const historical = runner === 'claude' ? obj(obj(event.raw?.payload).rate_limit_info) : {};
    this.snapshots.set(runner, quotaSnapshot(runner, { ...historical, ...event.data }, ts));
  }
  async seed(sessionsDir: string): Promise<void> {
    // Stream each segment, retaining two snapshots, never entire session histories.
    for (const session of await readdir(sessionsDir, { withFileTypes: true }).catch(() => [])) {
      if (!session.isDirectory()) continue;
      const dir = join(sessionsDir, session.name, 'events');
      for (const file of (await readdir(dir).catch(() => [])).filter(f => /^\d{6}\.jsonl$/.test(f)).sort()) {
        const lines = createInterface({ input: createReadStream(join(dir, file)), crlfDelay: Infinity });
        try { for await (const line of lines) {
          if (!line.includes('"rate-limit"')) continue;
          try { this.observe(JSON.parse(line)); } catch { /* Damaged tail or version drift. */ }
        } } catch { /* One unreadable ledger must not disable other snapshots. */ }
        finally { lines.close(); }
      }
    }
  }
  read(): QuotaState {
    const view = (runner: QuotaRunner) => ({ ...(this.snapshots.has(runner) ? { snapshot: structuredClone(this.snapshots.get(runner)!) } : {}), refreshAfter: this.after.get(runner) ?? 0, refreshing: this.busy.has(runner) });
    return { runners: { claude: view('claude'), codex: view('codex') } };
  }
  async refresh(runner: QuotaRunner): Promise<{ok:boolean;code?:string;message?:string;state:QuotaState}> {
    const result = (ok: boolean, code?: string, message?: string) => ({ ok, ...(code ? { code, message } : {}), state: this.read() });
    if (!this.options.refresh || this.abort.signal.aborted) return result(false, 'quota-unavailable', 'Quota refresh is unavailable.');
    if (this.busy.has(runner) || this.now() < (this.after.get(runner) ?? 0)) return result(false, 'quota-cooldown', 'Wait a minute between quota refreshes.');
    this.after.set(runner, this.now() + 60_000); this.busy.add(runner);
    let code: string | undefined;
    try {
      const data = await this.options.refresh(runner, this.abort.signal);
      if (data === undefined) code = 'quota-no-data';
      else if (!this.abort.signal.aborted) this.snapshots.set(runner, quotaSnapshot(runner, data, this.now()));
      else code = 'quota-unavailable';
    } catch { code = 'quota-refresh-failed'; }
    finally { this.busy.delete(runner); }
    return code ? result(false, code, code === 'quota-no-data' ? 'No quota event arrived. Previous snapshot kept.' : 'Could not refresh quota. Previous snapshot kept.') : result(true);
  }
  get refreshing(): boolean { return this.busy.size > 0; }
  close(): void { this.abort.abort(); }
}
