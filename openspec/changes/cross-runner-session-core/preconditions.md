# Apply Preconditions

Resume checkpoint: 2026-10-12, branch `fix/claude-model-config-blocked-plan`.

- The user requested continuation from the existing handoff. The accepted decisions in `design.md` and `spec.md` remain authoritative.
- Repository guidance, OpenSpec configuration/schema, dependency availability, and indexed project identity were checked. Local project `deck-lead` skill is absent; the installed global skill was loaded. No setup repair is needed for this bounded continuation.
- TypeScript passes; the initial core/session-host baseline is 322 passing tests. Existing uncommitted S1 CLI work is continuation input, not disposable output.
- Preserve unrelated uncommitted Codex MCP repair, dashboard, and runner documentation edits. Do not edit Pi or generated files by hand. OpenSpec writes remain centralized in Lead.
- Use Bun 1.3.12 from the npm cache for generation/build; host Bun is 1.3.11. Do not install global tools, run `canary:install`, push, or run bare `bun install`.
- Docker was initially stopped; the installed Docker application was started and now reports Linux/aarch64. A disposable Bun 1.3.12 container will verify the Linux binary without mounting the repository or credentials; the repository installation-sandbox image is not cached. Cross-compilation alone is not Linux runtime evidence.
- Recorded Claude fixtures are historical live evidence. Report new live probes separately from offline tests; never claim an unexecuted probe passed.
- Adaptive recall was available as advisory context; implementation and status decisions use repository artifacts and current checks.
