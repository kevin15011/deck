# Official Claude Supermemory fixture

`claude-supermemory-d42bd8066f0a.tgz` contains the complete `plugin/` tree from
supermemoryai/claude-supermemory commit `d42bd8066f0a5b6360a91e60c59772ef1134cab6`
(2026-10-29), retrieved 2026-10-31 from
https://codeload.github.com/supermemoryai/claude-supermemory/tar.gz/d42bd8066f0a5b6360a91e60c59772ef1134cab6.
The files are unmodified; archive metadata is not a production identity.
`supermemory-artifact.ts` pins every byte, including the vendored SDK and its license.
`official-supermemory-hooks.json` is the same upstream hook manifest for fast checks.

The acceptance harness extracts only this checked-in fixture into synthetic HOME,
then calls the production verifier/materializer. No upstream installer runs.
