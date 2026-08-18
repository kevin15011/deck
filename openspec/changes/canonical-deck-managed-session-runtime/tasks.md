# Tasks: Canonical Deck-Managed Session Runtime

1. **Characterize and model**
   1.1 Add failing/characterization tests for production OpenCode/Codex generic routing, Pi separate ownership, stale OpenCode helper isolation, and no TUI/setup runtime effects.
   1.2 Add runner-neutral execution topology and static-versus-managed capability/readiness declarations with stable reason codes.
   1.3 Add a minimal CLI-owned, idempotent Session Runtime lease around the existing host and generic launcher.

2. **OpenCode managed vertical slice**
   2.1 Move runtime host creation and explicit effects after install/verify and exclude dry-run/install-only.
   2.2 Prove project/session identity, pre-task Automatic Recall, explicit recall, Automatic Capture, sanitized bridge environment, signal/spawn cleanup, and metadata-only observability.
   2.3 Add bounded in-flight duplicate coalescing while preserving retry after failure and successful replay suppression.

3. **Product modes and everyday UX**
   3.1 Make CLI previews/guidance identify Deck-managed as canonical and standalone as static-compatible.
   3.2 Add the smallest TUI launch handoff to the configured runner if it can reuse the generic lifecycle without retaining Ink/process ownership; otherwise expose the exact existing managed command as the one-action next step.
   3.3 Update Setup/readiness, Doctor, capability declarations, installed guidance, and documentation to distinguish static readiness, managed readiness, and active runtime state.

4. **Runner convergence**
   4.1 Route Pi through the generic lifecycle while preserving supported continue/resume/profile/model semantics and removing separate host/spawn/cleanup ownership.
   4.2 Run Codex interactive/exec/resume regression coverage and verify no duplicate runtime path.
   4.3 Keep legacy `runOpenCodeLaunch` outside production; remove it only if bounded and safe.

5. **Verification**
   5.1 Run the focused 25-scenario managed/isolation/exactly-once/Quick Fix/standalone/installer/runner matrix hermetically.
   5.2 Run relevant runtime host, session store, adapter, CLI/TUI, Setup/Doctor, installer/compiled binary, project-isolation, and typecheck suites with no live provider effects or user-state writes.
   5.3 Obtain independent Quality review and resolve confirmed issues before recording GO/NO-GO.
   5.4 Prepare, but do not execute or publish, the manual Session A–D and Project B live acceptance procedure.

6. **Live acceptance canary helper**
   6.1 Add `bun run canary:install` with fixed `deck-canary` naming and safe destination parsing.
   6.2 Reuse the canonical host compile primitive and activate a verified immutable digest payload through an atomic alias without modifying stable `deck` or tracked generated sources.
   6.3 Cover lock recovery/contention, unsafe destinations, payload validation, interruption/concurrency, PATH guidance, stable-binary preservation, and real temporary host compilation.

7. **Common SSH alias identity**
   7.1 Replace hardcoded alias trust with exact trusted OS-account SSH configuration mapping.
   7.2 Remove Git/PATH/HOME execution authority through structural Git discovery and descriptor-consistent account/SSH config reads.
   7.3 Add hostile environment, passwd, Git layout, SSH syntax/directive, protocol, ambiguity, isolation, and live-shape tests.
   7.4 Keep mutation preview output single and confirmation concise.
