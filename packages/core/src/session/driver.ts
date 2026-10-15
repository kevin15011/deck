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

/** Launch spec of one MCP server of a child. Secrets are file paths in `env`, never values. */
export type ChildMcpServerSpec =
  | { transport?: "stdio"; command: string; args: readonly string[]; env: Readonly<Record<string, string>> }
  | { transport: "http"; url: string; /** Header name to environment variable NAME; never a resolved credential. */ envHttpHeaders?: Readonly<Record<string, string>> };

/** Prepared by the CLI composition after native artifact, profile and canonical scope checks.
 * Contains no credential values. Credentials travel only through the private spawn environment.
 */
export type NativeMemoryDescriptor = {
  provider: "supermemory";
  integration: "runner-plugin";
  status: "ready" | "disabled" | "unavailable";
  reasonCode?: string;
  /** Explicit global mode omits all provider container tags. Absence still requires a canonical project scope. */
  scopeMode?: "global";
  projectScope?: string;
  /** Native hook activation is support evidence, not proof of provider success. */
  automaticRecall?: "native-hook";
  /** Managed native lifecycle may not report or await background persistence. */
  automaticCapture?: "unverified";
  plugin?: {
    root: string;
    hookConfigPath?: string;
    exclusiveHookEvents?: readonly string[];
    hooks?: Readonly<Record<string, unknown>>;
    scripts?: { recall: string; flush: string };
    nodeCommand?: string;
    loaderPath?: string;
    mcpServers?: Readonly<Record<string, ChildMcpServerSpec>>;
  };
};

/** Host-validated managed files, supplied as native structured image input. */
export type DriverImageInput = { path: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; name: string };

export type DriverTaskInput = {
  taskId: string; memberId: string; cwd: string; assignment: RunnerQualifiedAssignment;
  rolePrompt: string; prompt: string; images?: readonly DriverImageInput[]; resume?: { nativeSessionId: string };
  /** Caller-assigned native session id for a fresh native session; set only for drivers that expose `newNativeSessionId`. */
  nativeSessionId?: string;
  mcp: ChildMcpSet;
  /** Launch spec for every id in `mcp.servers` (the Deck session server included). */
  mcpServerSpecs: Readonly<Record<string, ChildMcpServerSpec>>;
  nativeMemory?: NativeMemoryDescriptor;
  approvals: "relay" | "runner-default"; credentialFile: string;
  disableNativeDelegation: boolean;
};

export type DriverApprovalRequest = { approvalId: string; tool: string; summary?: string; input?: unknown };
export type DriverDecision = { decision: "allow" | "deny"; updatedInput?: unknown };
export type DriverEvent = { kind: string; data: Record<string, unknown>; raw?: unknown };
export type SupervisedChildExit = {
  /** True only for a clean code-0 exit whose output streams fully drained. */
  ok: boolean; code: number | null; signal: string | null; drained: boolean; error?: string;
  /** The containing anchor ended without reporting the child's exit. */
  anchorLost: boolean;
};

/** A child running behind the host's process-group anchor (D-7). Drivers use only this surface. */
export type SupervisedChild = {
  readonly ready: Promise<{ workerPid: number }>;
  writeStdin(text: string): void;
  endStdin(): void;
  /** Text chunks (UTF-8 decoded). Attach right after spawn. */
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  /** SIGINT to the CLI process only. False when the anchor is unreachable. */
  interrupt(): boolean;
  /** Group TERM, then KILL after `graceMs`. */
  terminateGroup(graceMs?: number): Promise<void>;
  readonly exited: Promise<SupervisedChildExit>;
};

export type SupervisedSpawn = (command: string, args: readonly string[], options?: { cwd?: string; env?: Record<string, string> }) => Promise<SupervisedChild>;

export type DriverHostIo = {
  spawn: SupervisedSpawn;
  emit(e: DriverEvent): void;
  approval(req: DriverApprovalRequest): Promise<DriverDecision>;
  /** Write a 0600 file into the task's private directory; returns its absolute path. Secrets never go to argv. */
  writePrivateFile(name: string, content: string): string;
};

export type TurnOutcome = { status: "completed" | "interrupted" | "interrupted-forced" | "failed"; error?: string; reasonCode?: "native-session-not-found" };

export type DriverTaskHandle = {
  nativeSessionId: Promise<string>;
  /** Run a follow-up turn on the same native session; resolves with that turn's outcome. */
  send(prompt: string, images?: readonly DriverImageInput[]): Promise<TurnOutcome>;
  interrupt(): Promise<void>;
  /** Outcome of the turn started by `startTask`. */
  done: Promise<TurnOutcome>;
  close(): Promise<void>;
};

export interface RunnerSessionDriver {
  readonly runnerId: string;
  readonly protocol: DriverProtocol;
  readonly testedVersions: { min: string; maxTested: string };
  /** Present when the runner lets the caller assign the native session id (Claude `--session-id`): the host persists it before spawn (XR-4.5). */
  newNativeSessionId?(): string;
  probe(ctx: DriverProbeContext): Promise<DriverProbe>;
  startTask(input: DriverTaskInput, io: DriverHostIo): Promise<DriverTaskHandle>;
}
