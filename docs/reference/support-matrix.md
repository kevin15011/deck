# Support matrix

Support labels are scoped to a surface. “Supported” for one capability does not imply universal runner parity, and “detected” does not imply an operational adapter.

> **Audience:** People evaluating whether Deck covers a runner or capability.
> **Authority:** Current product boundary; source registries, adapters, tests, and runner evidence define status.
> **Maintainer:** Deck maintainers.
> **Evidence:** [runner capability registry](../../packages/core/src/runner-capability-registry.ts), [runtime detection](../../apps/cli/src/runtime-detection.ts), [adapter registry](../../apps/cli/src/runner-adapters.ts), [canonical catalogs](../../packages/core/src/teams/developer/catalog.ts), and [documentation governance](../../tests/documentation-governance.test.ts).

## Status vocabulary

| Label | Meaning |
|---|---|
| **Supported** | The product has an implemented path and source-backed checks for the named surface. |
| **Runner-specific** | The capability exists only through a particular runner's native package, configuration, or effect. |
| **Experimental** | The path is intentionally available but its contract or runtime validation is not considered stable. |
| **Manual verification required** | Automated evidence is incomplete; the user or maintainer must verify the result. |
| **Detection only** | Deck can observe presence but does not configure, launch, or verify the runtime as an operational target. |
| **Known gap** | The boundary is recognized and not represented as a complete supported path. |
| **Not shipped** | The named product surface is not part of the current Deck distribution. |

## Operational runner matrix

Pi and OpenCode are operational Deck runners. Codex has a Developer Team adapter with route-limited protected controls and Deck-supervised Supermemory loopback support. The cells use the status vocabulary above; runner-specific details are described below the table.

| Surface | Pi | OpenCode | Codex |
|---|---|---|---|
| Binary detection | Supported | Supported | Supported |
| Version/config preflight | Supported | Supported | Supported |
| Package and MCP review | Supported | Supported | Supported with static-compatible route limits |
| Developer Team materialization | Supported | Supported | Supported with static-compatible route limits |
| Model discovery and per-role assignment | Supported | Supported | Supported |
| Adaptive-memory runner configuration | Runner-specific | Runner-specific | Runner-specific; Deck-supervised launches use an ephemeral loopback token, while optional MCP OAuth remains external |
| Project-local skill discovery | Supported | Supported | Supported |

Project-local discovery is always scoped to the active runner. Pi and OpenCode can share a capability ID while using different configuration files, package systems, model discovery, and verification effects.

## Detection-only runtimes

| Runtime | Status | Deck scope |
|---|---|---|
| Claude | Detection only | Deck can observe the binary in `PATH`; no operational adapter is registered. |
| Codex | Supported with route limits | Deck can configure and launch the Developer Team. Deck-supervised launches bind adaptive memory through runner hooks; protected execution controls remain static-compatible. |

## Runner-independent surfaces

| Surface | Status | Boundary |
|---|---|---|
| Deck self-update | Supported | Operates on compatible Deck binary installations independently of which runner is detected. |

## Capability matrix

| Capability | Product status | Boundary |
|---|---|---|
| Context Mode | Supported | Shared binary and MCP capability; effect and persistence are runner-specific. |
| Codebase Memory | Supported | Shared binary/MCP integration where the active runner exposes the required surface. |
| RTK | Supported | Optional shared binary; OpenCode uses its hook integration and Pi reuses a usable binary. |
| Serena | Supported | MCP and symbol-editing capability; Pi can require manual verification when automatic installation is unavailable. |
| Context7 | Supported | MCP server configuration is validated by the active adapter. |
| Supermemory | Supported with route limits | Deck runtime handles supervised recall/capture through an ephemeral authenticated loopback for Deck-launched OpenCode, Pi, and Codex routes where native hooks expose events. Optional external MCP OAuth is separate, scoped recall/list/graph/document only, and remains unobservable to Deck runtime metrics. |
| Developer Team | Supported | Seven canonical roles plus separate Onboard and Archive lifecycle skills. |
| Bundled external skills | Supported | 29 standalone content bundles; separate from project-local discovery. |
| Local skill registry | Supported | Read-only validation/discovery is bounded; refresh requires explicit authority and complete evidence. |

## Explicit limits

- Claude detection does not create a Deck runner adapter. Codex has a Deck-supervised adaptive-memory hook bridge, but protected execution controls remain static-compatible.
- Pi and OpenCode can share a capability ID while using different config files, package systems, model discovery, and verification effects.
- Adaptive memory never outranks OpenSpec, source, tests, or current runner evidence.
- Project-local skill metadata is discovery input, not runtime authority or bundled Deck content.
- Generated bundles and build metadata remain generator-owned.

Use [Runners](../runners.md) for operational details, [Skills](../skills.md) for the bundled inventory, and [Troubleshooting](../troubleshooting.md) when evidence is manual, incomplete, or indeterminate.
