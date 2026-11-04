# Working Brief: Stable workspace panels when switching tabs

## Intent and authorization

The user reports that the panels jump when switching Activity, Subagents and Review.
Implement a separate focused fix on current main while resilience work continues.
Preserve the accepted role-assignment rows and existing application design.

## Acceptance

- Diagnose the observed geometry or motion cause with browser evidence.
- Switching tabs does not displace surrounding chat, panel frame or tab rail.
- Long and empty content scroll correctly within responsive panel boundaries.
- Rapid reversals remain interruptible; keyboard focus/selection is immediate.
- Reduced motion gives immediate state changes or a minimal fade.
- Any transition uses GSAP with cleanup and no competing CSS animation.
- Desktop and narrow layouts remain usable; no arbitrary global fixed-height patch.

## Ownership and verification

Apply Fast task `task-f725bfd1-7d54-49f9-9594-9c0e07af784d`, attempt 4, owns the
web UI continuation. Backend lifecycle remains with Apply Deep. Lead centralizes
OpenSpec; source changes only, no user daemon restart, installation or publication.

Verify actual tab geometry before and after, all switching directions, long/empty
content, rapid input, keyboard, scroll and reduced motion. Use existing browser
harness and isolated fixture state. Do not pin CSS declarations or markup in tests.
Full gates will run on the final combined candidate. Implementation is in progress.

## Review progress

Attempt 4 found repeated entrance motion on still-visible ancestor panels and added
a guard plus frame geometry checks. Owner reports desktop/narrow/reduced-motion
checks passing within 1.1px, but long-content/manual-scroll behavior is unverified
and existing disclosure reversal acceptance failed without a baseline comparison.
Lead also identified per-key cleanup killing all panel tweens while the new guard
skips already-visible panels; an entrance interrupted by tab selection might remain
partially transformed. Attempt 5 must investigate and verify these cases before
acceptance. No regression cause or unrelated baseline failure is assumed yet.

## Scoped result

Attempt 5 keeps already-visible ancestors in place and gives subscriptions/cleanup
a stable ref lifetime instead of restarting them on every selection key. Owner
reproduced an interrupted entrance stuck at opacity0.6069 before correction and
reports the disclosure assertion also fails against the committed hook in an
isolated baseline fixture. No unrelated disclosure fix is included.

Lead reviewed the hook diff and independently reran both browser paths with exact
reported input hashes matched before/after:

- `DECK_VIEW_ONLY=1 bun apps/web/view-motion-acceptance.ts`: exit0,4.267s;
  interrupted entrance, live reduced-motion change and immediate keyboard selection.
- `DECK_TAB_ONLY=1 bun apps/web/layout-stability-acceptance.ts`: exit0,28.87s;
 1440px/390px normal/reduced motion, geometry within1.1px, switching all directions,
 desktop reading-position preservation and paused auto-scroll under incoming content.
- `git diff --check`: passed.

Chrome executable was explicitly supplied from the existing local Playwright cache.
Hook SHA256: `a705e3a665e60b65f561daf4db3772228dec4b97aea03013d881e731af2f38cd`.
View check SHA256: `dfa19162563811e1f5e5c7c056dec36b4b7f99762fd529d608e597e7f8150ae5`.
Layout check SHA256: `b53bfaaf42c7efe201bc2ccb756317e4c71f89d6568e35ba5d8cf00e1c1efa4e`.

Scoped tab-jump correction is accepted. Narrow-screen long-content reading behavior
was not separately exercised; broader disclosure acceptance remains baseline-red.
Combined full-suite/type gates remain part of backend final verification.
