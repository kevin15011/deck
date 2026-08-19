# Exploration: Expose Managed Project Memory Recall

## Diagnosis

Automatic Capture, canonical scope, provider persistence, and OpenCode system-transform delivery are functional. Broad Automatic Recall is deliberately limited and can omit a requested prior decision when the same project contains several semantically similar valid memories. Focused runtime `explicit_recall` finds the omitted decision, but OpenCode has no model-visible managed recall surface and falls back to local repository tools.

## Selected seam

The existing OpenCode execution plugin and authenticated Deck Runtime loopback are the smallest authoritative seam. A conditional custom tool can reuse them without adding raw provider MCP, model-selectable scope, another runtime, or query rewriting.

## Risk boundary

The tool is an untrusted model-input boundary. Query shape, byte size, controls, sensitive material, output envelope, rate, observability, and managed-only availability require validation and protected tests.
