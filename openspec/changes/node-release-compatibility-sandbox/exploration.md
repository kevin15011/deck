# Exploration

The existing release workflow built four Bun-compiled targets but did not execute each candidate on its native OS/architecture or with Node 20/24. Existing canary installation targets a personal binary location and skips release generators, so it is not a sandbox substitute. Existing compiled Supermemory smoke checks remain valuable and are preserved.

Deck embeds Bun. External Node compatibility is a separate dimension, covered here by executing the generated Codex hook with a loopback protocol fixture under real Node versions. Arbitrary third-party installations are explicitly out of scope.

Evidence: `scripts/build-binaries.ts`, `scripts/install-canary.ts`, `scripts/verify-supermemory-compiled-runtime.ts`, `.github/workflows/release.yml`, runner adapter installation boundaries, and generated Codex hook source. No existing active sandbox implementation was identified; historical installer regression work was not reopened.

## External reference provenance
- GitHub-hosted runners reference, https://docs.github.com/en/actions/reference/runners/github-hosted-runners — Tavily search snippet, retrieved 2026-09-20, undated. Lists the selected native runner labels and architectures; repository-specific availability still requires CI execution.
- Setup Node README and advanced usage, https://github.com/actions/setup-node/blob/main/README.md and https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md — Context7 documentation excerpts, retrieved 2026-09-20, undated. Matrix Node versions and architecture configuration. Existing v4 action retained rather than introducing an unrelated action-runtime migration.
