# Web workspace research and design decisions

Date: 2026-10-13. Owner: Deck Lead. Scope: responsive cross-runner conversation, operational activity, subagents and read-only OpenSpec artifacts. This is product research, not a claim of live usability testing of competing products.

## Repository diagnosis

The original `apps/web/src/state.ts` conversation selector included tools and public messages from every task. `main.tsx` gave these items the same message presentation and rendered text in `pre`. Background events also forced conversation scrolling. These are information architecture and interaction defects, not only color choices. Authentication, cursor replay, interrupted text, approvals and immutable runner assignment already have contracts to preserve.

## Primary evidence

Sources were retrieved on 2026-10-13 using Web search/point extraction (Lead) and Tavily search/point extraction (Architect). No recursive crawling. Undated sources are identified below; product pages describe the retrieved version only.

| Source | Evidence and provenance | Implication for Deck (design inference) |
| --- | --- | --- |
| [Claude: What are artifacts and how do I use them?](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them) | Official support, relative update label at retrieval; Web selected search extraction. Artifacts occupy a dedicated space beside the conversation; mobile has an artifact view. | Treat OpenSpec documents as a separate reading surface, keeping conversation context beside them on wide screens. |
| [OpenAI: Introducing canvas](https://openai.com/index/introducing-canvas/) | Official historical launch article, published 2024-10-03; Web point extraction. A separate window supports working on a document/code alongside chat. This is historical pattern evidence, not a claim about current feature availability. | A persistent document workspace suits iterative OpenSpec work better than burying complete documents among messages. |
| [Vercel AI Elements: Message](https://elements.ai-sdk.dev/components/message) and [Tool](https://elements.ai-sdk.dev/components/tool) | Official component documentation, undated; Web selected extraction. Distinct message and tool components expose text versus operational states/details. | Keep Lead prose in Chat; show tools and task lifecycle in Activity. Borrow the distinction without adopting a new application framework. |
| [Apple HIG: Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) | Official guidance, undated; Tavily point extraction by Architect at 08:48 UTC. Navigation consumes available width and should adapt to compact layouts. | Collapse desktop navigation to a rail; use a sessions drawer and one reading pane on narrow screens. |
| [Fluent 2: Wait UX](https://fluent2.microsoft.design/wait-ux) | Official guidance, undated; Tavily point extraction at 08:48 UTC. Describe actual progress and distinguish ongoing/completed/failure states. | Show real tool/task activity and concise status; do not fabricate progress percentages, time estimates or model reasoning. |
| [W3C: ARIA23, role log](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA23) | Official WCAG technique, metadata updated 2026-06-01; Tavily point extraction at 08:48 UTC. Labeled sequential logs can announce additions politely and non-atomically. | Provide named regions and restrained status announcements; avoid repeatedly announcing streamed tokens or moving focus. |
| [react-markdown documentation](https://github.com/remarkjs/react-markdown) | Maintainer documentation, undated; Web point extraction. Renders a Markdown syntax tree as React elements; remark-gfm adds tables, task lists and related syntax. | Use shared semantic rendering without raw HTML. Restrict URLs and remote images separately; parser defaults alone are not the entire application security boundary. |

## Selected behavior

Desktop uses a collapsible session sidebar followed by approximately equal Chat and workspace panes. Workspace tabs are Activity, Subagents and OpenSpec. Narrow layouts expose Chat plus those three destinations one at a time, retaining the user's draft and reading position. This is responsive web scope, not a native application, PWA or new network exposure feature.

Chat contains user messages and public Lead responses classified by canonical task identity, not display labels. Child prompts/results remain with their subagent. Activity uses compact summaries and expandable details; failures and pending approvals remain discoverable from every view. Markdown supports real paragraphs, lists, tables and code copying. Scrolling follows only when the user is already near the latest message.

OpenSpec lists active changes for an unbound session and only the immutable change for a bound session. Selecting a document does not change session ownership. Only nested Markdown artifacts beneath the trusted project OpenSpec changes directory are readable, with authentication, path/symlink checks, bounded enumeration/read and explicit empty/error states. Visible polling updates documents without switching the user's selected artifact.

The full visual agreement, palette and skills ownership are in `working-brief.md`. The rejected dark navy/blue direction is superseded by a light porcelain/graphite/pine workspace. No external fonts, images, tracking or UI framework migration are required.

## Validation plan

Verify semantic event separation, interrupted/replayed streams, safe Markdown, document scope/path boundaries, stale request handling, keyboard navigation, desktop/mobile overflow, scroll behavior, approvals across tabs and embedded production assets. Inspect actual screenshots before finalizing. Research supports the choices; browser acceptance and independent review provide implementation evidence. Neither replaces future feedback from the user's canary usage.
