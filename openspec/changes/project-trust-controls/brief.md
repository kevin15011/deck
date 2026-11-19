# Project trust controls

Allow users to grant project trust explicitly when adding a directory and to grant or revoke trust later in that project's settings. Code Map should reflect the saved decision for the settings target. Existing project records retain their trust, with no bulk migration. Adding a new project without opting in leaves it untrusted.

Implemented and verified with the real-host sidebar browser regression using --project-trust-only. Two runs passed for default-off, opt-in, scoped grant and revocation, re-add, failed save, Code Map refresh, and persistence after reload. Tested release binary SHA-256 7e003bbf4973c076c3121423e7a6f8632877b637276231d56f1c915ffa307769.
