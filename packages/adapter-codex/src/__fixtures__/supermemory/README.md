# Published Codex plugin fixture

`codex-supermemory-1.1.0.tgz` is the unchanged npm release from
https://registry.npmjs.org/codex-supermemory/-/codex-supermemory-1.1.0.tgz
(retrieved 2026-10-31). Published package license: MIT.

SHA256: `3e0f16dc2d4d99770677ca95140c45df90c3cd5140b2b5458db7aed540979c99`.
Registry SHA512: `EOveOZ5QcMgRJWILK+poHF5CMpn72zUVHtwQrvso41mdaCepcyFhPU9tyaY3hI3cMGkLswqNyAdYE7wS0NMAcw==`.

The offline integration test uses the production bounded extractor and file pins,
then executes the original hooks and hosted MCP proxy in synthetic HOME with fake provider I/O.
The selected recall/flush bundles include their SDKs; the hosted proxy has no external
runtime dependencies. All three use Node builtins and retain the original
`dist/package.json` CommonJS module declaration in their materialized root. The proxy SHA256 is
`c96a1cfd36a522b831e70dd95083456fca77816385609355238d1f904cbbcca2`.
It forwards native requests without rewriting namespace arguments.

The `official-supermemory-1.1.0-hosted-v1` artifact directory preserves older
owned generations. Review & Install replaces only receipted MCP contributions.
The hosted credential travels in the child environment; configuration contains
only its variable name. Automatic capture keeps the canonical project tag.
Native tool context requests project-first consultation with explicit `namespace`
arguments; account-accessible tools and operations without a selector retain
upstream behavior. This guidance does not enforce routing or ranking. Codex
memory remains disabled when no verified project identity exists.

Run `bun apps/cli/src/codex-hosted-tools-acceptance.ts <new-absolute-evidence-directory>`
for the opt-in Linux real-CLI check (installed executable, synthetic HOME, fake model
and provider, isolated network with only loopback). Read-only roles retain the
existing MCP default-deny policy while automatic hooks remain eligible.

As with the hooks,
the npm installer, CLI, OAuth flow and personal runner homes are never used.
OpenCode's corresponding release is a pinned workspace development dependency.
