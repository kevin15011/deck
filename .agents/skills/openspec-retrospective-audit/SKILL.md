---
name: openspec-retrospective-audit
description: "Review Deck OpenSpec sessions for evidence-backed improvement opportunities without modifying repository files."
disable-model-invocation: true
user-invocable: true
license: MIT
metadata:
  author: deck-internal
  scope: local-project
---

# OpenSpec Retrospective Audit

> **Audience:** Project-local agents auditing Deck's OpenSpec history.
> **Authority:** thin read-only audit wrapper; [OpenSpec configuration](../../../openspec/config.yaml) and [registry schema](../../../openspec/registry-schema.md) own lifecycle and registry policy.
> **Maintainer:** Deck maintainers.
> **Evidence:** [OpenSpec configuration](../../../openspec/config.yaml), [registry schema](../../../openspec/registry-schema.md), and change artifacts under `openspec/changes/` and `openspec/archive/`.

## Trigger

Use for an OpenSpec retrospective, a review of recent changes, a failure-focused audit, or a request to identify evidence-backed process improvements.

## Scope and safety

This is a project-local, read-only skill. Read only the artifacts needed for the requested audit. Preserve the distinction between official OpenSpec evidence and advisory memory. Do not modify repository files, change artifacts, prompts, skills, agents, or runtime behavior during an audit.

## Evidence

State the audited scope and separate evidence from inference. Cite the relevant change artifact and classify recommendations as a direct fix, an SDD candidate, further investigation, or no action. Use [OpenSpec configuration](../../../openspec/config.yaml) and the [registry schema](../../../openspec/registry-schema.md) for detailed procedure and policy.
