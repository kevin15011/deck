import { isAlias, isMap, isScalar, isSeq, parseDocument, visit, type YAMLMap } from "yaml";

const RETIRED = new Set(["strict_tdd", "strict_tdd_mode", "tdd", "coverage_threshold", "strict_tdd_gates"]);
/** Deliberately bounded to Deck policy maps; commands and opaque user data are never traversed. */
export function migrateRetiredTestingPolicy(source: string): { text: string; changed: boolean; initialized: boolean } {
  if (Buffer.byteLength(source) > 128 * 1024) throw new Error("yaml-budget-exceeded");
  const doc = parseDocument(source, { uniqueKeys: true, keepSourceTokens: true });
  if (doc.errors.length || !isMap(doc.contents)) throw new Error("yaml-malformed");
  let nodes = 0;
  visit(doc, (_key, node, path) => {
    if (++nodes > 4096 || path.length > 32 || isAlias(node)) throw new Error("yaml-unsupported");
  });
  const testing = doc.get("testing", true);
  if (testing !== undefined && !isMap(testing)) throw new Error("testing-shape-unsupported");
  let changed = false;
  const comments: string[] = [];
  const remember = (node: unknown) => {
    if (node && typeof node === "object") {
      const v = node as { comment?: string; commentBefore?: string };
      if (v.commentBefore) comments.push(v.commentBefore);
      if (v.comment) comments.push(v.comment);
    }
  };
  const gates: { name: string; node: unknown }[] = [];
  const collect = (node: unknown, name: string) => {
    if (isScalar(node) && typeof node.value === "string") gates.push({ name, node });
    else if (isMap(node)) for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string" || !isScalar(pair.value) || typeof pair.value.value !== "string") throw new Error("gate-shape-unsupported");
      remember(pair.key); gates.push({ name: pair.key.value, node: pair.value });
    }
    else if (isSeq(node)) node.items.forEach((item, i) => {
      if (!isScalar(item) || typeof item.value !== "string") throw new Error("gate-shape-unsupported");
      gates.push({ name: `${name}_${i + 1}`, node: item });
    });
    else throw new Error("gate-shape-unsupported");
  };
  const maps: YAMLMap[] = [doc.contents];
  if (isMap(testing)) maps.push(testing);
  const rules = doc.get("rules", true);
  if (isMap(rules)) for (const name of ["apply", "verify"]) {
    const map = rules.get(name, true); if (isMap(map)) maps.push(map);
  }
  for (const map of maps) for (const pair of [...map.items]) {
    if (!isScalar(pair.key) || !RETIRED.has(String(pair.key.value))) continue;
    const key = String(pair.key.value);
    remember(pair.key);
    if (key === "strict_tdd_gates") { if (!isScalar(pair.value)) remember(pair.value); collect(pair.value, "gate"); } else remember(pair.value);
    map.delete(key); changed = true;
  }
  if (!testing) doc.set("testing", doc.createNode({}));
  const target = doc.get("testing", true) as YAMLMap;
  const policy = target.get("policy");
  if (policy === undefined || policy === "strict") { target.set("policy", "proportional"); changed = true; }
  if (gates.length) {
    if (!target.has("commands")) target.set("commands", doc.createNode({}));
    const commands = target.get("commands", true);
    if (!isMap(commands)) throw new Error("commands-shape-unsupported");
    for (const gate of gates) {
      let name = gate.name;
      for (let i = 2; commands.has(name); i++) name = `${gate.name}_${i}`;
      commands.set(name, gate.node);
    }
  }
  if (comments.length) doc.comment = [doc.comment, ...comments].filter(Boolean).join("\n");
  const indents = [...source.matchAll(/^( +)\S/gm)].map(match => match[1]!.length);
  const indent = indents.length ? Math.min(...indents) : 2;
  return { changed, initialized: doc.get("initialized") === true, text: changed ? doc.toString({ lineWidth: 0, indent }) : source };
}
