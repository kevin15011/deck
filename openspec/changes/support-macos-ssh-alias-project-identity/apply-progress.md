# Apply Progress: Support macOS SSH Alias Project Identity

## Status

Implementation is complete and independently reviewed GO. No release, publication, commit, push, installed-binary replacement, Git remote mutation, or SSH configuration mutation occurred.

## Evidence

- Stable `deck 0.4.2` reports `managed-runtime-project-missing` and `SUPERMEMORY_PROJECT_REMOTE_INVALID` for the reported macOS repository.
- Deck now resolves the effective Darwin account through fixed, bounded `/usr/bin/dscacheutil` execution with a replacement environment and strict one-record framing.
- The direct SSH configuration path and descriptor are validated against unsafe ancestors, file type, ownership, permissions, growth, size, controls, and unsupported directives; reads are nonblocking.
- Exact non-command `AddKeysToAgent` values are supported for common macOS SSH configuration while unknown and command-capable directives remain rejected.
- The real project `/Users/kevinlondono/Proyects/espritec-theme` resolves exactly to `sm_project_v1_comodin_software_espritec_theme` without dependency overrides or user configuration changes.
- Rejected aliases disable the production runtime host before provider access; the provider spy records zero calls.
- Portable compiled verification remains hermetic; real Darwin account/alias verification is explicit opt-in with a supplied project root.

## Protected files

- `.serena/project.yml` remains untouched.
