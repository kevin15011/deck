# Tailscale private web access

## Intent
Allow the owner to opt into direct Deck Web access through private Tailscale Serve without entering a pairing code. Tailscale network authorization becomes the admission boundary for this explicitly enabled path. Default deployments continue to require existing browser authorization.

## Acceptance and decisions
- Keep the listener bound to loopback and preserve Host/Origin validation.
- Require explicit configuration, the configured trusted local proxy, an allowed HTTPS Tailscale origin and Tailscale identity evidence for automatic enrollment.
- Reject Funnel for automatic enrollment, including when manual pairing over Funnel is otherwise permitted.
- Preserve ordinary pairing, local bootstrap, device revocation, and authenticated WebSocket behavior.
- Automatically enter the workspace from a fresh eligible browser; no code prompt.
- Configure this owner's existing private endpoint after verification; install canary but leave daemon restart to the owner to avoid interrupting this session.

## Trace and constraints
Source: `packages/session-host/src/web-service.ts` (boundary, issueDevice, local-access bootstrap, API authentication); `packages/core/src/config/deck-config.ts` (web config). Graph capabilities are unavailable in this runner; source fallback applies, without graph completeness claims.
Existing endpoint: HTTPS Tailscale Serve proxies to loopback port 7421. Global config already trusts loopback proxy and lists its exact HTTPS origin. Default mode must remain unchanged for other installations. No public access or general anonymous mode is requested.

## Progress
Implementation delegated to apply-fast task-b72837f9-6021-4d77-adfe-62f6ad6e0808. Independent authentication-boundary review required before installation. No commit requested.

## Rollback
Disable the new opt-in configuration and restart the daemon to restore pairing-only remote enrollment. Existing device revocation remains available.

## Result and evidence
Implemented `crossRunner.web.tailscaleServeAccess` (default false). Browser bootstrap asks the server for automatic access; Serve enrollment requires the configured loopback proxy, exact HTTPS .ts.net origin and Tailscale-User-Login. Automatically issued cookies bind to the identity and origin for HTTP and WebSocket requests. Funnel cannot enroll automatically. Standard pairing and local bootstrap remain available.

Implementation validation: 151 focused tests passed and production-asset browser acceptance passed (fresh entry, reload, revocation, absent identity). Independent quality task-b2046fd0-1093-4d73-a27c-1941acf8bd32 found no blockers; 74 tests and browser acceptance passed independently. `git diff --check` passed. Typechecking reports the unrelated preexisting `apps/cli/src/pi-client-proof.ts:187` error.

Canary installed successfully. Owner's global config enabled the option with a backup, retaining existing origin/proxy settings. Activation awaits owner daemon restart; live-tailnet verification remains pending. No commit made.

Trust limits: local processes on the Serve host are trusted; tagged clients without user identity use pairing. Clearing cookies allows re-enrollment while Tailscale access is authorized; revoking tailnet access is the network-level removal. Official contract: https://tailscale.com/docs/features/tailscale-serve#identity-headers.

Commit preparation: user requested recording the completed change. Rechecked the final configuration, web-service, daemon composition and web doctor suites: 74 passed, 0 failed, 357 assertions. Personal machine configuration remains outside the repository.
