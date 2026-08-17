# Exploration: Adaptive Memory Project Isolation and Automatic Recall

## Question

Why could a runner in another repository use Deck's Supermemory scope, and did that invocation prove Automatic Runtime Recall?

## Finding

It did not prove Automatic Runtime Recall. The observed call was agent-initiated raw MCP. Deck had materialized Supermemory MCP in global runner configuration with Deck's diagnostic `x-sm-project`; that stale entry remained available across repositories while the MCP tool still accepted a model-controlled `containerTag`.

The Deck-supervised Runtime already owned a server-bound canonical scope, but adjacent authority gaps existed in ambient Git/project-root handling, stale-entry recognition, trusted bundle composition, and aggregate recall evidence. The repair therefore keeps Automatic Recall inside Deck Runtime and fails closed by removing raw project-selectable MCP exposure.

## Evidence boundary

Repository source, tests, archived canonical Supermemory requirements, hermetic reproductions, and current runner lifecycle composition were authoritative. Adaptive Memory recall was advisory and did not define the change.
