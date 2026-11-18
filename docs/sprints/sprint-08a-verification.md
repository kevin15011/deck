# S8a appearance and conversation layout verification

Status: **accepted and installed** as `605f4e83` after Quality27 integration233418. Production30 was integrated at232613; no user host was restarted.

Candidate `b9bbecf558cdb790c1e750b310a994f0e4786235238fcd6a1d589c483647c374`, binary `605f4e83d533dd8b2faefb3cd3c2643e71e95be7a51c0b63fd19d2c8be9c34f3`. Lead independently rematched155 current/frozen implementation inputs,22 current/frozen assets and both binaries before and after replay. [Frozen handoff](../../target/review-s8a-b9bbecf5/handoff.json), [exact manifest](../../target/review-s8a-b9bbecf5/candidate.json), and [Lead review](../../target/lead-s8a-b9bbecf5/review.json).

## Behavior and scope

Settings → Appearance exposes the original19 palettes and10 font options, including system default and9 local bundled fonts. Optional browser preferences validate stored values and remain usable when storage fails. A pointer/keyboard divider persists the original25–75/default50 requested desktop proportion; pane minimum widths can constrain physical geometry at narrow desktop sizes. Mobile retains panel navigation. The composer reserves its actual layout height, preserving the transcript and useful execution controls.

Lead reviewed all production changes and the three legacy browser-fixture navigation adapters. Native protocol, authority, queue and maintenance implementations are unchanged. Draft/command storage remains distinct from best-effort appearance preferences. No new package/API/framework or provider call was needed.

## Verification

`node scripts/s8a-browser-acceptance.cjs dist/deck2` passed independently in **30.066s**, using a disposable packaged host, protocol fixture and browser. Evidence: [replay](../../target/lead-s8a-b9bbecf5/replay.json), [browser result](../../target/lead-s8a-b9bbecf5/browser/result.json). It exercised theme search, Escape/focus return, all bundled fonts, pointer/keyboard split, persistence/reload, draft and message identity during streaming, IME non-submission, rapid view reversals, reduced motion, malformed/throwing optional storage and320/768/1024/1440 viewport overflow checks. Owned browser/host settled; no personal host/provider used.

Connected typing with a requested12ms inter-key delay took699ms; hidden-node reinsertion count remained zero. This is bounded regression evidence, not an input-latency percentile or general hardware certification. The measured transcript bottom and composer top were both804px at1000px viewport height.

Owner17 frontend tests, typecheck, package build and affected entrance/motion/composer/queue/maintenance journeys are reused with their original candidate attribution and matching inputs. [Gate records](../../target/review-s8a-b9bbecf5/evidence/final-gates.json) distinguish the interim fixture-only candidate from the final candidate. All Rust/host inputs remain byte-identical to acceptedf7c79993, so its148 Rust/fmt/Clippy evidence is reused. Historical actual Codex graph/exact-read proof remains attributed to7462b729; no fresh exact-binary provider or new-version proof is claimed. [Reuse mapping](../../target/review-s8a-b9bbecf5/reuse.json).

## Visual comparison and limits

[Comparison with12 captures](../../target/review-s8a-b9bbecf5/comparison.json) uses the [saved live Deck reference](../design-reference/live-20261111/README.md). Lead viewed the original/candidate desktop-dark Settings and mobile-dark home, plus candidate mobile-light Appearance and desktop-light home. Appearance composition, spacing, typography and palettes align with the reference. Home states differ: the reference has no selected session, while the candidate is connected to a disposable project. The sidebar lacks later project/usage functionality, and Settings exposes only implemented Appearance. These are explicit scope differences, not pixel-perfect or full-parity claims.

The original Quality task accepted a bounded independent interaction/accessibility/performance review with Production30 as source. S1-Q07, successful new interactive sign-in, broader S7 support and remaining S8–S12 work stay open. No personal tool update, account/profile/model change, installed-binary change, commit or publication occurred.

## Acceptance and installation

Lead reviewed the complete Quality27 report (1452bytes, SHA256 `3d0372e23f894cb707e763697b33fea1c5547d51d59648553074c68ec830a309`) and rematched155 inputs,22 assets and current/frozen binary before accepting the bounded slice at233418. Quality found no material defect; its independent preference check passed1 test/22 assertions in20ms. Its supplemental Playwright attempt failed before browser behavior with EROFS after15ms, so those extra edges remain source-reviewed, not independently browser-reproduced. Lead's30.066s packaged replay supplies the independent browser evidence. No extra unchanged suite or provider execution was repeated.

On2026-11-11T23:58:43Z, Lead atomically replaced `/home/kevin15011/.local/bin/deck2` with frozen605f4e83, retained predecessor97d59684, checked the installed digest, version and serve help, and recorded [installation evidence](../../target/deck2-s8a-install-evidence.json). This release changes no host/service schema (API6,host9,service3), does not open/migrate user state and updates no personal tools. An already running host keeps its prior build until the user restarts it. S1-Q07, new interactive sign-in and remaining migration scope remain open.
