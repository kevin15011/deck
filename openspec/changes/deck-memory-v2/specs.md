# Memory integration requirements

## Native provider ownership

Deck MUST compose supported official Supermemory plugins and MUST NOT add semantic capture eligibility, role exclusion or post-retrieval relevance filtering. It MUST NOT duplicate native automatic capture or remote injection for the same event range.

Scenario: Given an enabled project and a supported plugin, when a short correction is exchanged by any participating role, then Deck SHALL allow the plugin's supported automatic capture path without a Deck importance classifier or a required manual tool call.

## Cross-runner continuity

Deck MUST preserve applicable project memory across runner changes. Native and cross-runner launch paths MUST bind the same verified project consistently and preserve actual native capture/recall callbacks.

Scenario: Given accepted work from Codex in a project, when OpenCode receives a subsequent task in that project, then its native plugin SHALL be able to retrieve that work after provider processing without exclusion solely by source runner or role.

Scenario: Given remote processing is pending, when the next authorized agent starts or resumes, then relevant ordered local session continuity SHALL remain available without waiting for remote extraction. This SHALL be identified as local evidence, not remote recall success.

## Honest delivery and lifecycle

Deck MUST distinguish local capture, native callback completion, provider acceptance and processing readiness. It MUST NOT claim complete coverage when the plugin omits source types. Genuine transport/context limits MUST be visible and handled without silent arbitrary truncation. Complementary functionality MUST address a documented gap and avoid overlapping writers.

Scenario: Given a native request fails or acceptance is uncertain, when the task ends, then Deck SHALL preserve truthful pending/failure evidence and MUST NOT advance a capture receipt as successful or blindly replay an ambiguous append.

## Compatibility and disable

Deck MUST preserve current tool/skill/runner contracts, credential exclusion, selected account permissions and official-source authority. The official Codex hosted tool channel MAY access namespaces permitted by the selected account credential, as explicitly authorized by the user. Automatic capture MUST preserve the verified project identity across runners. Memory-disabled operation MUST make no new provider calls. Existing namespace data MUST NOT be deleted by migration, rollback or evaluation cleanup without applicable authorization.

Scenario: Given memory is disabled, when a native or cross-runner task starts, then ordinary tools, history and OpenSpec access SHALL continue without Supermemory reads/writes.

## Project organization with broader access

Deck MUST expose the current verified project identity for native memory operations. Project-specific capture and explicit writes SHALL target the current project's supported namespace, while intentionally shared records may use the appropriate shared space. Project-specific consultation SHALL prefer an explicitly scoped current-project query using supported provider controls, without forbidding broader queries or applying a Deck semantic result filter. Deck MUST NOT claim project-first ranking for an unscoped hosted query or silently change the account's shared active space to simulate per-session state. Distinguish agent guidance from deterministic routing in implementation and verification evidence.

Scenario: Given two projects and a shared space, when an agent works on project A, then automatic capture remains attributed to A and project-specific consultation uses A's identity; relevant knowledge in other authorized spaces remains accessible. Access to those spaces does not authorize relabeling their contents as project A evidence.

## Outcome gate

The redesigned integration MUST be compared with normal Deck before a value verdict. Extraction-sensitive cases MUST have at least three independent repetitions. Local continuity and remote benefit MUST be distinguishable. Successful API calls alone MUST NOT justify retaining Supermemory.
