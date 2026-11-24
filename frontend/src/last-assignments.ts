import type {MemberAssignment} from './api';

type Runner = {runnerId: string; available: boolean; models: {modelId: string; thinkingLevels: string[]}[]};

export const lastAssignmentsKey = 'session.last-assignments';

// The most recent member assignments, kept only where the current inventory
// still offers that runner, model and reasoning level. Without a usable Lead
// the caller falls back to its default.
export function restoreAssignments(saved: string, runners: Runner[]): Record<string, MemberAssignment> | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(saved); } catch { return undefined; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const members: Record<string, MemberAssignment> = {};
  for (const [member, value] of Object.entries(parsed as Record<string, unknown>)) {
    const v = value as Partial<MemberAssignment> | null;
    if (!v || typeof v.runnerId !== 'string' || typeof v.modelId !== 'string') continue;
    const model = runners.find(r => r.available && r.runnerId === v.runnerId)?.models.find(m => m.modelId === v.modelId);
    if (!model) continue;
    members[member] = {runnerId: v.runnerId, modelId: v.modelId,
      ...(typeof v.thinking === 'string' && model.thinkingLevels.includes(v.thinking) ? {thinking: v.thinking} : {})};
  }
  return members.lead ? members : undefined;
}

export function mergeAssignments(saved: string, member: string, value: MemberAssignment): string {
  let current: Record<string, unknown> = {};
  try { const parsed = JSON.parse(saved); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed; } catch { /* start fresh */ }
  return JSON.stringify({...current, [member]: value});
}
