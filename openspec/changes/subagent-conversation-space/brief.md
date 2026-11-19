# Conversation space in subagent detail

Collapse the assignment behind a native disclosure in the detail view. Cap the scrollable summary card at 40% of the panel height to keep messages visible even when the assignment, result or failure detail is long. Preserve the existing compact list preview and inspector typography.

Verified the rendered Subagents component with long assignment and result fixtures in Chromium. With the disclosure closed or opened by keyboard, the transcript remained 258 px high in a 425 × 600 panel and 120 px high in a 325 × 370 panel. The conversation endpoint was simulated. TypeScript and the three timestamp and subagent rendering tests passed.

The installed launcher and running host lacked the disclosure included in the prior project build. Installed the verified package atomically at the launch path used by Settings. Its SHA-256 matches dist/deck2 (4ffcda82a57fb8704cc8326a762be89875c0240fddc5ea05f66f55993f920542). Application restart reported busy; activation is pending an idle restart.
