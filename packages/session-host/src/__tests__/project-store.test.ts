import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectStore } from "../project-store";
import { cleanupTempDirs, tempDir } from "./test-helpers";

afterEach(cleanupTempDirs);

test("canonical project identities survive reload and symlink aliases", () => {
  const root = tempDir(), home = join(root, "home"), state = join(root, "state");
  mkdirSync(home); mkdirSync(state); mkdirSync(join(home, "repo"));
  symlinkSync(join(home, "repo"), join(home, "alias"));
  const store = new ProjectStore({ stateRoot: state, home });
  const first = store.register(join(home, "repo"), "Deck");
  expect(store.register(join(home, "alias")).projectId).toBe(first.projectId);
  expect(new ProjectStore({ stateRoot: state, home }).list()).toEqual([first]);
});

test("home confined suggestions exclude escaping symlinks and never expose files", () => {
  const root = tempDir(), home = join(root, "home"), state = join(root, "state");
  mkdirSync(home); mkdirSync(state); mkdirSync(join(home, "repo")); mkdirSync(join(root, "outside"));
  symlinkSync(join(root, "outside"), join(home, "escape"));
  const store = new ProjectStore({ stateRoot: state, home });
  expect(store.directories({ path: "~/" }).directories.map(d => d.name)).toEqual(["repo"]);
  expect(() => store.directories({ path: join(home, "escape") })).toThrow();
  expect(() => store.register(join(root, "outside"))).toThrow();
  expect(() => store.directories({ path: "../../" })).toThrow();
});

test("legacy imports retain missing projects while registration requires an available directory", () => {
  const root = tempDir(), home = join(root, "home"), state = join(root, "state");
  mkdirSync(home); mkdirSync(state);
  const store = new ProjectStore({ stateRoot: state, home });
  store.importLegacy(join(home, "missing"));
  expect(store.list()[0]?.available).toBe(false);
  expect(() => store.register(join(home, "missing"))).toThrow();
});

test("directory results and scan work are bounded", () => {
  const root = tempDir(), home = join(root, "home"), state = join(root, "state");
  mkdirSync(home); mkdirSync(state);
  for (let i = 0; i < 10; i++) mkdirSync(join(home, `repo-${i}`));
  const store = new ProjectStore({ stateRoot: state, home });
  const result = store.directories({ path: home, prefix: "repo-", limit: 2 });
  expect(result.directories).toHaveLength(2); expect(result.truncated).toBe(true);
});

test("replaced canonical roots remain unavailable and keep their original identity", () => {
  const root = tempDir(), home = join(root, "home"), state = join(root, "state");
  mkdirSync(home); mkdirSync(state); mkdirSync(join(home, "repo")); mkdirSync(join(home, "other"));
  const store = new ProjectStore({ stateRoot: state, home });
  const project = store.register(join(home, "repo"));
  renameSync(project.path, join(home, "old")); symlinkSync(join(home, "other"), project.path);
  expect(store.get(project.projectId)?.available).toBe(false);
  const reopened = new ProjectStore({ stateRoot: state, home });
  expect(reopened.importLegacy(project.path).projectId).toBe(project.projectId);
  expect(reopened.list()).toHaveLength(1);
});

test("project registration receipts survive restart without repeating a rename", () => {
  const root = tempDir(), home = join(root, "home"), state = join(root, "state");
  mkdirSync(home); mkdirSync(state); mkdirSync(join(home, "repo"));
  const store = new ProjectStore({ stateRoot: state, home });
  const first = store.registerCommand("command-1", join(home, "repo"), "Original");
  store.register(join(home, "repo"), "Renamed");
  const reopened = new ProjectStore({ stateRoot: state, home });
  expect(reopened.registerCommand("command-1", join(home, "repo"), "Original")).toEqual({ ...first, duplicate: true });
  expect(reopened.list()[0]?.name).toBe("Renamed");
});

