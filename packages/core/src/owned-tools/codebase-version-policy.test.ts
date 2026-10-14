import { expect, test } from "bun:test";
import { isSupportedCodebaseVersion } from "./codebase-native-artifact";

test("Codebase Memory compatibility admits only the release with verified native rendezvous behavior", () => {
  expect(isSupportedCodebaseVersion("0.11.0")).toBe(true);
  for (const version of ["0.9.0", "0.10.8", "0.11.1", "0.12.0", "1.0.0", "99.0.0", "0.11.0-beta", "garbage"]) expect(isSupportedCodebaseVersion(version)).toBe(false);
});
