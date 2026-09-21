# Preconditions

- User authorized a development sandbox and pre-release Linux/macOS Node 20/24 checks, not release publication, global installations, or destructive Git operations.
- Implementation remained one vertical owner; Lead is the only OpenSpec writer.
- Deterministic tests use fixtures and injected provisioning effects. Explicit real acceptance provisioning is confined to disposable paths and does not change the personal toolchain.
- Native builds require the canonical Bun version in the release workflow (1.3.12), Git, tar, macOS codesign where applicable, and network for dependency/Node provisioning.
- Preserve the preexisting `.serena/project.yml` change and all historical OpenSpec artifacts.
- Remote CI is unavailable without pushing/dispatching repository changes; no claim of completed cross-platform certification is authorized by local tests alone.
