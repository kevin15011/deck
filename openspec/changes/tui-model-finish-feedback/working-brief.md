# Model configuration Finish feedback

## Problem and acceptance

Finish currently awaits model validation/materialization without activity feedback. applyDeveloperTeamModelConfig returns no success status, records failures in a different result list, and callers continue navigation regardless. Exceptions before its inner apply try can reach only the input handler's debug catch. Show saving activity promptly, prevent duplicate submissions/conflicting input while saving, keep failures visible beside the model configuration and preserve selections for retry. Advance only after successful completion.

## Boundaries

Preserve existing runtime-specific write/staging semantics: Codex dashboard stages assignments; current Pi/OpenCode/Claude dashboard paths apply configuration. Do not redesign installation authorization, model discovery, or runner contracts. Use the pending shared ActivityIndicator. Preserve rollback behavior and do not hide rollback failures. Lead owns OpenSpec; Apply Fast owns input/operation/screen/test slice.

## Evidence and validation

Parent graph generation2026-08-20 is stale; coverage reports metadatachanged app/screens and excluded tests. Current source read directly at Finish/apply/input/render. Real Ink regression demonstrated RED before implementation. GREEN:39 focused tests,251 assertions across synthetic app and developer-team screens. Coverage includes held validation and visible saving, duplicate/conflicting input suppression, invalid/rejected validation, verification diagnostics, and successful retry. Independent Quality findings were fixed: preserve verifier diagnostics, clear errors on fresh workflow entry, and correct diagnostic variable scope. Final scoped review passed; TypeScript and git diff --check passed. Rebuilt and installed canary from the current worktree.

Existing Claude rollback can fail to fully restore model metadata after a synthetic verification failure. This UI repair reports incomplete rollback explicitly and does not redesign that adapter's transaction semantics. No full real installation was repeated and no commit was made.
