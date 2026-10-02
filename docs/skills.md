# Skills

Deck ships two kinds of skill content: lifecycle skills that accompany the Developer Team installation, and standalone external skills that can be selected or used by goal. Project-local skills are discovered separately and are not part of the bundled distribution catalog.

> **Audience:** People browsing or selecting Deck skills.
> **Authority:** Skill distribution reference; the bootstrap and external catalogs define the shipped inventory.
> **Maintainer:** Deck maintainers.
> **Evidence:** [bootstrap catalog](../packages/core/src/skills/bootstrap/index.ts), [external catalog](../packages/core/src/skills/external/index.ts), [generated bundle ownership](../packages/core/src/skills/external/content.generated.ts), and [skill discovery command](../apps/cli/src/skill-registry-command.ts).

## Lifecycle skills

These are installed beside the Developer Team and are not materialized as role agents.

| Skill ID | Purpose |
|---|---|
| `deck-onboard` | Walks a project into the Deck workflow and establishes the appropriate readiness and context path. |
| `deck-archive` | Closes an approved OpenSpec change while preserving lifecycle traceability and historical artifacts. |

## Bundled external skills

These 59 skills are shipped as standalone reusable content. They are copied with their source frontmatter and are not bound to Developer Team agents.

| Skill ID | User goal |
|---|---|
| `api-and-interface-design` | Design stable APIs and module boundaries. |
| `ci-cd-and-automation` | Set up or modify CI/CD and automation. |
| `code-review-and-quality` | Review changes across correctness, architecture, security, and maintainability. |
| `code-simplification` | Refactor working code for clarity without changing behavior. |
| `cognitive-doc-design` | Write documentation that reduces cognitive load. |
| `comment-writer` | Draft warm, direct collaboration and review comments. |
| `debugging-and-error-recovery` | Diagnose failures systematically and recover from unexpected errors. |
| `deprecation-and-migration` | Manage deprecation, migration, and system retirement. |
| `documentation-and-adrs` | Record durable decisions and supporting documentation. |
| `doubt-driven-development` | Apply adversarial checks to decisions where correctness matters. |
| `frontend-ui-engineering` | Build and modify production-quality user interfaces. |
| `git-workflow-and-versioning` | Structure Git workflow, branching, conflicts, and versioning. |
| `idea-refine` | Turn a rough idea into an actionable, stress-tested concept. |
| `interview-me` | Clarify underspecified intent through focused questions. |
| `judgment-day` | Run a blind dual review, fix confirmed issues, and re-judge. |
| `performance-optimization` | Optimize application performance from requirements and profiling evidence. |
| `security-and-hardening` | Harden input, authentication, storage, and integrations. |
| `shipping-and-launch` | Prepare production launches, monitoring, rollout, and rollback. |
| `test-driven-development` | Drive behavior changes with proportional tests. |
| `using-agent-skills` | Discover and invoke the relevant agent skill. |
| `ui-skills-root` | Select the smallest useful UI skills context before UI work. |
| `frontend-design` | Establish an intentional visual direction for distinctive interfaces. |
| `baseline-ui` | Quickly improve spacing, hierarchy, typography, and layout polish. |
| `fixing-accessibility` | Audit and fix HTML accessibility and interaction issues. |
| `fixing-motion-performance` | Audit and fix animation and motion performance problems. |
| `fixing-metadata` | Audit and fix SEO, social, and document metadata. |
| `web-quality-audit` | Audit web performance, accessibility, SEO, and best practices. |
| `playwright-cli` | Automate browser interactions and work with Playwright tests. |
| `design-lab` | Explore multiple UI variations and turn feedback into an implementation plan. |
| `deck-frontend-design` | Select compatible aesthetic skills, establish a shared visual direction, and replace rejected directions. |
| `animation-vocabulary` | Name motion effects and translate visual descriptions into animation terminology. |
| `apple-design` | Create Apple-inspired interfaces with physical motion and restrained visual hierarchy. |
| `archify` | Build explorable HTML and SVG architecture and workflow diagrams. |
| `architecture-diagram` | Create self-contained architecture and infrastructure diagrams. |
| `baoyu-xhs-images` | Compose illustrated social-media infographic card series. |
| `beautiful-article` | Turn source material into a designed, offline HTML article. |
| `better-ui` | Polish optical alignment, surfaces, controls, and interaction details. |
| `brand-guidelines` | Apply Anthropic branding when that brand is explicitly requested. |
| `brandkit` | Design visual brand kits, identity boards, and presentation concepts. |
| `design-taste-frontend` | Choose distinctive visual directions for landing pages, portfolios, and redesigns. |
| `diagram-design` | Design branded diagrams for systems, processes, and data. |
| `excalidraw-skill` | Author and refine diagrams with an available Excalidraw canvas. |
| `expo-native-ui` | Build native-feeling Expo interfaces with platform conventions. |
| `field-notes-editorial-template` | Create editorial HTML reports using the Field Notes template. |
| `flint-chart-author` | Author semantic chart specifications for an available Flint renderer. |
| `flint-theme-author` | Translate visual identities into reusable Flint chart themes. |
| `gsap-core` | Implement responsive animations with the GSAP core API. |
| `gsap-scrolltrigger` | Implement scroll-linked motion, pinning, and scrubbing with GSAP. |
| `gsap-timeline` | Sequence and coordinate GSAP animations with timelines. |
| `high-end-visual-design` | Establish premium visual hierarchy, typography, spacing, and motion. |
| `html-plan` | Present an implementation plan as HTML when explicitly requested. |
| `image-to-code` | Generate and analyze visual references before implementing matching interfaces. |
| `industrial-brutalist-ui` | Create rigid, utilitarian interfaces with Swiss typography and terminal aesthetics. |
| `landing-page-design` | Design landing-page structure, visual hierarchy, and conversion journeys. |
| `minimalist-ui` | Create restrained editorial interfaces with warm monochrome palettes. |
| `redesign-existing-projects` | Audit existing interfaces and implement a distinct visual upgrade. |
| `review-animations` | Review animation craft when the skill is explicitly invoked. |
| `scroll-craft` | Design expressive scroll-driven landing pages and signature motion. |
| `visual-explainer` | Create self-contained HTML explanations, diagrams, and visual reports. |

For aesthetic selection and compatible combinations, see [Frontend design](frontend-design.md). A bundled skill can require project libraries or external tools; its inclusion does not install those dependencies.

## Project-local skills

This repository's [deck-runner-evolution skill](../.agents/skills/deck-runner-evolution/SKILL.md) reviews new stable Codex, OpenCode, and Claude Code releases against Deck and maintains a [version review record](runner-evolution/README.md). It is project-local and is not shipped in the bundled external catalog.

Project-local skills are discovery candidates supplied by the project and the active runner. They are not bundled Deck content, and their discovery metadata is not authority. Discovery is bounded to generic project roots plus the selected runner's declared sources; another runner's exclusive roots are not merged in.

Read-only checks:

```sh
deck skill-registry validate --runner pi
deck skill-registry discover --runner opencode --json
```

An explicitly authorized refresh is separate from validation and discovery:

```sh
deck skill-registry refresh --runner pi
```

Refresh can be refused when the source set is incomplete, the registry is not protected by `.gitignore`, or the caller has not supplied the exact write authority. See [Project workflows](project-workflows.md) for the boundary and [Runners](runners.md) for active-runner scope.
