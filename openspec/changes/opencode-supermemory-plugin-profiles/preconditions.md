# Preconditions: OpenCode Supermemory Plugin Profiles

- Release version: v0.6.0, selected by the user on 2026-09-29 after testing the branch canary.
- User authorized the release in a separate message on 2026-09-29. This authorization does not convert the unverified full composed-process test into passing evidence.
- Main and the published v0.5.0 tag point to `b67e35c`; the candidate feature branch adds `455307d`. Never move the existing tag.
- `.serena/project.yml` is an unrelated pre-existing worktree modification. Do not stage or discard it. Test-generated untracked `.bun-cache/` is also excluded from release commits.
- Use the pinned Bun 1.3.12 release toolchain for build verification; the ambient Bun 1.4.0 cannot generate canonical assets. Leave managed user credentials and installations untouched during release checks.
