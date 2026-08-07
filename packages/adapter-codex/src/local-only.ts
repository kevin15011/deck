const START = "# deck:codex-local-only:start";
const END = "# deck:codex-local-only:end";

export type LocalOnlyInput = {
  projectRoot: string;
  requestedPaths: readonly string[];
  tracked: ReadonlySet<string>;
  fullyOwned: ReadonlySet<string>;
  requireZeroVisibleTrackedChanges?: boolean;
  resolveExcludePath(): Promise<string>;
  existingExclude: string;
};

export function composeLocalOnlyExclude(existingExclude: string, exactPaths: readonly string[]) {
  const starts = existingExclude.split(START).length - 1;
  const ends = existingExclude.split(END).length - 1;
  if (starts !== ends || starts > 1) return { blocked: true as const, content: existingExclude, diagnostic: "Malformed Deck local-only exclude block." };
  const existingOwned = starts === 1
    ? existingExclude
        .slice(existingExclude.indexOf(START) + START.length, existingExclude.indexOf(END))
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("/") && !line.endsWith("/"))
        .map((line) => line.slice(1))
    : [];
  const ownedPaths = [...new Set([...existingOwned, ...exactPaths])];
  const block = [START, ...ownedPaths.map((path) => `/${path}`), END].join("\n");
  if (starts === 1) {
    const start = existingExclude.indexOf(START);
    const end = existingExclude.indexOf(END, start) + END.length;
    return { blocked: false as const, content: existingExclude.slice(0, start) + block + existingExclude.slice(end) };
  }
  const separator = existingExclude.length === 0 || existingExclude.endsWith("\n") ? "" : "\n";
  return { blocked: false as const, content: `${existingExclude}${separator}${block}\n` };
}

export async function buildLocalOnlyExcludeMutation(input: LocalOnlyInput) {
  const excludePath = await input.resolveExcludePath();
  const exactPaths = input.requestedPaths.filter((path) => !input.tracked.has(path) && input.fullyOwned.has(path));
  const visiblePaths = input.requestedPaths.filter((path) => !exactPaths.includes(path));
  const composed = composeLocalOnlyExclude(input.existingExclude, exactPaths);
  if (composed.blocked) return { blocked: true, excludePath, content: input.existingExclude, exactPaths: [], visiblePaths, diagnostic: composed.diagnostic };
  return {
    blocked: input.requireZeroVisibleTrackedChanges === true && visiblePaths.some((path) => input.tracked.has(path)),
    excludePath,
    content: composed.content,
    exactPaths,
    visiblePaths,
  };
}
