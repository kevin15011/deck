# Human-operated Web terminals: feasibility

Status: feasibility research only. No terminal feature, privileged command, dependency installation, PTY session or remote endpoint was created. The user asked to pause voice-note research and study interactive terminal access from the Web UI, including sudo. The approved continuity source/package work remains preserved; its unresolved live-build compatibility boundary is unchanged.

## Conclusion

Feasible as an explicit, human-operated host-terminal capability, separate from agent execution and model modality. Use a browser terminal emulator, authenticated bidirectional WebSocket transport and a supervised PTY on the daemon host. A terminal on a phone controls the daemon's machine, not the phone. This provides command-line access, not a complete remote desktop or visibility into every application.

Recommend an opt-in macOS/Linux first slice: explicit terminal creation, trusted host/cwd identity, keyboard input, resize, Ctrl+C, exit status, disconnect/reconnect to the same live PTY and explicit close. No automatic agent access, command replay or persistent terminal recording. Remote use requires a deliberate terminal grant and secure transport. These are proposed constraints, not an approved implementation contract.

## Verified local trace

Investigate task `task-5913e085-4348-4b61-92cf-ba90375b48fb`, attempt 7, traced:

- `packages/session-host/src/supervisor.ts`, `anchor.ts` and Core `SupervisedChild`: existing runner supervision uses process groups and pipes. A human PTY needs its own lifecycle path; do not attach a browser to the agent's stdin.
- `packages/session-host/src/web-service.ts`: loopback auto-authentication and paired device cookies have no terminal-specific scope. Host/Origin validation, forwarded-origin configuration and revocation exist, but adding shell endpoints beneath those permissions would silently broaden existing authority. Existing WebSocket events are log subscriptions, not an interactive terminal protocol.
- `packages/session-host/src/daemon.ts`: busy/idle accounting covers current agent work and approvals, not human terminals. Explicit terminal ownership, shutdown policy and release/removal semantics are required.
- Installed Bun types expose PTY options, write/resize/data/drain/close, but types are 1.3.14 while runtime is pinned to 1.3.12. Lead directly checked the cached pinned executable: `{version:"1.3.12",terminalApi:"function",platform:"darwin"}`. This proves API presence only; no PTY or compiled-runtime behavior was tested.
- `scripts/build-binaries.ts` targets Linux and macOS. Windows/ConPTY is not part of this proposed first slice; newer upstream Bun documentation does not certify the pinned runtime across platforms.

## Authority and sudo

The shell should run as the daemon's ordinary OS user. Do not run the daemon as root, insert passwords into commands, bypass sudo policy or turn agent approval/YOLO mode into terminal authority. An interactive PTY can support sudo's terminal prompt, subject to real controlling-TTY behavior, local sudoers and authentication configuration. Touch ID, PAM, hardware prompts and platform-specific behavior remain unverified.

The user types credentials into the terminal. Those bytes necessarily traverse trusted browser code and Deck's transport/process path; do not claim end-to-end secrecy from Deck itself. Do not log input or send it to models, memory, chat history or the session event ledger. A normal hidden password prompt avoids echo, but arbitrary programs can echo secrets, so output buffers are sensitive too. Prefer bounded in-memory output, short retention and explicit clearing; metadata-only audit must still avoid sensitive titles and paths where unnecessary.

Each device requires explicit terminal authority beyond ordinary pairing/local chat cookies. Grant creation must not be reachable using the same unprivileged cookie alone. A shared-origin XSS could still exercise granted authority; permission separation does not remove frontend compromise risk. Consider a minimal separate terminal page/context, bundled assets, strict origin validation, TLS remotely and revocation of existing connections. A terminal grant is host access under one OS account, not multi-user isolation. Supporting mutually untrusted users requires OS-account/container/SSH isolation and a different scope.

## Proposed process and transport rules

- One explicit writer per PTY; additional viewers only by deliberate sharing. The agent has neither read nor write access by default. Sharing selected output into chat is a separate user action.
- Pass shell executable and arguments structurally; sanitize inherited Deck/provider environment. Starting in a project directory is a convenience, not a filesystem sandbox. User shell profiles may load personal configuration and credentials and need an explicit startup policy.
- Separate stream/input/resize/close messages from the event ledger. Bound byte rates and memory, respect backpressure and avoid unbounded output replay. Never retransmit uncertain input after reconnect.
- Keep disconnect distinct from explicit close. Propose a bounded grace period for reconnection while the daemon lives, with visible expiry. Count live PTYs in busy accounting so daemon shutdown cannot silently treat an active user command as idle.
- Process groups, foreground signals and cleanup of descendants require a native spike. A daemon crash does not inherently guarantee child cleanup; implement and verify that policy. Surviving daemon restarts via a separate broker or tmux is a later option with additional lifecycle complexity, not a default promise.
- Mobile interaction needs explicit Ctrl/Tab/Esc/navigation keys, paste handling and viewport resize. Background suspension must not automatically replay keystrokes or create another shell.

## Next research validation, if authorized

Use an isolated unprivileged fixture to verify pinned Bun PTY behavior, controlling terminal, resize, UTF-8, signals, exit status, large output, reconnection and packaged execution. Then review terminal-specific authorization/revocation and lifecycle design. Validate sudo separately with deliberate human participation on a test account; this study performed no sudo invocation. Measure integration cost before committing to Bun.Terminal versus a native helper such as node-pty, whose packaging adds dependencies.

## Primary sources

- [Bun subprocess/PTY documentation](https://bun.sh/docs/runtime/child-process): current API reference; pinned runtime behavior needs its own validation.
- [xterm.js security guidance](https://xtermjs.org/docs/guides/security/): browser/script trust, terminal I/O and WebSocket authorization.
- [xterm.js flow control](https://xtermjs.org/docs/guides/flowcontrol/): bounded transport and rendering throughput.
- [Upstream sudo manual](https://github.com/sudo-project/sudo/blob/main/docs/sudo.man.in): terminal authentication and policy behavior.

No implementation estimate, sudo compatibility certification, remote-terminal exposure or production security approval is implied by this study.
