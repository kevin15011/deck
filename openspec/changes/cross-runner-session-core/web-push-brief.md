# User-attention Web Push notifications

## Intent
Deliver opt-in notifications across desktop and mobile Chrome, Firefox and Safari for events requiring the user's attention. Exclude ordinary subagent replies and completion notifications. Keep Deck private behind Tailscale; the daemon may send encrypted messages to browser push providers.

## Acceptance
- Notify when the Lead finishes and waits for user input, when a question or approval requires user action, and when actionable execution failure requires attention.
- Questions/approvals from delegated work remain eligible; normal delegated replies/completions do not.
- Browser/device opt-in and opt-out, explicit permission gesture, useful unsupported/denied/iOS install guidance.
- Notifications work without an open Deck tab, subject to OS/browser delivery constraints. Daemon must run.
- Clicking opens/focuses the exact session; avoid duplicate alerts on a device actively viewing the target conversation.
- Generic payloads exclude chat text, commands, secrets and raw errors.
- Durable owner-private signing identity/subscriptions, authenticated management APIs, device revoke cleanup, bounded asynchronous delivery, expired endpoint removal, no historical replay flood.
- Restrict outbound destinations to supported browser push provider HTTPS endpoints and reject redirects to prevent subscription-driven SSRF.
- Include embedded service worker assets, production composition verification, browser checks and user documentation.

## Decisions and scope
Use standard Web Push rather than tab-only notifications. iOS/iPadOS Safari requires an installed Home Screen web app for push. Notification delivery is best effort, not an approval/execution channel. Tailscale connectivity is needed to reopen private Deck. Browser providers transport encrypted notifications over Internet; no public Deck listener is introduced.

## Evidence and ownership
Source fallback: `packages/session-host/src/event-log.ts` emits append subscriptions; `daemon.ts` composes WebService; `packages/core/src/session/events.ts` defines canonical events; `scripts/generate-web-assets.ts` embeds web assets. Graph capability unavailable in this runner, so graph generation/coverage is unknown.
One implementation owner: apply-deep task-e321a502-c8e1-467a-b7c4-4dfd7f900013. Lead owns persistence and independent review. Existing uncommitted mobile viewport/avatar changes must be preserved. No commit requested.

## Verification and rollback
Use fake outbound effects for security/event/delivery tests and exercise production daemon composition. Verify UI/service worker registration and notification routing where browser capabilities permit. Disclose untested real devices. Roll back via per-browser disable/revoke; retain default opt-out for existing devices.

## Status
Implementation in progress; no push subscriptions created for the owner yet.

## Browser compatibility evidence
Official references consulted on 2026-10-17: MDN Push API (https://developer.mozilla.org/en-US/docs/Web/API/Push_API), Mozilla Web Push help (https://support.mozilla.org/en-US/kb/push-notifications-firefox), WebKit Home Screen Web Push (https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). Standard Push API + Service Worker is the cross-browser contract. iOS/iPadOS requires Home Screen installation and an explicit user gesture to request permission; Apple documents `*.push.apple.com` delivery endpoints. Background delivery remains subject to browser/OS lifecycle and permission settings. No promise of delivery while a browser is force-stopped.

## Review checkpoint
Independent quality task-f87d0dec-7127-4bc6-b0bd-cfdd6f28fc45 found blockers in the initial candidate: notification clicks reloaded tabs and lost drafts; silent push returns violated Safari's visible-notification contract; session cookie loss broke durable browser ownership; distinct Lead completions shared a non-renotifying tag; successful forced user interruption was misclassified as failure. Also requested cancellation of active outbound jobs on unsubscribe/revoke. These findings must be resolved before installation. Browser acceptance currently uses real service-worker/notification APIs with simulated delivery; no live provider delivery has been claimed.

## Review-driven decisions
Safari's user-visible push contract takes precedence over attempting to suppress already delivered pushes: suppress only before outbound delivery; a valid incoming push must display a generic notification even if attention was resolved in transit. Document this best-effort stale-alert limitation. Each occurrence gets a unique deduplication tag. Existing tabs must never be reloaded as a notification-routing fallback; use acknowledged in-app routing or a new window. Push opt-in needs a finite persistent revocable browser credential, plus ownership-safe resubscription after cookie expiry/clearing. These deltas are assigned to the original owner, attempt 2. Forced-interruption filtering and active-delivery cancellation are already independently verified resolved.

## Final implementation and verification
Original owner attempt 2 resolved all review blockers. Quality task-f87d0dec-7127-4bc6-b0bd-cfdd6f28fc45 attempt 3 passed its bounded re-review with no remaining findings. Push opt-in now persists a revocable credential for 180 days, checked server-side for authentication and delivery. Cookie loss uses ownership-safe fresh subscription enrollment. Every valid received push displays generic text; server-side presence/current-state checks suppress unnecessary sends. Notification tags and provider topics identify individual occurrences. Warm routing uses application messaging; an unresponsive tab is preserved and a new window opens. Forced user interruptions are excluded; pending outbound jobs are canceled on device opt-out/revoke.

Evidence: initial affected suite 389 passed / 1 skipped; final review delta 58 passed / 0 failed (390 assertions), `/tmp/deck-push-review-final.log`. Updated Chromium acceptance passed (`/tmp/deck-push-review-browser.log`), exercising actual worker registration/Notification API with simulated push, cold/warm session routing, draft preservation, notification display without cookies, safe re-enrollment and mobile/desktop controls. Scratch compiled binary smoke verified crypto, worker and manifest embedding. TypeScript still reports the known unrelated `apps/cli/src/pi-client-proof.ts:187` error. `git diff --check` passed. Lead inspected the mobile notification-control screenshot `/tmp/deck-push-390.png`.

Live delivery through Google/Mozilla/Apple and physical Firefox/Safari/iOS are not verified. Browser/system permission and lifecycle restrictions still apply. Already accepted provider messages cannot be recalled, and stale in-flight alerts can appear. Delivery remains best effort. Personal browser permissions/subscriptions were not enabled by the agent. Canary installation follows; user performs daemon restart to avoid terminating this session. No commit requested; prior mobile fixes remain in the worktree.

Canary installation completed successfully with regenerated web assets. Activation awaits user daemon restart and browser opt-in.
