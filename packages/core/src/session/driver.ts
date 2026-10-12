/** RunnerSessionDriver contract (XR-4.1, D-6). Types only: no implementation in S0. */
import type { DriverProtocol } from "./events";
import type { RunnerQualifiedAssignment } from "./assignments";
import type { ChildMcpSet } from "./mcp";

export type DriverProbeContext = { executablePath?: string; cwd: string };
export type DriverProbe = {
  version?: string;
  status: "ready" | "degraded" | "blocked";
  reasonCode?: string;
  capabilities: readonly string[];
  mcpIsolationVerified?: boolean;
};

export type DriverTaskInput = {
  taskId: string; memberId: string; cwd: string; assignment: RunnerQualifiedAssignment;
  rolePrompt: string; prompt: string; resume?: { nativeSessionId: string };
  mcp: ChildMcpSet; approvals: "relay" | "runner-default"; credentialFile: string;
  disableNativeDelegation: boolean;
};

export type DriverApprovalRequest = { approvalId: string; tool: string; summary?: string; input?: unknown };
export type DriverDecision = { decision: "allow" | "deny"; updatedInput?: unknown };
export type DriverEvent = { kind: string; data: Record<string, unknown>; raw?: unknown };
export type SupervisedSpawn = (command: string, args: readonly string[], options?: { cwd?: string; env?: Record<string, string> }) => Promise<unknown>;

export type DriverHostIo = {
  spawn: SupervisedSpawn;
  emit(e: DriverEvent): void;
  approval(req: DriverApprovalRequest): Promise<DriverDecision>;
};

export type TurnOutcome = { status: "completed" | "interrupted" | "interrupted-forced" | "failed"; error?: string };

export type DriverTaskHandle = {
  nativeSessionId: Promise<string>;
  send(prompt: string): Promise<void>;
  interrupt(): Promise<void>;
  done: Promise<TurnOutcome>;
  close(): Promise<void>;
};

export interface RunnerSessionDriver {
  readonly runnerId: string;
  readonly protocol: DriverProtocol;
  readonly testedVersions: { min: string; maxTested: string };
  probe(ctx: DriverProbeContext): Promise<DriverProbe>;
  startTask(input: DriverTaskInput, io: DriverHostIo): Promise<DriverTaskHandle>;
}
