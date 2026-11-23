/** Browser-safe subscription quota contract. Times are epoch milliseconds. */
export type QuotaRunner = 'claude' | 'codex';
export type QuotaWindow = { id: 'five-hour' | 'seven-day' | 'seven-day-oauth-apps' | 'seven-day-opus' | 'seven-day-sonnet' | `model:${string}`; usedPercent: number; resetsAt?: number };
export type QuotaSnapshot = { runnerId: QuotaRunner; updatedAt: number; windows: QuotaWindow[]; plan?: string; overageStatus?: string };
export type QuotaView = { supported?: boolean; error?: string; snapshot?: QuotaSnapshot; refreshAfter: number; refreshing: boolean };
export type QuotaState = { runners: Record<QuotaRunner, QuotaView> };
