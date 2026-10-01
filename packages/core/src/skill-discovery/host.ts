import type {
  SkillCandidateQueryV1,
  SkillCandidateSearchResultV1,
  SkillLoadOutcomeV1,
  SkillLoadPreparationResultV1,
  SkillSelectionResultV1,
} from "./contracts";

/** Opaque, host-minted binding; callers cannot supply path, runner, or project authority. */
export interface TaskSkillDiscoveryBindingV1 {
  readonly schema: "task-skill-discovery-binding-v1";
  readonly binding_id: string;
}

export type TaskSkillDiscoveryPrepareResultV1 = Readonly<{
  selection: SkillSelectionResultV1;
  preparation: SkillLoadPreparationResultV1;
}>;

export interface TaskSkillDiscoveryHostV1 {
  readonly schema: "task-skill-discovery-host-v1";
  open(input: { readonly session_id: string; readonly task_id: string }): Promise<TaskSkillDiscoveryBindingV1>;
  search(binding: TaskSkillDiscoveryBindingV1, query: SkillCandidateQueryV1): Promise<SkillCandidateSearchResultV1>;
  prepare(binding: TaskSkillDiscoveryBindingV1, input: { readonly observation_id: string }): Promise<TaskSkillDiscoveryPrepareResultV1>;
  beforeNativeLoad(binding: TaskSkillDiscoveryBindingV1, input: { readonly call_id: string; readonly name: string }): Promise<{ readonly outcome: "armed" | "unprepared" | "ambiguous" | "unsupported" | "rejected" }>;
  observeNativeLoad(binding: TaskSkillDiscoveryBindingV1, input: { readonly call_id: string; readonly name: string; readonly directory?: string; readonly failed?: boolean }): Promise<SkillLoadOutcomeV1>;
  getOutcome(binding: TaskSkillDiscoveryBindingV1): SkillLoadOutcomeV1;
  retire(binding: TaskSkillDiscoveryBindingV1): void;
  dispose(): void;
}
