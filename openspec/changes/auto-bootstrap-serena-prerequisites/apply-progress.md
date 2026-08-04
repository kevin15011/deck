# Apply-local progress: T01/T02

## Scope

Implemented only the delegated Core T01/T02 targets:

- `packages/core/src/serena-bootstrap.ts`
- `packages/core/src/serena-bootstrap.test.ts`
- `packages/core/src/index.ts`
- `packages/core/src/runner-adapter.ts`
- `packages/core/src/runner-adapter.test.ts`

No registry YAML, other OpenSpec artifact, adapter/CLI path, configuration,
generated file, dependency, lockfile, or Git operation was changed by Apply.

## TDD evidence

- **RED:** `/home/dev/.bun/bin/bun test packages/core/src/serena-bootstrap.test.ts packages/core/src/runner-adapter.test.ts`
  failed before implementation with the missing `./serena-bootstrap` module and
  missing `validateSerenaOperationAuthorization` export (`0 pass`, `2 fail`,
  `2 errors`).
- **GREEN:** the same command after implementation passed (`17 pass`, `0 fail`,
  `101 expect() calls`).

The tests use only deterministic injected fakes. They assert authorization,
Deck-root containment, reuse/fail-closed behavior, the fixed installer URL and
direct `/bin/sh` stdin shape, exact environments and Serena command, readiness
path/fingerprint evidence, cancellation/partial outcomes, bounded redaction,
writer revalidation, and `created|updated|unchanged` results.

## Apply-local functional exercise

Non-independent evidence only: `/home/dev/.bun/bin/bun -e '<public
bootstrapSerena call with deterministic fakes>'` exercised one reuse and one
controlled-bootstrap trace. It reported:

```text
{"reuseOutcome":"reused","reuseProbe":1,"bootstrapOutcome":"installed","fetches":1,"spawns":2,"probes":2}
```

No real fetch, installer, `/bin/sh`, `uv`, Serena, filesystem, home write, or
configuration writer was reachable.

## Conditional validation

- Core source bundles successfully with Bun (`bun build ... --target bun`).
- `bun x --no-install tsc --noEmit` remains environment-blocked because the
  repository runner lacks the configured `bun` type definitions. No dependency
  installation was attempted.
- Independent Verify and Review evidence remains outstanding and is not claimed
  here.

## Post-implementation live composition repair — 2026-08-04T13:54:50Z

The user's first authorized live OpenCode reinstall stopped at
`capability.serena.install` with `Serena Deck-owned root is unavailable`.
This was production evidence of a default-composition defect, not an invalid
user installation: `createOpenCodeRunnerAdapter()` had safe injected seams for
tests, but its no-options production path supplied neither the Deck-owned root
nor the immediate readiness revalidator.

The repair keeps the fail-closed boundary and connects the missing production
path:

- Core now exposes one read-only owned-root resolver shared with bootstrap root
  validation and a fixed-argument same-path/fingerprint revalidator.
- The OpenCode adapter lazily composes those defaults from its Serena effects
  when no explicit root/revalidator was supplied. An explicitly supplied unsafe
  root still fails closed.
- No PATH Serena fallback, authorization relaxation, automatic cleanup, or
  writer bypass was added.

TDD and verification evidence:

- **RED:** the new default-composition regression test reproduced the live
  failure (`15 pass`, `1 fail`; expected `executed`, received `failed`).
- **GREEN:** Core plus OpenCode focused tests passed (`30 pass`, `0 fail`).
- Affected Serena/bootstrap/install/MCP/action-runner/render tests passed
  (`116 pass`, `0 fail`; `519` expectations).
- `bunx tsc --noEmit` and `git diff --check` passed.
- The repository-wide suite passed (`4,199 pass`, `0 fail`; `16,459`
  expectations across `249` files).
- A read-only call through the real default Core effects returned `resolved`;
  it performed no directory creation, process start, network call, or config
  write.

The agent did not run `bun run deck:run`; per the Design contract, live
functional confirmation remains user-owned.

## Post-implementation official-redirect repair — 2026-08-04

The user's second authorized live OpenCode reinstall progressed past owned-root
resolution but stopped before `uv` existed, while the TUI exposed only the
generic `Serena setup failed before configuration` line. Read-only inspection
found the Deck-owned Serena directories created and both expected executables
absent. The production fetcher also combined the official latest-installer URL
with `redirect: "error"`; current official `uv` installation guidance follows
that endpoint's redirect chain. The previous one-request/no-redirect design was
therefore internally safe-looking but not operable.

The repair changes only this acquisition boundary and safe diagnostics:

- the exact initial endpoint remains `https://astral.sh/uv/install.sh`;
- Core manually follows at most three HTTPS redirects through fixed Astral/uv
  GitHub release host/path rules, sends no credentials, and keeps the existing
  operation-wide timeout and response-size bound;
- missing, malformed, non-HTTPS, credential-bearing, unrecognized, or excess
  redirects still fail closed;
- the production redirect logic is regression-tested with an injected fetch
  transport, so no test performs network, installer, process, or home I/O; and
