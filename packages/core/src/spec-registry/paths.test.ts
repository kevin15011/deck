import { describe, expect, test } from "bun:test";

import {
  changeDir,
  registryPath,
  statePath,
  eventsPath,
  artifactPath,
  artifactFileName,
  schemaPath,
  templatesPath,
  OPENSPEC_ROOT,
  OPENSPEC_REGISTRY_DIR,
  OPENSPEC_CHANGES_DIR,
  OPENSPEC_SCHEMAS_DIR,
} from "./paths";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("OpenSpec path constants", () => {
  test("OPENSPEC_ROOT is 'openspec'", () => {
    expect(OPENSPEC_ROOT).toBe("openspec");
  });

  test("OPENSPEC_REGISTRY_DIR is under openspec", () => {
    expect(OPENSPEC_REGISTRY_DIR).toBe("openspec/registry");
  });

  test("OPENSPEC_CHANGES_DIR is under openspec", () => {
    expect(OPENSPEC_CHANGES_DIR).toBe("openspec/changes");
  });

  test("OPENSPEC_SCHEMAS_DIR uses developer-team namespace", () => {
    expect(OPENSPEC_SCHEMAS_DIR).toBe("openspec/schemas/developer-team");
  });
});

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

describe("registryPath", () => {
  test("returns openspec/registry under root", () => {
    expect(registryPath("/project")).toBe("/project/openspec/registry");
  });

  test("handles relative root", () => {
    expect(registryPath(".")).toBe("./openspec/registry");
  });
});

describe("changeDir", () => {
  test("returns change directory under openspec/changes", () => {
    expect(changeDir("/project", "add-dark-mode")).toBe(
      "/project/openspec/changes/add-dark-mode",
    );
  });

  test("handles kebab-case change names", () => {
    expect(changeDir("/project", "fix-auth-token-refresh")).toBe(
      "/project/openspec/changes/fix-auth-token-refresh",
    );
  });
});

describe("statePath", () => {
  test("returns state.yaml inside change directory", () => {
    expect(statePath("/project", "add-dark-mode")).toBe(
      "/project/openspec/changes/add-dark-mode/state.yaml",
    );
  });
});

describe("eventsPath", () => {
  test("returns events.yaml inside change directory", () => {
    expect(eventsPath("/project", "add-dark-mode")).toBe(
      "/project/openspec/changes/add-dark-mode/events.yaml",
    );
  });
});

describe("artifactFileName", () => {
  test("maps exploration to exploration.md", () => {
    expect(artifactFileName("exploration")).toBe("exploration.md");
  });

  test("maps proposal to proposal.md", () => {
    expect(artifactFileName("proposal")).toBe("proposal.md");
  });

  test("maps spec to spec.md", () => {
    expect(artifactFileName("spec")).toBe("spec.md");
  });

  test("maps design to design.md", () => {
    expect(artifactFileName("design")).toBe("design.md");
  });

  test("maps tasks to tasks.md", () => {
    expect(artifactFileName("tasks")).toBe("tasks.md");
  });

  test("maps apply-progress to apply-progress.md", () => {
    expect(artifactFileName("apply-progress")).toBe("apply-progress.md");
  });

  test("maps verify-report to verify-report.md", () => {
    expect(artifactFileName("verify-report")).toBe("verify-report.md");
  });

  test("maps review-report to review-report.md", () => {
    expect(artifactFileName("review-report")).toBe("review-report.md");
  });

  test("maps archive-report to archive-report.md", () => {
    expect(artifactFileName("archive-report")).toBe("archive-report.md");
  });
});

describe("artifactPath", () => {
  test("returns artifact file inside change directory", () => {
    expect(artifactPath("/project", "add-dark-mode", "spec")).toBe(
      "/project/openspec/changes/add-dark-mode/spec.md",
    );
  });

  test("returns proposal artifact path", () => {
    expect(artifactPath("/project", "fix-auth", "proposal")).toBe(
      "/project/openspec/changes/fix-auth/proposal.md",
    );
  });
});

describe("schemaPath", () => {
  test("returns schema file under developer-team schemas", () => {
    expect(schemaPath("/project", "change-state.schema.json")).toBe(
      "/project/openspec/schemas/developer-team/change-state.schema.json",
    );
  });
});

describe("templatesPath", () => {
  test("returns template file under developer-team templates", () => {
    expect(templatesPath("/project", "proposal-template.md")).toBe(
      "/project/openspec/schemas/developer-team/proposal-template.md",
    );
  });
});
