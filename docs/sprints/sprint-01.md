# Sprint 1 — A real project conversation in the Rust workspace

Status: the approved React/TypeScript/GSAP replacement is installed as `deck2`. User validation subsequently reports another 403; S1-Q07 launch/access acceptance is reopened for the actual WSL environment. Earlier bounded checks remain evidence for their tested paths, including the resolved S1-Q08 composer check; they do not qualify the Windows browser opener. Evidence and exact limits are in the [verification record](sprint-01-verification.md) and the latest [implementation brief](../../openspec/changes/sprint-01-deck2/working-brief.md). Parent plan: [roadmap](../roadmap.md).

## User journey

Launch the isolated `deck2` executable, open the authenticated local Deck web workspace, choose a disposable project, ask an installed runner to explain a file, watch its answer stream, reload the page and inspect the same recorded session.

Proposed initial environment: Linux x64, one compatible installed/authenticated Codex runner, and Chromium. These keep the first slice bounded; verify exact runner support and available native read-only enforcement before committing its execution mode. A runner lacking the required boundary is blocked with an explanation, never silently launched unrestricted.

## Deliverables

- React/TypeScript browser application reusing the established presentation with GSAP transitions, as approved after user validation of the first prototype.
- Independent native host and a small launcher/recovery interface, with embedded versioned web assets.
- Separate development binary/config/state/cache/socket/browser-authentication scope from old Deck.
- One project, session, active task, text prompt and streamed result with durable IDs/receipts.
- Recognizable navigation, transcript, composer and status/error/connection states following the existing design.
- Relevant Code Economy instructions for development/review; no speculative extension framework or hard code-size gate.

No project writes, tool/runner installation, delegation, remote access, voice, push or old-history import belongs in this slice. Those exclusions are release scope, not removal from the roadmap.

## Acceptance scenarios

1. Given a compatible authenticated runner and authorized disposable project, submitting a read-only question yields real streamed output and an attributable terminal result.
2. Given a previously accepted command, retrying the same identity retrieves the existing outcome; conflicting input is rejected.
3. Given browser closure/reload during execution, the host continues according to policy and reconnect does not dispatch the prompt again.
4. Given absent authentication/binary or unsupported read-only enforcement, launch is blocked with an actionable explanation and no fabricated response.
5. Given an unauthenticated or wrong-origin request, it cannot create an executable task.
6. Given cancellation, host interruption, storage failure or uncertain dispatch, the UI reports actual state; it does not silently replay or claim clean completion.
7. Given keyboard navigation, narrow viewport or reduced motion, the selected reference surfaces remain usable and controls do not wait for animation.
8. Given a failed launch or handshake, the user can identify the failed stage, actual execution state and safe next step, with a correlation reference for bounded diagnostics and no exposed secrets.
9. Given an incompatible browser/API client or unproven required native capability, dispatch is unavailable with an explanation; draft input is preserved where applicable. Recorded instruction/tool identities distinguish selected content from observed delivery/loading.

Before choosing the launch/preparation mechanism, consume the [non-invasive integration research](../reliability-runner-research.md) for the exact initial runner/version. Record separate startup, host acceptance, native dispatch and first-output baseline timings during eventual implementation verification; no zero-overhead or compatibility claim is established by this plan.

## Implementation/verification order

Capture the agreed visual states and exact native capability evidence first. Establish a runnable Rust browser/native skeleton, then one authenticated command-to-runner-to-event path. Add durable receipt/reconnect and conservative failure outcomes before broadening polish. Keep authority in the native host and privileged secrets out of shared/browser types.

Derive deterministic tests from the acceptance scenarios. Use fake runner edges for failure cases, then one actual supported native turn in an isolated project. Verify Rust native and static React browser builds and the packaged launcher from their manifests. Compare equivalent original/replacement desktop/mobile states in the same theme, font and viewport. Record candidate hashes, commands, scope and limitations; browser and native evidence have different roles.

## Exit gate

The demo must run from a packaged development artifact without a development server, use a real runner, survive a browser reconnect without duplicate work, and show the selected visual/interaction states. Native host lifetime is independent of browser lifetime. No write-capable mode may be enabled by this sprint.

## Traceability

Catalog: W01, W02, W03, W05, W06, A01, A10, A11, A13, A14 and the minimum C11 bootstrap. Contracts: applicable INV01–INV15, including native authority, truthful uncertain outcomes, actionable failures and Code Economy for the implementation itself. Optional helper update paths do not gate this first conversation. Sources: [catalog](../product-catalog.md), [contract register](../product-contracts.md), [design baseline](../design-baseline.md), [technical direction](../technical-direction.md), [operating model](../operating-model.md).
