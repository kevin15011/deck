import { describe, expect, test } from "bun:test";
import {
  getNextScreenAfterPiToolInstall,
  getNextScreenAfterTeamSelection,
  getNextScreenAfterDeveloperTeamReview,
  getNextScreenAfterDeveloperTeamInstall,
  getNextScreenAfterEnvironmentSelection,
  getNextScreenAfterPersonalitySelection,
} from "./developer-team-flow";

describe("Developer Team flow helpers", () => {
  describe("getNextScreenAfterPiToolInstall", () => {
    test("returns team-selection when Pi environment is active", () => {
      const result = getNextScreenAfterPiToolInstall({
        selectedEnvironments: ["pi-development"],
        hasPiCommand: true,
        nextEnvironment: null,
      });

      expect(result).toBe("team-selection");
    });

    test("returns opencode-preflight-checking when OpenCode is next and no Pi", () => {
      const result = getNextScreenAfterPiToolInstall({
        selectedEnvironments: ["opencode-development"],
        hasPiCommand: false,
        nextEnvironment: "opencode-development",
      });

      expect(result).toBe("opencode-preflight-checking");
    });

    test("returns complete when no environments remain", () => {
      const result = getNextScreenAfterPiToolInstall({
        selectedEnvironments: ["pi-development"],
        hasPiCommand: false,
        nextEnvironment: null,
      });

      expect(result).toBe("complete");
    });

    test("prioritizes team-selection over opencode when Pi is active", () => {
      const result = getNextScreenAfterPiToolInstall({
        selectedEnvironments: ["pi-development", "opencode-development"],
        hasPiCommand: true,
        nextEnvironment: "opencode-development",
      });

      expect(result).toBe("team-selection");
    });
  });

  describe("getNextScreenAfterTeamSelection", () => {
    test("returns developer-team-review when Developer Team is selected", () => {
      const result = getNextScreenAfterTeamSelection({
        selectedTeams: ["developer-team"],
        nextEnvironment: null,
      });

      expect(result).toBe("developer-team-review");
    });

    test("returns next environment when no teams selected", () => {
      const result = getNextScreenAfterTeamSelection({
        selectedTeams: [],
        nextEnvironment: null,
      });

      expect(result).toBe("complete");
    });

    test("returns opencode-preflight-checking when no teams selected and OpenCode is next", () => {
      const result = getNextScreenAfterTeamSelection({
        selectedTeams: [],
        nextEnvironment: "opencode-development",
      });

      expect(result).toBe("opencode-preflight-checking");
    });

    test("returns developer-team-review when Developer Team is among multiple selections", () => {
      const result = getNextScreenAfterTeamSelection({
        selectedTeams: ["developer-team", "future-team"],
        nextEnvironment: null,
      });

      expect(result).toBe("developer-team-review");
    });
  });

  describe("getNextScreenAfterDeveloperTeamReview", () => {
    test("returns developer-team-installing when user chooses install (cursor=0)", () => {
      const result = getNextScreenAfterDeveloperTeamReview({
        cursor: 0,
        selectedEnvironments: ["pi-development"],
        nextEnvironment: null,
      });

      expect(result).toBe("developer-team-installing");
    });

    test("returns next environment or complete when user skips (cursor=1)", () => {
      const result = getNextScreenAfterDeveloperTeamReview({
        cursor: 1,
        selectedEnvironments: ["pi-development"],
        nextEnvironment: null,
      });

      expect(result).toBe("complete");
    });

    test("returns opencode-preflight-checking when user skips and OpenCode is next", () => {
      const result = getNextScreenAfterDeveloperTeamReview({
        cursor: 1,
        selectedEnvironments: ["pi-development", "opencode-development"],
        nextEnvironment: "opencode-development",
      });

      expect(result).toBe("opencode-preflight-checking");
    });
  });

  describe("getNextScreenAfterDeveloperTeamInstall", () => {
    test("returns opencode-preflight-checking when OpenCode is next", () => {
      const result = getNextScreenAfterDeveloperTeamInstall({
        selectedEnvironments: ["pi-development", "opencode-development"],
        nextEnvironment: "opencode-development",
      });

      expect(result).toBe("opencode-preflight-checking");
    });

    test("returns complete when no more environments", () => {
      const result = getNextScreenAfterDeveloperTeamInstall({
        selectedEnvironments: ["pi-development"],
        nextEnvironment: null,
      });

      expect(result).toBe("complete");
    });
  });

  describe("getNextScreenAfterEnvironmentSelection", () => {
    test("returns personality-selection when environments are selected", () => {
      const result = getNextScreenAfterEnvironmentSelection({
        selectedEnvironments: ["pi-development"],
        hasPiCommand: true,
        nextEnvironment: null,
      });

      expect(result).toBe("personality-selection");
    });

    test("returns personality-selection when multiple environments are selected", () => {
      const result = getNextScreenAfterEnvironmentSelection({
        selectedEnvironments: ["pi-development", "opencode-development"],
        hasPiCommand: true,
        nextEnvironment: "opencode-development",
      });

      expect(result).toBe("personality-selection");
    });

    test("returns complete when no environments are selected", () => {
      const result = getNextScreenAfterEnvironmentSelection({
        selectedEnvironments: [],
        hasPiCommand: false,
        nextEnvironment: null,
      });

      expect(result).toBe("complete");
    });

    test("returns personality-selection when only OpenCode is selected", () => {
      const result = getNextScreenAfterEnvironmentSelection({
        selectedEnvironments: ["opencode-development"],
        hasPiCommand: false,
        nextEnvironment: "opencode-development",
      });

      expect(result).toBe("personality-selection");
    });
  });

  describe("getNextScreenAfterPersonalitySelection", () => {
    test("routes to pi-preflight-checking when Pi is selected", () => {
      const result = getNextScreenAfterPersonalitySelection({
        selectedEnvironments: ["pi-development"],
        hasPiCommand: true,
        nextEnvironment: null,
      });

      expect(result).toBe("pi-preflight-checking");
    });

    test("routes to pi-preflight-checking when Pi and OpenCode are both selected", () => {
      const result = getNextScreenAfterPersonalitySelection({
        selectedEnvironments: ["pi-development", "opencode-development"],
        hasPiCommand: true,
        nextEnvironment: "opencode-development",
      });

      expect(result).toBe("pi-preflight-checking");
    });

    test("routes to opencode-preflight-checking when only OpenCode is selected", () => {
      const result = getNextScreenAfterPersonalitySelection({
        selectedEnvironments: ["opencode-development"],
        hasPiCommand: false,
        nextEnvironment: "opencode-development",
      });

      expect(result).toBe("opencode-preflight-checking");
    });

    test("routes to complete when no environments are selected (defensive)", () => {
      const result = getNextScreenAfterPersonalitySelection({
        selectedEnvironments: [],
        hasPiCommand: false,
        nextEnvironment: null,
      });

      expect(result).toBe("complete");
    });
  });
});