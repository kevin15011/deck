

### Quality91 required corrections — OPEN

Read627203/627204 and independently inspected frozen session_transition/create_session call ordering and session_mcp delivery key. Candidate704ecabf cannot be accepted/installed.

Q91-01 major: transition calls ordinary create_session before provenance validation; omitted approvals can reuse an unrelated existing YOLO target. Reject all pre-existing targets except exact recorded transition retry, enforce relay-only new creation and exact retry identity, preserve source/native context. Add real production route regression existing YOLO target with omitted approvals and source/target unchanged on rejection.

Q91-02: delivery uniqueness omits resource path; actual packaged archify examples/event-stream.dataflow.json and test/fixtures/v1-baseline/event-stream.dataflow.json share digest and collapse. Include exact resource identity in uniqueness; retain old ledger compatibility and verify both distinct paths survive reopen. Reviewer in-memory production INSERT probe reproduced2paths->1row.

Runtime117 measurement and UI19 currently running. On next SAME runtime owner continuation, prioritize both fixes with structured open findings before any final integration. Also add required protects annotations to new protected tests. Preserve raw native harness failed SIGTERM assertion versus bounded prefix and executed no-input reopen evidence. No installation.
