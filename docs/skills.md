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

These 29 skills are shipped as standalone reusable content. They are copied with their source frontmatter and are not bound to Developer Team agents.

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

## Project-local skills

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
