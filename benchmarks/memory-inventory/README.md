# Supermemory production inventory

One-shot, read-only inventory of the account namespace listing and production namespace `sm_project_v1_kevin15011_deck`. It classifies visible documents and memories and identifies records related to the exposed session ids. It never deletes, forgets, updates, or writes to Supermemory.

## Commands

Set `SUPERMEMORY_INVENTORY_API_KEY_FILE` to a non-empty regular file with mode `0600`; its parent must be a non-symlink directory with mode `0700`. No other credential source is used.

Offline preflight (checks credentials, output path, cap, and allowlist; makes **zero fetch calls**):

```sh
bun run benchmarks/memory-inventory/main.ts --dry-run
```

Live read-only inventory (the end of the window defaults to invocation time):

```sh
bun run benchmarks/memory-inventory/main.ts --live --sessions 78139695-03a1-4ce3-816d-d522df8dd928,01a15ee3-9102-7983-b153-b630205c3086,01a15ee2-8e87-7101-8795-b783e01276a3,01a15ee2-3e9e-7143-be56-3ca98bffa5b2,01a15ee2-cce7-7c13-a997-b749d73250ff --window-start 2026-10-21T00:00:00Z
```

`--max-requests N` accepts a positive integer from 1 to 1500. Unknown/duplicate flags and invalid date-times are rejected. Live output goes to `~/.deck-eval/inventory/<UTC timestamp>/`; directories are `0700`, files `0600`. The CLI pins this path, checks every existing component for symlinks, resolves the repository root from this script, and refuses repository-contained output.

Document ids are never used in local filenames or output paths. Unsafe ids are skipped before fetch and represented by a hash. A record that still matches a residual secret pattern after redaction is quarantined independently so other records can be inventoried.

## Network allowlist

The request guard validates the normalized URL and query parameter names immediately before fetch. Namespace-scoped calls require exactly `sm_project_v1_kevin15011_deck`. Base URL is fixed to `https://api.supermemory.ai`, redirects are refused.

- `GET /namespaces` and alias `GET /ns` (`page`, `limit`)
- `GET /ns/{namespace}`
- `POST /ns/{namespace}/list/documents` (`page`, `limit`, `sort`, `order`)
- `POST /ns/{namespace}/list/memories` (`page`, `limit`, `sort`, `order`)
- `GET /ns/{namespace}/document/{id}` (`include`)
- `GET /ns/{namespace}/profile/buckets`
- `POST /ns/{namespace}/profile`

The v5 OpenAPI description calls profile POST “Get profile” and says it reads the continuously maintained profile; the operation has a read-only filter/bucket body and no mutation behavior is described. It remains allowlisted as a read. Listing pages stop on an empty page and reject absurd totals. Retries are limited and request accounting includes transport failures and timeouts.

## Outputs and limits

- `documents-memories.jsonl`: redacted document detail and memory records. A record that retains a residual secret pattern is quarantined to a hashed id, field/record counts, byte size, and suspicion categories; its content and raw id are omitted.
- `namespaces.json`: namespace names, counts, and name-pattern classes only.
- `document-details.json`, `profile-buckets.json`, `profile.json`: redacted provider records.
- `request-log.json`: method, path template, status, latency, response bytes, and attempt; no content.
- `summary.json`: counts/classifications, redactions, quarantined record/category counts, secret-like document count, session matches with attribution and `inWindow`, and unusable date count.
- On request failure/cap, `partial-summary.json` and `request-log.partial.json` preserve redacted counts and operation evidence.

The live run prints an expected request estimate of approximately one document GET per listed document plus fixed overhead, based on the account namespace document count. The final report includes total operations and status counts per endpoint. Billing is **unknown — not readable with this key**. The v5 snapshot marks the profile operation as a read; this inventory does not infer account-specific billing.

## Offline verification

```sh
bun test benchmarks/memory-inventory/inventory.test.ts
```

Tests inject fetch or assert offline preflight performs zero fetch calls. They do not invoke `main.ts` or contact the network.
