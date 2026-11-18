# S4 second-runner qualification

Status: bounded OpenCode startup qualification passed; no cross-runner product behavior is implemented or accepted by this record. Investigate attempt 19 (97212/97213), integrated by Lead at 97497, recommends OpenCode as the second-runner candidate. Apply Fast attempt 2 and an independent Lead replay now provide the startup evidence below.

## Observed versus required

Lead independently observed installed OpenCode `1.19.1`. The current old-Deck adapter declares tested version `1.18.31`, classifies newer versions as untested/degraded, and explicitly returns `mcpIsolationVerified: false`. Its source is an integration reference, not native enforcement proof for 1.19.1.

Reference paths are `packages/adapter-opencode/src/session-driver/launch.ts` and `driver.ts` in the old repository. Their checked graph coverage was metadata-matched at generation `2026-11-11T01:38:54Z`; Lead read the material source. Existing behavior suggests a loopback HTTP/SSE server, process-specific server authentication, configuration supplied per launch, session-bound permission rules, prompt/system content and native abort. Persistent native `always` grants affect later sessions outside Deck and must not be used in qualification.

| Qualification boundary | Required evidence before enabling |
|---|---|
| Startup and coexistence | Exact 1.19.1 startup, bounded endpoint discovery, authentication, no old-process interference and owned cleanup |
| Configuration/tool isolation | Effective process-scoped content and MCP inventory; inherited plugins, project/global instructions and tools must be accounted for |
| Role and instructions | Selected content revision, exposed paths/tools and observed delivery/loading distinguished; Code Economy reaches intended roles |
| Authority | Real deny/allow-once behavior, no permission escalation through alternate tools, unsupported effects disabled |
| Events and cancellation | Session/message correlation, correct-child interruption, late events, crashes and uncertain outcomes |
| S4 product exit | A useful task across two real runners with owner/attempt/report provenance and explicit Lead treatment |

The native `--pure` option excludes external plugins according to observed local help; do not combine it blindly with a required plugin-based tool or skill mechanism. Treat all proposed launch mechanisms as hypotheses until the effective configuration and real behavior are observed.

## Preparation scope

The isolated startup/auth/configuration/SSE/cleanup probe may create only owned temporary fixture/state artifacts, never replace global configuration, copy credentials or alter existing native resources. Verify safety before launching; use no model turn until the selected restrictions and tool surface are demonstrated. Return a compact result with exact version, commands, timings, sanitized evidence and specific remaining qualification gaps. A successful server probe alone does not complete S4 or qualify native effects. Execution ownership and the completed bounded result are recorded below.

Production adapter implementation remains with the existing Apply Deep owner after S2/S3 prerequisites. Keep host admission, durable authority and report treatment outside runner adapters. No general adapter framework is required merely to begin this qualification.

## Pre-start findings and execution ownership

Investigate attempt 20 (98438/98439) did not launch a server: the runner is read-only and the proposed isolated directories had not been proven sufficient. Lead read the complete report and checked the exact 1.19.1 primary source. [`config.ts`](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.1/packages/opencode/src/config/config.ts) merges inline content before account/managed content and schedules dependency installation in discovered configuration directories. [`plugin/index.ts`](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.1/packages/opencode/src/plugin/index.ts) uses pure mode to omit external plugins; [`mcp/index.ts`](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.1/packages/opencode/src/mcp/index.ts) separately connects enabled configured servers. Sources were retrieved on 2026-11-11. Empty inline maps and `--pure` alone therefore do not demonstrate isolated startup.

The next execution task must establish exact-version path/flag behavior, account/managed configuration precedence, and dependency write destinations before launching. Investigate retains its analysis record; a distinct writable probe-harness task is necessary because its execution owner cannot create/run the required owned fixtures. That task owns only `target/opencode-qualification/`, not production implementation or documentation, and must preserve the same no-profile-mutation/no-model-dispatch boundary. A role permission limitation is not evidence of a product defect or a need to ask the sleeping user for routine implementation approval.

Apply Fast attempt 1 (99711/99712) supplied three hashed exact-version files but no executable harness. Lead matched those files and the installed binary hash `541bb0aa88d0b317967efbc947aa54506606c257d3b6ed1dee644756879fb4be`. The source shows an explicit `OPENCODE_TEST_HOME` discovery root, independently resolved XDG paths and `os.tmpdir()/opencode`, while npm consumes process configuration. These provide concrete fixture controls; an open-ended claim of proving every possible startup effect is not the next deliverable.

Lead's read-only kernel query reports Linux Landlock ABI 3 on this WSL host; `bwrap` is absent. Continue the same harness owner with an enforced filesystem write boundary allowing only owned fixture paths, explicit discovery/XDG/temp/npm configuration, and an empty credential environment. Demonstrate the guard with an owned sentinel outside the permitted root before launching the runner. This is a temporary qualification safeguard, not a selected production sandbox architecture. If the guard cannot be established, report that exact error; do not fall back to an unrestricted launch. Source checks still need to account for native auth/account reads and managed configuration; filesystem protection supplements rather than fabricates that evidence.

## Completed startup observation — 2026-11-11

Apply Fast attempt 2 (101235/101236) is integrated at 101744 after Lead reviewed the complete report and both harness scripts. The tested OpenCode 1.19.1 executable still matches SHA-256 `541bb0aa88d0b317967efbc947aa54506606c257d3b6ed1dee644756879fb4be`. Harness files are `target/opencode-qualification/probe.py` (`9dc029bb52a728c0807d9e3eb002a45ca4405a1ef5c878ece094def7bce87e69`) and `guard.py` (`56ea4ac5a45f95c9ce0f8073561ef75fda1388b1e4b35d0178f44b4ce8639dc4`). They are local qualification scaffolding, not production adapter code.

The harness redirects discovery, XDG, temporary and npm paths into an owned fixture, uses empty process-supplied credentials, disables built-in plugins and external skills, and starts with `--pure`. It refuses to launch when `/etc/opencode` exists. Native auth/account path source was checked against the redirected data directory. The Landlock ABI 3 guard restricts the selected filesystem write operations; reads, network access and general process execution are not sandboxed by this guard.

Lead independently ran `python3 target/opencode-qualification/probe.py` against the same inputs in 2.141 seconds overall (1.91 seconds reported inside the probe). Sanitized evidence is retained in `target/lead-opencode-checks/result.json`:

| Boundary | Observed result |
|---|---|
| Filesystem guard | Fixture write allowed; write to an owned sentinel outside the allowed root denied |
| HTTP authentication | Health returned 401 without credentials and 200 with ephemeral process credentials |
| Effective configuration | Zero configured MCP servers and zero external plugins |
| MCP inventory | Endpoint returned 200 with zero servers |
| Event transport | HTTP 200, `text/event-stream`, initial line received |
| Shutdown | Server exited on SIGTERM; the sampled process was no longer live and its observed port was closed |

Process sampling is not exhaustive descendant tracking. No model turn was sent. This establishes bounded startup and transport behavior only: tool permission enforcement, instruction delivery, event correlation during work, cancellation and the useful two-runner S4 demonstration remain required. The next dependency-ready step is production adapter qualification after the S2/S3 contracts; more repetitions of this unchanged startup probe do not establish those missing behaviors.
