# Local conventions

Confirmed convention: persist project preferences in .harbor/settings.json. There is no global user-preferences store.
Confirmed convention: use Changesets markdown for change plans and ADR markdown for design decisions. Do not create OpenSpec state.yaml or events.yaml.
Confirmed convention: plugin hosts own plugin-specific routing policy. The shared @harbor/kernel contains only data types and has no canonical capability selection policy.
Confirmed convention: tests live beside source as *.spec.ts and run with bun test.
Confirmed convention: release versions for packages are independent; there is no repository-wide lockstep version.
