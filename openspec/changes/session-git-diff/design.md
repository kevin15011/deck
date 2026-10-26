# Git diff and workspace layout — working design

Approved product contract: proposal.md. Status: implemented and independently reviewed on Linux x64/Bun 1.3.12; other native targets remain unqualified. See verify-report.md.

## Boundaries

The session host owns bounded read-only Git access resolved from the authorized session project/worktree, behind existing authenticated web API patterns. The browser receives a file catalog and requested file diff, never an unrestricted shell or arbitrary filesystem API. Preserve ordinary unstaged (index to worktree) and staged (HEAD to index) semantics; non-ignored untracked files are explicitly new. Do not add session baselines, history comparisons or attribution logic.

Use argument arrays, literal path handling, time/output limits and no external diff/textconv helpers. Validate paths from the current repository catalog and handle symlinks without reading external targets. Handle absent repositories/HEAD, binary content, conflicts and bounded output explicitly. Reuse existing process/security helpers where suitable.

The UI loads the catalog when the diff tab is visible and file content when selected; explicit refresh is sufficient for the first delivery. Preserve selections across refresh when still valid. Ignore stale responses after file/session changes. No background Git polling in hidden tabs. Inline and side-by-side share the same parsed data and bounded context. Choose the smallest maintainable rendering approach after inspecting existing dependencies.

## Layout

Keep navigation visibility independent. Replace workspace-collapsed semantics with a single desktop content mode: chat, both or workspace. Migrate the existing preference conservatively (collapsed workspace means chat; otherwise both). Controls live in a stable application header, use consistent icons/labels and remain reachable in every mode. Avoid duplicate hide/expand controls. Hiding panes must not discard chat drafts, conversation or component selection state, nor stop execution. Desktop preference must not make views inaccessible when crossing mobile breakpoints.

## Verification and handoff

Focused Git fixtures cover staged/unstaged/new/deleted/renamed/binary/conflicted content, missing HEAD, path boundaries and unchanged worktree/index/history. UI checks cover both render modes, all layout modes, all workspace tabs, mobile transitions, preserved drafts and stale async results. Hydrated browser verification is required for layout claims; save reusable checks and screenshots rather than repeatedly rebuilding scripts. Bound large-diff behavior and report actual tested limits.

The implementation owner returns changed paths, concrete API/renderer choices, focused test evidence and browser artifacts. Lead owns OpenSpec updates. Independent review will cover the new filesystem boundary and layout regressions. No canary restart or release is part of candidate implementation.

## Implemented decisions

Authenticated GET `/api/sessions/:sessionId/git` provides the catalog; `/api/sessions/:sessionId/git/diff?section=...&path=...` provides one document. The manager resolves the durable session project root, with no caller root override. A bounded unified-hunk parser provides both render modes without a new dependency; Git performs comparisons and React escapes content.

Git uses argument arrays and literal pathspecs. Catalog: `status --porcelain=v1 -z --untracked-files=all --ignore-submodules=dirty`. Patch commands use `diff --no-ext-diff --no-textconv --no-color --no-relative --unified=3`, fixed output indicators and `--ignore-submodules=dirty`. Staged appends `--cached -- [previousPath] path`; unstaged appends `-- [previousPath] path`; untracked appends `--no-index -- /dev/null path`. All commands disable pager/fsmonitor/untracked cache and optional locks; inherited Git environment overrides and global/system config are suppressed. Blank context is normalized with `diff.suppressBlankEmpty=false`.

Limits: 500 catalog entries, 1 MiB command output, 256 KiB rendered worktree content/patch, 6,000 patch lines, five seconds per Git command, one request per project key and four concurrent projects. Construction is bounded to 100,000 entries, ten seconds and 64 MiB captured metadata/content; worktree excess is represented per entry. Staged limits apply to the staged comparison independently of working content. Sessions target a worktree root; conventional linked worktrees and shared clones are supported. Symlinks/special files, filter-managed content, submodule working state, nested repositories and conflicts receive explicit unavailable/uncertain states where needed rather than false clean results.

The host supervises a separate OS process so native failure cannot abort the session host. Private pipes carry a versioned JSON request and fresh token; request/output limits are 32 KiB/4 MiB, with a 30-second deadline and process-group termination. Parent-owned temporary cleanup is asynchronous. Source mode launches the helper entrypoint; compiled mode reexecutes the canonical CLI's internal helper dispatch before stores/adapters initialize.

The helper uses descriptor-relative no-follow reads and a disposable private Git view. Objects are opened through pinned directories and exposed to Git as inherited read-only descriptors; history bytes are not copied. Index/refs and selected worktree content are captured with bounds. Conventional Git metadata pointers supply bounded metadata authority, never API root overrides. Private config retains only non-executable semantic settings, including core.symlinks; executable filter/hook definitions are absent. This design preserves Git comparisons without session baseline/history machinery. Native filesystem bindings use Bun FFI inside the subprocess; Linux x64 is verified, other native ABI targets remain pending.

Header content modes preserve mounted panes and the existing equal split. Mobile uses one-view navigation and inline rendering. Refresh is explicit, with no hidden polling. Verification provenance and remaining broader-test failures are recorded in apply-progress.md.

## Final Review navigation and Markdown delta

Visible tabs are Chat, Activity, Subagents, Review. The internal git route remains stable and legacy OpenSpec routes migrate safely. The file navigator uses native disclosures and buttons, section/path identities, status colors plus labels, and independent terminal/descendant rows for file-to-folder replacements. Lead context is rendered only within the conversation.

Authenticated `GET /api/sessions/:sessionId/git/content?section=...&path=...` uses the same isolated process and catalog membership checks. Full content is bounded to 256 KiB. Staged previews use regular index blobs, working/untracked previews use captured regular worktree files, staged deletions use HEAD and unstaged deletions use the index. Validated object IDs are checked with `cat-file -s` before `cat-file blob`. Existing filter/symlink/conflict/binary guards remain. Markdown uses the existing safe renderer with raw HTML skipped, unsafe/local links inert and remote images represented as text. Diff and preview reading positions are separate; busy retries are cancellable and bounded to user-requested visible reads.
