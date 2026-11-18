# S8b image attachment verification

Status: **bounded S8b accepted and installed** as candidate a9f0da92/binary8a966675. Production32 is integrated at239815 and Quality29 at240159; Lead resolved S8B-Q01/Q02 on both tasks. S1-Q07 remains open. Earlier checkpoint evidence below is retained with its original attribution; the final acceptance section supersedes its pending installation status.

Candidate `01f53b924e863a950df88640d055609c9df2ff2b87794f15920a5f8ef60bf33b`, binary `4534af42b1cdf271a9b429169ae751c01a6c69aaeefd5198d195bef43d0e6b8d`. Lead rematched162 current/frozen implementation inputs,22 assets and both binaries before and after replay. [Frozen handoff](../../target/review-s8b-01f53b92/handoff.json), [manifest](../../target/review-s8b-01f53b92/candidate.json), [Lead review](../../target/lead-s8b-01f53b92/review.json).

## Behavior and boundaries

Select or paste PNG/JPEG/WebP images, preview them, retry failed uploads and remove drafts. Source conversation ownership survives navigation; ready references and unresolved command identity survive reload. Limits are8 images,5MiB each,20MiB per message,16384px per dimension and40million pixels. Rust checks actual decoded contents, with one decoder at a time and a192MiB allocation ceiling.

Image bytes live in the existing private host SQLite state. Authenticated, origin-checked routes use opaque scoped identities; polling contains metadata and references. Ordered attachment IDs join command identity, immutable metadata joins receipts, and accepted/queued images cannot be removed as drafts. Staging rejects at128 unreferenced images or128MiB without evicting accepted content. Cancellation identities prevent late upload completion after removal;4096 cancellations per conversation requires another conversation for additional uploads. Session removal clears its image state under existing ownership checks.

Only **Codex read-only root inputs** accept images. Other modes reject before dispatch. Native input validates stored digest/metadata and uses0600 temporary files in an owned0700 directory. No specialist forwarding or permission expansion is added. API7/host schema10 prevent predecessor clients/binaries from silently dropping image identity; recognized historical text state migrates transactionally. Service schema remains3. The installed API6/schema9 release has not been replaced and user state has not been migrated.

## Independent verification

All commands used the exact matched candidate. Owned hosts, projects and browsers were stopped; personal tools and user hosts were untouched. Sources are the Cargo manifest, repository environment script and S8b acceptance criteria.

| Check | Result | Wall time |
|---|---|---:|
| `source scripts/env.sh` then `nice -n 10 cargo test --locked -p deck2 --test images -j 2` |6 protected boundary tests passed |4.430s including4.14s compilation |
| `python3 scripts/s8b-schema-boundary.py` |Actual S8a migration, old/future binary refusal and reopen passed; historical text bytes preserved; no dispatch |0.618s |
| `node scripts/s8b-browser-acceptance.cjs target/review-s8b-01f53b92/dist/deck2` |Packaged browser journey passed |21.630s |
| Same browser command with `DECK2_REAL_IMAGE=1` |One real Codex image+text journey passed |18.681s |

[Lead evidence](../../target/lead-s8b-01f53b92/review.json) links the command records. The deterministic checks protect actual-content limits, authentication, session ownership, immutable ordered identity, pinning, queue/restart and remove-versus-late-upload behavior. Browser checks cover lost upload/submit acknowledgments, source navigation, clipboard/IME, draft and recorded-image reload, image-only default composition, preview focus/zoom, rapid GSAP reversals and reduced-motion cleanup. Connected scripted typing during a held upload took402ms with8ms requested inter-key delays and stable textarea identity; this is regression evidence, not a latency percentile.

The exact final binary sent a synthetic600×360 PNG with digest `01a92ef73275d6b9c1011db05e7462fe2f97aeeab2118f3feef1604e84879e2d` to selected Codex0.166.0, observed modelgpt-6.1-sol. Its answer correctly described a red circle upper-left, green triangle lower-left and blue rectangle lower-right. First output arrived5188ms after admission. The same image/history reopened after reload. [Real result](../../target/lead-s8b-01f53b92/real-image/result.json). Real image-only, other formats/counts and other runners are not implied by this one provider check.