- OpenCode's bounded Serena failure now includes the safe stage/code (for
  example `evidence/fetch-failed`) while continuing to suppress raw streams,
  private paths, and arbitrary diagnostic text.

TDD evidence:

- **RED:** focused tests failed in four expected assertions: the production
  transport was not injectable/following redirects, Core and adapter still
  requested `redirect: "error"`, and the safe failure omitted its code.
- **GREEN:** `bun test packages/core/src/serena-bootstrap.test.ts
  packages/adapter-opencode/src/install-tools.test.ts` passed (`32 pass`,
  `0 fail`; `171` expectations).

The agent did not perform the real fetch, execute the remote installer, invoke
`uv`/Serena, write runner configuration, or run `bun run deck:run`.

## Post-implementation redirect-policy simplification — 2026-08-04

The user's next authorized retry surfaced the new safe diagnostic
`evidence/redirect-rejected`. The first redirect repair had repeated the
original planning defect at a smaller scale: a predeclared CDN host/path
inventory looked precise but was not derived from the live production chain and
became a correctness dependency.

The policy now trusts only the same authority already accepted by the change:
the exact initial `https://astral.sh/uv/install.sh` endpoint. Core may follow at
most five redirects selected by that endpoint/chain; each hop must remain HTTPS
and contain no embedded credentials or custom port. One timeout, one body-size
bound, omitted credentials, fixed process/environment values, Deck-owned
destinations, and post-install readiness remain unchanged. This does not claim
independent content verification: a hostname inventory could not provide that
because the accepted initial endpoint can itself return executable bytes.

TDD evidence:

- **RED:** a fake current release-CDN destination was rejected after the first
  request (`14 pass`, `1 fail`).
- **GREEN:** the focused Core suite passed after removing the volatile hostname
  dependency and adding the hop-limit assertion (`15 pass`, `0 fail`; `90`
  expectations).

The agent again performed no real fetch, installer/process invocation,
home/configuration write, or `bun run deck:run`.

## Post-implementation uv-managed symlink repair — 2026-08-04

The user's next authorized retry passed `uv` bootstrap and Serena installation,
then surfaced `post-install/serena-unusable`. Read-only filesystem inspection
showed `uv` and `serena-agent 1.6.1` fully installed. The expected managed entry
`<root>/bin/serena` was the normal symlink produced by `uv tool install`, and
its canonical target was the regular executable
`<root>/uv-tools/serena-agent/bin/serena`. Core rejected the entry solely
because it was a symlink, before checking target containment.

The repair permits no arbitrary symlink reuse. Production inspection now:

- requires an absolute managed entry and a canonical regular executable target;
- accepts a symlink only when that target remains inside the supplied
  Deck-owned Serena root;
- rejects missing, dangling, escaping, non-regular, or non-executable targets;
- fingerprints both symlink and target metadata and checks them before/after
  inspection; and
- passes the owned root through inspection, direct probe, and immediate
  pre-writer revalidation so a retarget invalidates the evidence.

TDD evidence:

- **RED:** the production inspection seam classified a contained `uv`-style
  symlink as `unusable` (`15 pass`, `1 fail`).
- **GREEN:** the focused Core suite accepted the contained fixture and rejected
  an escaping fixture (`16 pass`, `0 fail`; `93` expectations).
- A read-only production call against the user's installed managed entry
  returned `ready` with a bounded fingerprint. It did not execute Serena.

The agent did not execute `uv`/Serena, modify the installed tool, write runner
configuration, or run `bun run deck:run`.

## Post-implementation OpenCode composition repair — 2026-08-04

The next user-owned reinstall completed, but OpenCode reported
`Executable not found in $PATH: "serena"`. Read-only inspection confirmed that
the active `opencode.json` still contained the legacy bare command even though
Deck's evidence-gated writer requires the validated absolute executable.

The defect was in the TUI production bridge. The OpenCode adapter returned
reuse as a satisfied skipped action with raw outcome `already-present`, but the
bridge flattened every skipped Serena result to `cancelled`. The shared action
runner consequently skipped MCP configuration. The repair removes the unused
parallel OpenCode install branch and, critically, returns the adapter result
without overwriting its identified outcome. Reuse can now reach the same
adapter instance's retained readiness, revalidation, and absolute-path writer.

Regression and verification evidence:

- A new adapter-flow regression starts with a legacy bare Serena entry, reuses
  validated readiness, writes the absolute command, and preserves an unrelated
  MCP entry.
- Focused Core, OpenCode bootstrap/install/MCP/adapter/plan, dashboard
  action-runner, production bridge, and TUI integration/render suites passed
  (`178 pass`, `0` fail; `709` expectations).
- `bunx tsc --noEmit` and `git diff --check` passed.
- Deck's OpenSpec registry validator reported `0` errors and the same `3`
  historical event-name warnings for this change.

The agent did not edit the user's OpenCode configuration, execute OpenCode or
Serena, or run `bun run deck:run`; live confirmation remains user-owned.
