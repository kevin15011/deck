import { describe, test, expect } from "bun:test";
import { extractProjectNameFromGitRemote, getProjectFallbackName } from "./git";

describe("extractProjectNameFromGitRemote", () => {
  test("SSH URL: git@github.com:kevin15011/deck.git", () => {
    expect(extractProjectNameFromGitRemote("git@github.com:kevin15011/deck.git")).toBe("deck");
  });

  test("HTTPS URL with .git: https://github.com/user/my-repo.git", () => {
    expect(extractProjectNameFromGitRemote("https://github.com/user/my-repo.git")).toBe("my-repo");
  });

  test("HTTPS URL without .git: https://github.com/user/my-repo", () => {
    expect(extractProjectNameFromGitRemote("https://github.com/user/my-repo")).toBe("my-repo");
  });

  test("SSH protocol URL: ssh://user@host/path/to/repo.git", () => {
    expect(extractProjectNameFromGitRemote("ssh://user@host/path/to/repo.git")).toBe("repo");
  });

  test("Local absolute path: /home/user/projects/my-app", () => {
    expect(extractProjectNameFromGitRemote("/home/user/projects/my-app")).toBe("my-app");
  });

  test("Local path with .git: /local/path/to/repo.git", () => {
    expect(extractProjectNameFromGitRemote("/local/path/to/repo.git")).toBe("repo");
  });

  test("file:// URL: file:///local/path/to/repo.git", () => {
    expect(extractProjectNameFromGitRemote("file:///local/path/to/repo.git")).toBe("repo");
  });

  test("Empty string returns undefined", () => {
    expect(extractProjectNameFromGitRemote("")).toBe(undefined);
  });

  test("Whitespace only returns undefined", () => {
    expect(extractProjectNameFromGitRemote("   ")).toBe(undefined);
  });

  test("Trailing slash: https://github.com/user/repo/", () => {
    expect(extractProjectNameFromGitRemote("https://github.com/user/repo/")).toBe("repo");
  });

  test("Multiple .git in path: https://github.com/git-tools/repo.git", () => {
    expect(extractProjectNameFromGitRemote("https://github.com/git-tools/repo.git")).toBe("repo");
  });

  test("URL with query params should still extract name", () => {
    expect(extractProjectNameFromGitRemote("https://github.com/user/repo.git?ref=main")).toBe("repo");
  });
});

describe("getProjectFallbackName", () => {
  test("Fallback: /home/user/my-project", () => {
    expect(getProjectFallbackName("/home/user/my-project")).toBe("my-project");
  });

  test("Fallback with trailing slash: /home/user/my-project/", () => {
    expect(getProjectFallbackName("/home/user/my-project/")).toBe("my-project");
  });
});