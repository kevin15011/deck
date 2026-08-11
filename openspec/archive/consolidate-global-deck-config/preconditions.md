# Preconditions: Consolidate Global Deck Configuration

- User explicitly requested global, repository-agnostic Deck configuration.
- Existing local and legacy configs must remain untouched until values are safely represented in canonical XDG config.
- Tests must use temporary HOME/XDG/project roots only.
- No production migration test may modify the user's real config or project files.
- The uncommitted local `.deck/config.json` is user state and must not be staged, deleted, or silently rewritten.
