import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";

import { ScreenFrame } from "./screen-frame";
import { HomeScreen } from "./screens/home-screen";

describe("page based TUI screens", () => {
  test("renders a framed home screen without transcript-style previous output", () => {
    const output = renderToString(
      <ScreenFrame title="Deck" help="j/k: navigate • enter: select • q: quit">
        <HomeScreen cursor={0} />
      </ScreenFrame>,
    );

    expect(output).toContain("Deck");
    expect(output).toContain("Your AI environment, configured.");
    expect(output).toContain("Start installation");
    expect(output).toContain("Upgrade tools");
    expect(output).not.toContain("Pi Environment Preflight");
  });

  test("can render a frame using the full terminal dimensions", () => {
    const output = renderToString(
      <ScreenFrame title="Deck" help="help" width={100} height={24}>
        <HomeScreen cursor={0} />
      </ScreenFrame>,
    );

    expect(output).toContain("Deck");
    expect(output).toContain("help");
  });
});
