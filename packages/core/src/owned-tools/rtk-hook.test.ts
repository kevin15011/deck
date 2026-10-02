import { describe, expect, test } from "bun:test";
import { PIN_RTK_REWRITE_SOURCE, pinRtkRewrite, rtkHookScript } from "./rtk-hook";

const staticPin = new Function(`${PIN_RTK_REWRITE_SOURCE}; return pinRtkRewrite;`)() as typeof pinRtkRewrite;

const corpus = [
  "rtk git status",
  "FOO='rtk literal' rtk git status && rtk git show HEAD --stat",
  "rtk git show --format='rtk word && rtk inside literal'",
  "printf 'rtk git show'",
  "rtk git show $(echo rtk)",
  "rtk git show `echo rtk`",
  "rtk git show > output",
  "sudo rtk git show",
  "env PATH=/other rtk git show",
  "rtk git show && /usr/bin/env rtk git show",
  "rtk git show && xargs 'rtk' git show",
  "rtk git show # rtk comment",
  "function rtk() { echo wrong; }; rtk git show",
  "git status",
  "rtk ls -la | rtk grep foo; rtk read x\nrtk diff",
  "echo \"unterminated",
  "",
];

describe("RTK hook bridge source", () => {
  test("static JavaScript twin matches the typed qualifier on a corpus, including a quoted binary path", () => {
    for (const binary of ["/owned/rtk", "/owned path/quoted'rtk"]) {
      for (const command of corpus) expect(staticPin(command, binary), `${binary} :: ${command}`).toBe(pinRtkRewrite(command, binary));
    }
  });

  test("generated scripts are deterministic and flavour-specific", () => {
    expect(rtkHookScript("/owned/rtk", "codex")).toBe(rtkHookScript("/owned/rtk", "codex"));
    expect(rtkHookScript("/owned/rtk", "codex")).toContain('["hook", "codex"]');
    expect(rtkHookScript("/owned/rtk", "claude")).toContain('["hook", "claude"]');
    expect(rtkHookScript("/owned/rtk", "codex")).not.toContain("Function.prototype");
    expect(rtkHookScript("/owned/rtk", "codex")).toContain(PIN_RTK_REWRITE_SOURCE);
  });
});
