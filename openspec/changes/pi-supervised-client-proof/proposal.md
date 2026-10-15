# Pi supervised client proof

## Why
A separate optional local graphical client needs structured access to Deck-supervised Pi without bypassing Deck or making Deck depend on a GUI.

## Authorized scope
The user approved a minimum contract and technical proof: supervised launch, message exchange, observation of one Deck-managed subagent, and orderly shutdown. A sibling client in deck-ui may exercise the generic interface. No complete GUI, release, user-profile installation, other-runner changes, or external model calls are authorized.

## What Changes
Add only the smallest generic Pi headless integration surface justified by source/tests. Reuse Deck launch configuration, extension/policy/memory handoffs, ownership, and cleanup; do not reimplement orchestration in the client. The existing interactive workflow must remain unchanged.

## Impact and boundaries
Expected areas: Pi launch adapter/plan, generic CLI composition where required, extension structured reporting if needed, targeted tests, and the independent proof client. Final source paths are determined by the implementation owner. No Deck import or runtime dependency on deck-ui is permitted.

Existing unrelated work must be preserved: .serena/project.yml, openspec/changes/release-v0-10-0/working-brief.md, and untracked .bun-cache/.

## Security correction
The application has no authentication: no accounts, login, app credentials or browser bearer tokens. This does not remove Deck's existing internal security or provider credentials. Prefer an owned stdio channel for the proof; any browser-facing endpoint requires loopback and strict Host/Origin controls. Local OS processes are trusted; remote control is out of scope.

## Rollback
Keep the new path opt-in. If verification fails, do not enable it in ordinary launch or publish it. A future authorized revert of the new slice can remove the optional path without changing interactive defaults; never discard unrelated work.
