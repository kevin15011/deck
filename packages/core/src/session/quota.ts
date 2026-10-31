/** Browser-safe subscription quota contract. Times are epoch milliseconds. */
export type QuotaRunner = 'claude' | 'codex';
export type QuotaWindow = { id: 'five-hour' | 'seven-day'; usedPercent: number; resetsAt?: number };
export type QuotaSnapshot = { runnerId: QuotaRunner; updatedAt: number; windows: QuotaWindow[]; plan?: string; overageStatus?: string };
export type QuotaView = { snapshot?: QuotaSnapshot; refreshAfter: number; refreshing: boolean };
export type QuotaState = { runners: Record<QuotaRunner, QuotaView> };
