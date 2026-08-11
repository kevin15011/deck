import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { WebSearchCredentialScreen, webSearchCredentialSetupError } from "./app";

describe("WebSearchCredentialScreen", () => {
  test("masks an entered value and explains its explicit shell-profile destination", () => {
    const enteredValue = "hidden-value";
    const output = renderToString(<WebSearchCredentialScreen value={enteredValue} />);

    expect(output).toContain("Tavily credential");
    expect(output).toContain("active .bashrc or .zshrc");
    expect(output).toContain("•");
    expect(output.includes(enteredValue)).toBe(false);
  });

  test("renders manual cleanup guidance without claiming a raced credential was not saved", () => {
    const credential = "must-not-render";
    const profilePath = "/tmp/example-home/.bashrc";
    const error = webSearchCredentialSetupError({
      ok: false,
      profileStatus: "manual-cleanup-required",
      credentialPresent: true,
      profilePath,
      diagnosticCodes: ["deck-config-write-failed", "profile-rollback-conflict"],
      message: "Credential may remain because safe profile rollback could not be confirmed.",
      guidance: "Inspect the reported profile path and, if necessary, remove only the exact Deck-owned Web Search block before retrying.",
    });
    const output = renderToString(<WebSearchCredentialScreen value={credential} error={error} />);

    expect(output).toContain("Credential may remain");
    expect(output).toContain(profilePath);
    expect(output).toContain("Deck-owned Web Search block");
    expect(output).not.toContain("was not saved");
    expect(output).not.toContain(credential);
  });
});
