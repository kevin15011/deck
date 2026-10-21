/** Pi stdio servers inherit the session environment; Deck-owned MCP children never receive memory credentials. */
export const DECK_PI_MEMORY_ENV_BLANKS: Readonly<Record<string, string>> = Object.freeze({
  DECK_RUNNER_MEMORY_ENDPOINT: "",
  DECK_RUNNER_MEMORY_TOKEN: "",
  DECK_RUNNER_MEMORY_TOKEN_FILE: "",
});