test("renaming and hiding persist without deleting files or implicit import restoration", () => {
  const root = tempDir(), home = join(root, "home"), state = join(root, "state");
  mkdirSync(home); mkdirSync(state); mkdirSync(join(home, "repo"));
  const store = new ProjectStore({ stateRoot: state, home }); const original = store.register(join(home, "repo"));
  expect(store.executeCommand({ type: "project.rename", commandId: "rename-1", projectId: original.projectId, name: "  Renamed  " }).data).toMatchObject({ project: { projectId: original.projectId, path: original.path, name: "Renamed" } });
  store.executeCommand({ type: "project.remove", commandId: "remove-1", projectId: original.projectId });
  expect(store.list()).toEqual([]);
  const reopened = new ProjectStore({ stateRoot: state, home }); reopened.importLegacy(original.path);
  expect(reopened.list()).toEqual([]);
  expect(reopened.get(original.projectId, true)).toMatchObject({ path: original.path, name: "Renamed", available: true });
  const restored = reopened.registerCommand("add-2", original.path);
  expect(restored.project).toMatchObject({ projectId: original.projectId, name: "Renamed" });
  expect(reopened.list()).toHaveLength(1);
  expect(reopened.executeCommand({ type: "project.remove", commandId: "remove-1", projectId: original.projectId }).duplicate).toBe(true);
  expect(reopened.list()).toHaveLength(1);
});

test("mutation receipts reject cross-command reuse and never undo a later rename", () => {
  const root = tempDir(), home = join(root, "home"), state = join(root, "state");
  mkdirSync(home); mkdirSync(state); mkdirSync(join(home, "repo"));
  const store = new ProjectStore({ stateRoot: state, home }); const first = store.registerCommand("add-1", join(home, "repo"));
  const projectId = first.project.projectId;
  store.executeCommand({ type: "project.rename", commandId: "rename-1", projectId, name: "One" });
  store.executeCommand({ type: "project.rename", commandId: "rename-2", projectId, name: "Two" });
  expect(store.executeCommand({ type: "project.rename", commandId: "rename-1", projectId, name: "One" }).duplicate).toBe(true);
  expect(store.get(projectId)?.name).toBe("Two");
  expect(() => store.executeCommand({ type: "project.remove", commandId: "add-1", projectId })).toThrow("command-id-reused");
  for (const name of ["", "   ", "x".repeat(161), "bad\nname"]) expect(() => store.executeCommand({ type: "project.rename", commandId: `invalid-${name.length}`, projectId, name })).toThrow();
  store.executeCommand({ type: "project.remove", commandId: "remove-1", projectId });
  expect(() => store.registerCommand("remove-1", "project.remove", projectId)).toThrow("command-id-reused");
  expect(store.registerCommand("add-1", join(home, "repo")).duplicate).toBe(true);
  expect(store.list()).toEqual([]);
});

test("known hidden legacy roots outside home can be restored without widening discovery", () => {
  const root = tempDir(), home = join(root, "home"), state = join(root, "state"), outside = join(root, "legacy"), unknown = join(root, "unknown");
  mkdirSync(home); mkdirSync(state); mkdirSync(outside); mkdirSync(unknown);
  const store = new ProjectStore({ stateRoot: state, home }); const project = store.importLegacy(outside);
  store.executeCommand({ type: "project.remove", commandId: "remove", projectId: project.projectId });
  const reopened = new ProjectStore({ stateRoot: state, home });
  expect(() => reopened.registerCommand("new-outside", unknown)).toThrow();
  expect(() => reopened.directories({ path: outside })).toThrow();
  expect(reopened.registerCommand("restore", outside).project.projectId).toBe(project.projectId);
  expect(existsSync(outside)).toBe(true);
  reopened.executeCommand({ type: "project.remove", commandId: "remove-again", projectId: project.projectId });
  renameSync(outside, `${outside}-old`); symlinkSync(unknown, outside);
  expect(() => reopened.registerCommand("replaced", outside)).toThrow();
  expect(reopened.list()).toEqual([]);
});

test("legacy registration receipts survive the action extension without restoring hidden projects", () => {
  const root = tempDir(), home = join(root, "home"), state = join(root, "state");
  mkdirSync(home); mkdirSync(state); mkdirSync(join(home, "repo"));
  const store = new ProjectStore({ stateRoot: state, home }); const project = store.register(join(home, "repo"));
  const file = join(state, "projects.json"), raw = JSON.parse(readFileSync(file, "utf8"));
  raw.registrations["legacy-add"] = { fingerprint: JSON.stringify([project.path, null]), project };
  writeFileSync(file, JSON.stringify(raw));
  const reopened = new ProjectStore({ stateRoot: state, home });
  reopened.executeCommand({ type: "project.remove", commandId: "remove", projectId: project.projectId });
  expect(reopened.registerCommand("legacy-add", project.path)).toEqual({ project, duplicate: true });
  expect(reopened.list()).toEqual([]);
  expect(() => reopened.executeCommand({ type: "project.rename", commandId: "legacy-add", projectId: project.projectId, name: "Conflict" })).toThrow("command-id-reused");
});
