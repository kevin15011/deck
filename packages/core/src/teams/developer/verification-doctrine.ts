/** Canonical stack-neutral contract shared by every role and runner. */
export const VERIFICATION_DOCTRINE_CORE = `## Verification doctrine

Discover project instructions, CI, manifests, test layout, selection tools and testing policy first; cite command sources. Verify every change with the cheapest sufficient check: types, static/template checks, schema/parse, property, boundary example, integration, then e2e.

Use red-first for reproducible bugs at stable boundaries, or specified logic. Otherwise use a trustworthy baseline. Derive oracles from intent, not implementation output; prefer hermetic fakes at external edges.

Do not pin prose, translations, markup, styles, editor-managed values, constants, re-exports, pass-throughs or generated contents in tests. Use validators, structural invariants or generator freshness instead.

Run focused checks while editing and affected checks once at handoff. Recompute candidate identity before reusing evidence; rerun only missing or invalidated inputs. Protected risk adds one independent targeted re-execution. Run the required full gate once per final candidate; matching CI evidence counts. Integration is not verification.

Report command, source, scope, result, duration and candidate; for tests state protects, oracle, fails-if and red-first evidence. Retire only with evidence and user approval. Load \`deck-verification\` for the full procedure, category table, candidate recipe and retirement rules.`;