Owner154 Rust tests, fmt/Clippy and final18 frontend/type/package gates are reused. Lead rematched all53 Rust/shared inputs supporting the earlier96a86b70 gate record; final presentation changes did not invalidate them. [Reuse mapping](../../target/review-s8b-01f53b92/reuse.json) separately attributes the owner's earlier real image proof toc36e0c63. Lead's new canary supplies final-binary proof. Existing affected appearance, entrance, queue/restart and motion records remain attributed to their exact runs. No unchanged full suite was repeated.

The first Lead identity wrapper used an incorrect asset prefix and stopped before tests. The first cargo invocation lacked the repository environment and failed before test execution; its record is retained. Corrected source/environment invocation passed. Neither is counted as a product failure or test pass.

## Visual evidence and remaining scope

Lead viewed the independent desktop attachment strip, mobile preview and original mobile preview projection. Familiar typography, controls, palette and preview bounds are retained. [Comparison](../../target/review-s8b-01f53b92/comparison.json) uses original component/CSS projection, not a private live session or full-shell pixel oracle. Current history shows thumbnails with generic labels; zoom is50–400% without a pan gesture. A separate light-theme attachment comparison was not qualified.

Incomplete uploads recover already stored content by upload identity; if no server content exists after reload, the file must be reselected. Browser File bytes are not persisted. Decode variants exceeding the resource ceiling can be rejected. These limits are distinct from successful ready-reference and admitted-message recovery.

The existing Quality task accepted fresh review with six structured S8b criteria and Production31 as source. Lead owns final acceptance/installation. S1-Q07, broader runner support and remaining daily-workspace/migration scope remain open. No commit, publication, personal updater/account/profile/model change or user-host restart occurred.

## Quality28 findings

Lead read the complete2733byte report (SHA256 `724768a5346b215f3aa48fc3609d41d8a6e9b1717186500eed4da7878023b5f9`) and rematched162inputs22assets/binary4534af42. Two medium findings are adopted; successful ordinary journeys do not cover these failure boundaries.

- **S8B-Q01:** `useImages.remove` persists removal of the draft, aborts upload and ignores cancellation DELETE failure. The aborted upload completion also returns without reconciling cleanup. A lost cancellation can leave uploaded bytes without a browser retry identity, eventually exhausting non-evicting staging. Quality reproduced the actual hook with in-memory storage/transport edges in22.7ms; Lead confirms the source ordering. Retain durable pending removal until acknowledgment, recover it after reload/reconnect and make unresolved failure visible. Removed inputs must not be resubmitted or erase admitted images.
- **S8B-Q02:** the temporary image directory is declared after `Native` in `run_inner`; error-return drop order removes it before Native signals the process and asynchronously reaps it. Successful terminal handling awaits termination, but request/acknowledgment/cancellation errors violate resource lifetime. Lead confirms this source path; no runtime process-fault reproduction is claimed yet. Bind image resources to process-cleanup ownership and preserve them until observed termination/reaping, including uncertain cleanup. Merely reordering local declarations cannot establish asynchronous settlement.

The repair should reproduce both defects at stable boundaries, fix them within the current small mechanisms and rerun only invalidated checks plus required candidate gates. No new service/framework or unrelated provider qualification is requested. Quality's8 API tests/59 assertions passed18ms. Its provider attribution covered the owner's earlierc36e0c63 proof; Lead's separate final-binary18.681s canary above is additional evidence, not evidence against these findings. S1-Q07 stays open.

## Q01/Q02 correction — a9f0da92

Production32 delivered candidate `a9f0da9214b24763968882a76bef4e9331ddc161a394302edd3f49db4cef57ed`, binary `8a9666759ca25297ab0a76f0f4ff53c19fdc00d009b449bb4e1ba37f502e37b9`. Lead read all five changed paths and the new hook test, then rematched163 inputs,22 assets and current/frozen binaries before and after checks. [Handoff](../../target/review-s8b-a9f0da92/handoff.json), [Lead review](../../target/lead-s8b-a9f0da92/review.json).

Removed images now become durable hidden records before cancellation, excluded from displayed/submitted/consumed images. Cleanup retries after source-scope restoration, online events and a10s timer for loaded scopes; failures are visible and late upload success cannot revive input. Pending records are bounded. Already recorded host cancellation acknowledges successfully even at the4096-record ledger cap.

