# Project workflows

Deck connects an interactive runner with source-backed project workflows. The project workflow is explicit: official artifacts define durable change state, local skill discovery is bounded, and verification evidence determines whether a candidate is ready.

> **Audience:** Contributors and project teams using Deck for repository work.
> **Authority:** Workflow boundary; OpenSpec artifacts, source, tests, and active runner evidence are authoritative.
> **Maintainer:** Deck maintainers.
> **Evidence:** [OpenSpec configuration](../openspec/config.yaml), [CLI validator](../apps/cli/src/openspec-validate-command.ts), [skill-registry command](../apps/cli/src/skill-registry-command.ts), [architecture boundary](architecture.md), and [contributor procedure](../CONTRIBUTING.md).

## Official project state

For work that needs durable planning or an auditable lifecycle, use an active OpenSpec change under `openspec/changes/`. When that route is chosen, its proposal, specification, design, tasks, state, events, and approved lifecycle records define the change. Keep implementation evidence with the active change and preserve historical artifacts. A clear, low-risk delta can stay on the direct implementation route with focused evidence; it does not require every planning artifact.

Adaptive memory can recall context, but it is advisory. It cannot replace an OpenSpec requirement, task, design decision, registry entry, or current source/test evidence.

Validate the project registry with the parser-backed command:

```sh
deck openspec validate
deck openspec validate --json --root .
deck openspec validate --change change-id
```

Human output groups issues by change. JSON output is stable for automation. Exit status `0` means no validation errors, `1` means errors were found, and `2` means the command could not complete or the requested change was not found.

## Work route

The Developer Team chooses the smallest route that reduces the uncertainty or protected risk in the request:

1. Lead identifies the desired outcome and current evidence.
2. Investigate traces unfamiliar code or an unknown cause when needed.
3. Architect creates a Working Brief or Full SDD only when durable design warrants it.
4. Apply Fast or Apply Deep owns the complete implementation slice.
5. Setup repairs only missing or indeterminate readiness components.
6. Quality independently checks material risk, security, architecture, regression, or release readiness when justified.
7. The candidate is verified with focused and affected checks proportional to the change.

Onboard and Archive are separate lifecycle skills. Browse the full role and skill inventories in [Developer Team](developer-team.md) and [Skills](skills.md).

## Local skill discovery

The skill registry is a local discovery index. It is not a runtime rules catalog, a prompt source, or an authority record. Read-only validation and discovery do not write the registry. Refresh is a separate explicit operation and is bounded to the active runner.

```sh
deck skill-registry validate --runner pi --json
deck skill-registry discover --runner opencode --root .
deck skill-registry refresh --runner opencode
```

Use `validate` to inspect readiness, `discover` to receive bounded candidate observations and locators, and `refresh` only when the caller is authorized for the exact write scope. Incomplete or truncated source evaluation fails closed for persistence rather than producing a partial registry that looks complete.

## Contributor checks

From a checkout, use the smallest affected check first:

```sh
bun install
bun test tests/documentation-governance.test.ts
bunx tsc --noEmit
```

The repository-wide suite is available through the root `test` script. Follow [Contributing](../CONTRIBUTING.md) for the verification tiers and [Architecture](architecture.md) for stable package boundaries.

## Boundaries to keep visible

- Pi and OpenCode adapter behavior is runner-specific even when the product capability is shared.
- Project-local skills are not bundled external skills.
- Generated content and build metadata have generator-owned boundaries.
- Metrics and adaptive memory can inform work but do not authorize effects.
- A successful source build or release gate is not proof that an automatic runtime cohort may expand.
