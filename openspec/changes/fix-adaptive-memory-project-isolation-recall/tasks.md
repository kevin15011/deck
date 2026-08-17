# Tasks: Adaptive Memory Project Isolation and Automatic Recall Evidence

1. **Identity and authority**
   1.1 Add failing tests for verified Git roots, A/B isolation, prompt inertness, resume, new-session recomputation, and missing-identity fail-closed behavior.
   1.2 Harden project-root and canonical-scope resolution without ambient or Deck fallbacks.
   1.3 Bind one immutable identity across runtime recall and capture; reject caller scope fields and stale bundles.

2. **MCP boundary**
   2.1 Add failing tests proving model-selected `containerTag` cannot escape project scope.
   2.2 Stop Deck-managed raw Supermemory MCP materialization on supported runners.
   2.3 Retire exact stale Deck-managed global entries idempotently and diagnose ambiguous external entries without modifying them.

3. **Automatic Recall and observability**
   3.1 Add failing lifecycle tests proving eligible recall completes before agent task processing with MCP count zero.
   3.2 Add the Quick Fix skip case with runtime and MCP counts zero.
   3.3 Emit redacted metadata that distinguishes runtime recall outcomes from observable or external-unobservable MCP activity.

4. **Verification**
   4.1 Run focused identity, runtime-host, runner-hook, MCP materialization, and observability tests.
   4.2 Run type checking and the relevant broader suite with no live Supermemory effects.
   4.3 Obtain independent Quality review and record GO/NO-GO.