Native now owns child, group identity and images together. Successful termination waits for child/group settlement before releasing images. Error/task-cancellation Drop transfers ownership to asynchronous cleanup, retaining a private path through unknown wait/reap results and releasing it after observed settlement. Runtime shutdown before observation can leave private temporary files; no startup sweep is added. The shared native Quality caller uses the same group identity.

| Independent check | Result | Wall time |
|---|---|---:|
| `bun test ./frontend/src/images.test.ts` |2 tests/7 assertions: retained removal, source reload/siblings, late aborted upload |0.033s |
| Repository environment, `nice -n 10 cargo test --locked -p deck2 --lib image_files_live_until -j 2 -- --nocapture` |Native error, malformed acknowledgment, task abort and uncertain reaping |4.029s including3.38s compilation |
| Same environment, `nice -n 10 cargo test --locked -p deck2 --test images acknowledged_removal_retries -j 2 -- --nocapture` |Cancellation capacity/idempotent acknowledgment |5.633s including4.22s compilation |
| `node scripts/s8b-browser-acceptance.cjs target/review-s8b-a9f0da92/dist/deck2` |Failed/lost DELETE response, reload/online cleanup and existing image journey |34.869s |
| Same browser with `DECK2_REAL_IMAGE=1` |Real synthetic image+text and history reload on final binary |20.294s |

All passed. The browser retained the sibling while removing the intended source upload after reconnection. Scripted typing during held upload took396ms with8ms requested delays and stable textarea identity. Real Codex0.166.0, observed modelgpt-6.1-sol, correctly described all three fixture shapes/colors/positions; first output arrived6580ms after admission. Owned hosts/browsers settled. [Protected records](../../target/lead-s8b-a9f0da92/protected.json), [browser records](../../target/lead-s8b-a9f0da92/browser-checks.json), [real result](../../target/lead-s8b-a9f0da92/real-image/result.json).

Owner156Rust/20frontend, fmt/Clippy/types/package gates are reused from1d43351a: Lead matched all162 other inputs and binary/assets. Only the browser fixture changed afterward and its final version was independently replayed. [Reuse map](../../target/review-s8b-a9f0da92/reuse.json). The owner's red/green record describes failures consistent with Lead's previously verified pre-fix source; Lead did not independently rerun the pre-fix candidate. Harness/compile corrections are not defect reproductions.

The process test aborts a real task during turn/start; it does not separately wait through the10s protocol interrupt timeout, whose error return uses the same Drop owner. Runtime-shutdown retention, source-conversation restoration for pending cleanup and deterministic-only image-only/other-format evidence remain explicit limits. The SAME Quality task accepted fresh review with both findings open and Production32 source. No user state migration, installed update, personal configuration change or full-S8 acceptance occurred.

## Acceptance and installation

Lead read the complete Quality29 report (1699 bytes, SHA256 `1a7093bcb74e38ffa412b8ca6a814bd1c1062d8c8b34dbb2273aa9b17c34e097`) and rematched all163 implementation inputs,22 assets and current/frozen binary `8a9666759ca25297ab0a76f0f4ff53c19fdc00d009b449bb4e1ba37f502e37b9`. Quality independently passed the two hook tests/7 assertions in26ms and reviewed native lifecycle evidence. Lead's existing independent process-fault, capacity, packaged-browser and real-Codex replay records above remain valid; unchanged checks were not repeated. Integration240159 accepts this bounded slice and explicitly resolves S8B-Q01/Q02 on production and review tasks. This does not close full S8 or S1-Q07.

At2026-11-12T01:03:48Z the frozen binary replaced `/home/kevin15011/.local/bin/deck2` atomically. The prior605f4e83 executable was preserved in `target/installed-backups`; installed hash, `--version` and `--help` passed. [Installation receipt](../../target/deck2-s8b-install-evidence.json). No user host was restarted, state opened/migrated or personal tool updated. An already running host continues its previous build until the user restarts it; reload its browser afterward and use the same-state private launch link if authentication is needed.

The installed protocol is API7/host schema10/service schema3. A prior executable cannot open migrated schema10, so a binary backup alone is not a database rollback. Native image support is limited to Codex read-only root inputs. Runtime shutdown before observed process settlement can retain private temporary image directories; there is no startup sweep. The preceding evidence qualifies these stated limits, not arbitrary images, providers, all platforms or complete visual parity.
