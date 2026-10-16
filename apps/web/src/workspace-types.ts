import type { ApprovalSummary } from './session-approvals';
import type { LeadActivity } from './status-indicator';
import type { RunnerQualifiedAssignment } from '../../../packages/core/src/session/assignments';
export type Assignment = RunnerQualifiedAssignment;
export type Project = { projectId: string; path: string; name: string; createdAt: string; available: boolean };
export type WorkspaceSession = ApprovalSummary & {
    id?: string; sessionId?: string; projectId?: string; title?: string; projectRoot?: string; state?: string; changeId?: string; running?: boolean; createdAt?: string;
    lastSeq?: number; leadActivity?: LeadActivity; predecessorSessionId?: string; generation?: number; assignmentRevision?: number; currentLeadTaskId?: string;
    members?: Record<string, Assignment>; sharedWorkspace?: boolean; sharedActiveSessions?: number; released?: boolean; releasing?: boolean; removing?: boolean; preparationStatus?: Preparation['status'];
};
export type RunnerOption = { runnerId: string; label: string; available: boolean; reasonCode?: string; models: { modelId: string; label: string; thinkingLevels: string[] }[] };
export type Preparation = { status: 'unprepared' | 'preparing' | 'ready' | 'failed' | 'cancelled' | 'releasing'; generation: number; preparationId?: string; phase?: string; reasonCode?: string; checkedAt?: string };
export type WorkspaceMutation = (command: Record<string, unknown>, sessionId?: string) => Promise<any>;
export const sessionIdOf = (session: WorkspaceSession): string => session.sessionId ?? session.id ?? '';
export const sessionName = (session: WorkspaceSession): string => session.title ?? session.changeId ?? session.projectRoot?.split('/').pop() ?? sessionIdOf(session).slice(0, 12);
