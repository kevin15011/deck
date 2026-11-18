# Existing Web UI design baseline

## Controlling fidelity correction

The user clarified the acceptance target directly: Deck1 as used today, with the backend migrated to Rust. Preserve its functionality, interface, interaction, session continuity and configured runner/tool behavior; retain the agreed React/TypeScript and GSAP frontend. Existing Deck1 behavior is the specification to reproduce, not inspiration for a different product. Completion is assessed against the same observable user journeys. Newly invented mandatory modes or restrictions are migration gaps, not the new definition of done.

The user explicitly rejected the invented Deck2 workflow after ordinary-v1 installation. Deck1 is the functional and interaction reference as well as the visual reference. The migration must preserve its normal session creation, conversation continuity, runner/model assignment, permission/delegation and configured-tool behavior. Changing the implementation stack does not authorize adding mandatory setup steps, fresh execution per message, read-only-first substitutes, special Investigator activation, new product modes or alternate panels to accommodate incomplete adapters.

Previously accepted isolated runtime checks remain evidence of their bounded mechanisms, not approval of this divergent product experience. Any necessary deviation must be identified explicitly before implementation rather than silently substituted or presented as parity. Follow the actual Deck1 flow and reuse its presentation where appropriate. User clarification is only needed for a concrete unresolved deviation; do not ask the user to redesign or restate the existing product.


The user explicitly likes the current Deck Web UI and requires preservation of its design. After rejecting the first Leptos prototype, the user approved React/TypeScript presentation reuse with GSAP and the Rust backend. This is not authorization for a new aesthetic direction.

## Available references

- [Dark desktop](../../deck/docs/assets/screenshots/web-workspace-dark.png)
- [Light desktop](../../deck/docs/assets/screenshots/web-workspace-light.png)
- [Mobile](../../deck/docs/assets/screenshots/web-workspace-mobile.png)
- [Workspace structure](../../deck/apps/web/src/workspace.tsx)
- [Style rules](../../deck/apps/web/src/style.css), [themes](../../deck/apps/web/src/themes.css), [font faces](../../deck/apps/web/src/font-faces.css)

Lead visually inspected the dark desktop and mobile captures during planning. They show the project/session sidebar, conversation and secondary workspace panels, team/runner context, clear activity states, orange accents and adapted mobile tabs/navigation. These are repository reference captures, not proof of the exact latest running UI. The light capture is available but was not visually inspected by Lead in this pass.

## Preserve deliberately

| Area | Preservation target | Evidence required before acceptance |
|---|---|---|
| Information hierarchy | Project/session navigation, active conversation, contextual secondary panels and task status | Compare equivalent desktop states |
| Identity | Brand assets, palettes, typography, spacing and control treatments | Match chosen current theme/font and asset provenance |
| Responsive behavior | Accessible navigation and controls on narrow screens; useful panel switching | Desktop/mobile and resize comparison |
| Interaction | Composer focus, keyboard traversal, clear selection, interruptible transitions | Keyboard use and rapid reversals |
| State | Loading, empty, error, disconnected, busy, awaiting input and completed views | Equivalent state fixtures |
| Motion | Immediate feedback, restrained easing and reduced-motion behavior | Reduced-motion and interrupted-transition checks |
| Continuity | Draft and navigation state survive expected view changes | Switch panels/routes and reconnect |

Reuse the original React presentation, styles and assets where appropriate, adapting their inputs to the new contracts. GSAP is selected for transitions, with immediate feedback, cleanup, rapid reversal and reduced-motion behavior. The rejected prototype is not a new visual baseline. Do not defer typography, spacing, composer quality or useful empty/error states to S8 merely because this slice has fewer features.

## Baseline capture gate

The user subsequently authorized opening the current live Deck for reference. A [ten-image live baseline](design-reference/live-20261111/README.md) now records desktop/mobile, dark/light, home/navigation and appearance settings from `http://127.0.0.1:7421/`, with served asset and running-binary hashes. Use it as the primary reference for those surfaces. The earlier projected-shell fixture remains supplementary; actual conversation and approval states still need capture when their slices are implemented.

Before implementing visual fidelity, capture the agreed current running UI at representative viewport sizes and states, record its source revision and selected preferences, and agree measurable comparison tolerances. Existing screenshots alone do not specify every interaction or current pixel. Screenshots must avoid private conversation/credential content. This planning step does not launch or mutate the old product.

The first usable sprint should already use the recognizable workspace structure; later slices add authentic controls and states as their behavior lands. Do not make unsupported operations appear functional merely to match a screenshot.
