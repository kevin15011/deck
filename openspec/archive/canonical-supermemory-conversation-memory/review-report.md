# Review Report: Canonical Supermemory Conversation Memory

## Verdict

GO.

## Review summary

The final candidate establishes Deck as the lifecycle, scope, security, budget, permission, and observability authority while leaving extraction, learning, graph relationships, temporal updates, supersession, ranking, and forgetting to Supermemory. It removes Engram and provider selection, preserves the standalone installer experience, and implements automatic memory above runner-specific serializers rather than relying on voluntary MCP calls.

Earlier candidates were rejected for raw output capture, credential routing, missing runner hooks, unsafe advisory framing, incomplete context bounds, replay behavior, and standalone hook dependencies. Each confirmed finding received regression coverage before the final GO.

Post-review real-install testing found additional readiness-state propagation, API-key persistence, retrieval-order, and debug-diagnostic gating defects. Each defect received a focused regression test and the final candidate passed the full 4,627-test repository suite. The actual OpenCode Review & Install flow then completed successfully; installed-state inspection and authenticated live canary recall passed.

## Release posture

- Safe to proceed to normal maintainer approval and archive workflow.
- The completed candidate was committed locally as `cb3d267`; no push, remote deletion, remote legacy copy, or release publication was performed.
- Residual limitations are documented in `verify-report.md` and do not create false capability claims.
