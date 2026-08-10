---
name: deck-release-publish
description: Prepare, verify, and publish Deck releases through the repository's canonical release workflow and explicit safety gates.
---

# Skill: deck-release-publish

> **Audience:** Project-local agents preparing a Deck release.
> **Authority:** thin invocation and safety wrapper; [release guidance](../../../docs/maintainers/releasing.md) and executable release sources own procedure.
> **Maintainer:** Deck maintainers.
> **Evidence:** [release guidance](../../../docs/maintainers/releasing.md), [release workflow](../../../.github/workflows/release.yml), and [release helper](../../../scripts/prepare-release.ts).

## Trigger

Use when a user asks to publish a release, bump a release version, tag and release, or deploy a release.

## Safety gates

- Inspect the working tree and release scope before acting.
- Use the root [package metadata](../../../package.json) as the product-version authority.
- Run the verification selected by [release guidance](../../../docs/maintainers/releasing.md).
- Do not create tags, push commits, or publish releases without explicit confirmation in a new user message.
- For destructive Git operations, use the canonical Git-discard confirmation workflow; never bypass it.

## Evidence and handoff

Report completed checks, pending confirmation-gated actions, and blockers. Delegate detailed release preparation, descriptor handling, rollback, and workflow behavior to [release guidance](../../../docs/maintainers/releasing.md).
