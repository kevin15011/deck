# Frontend aesthetic selection

Deck Lead consults `deck-frontend-design` when choosing a frontend identity or interpreting aesthetic feedback. The shared core catalog lists 29 new source-audited standalone skills, alongside existing craft skills. Adapters expose the same router and support resources; Claude now packages canonical standalones in its private immutable plugin.

Selection is contextual instruction guidance, not a plugin parser or host-enforced aesthetic decision. Read compact profiles, shortlist candidates, inspect their actual instructions, then load the selected responsibilities through the active runner. One visual aspect has one final authority; compatible motion/components/imagery can coexist. Native, article, chart and diagram specialists remain scoped to their deliverables rather than becoming universal web styles.

Lead records the current visual agreement in the existing work artifact and shares it with specialists. Narrow feedback preserves unaffected decisions. A rejected direction is replaced with meaningful structural/typographic contrast; old mandates are retired instead of accumulated. User references, project brand, functional constraints and authority remain in force.

## Resources and provenance

[The bundled catalog](../packages/core/src/skills/external/deck-frontend-design/references/catalog.json) describes responsibilities, traits, platforms, requirements and invocation restrictions. [Source audit](reference/frontend-design-skill-sources.json) records upstream revisions, paths and licenses. OpenDesign and Taste are curated selections, not wholesale repository imports; duplicate/copied skills and unrelated behavior overrides are omitted.

All imported resources are complete UTF-8 text with upstream frontmatter and licenses preserved. Existing generated-bundle tooling is retained. JavaScript/Python helper scripts are passive files; Deck does not register third-party agents/hooks, execute helpers during installation, install their runtime dependencies or supply credentials. For example Excalidraw requires available tools/MCP; image/chart/native specialists require their actual tools/stack. Standalone installation is not proof of those capabilities.

Third-party scripts/templates are bundle data, not Deck TypeScript implementation; `tsconfig.json` excludes their scripts/assets and the optional Visual Explainer extension rather than adding those packages to Deck's dependencies.

## Discarded requests

Binary resources include even optional package icons/previews: the complete upstream package is excluded rather than silently trimming it. Other exclusions retain their distinct reasons below. No candidate was discarded merely because it had no `SKILL.md`; every requested repository exposed skills, but some packages could not be shipped as usable standalone resources.

| Request / actual skill | Reason |
| --- | --- |
| shadcn/ui | binary package resources |
| baoyu-design | binary package resources |
| swiftui-pro | binary package resources |
| theme-factory | binary package resources |
| helloianneo/ian-xiaohei-illustrations | binary package resources |
| s1dashu/ip-as-logo-skill | binary package resources |
| nolangz/pixel2motion | binary package resources |
| canvas-design | binary package resources |
| LiamGvchi/gc-minimal-zine-poster | binary package resources |
| liangdabiao/ecom-details-image | no redistribution license |
| hugohe3/ppt-master | binary package resources |
| baoyu-slide-deck | Upstream descriptor exceeds Deck safe YAML nesting policy; do not weaken discovery or rewrite upstream frontmatter. |
| ningzimu/codex-ppt-skill | Upstream descriptor exceeds Deck safe YAML nesting policy; do not weaken discovery or rewrite upstream frontmatter. |
| gzh-design | AGPL-3.0-or-later redistribution treatment not implemented; excluded from embedded Deck bundle |
| story-to-handdrawn-video | Skill depends on separate full Remotion renderer project, not a self-contained standalone bundle |
| impeccable | Upstream setup requires a downloaded native launcher binary even though its directory is text-only. |

`impeccable` was excluded despite its text-only directory because setup requires attempting a downloaded native launcher. `story-to-handdrawn-video` requires a separate renderer project. The two deep descriptor exclusions preserve Deck's safe YAML policy and upstream content rather than weakening discovery or rewriting metadata.

## Verification limits

Catalog/schema, complete-resource and adapter tests establish installation and discovery. Independent scenario evaluation checked combination, brand preservation, feedback contrast, manual invocation and missing tools. It did not render frontend proposals; aesthetic quality must still be evaluated on real projects and references. Full bodies are loaded progressively, although adding resources increases binary size and installation/model-plan filesystem work.
