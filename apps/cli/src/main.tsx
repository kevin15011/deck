import React from "react";
import { render, renderToString } from "ink";

import { DeckApp } from "./tui/app";
import { ScreenFrame } from "./tui/screen-frame";
import { HomeScreen } from "./tui/screens/home-screen";

if (process.stdin.isTTY) {
  render(<DeckApp />, {
    alternateScreen: true,
    exitOnCtrlC: true,
    incrementalRendering: true,
    patchConsole: false,
  });
} else {
  console.log(
    renderToString(
      <ScreenFrame title="Deck" help="Run in an interactive terminal to navigate.">
        <HomeScreen cursor={0} />
      </ScreenFrame>,
    ),
  );
}
