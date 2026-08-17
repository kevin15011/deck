import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

type LaunchTarget = "runOpenCodeLaunch" | "runPiLaunch" | "runRunnerLaunch" | "createSupermemoryRuntimeHost";
type Enablement = "enabled" | "disabled" | "unknown";

type LaunchCallSite = Readonly<{
  file: string;
  line: number;
  target: LaunchTarget;
  enablement: Enablement;
  hasFakeTransport: boolean;
  hasIsolatedState: boolean;
  forwardingEdge: boolean;
  unresolved: readonly string[];
}>;

type SourceInput = Readonly<{ file: string; text: string }>;
type Declaration = Readonly<{ name: string; position: number; initializer: ts.Expression }>;
type FunctionReturn = Readonly<{ name: string; position: number; parameters: readonly string[]; expression: ts.Expression }>;
type ForOfBinding = Readonly<{ name: string; start: number; end: number; iterable: ts.Expression }>;
type ObjectFacts = Readonly<{ properties: ReadonlyMap<string, ts.Expression | undefined>; unresolved: readonly string[] }>;

const TARGET_EXPORTS = new Map<string, LaunchTarget>([
  ["runOpenCodeLaunch", "runOpenCodeLaunch"],
  ["runPiLaunch", "runPiLaunch"],
  ["runPiLaunchLegacyCompatibility", "runPiLaunch"],
  ["runRunnerLaunch", "runRunnerLaunch"],
  ["createSupermemoryRuntimeHost", "createSupermemoryRuntimeHost"],
]);

const LAUNCH_MODULE_PATTERNS = [
  /(?:^|\/)opencode-launch-command$/,
  /(?:^|\/)pi-launch-command$/,
  /(?:^|\/)pi-launch-command-legacy-compatibility\.test-support$/,
  /(?:^|\/)runner-launch-command$/,
  /(?:^|\/)supermemory-runtime-host$/,
];

function sourceFiles(root: string): SourceInput[] {
  const skipped = new Set([".git", "node_modules", "dist", "coverage", "openspec"]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skipped.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (/\.test\.(?:ts|tsx)$/.test(entry.name) || /\.test-support\.ts$/.test(entry.name)) files.push(fullPath);
    }
  };
  walk(root);
  const smoke = join(root, "apps/cli/src/internal-supermemory-runtime-smoke.ts");
  if (existsSync(smoke)) files.push(smoke);
  return files.map((file) => ({ file: relative(root, file), text: readFileSync(file, "utf8") }));
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function expressionText(source: ts.SourceFile, expression: ts.Expression): string {
  return source.text.slice(expression.getStart(source), expression.getEnd()).replace(/\s+/g, " ");
}

function collectDeclarations(source: ts.SourceFile): Declaration[] {
  const declarations: Declaration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.push({ name: node.name.text, position: node.getStart(source), initializer: unwrapExpression(node.initializer) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return declarations;
}

function returnExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (ts.isExpression(body)) return unwrapExpression(body);
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) return unwrapExpression(statement.expression);
  }
  return undefined;
}

function parameterNames(parameters: ts.NodeArray<ts.ParameterDeclaration>): string[] {
  return parameters.map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : "").filter(Boolean);
}

function collectFunctionReturns(source: ts.SourceFile): FunctionReturn[] {
  const functions: FunctionReturn[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const expression = returnExpression(node.body);
      if (expression) functions.push({ name: node.name.text, position: node.getStart(source), parameters: parameterNames(node.parameters), expression });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = unwrapExpression(node.initializer);
      if ((ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        const expression = returnExpression(initializer.body);
        if (expression) functions.push({ name: node.name.text, position: node.getStart(source), parameters: parameterNames(initializer.parameters), expression });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return functions;
}

function collectImportedFunctionReturns(source: ts.SourceFile): FunctionReturn[] {
  const functions: FunctionReturn[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@deck/core") continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    const importsDefaultConfig = namedBindings.elements.some((element) => (element.propertyName?.text ?? element.name.text) === "getDefaultDeckConfig");
    if (!importsDefaultConfig) continue;

    const configPath = join(process.cwd(), "packages/core/src/config/deck-config.ts");
    if (!existsSync(configPath)) continue;
    const configSource = ts.createSourceFile(configPath, readFileSync(configPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const configStatement of configSource.statements) {
      if (ts.isFunctionDeclaration(configStatement) && configStatement.name?.text === "getDefaultDeckConfig" && configStatement.body) {
        const expression = returnExpression(configStatement.body);
        if (expression) functions.push({ name: "getDefaultDeckConfig", position: -1, parameters: [], expression });
      }
    }
  }
  return functions;
}

function collectForOfBindings(source: ts.SourceFile): ForOfBinding[] {
  const bindings: ForOfBinding[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      const declaration = node.initializer.declarations[0];
      if (declaration && ts.isIdentifier(declaration.name)) {
        bindings.push({ name: declaration.name.text, start: node.getStart(source), end: node.getEnd(), iterable: unwrapExpression(node.expression) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bindings;
}

function nearestDeclaration(name: string, position: number, declarations: readonly Declaration[]): Declaration | undefined {
  return declarations.filter((candidate) => candidate.name === name && candidate.position < position).sort((a, b) => b.position - a.position)[0];
}

function nearestFunction(name: string, position: number, functions: readonly FunctionReturn[]): FunctionReturn | undefined {
  return functions.filter((candidate) => candidate.name === name && candidate.position < position).sort((a, b) => b.position - a.position)[0];
}

function resolveArrayExpression(source: ts.SourceFile, expression: ts.Expression, declarations: readonly Declaration[]): ts.ArrayLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isArrayLiteralExpression(unwrapped)) return unwrapped;
  if (ts.isIdentifier(unwrapped)) {
    const declaration = nearestDeclaration(unwrapped.text, unwrapped.getStart(source), declarations);
    const initializer = declaration?.initializer ? unwrapExpression(declaration.initializer) : undefined;
    return initializer && ts.isArrayLiteralExpression(initializer) ? initializer : undefined;
  }
  return undefined;
}

function importedLaunchTargets(source: ts.SourceFile): Map<string, LaunchTarget> {
  const localNames = new Map<string, LaunchTarget>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier)) continue;
    if (!LAUNCH_MODULE_PATTERNS.some((pattern) => pattern.test(moduleSpecifier.text))) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      const target = TARGET_EXPORTS.get(importedName);
      if (target) localNames.set(element.name.text, target);
    }
  }
  return localNames;
}

function objectFacts(properties: Map<string, ts.Expression | undefined>, unresolved: string[] = []): ObjectFacts {
  return { properties, unresolved };
}

function bindFunctionArguments(fn: FunctionReturn, call: ts.CallExpression, substitutions: ReadonlyMap<string, ts.Expression>): Map<string, ts.Expression> | undefined {
  if (fn.parameters.length !== call.arguments.length) return undefined;
  const bound = new Map(substitutions);
  for (const [index, parameter] of fn.parameters.entries()) bound.set(parameter, unwrapExpression(call.arguments[index]!));
  return bound;
}

function resolveObjectExpression(source: ts.SourceFile, expression: ts.Expression, declarations: readonly Declaration[], functions: readonly FunctionReturn[], seen = new Set<string>(), substitutions: ReadonlyMap<string, ts.Expression> = new Map()): ObjectFacts {
  const unwrapped = unwrapExpression(expression);

  if (ts.isIdentifier(unwrapped)) {
    const substituted = substitutions.get(unwrapped.text);
    if (substituted) return resolveObjectExpression(source, substituted, declarations, functions, seen, substitutions);
    const declaration = nearestDeclaration(unwrapped.text, unwrapped.getStart(source), declarations);
    if (!declaration) return objectFacts(new Map(), [`unresolved identifier ${unwrapped.text}`]);
    const key = `var:${declaration.name}:${declaration.position}`;
    if (seen.has(key)) return objectFacts(new Map(), [`cyclic identifier ${declaration.name}`]);
    return resolveObjectExpression(source, declaration.initializer, declarations, functions, new Set([...seen, key]), substitutions);
  }

  if (ts.isCallExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
    const fn = nearestFunction(unwrapped.expression.text, unwrapped.getStart(source), functions);
    if (!fn) return objectFacts(new Map(), [`non-object ${ts.SyntaxKind[unwrapped.kind]}`]);
    const bound = bindFunctionArguments(fn, unwrapped, substitutions);
    if (!bound) return objectFacts(new Map(), [`unresolved helper arguments ${unwrapped.expression.text}`]);
    const key = `fn:${fn.name}:${fn.position}`;
    if (seen.has(key)) return objectFacts(new Map(), [`cyclic helper ${fn.name}`]);
    return resolveObjectExpression(source, fn.expression, declarations, functions, new Set([...seen, key]), bound);
  }

  if (!ts.isObjectLiteralExpression(unwrapped)) return objectFacts(new Map(), [`non-object ${ts.SyntaxKind[unwrapped.kind]}`]);

  const properties = new Map<string, ts.Expression | undefined>();
  const unresolved: string[] = [];
  for (const candidate of unwrapped.properties) {
    if (ts.isSpreadAssignment(candidate)) {
      const spread = resolveObjectExpression(source, candidate.expression, declarations, functions, seen, substitutions);
      for (const [name, value] of spread.properties) properties.set(name, value);
      unresolved.push(...spread.unresolved.map((reason) => `spread ${expressionText(source, candidate.expression)}: ${reason}`));
      continue;
    }
    if (ts.isShorthandPropertyAssignment(candidate)) {
      properties.set(candidate.name.text, candidate.name);
      continue;
    }
    if (ts.isPropertyAssignment(candidate)) {
      const name = propertyName(candidate.name);
      if (name) properties.set(name, unwrapExpression(candidate.initializer));
      else unresolved.push("computed property name");
      continue;
    }
    if (ts.isMethodDeclaration(candidate)) {
      const name = propertyName(candidate.name);
      if (name) properties.set(name, undefined);
      else unresolved.push("computed method name");
    }
  }
  return objectFacts(properties, unresolved);
}

function expressionEnablement(source: ts.SourceFile, expression: ts.Expression | undefined, declarations: readonly Declaration[], functions: readonly FunctionReturn[], forOfBindings: readonly ForOfBinding[], seen = new Set<string>(), substitutions: ReadonlyMap<string, ts.Expression> = new Map()): Enablement {
  if (!expression) return "unknown";
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    const substituted = substitutions.get(unwrapped.text);
    if (substituted) return expressionEnablement(source, substituted, declarations, functions, forOfBindings, seen, substitutions);
    const declaration = nearestDeclaration(unwrapped.text, unwrapped.getStart(source), declarations);
    if (!declaration) return "unknown";
    const key = `var:${declaration.name}:${declaration.position}`;
    if (seen.has(key)) return "unknown";
    return expressionEnablement(source, declaration.initializer, declarations, functions, forOfBindings, new Set([...seen, key]), substitutions);
  }
  if (ts.isPropertyAccessExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
    const receiver = unwrapped.expression;
    const binding = forOfBindings.find((candidate) => candidate.name === receiver.text && candidate.start <= unwrapped.getStart(source) && candidate.end >= unwrapped.getEnd());
    const array = binding ? resolveArrayExpression(source, binding.iterable, declarations) : undefined;
    if (!array) return "unknown";
    let status: Enablement = "disabled";
    for (const element of array.elements) {
      const item = unwrapExpression(element);
      if (!ts.isObjectLiteralExpression(item)) return "unknown";
      const facts = resolveObjectExpression(source, item, declarations, functions);
      status = combineEnablement(status, expressionEnablement(source, facts.properties.get(unwrapped.name.text), declarations, functions, forOfBindings));
    }
    return status;
  }
  if (ts.isCallExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
    const fn = nearestFunction(unwrapped.expression.text, unwrapped.getStart(source), functions);
    if (fn) {
      const bound = bindFunctionArguments(fn, unwrapped, substitutions);
      if (!bound) return "unknown";
      const key = `fn:${fn.name}:${fn.position}`;
      if (seen.has(key)) return "unknown";
      return expressionEnablement(source, fn.expression, declarations, functions, forOfBindings, new Set([...seen, key]), bound);
    }
    return "unknown";
  }
  if (ts.isStringLiteralLike(unwrapped)) {
    if (unwrapped.text === "supermemory") return "enabled";
    if (unwrapped.text === "none") return "disabled";
    return "unknown";
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return "enabled";
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return "disabled";
  if (ts.isObjectLiteralExpression(unwrapped)) return objectEnablement(source, resolveObjectExpression(source, unwrapped, declarations, functions, seen, substitutions), declarations, functions, forOfBindings);
  return "unknown";
}

function stringLiteralValue(expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined;
  const unwrapped = unwrapExpression(expression);
  return ts.isStringLiteralLike(unwrapped) ? unwrapped.text : undefined;
}

function combineEnablement(current: Enablement, next: Enablement): Enablement {
  if (current === "enabled" || next === "enabled") return "enabled";
  if (current === "unknown" || next === "unknown") return "unknown";
  return "disabled";
}

function objectEnablement(source: ts.SourceFile, facts: ObjectFacts, declarations: readonly Declaration[], functions: readonly FunctionReturn[], forOfBindings: readonly ForOfBinding[]): Enablement {
  if (stringLiteralValue(facts.properties.get("cliMemoryProvider")) === "none") return "disabled";
  let status: Enablement = facts.unresolved.length > 0 ? "unknown" : "disabled";
  for (const directProperty of ["deckConfig", "adaptiveMemory", "enabled", "activeProvider", "cliMemoryProvider", "memoryProvider"]) {
    if (facts.properties.has(directProperty)) status = combineEnablement(status, expressionEnablement(source, facts.properties.get(directProperty), declarations, functions, forOfBindings));
  }
  const launch = facts.properties.get("launch");
  if (launch) status = combineEnablement(status, expressionEnablement(source, launch, declarations, functions, forOfBindings));
  return status;
}

function dependencyFactsForRuntime(source: ts.SourceFile, expression: ts.Expression | undefined, declarations: readonly Declaration[], functions: readonly FunctionReturn[]): { hasFakeTransport: boolean; hasIsolatedState: boolean; unresolved: readonly string[] } {
  if (!expression) return { hasFakeTransport: false, hasIsolatedState: false, unresolved: [] };
  const runtime = resolveObjectExpression(source, expression, declarations, functions);
  return { hasFakeTransport: runtime.properties.has("transport"), hasIsolatedState: runtime.properties.has("stateHome"), unresolved: runtime.unresolved };
}

function dependencyFactsForCall(source: ts.SourceFile, target: LaunchTarget, options: ObjectFacts, declarations: readonly Declaration[], functions: readonly FunctionReturn[]): { hasFakeTransport: boolean; hasIsolatedState: boolean; unresolved: readonly string[] } {
  if (target === "createSupermemoryRuntimeHost") {
    return { hasFakeTransport: options.properties.has("transport"), hasIsolatedState: options.properties.has("stateHome") || options.properties.has("observabilitySink"), unresolved: [] };
  }
  if (target === "runOpenCodeLaunch") {
    return { hasFakeTransport: options.properties.has("supermemoryRuntimeTransport"), hasIsolatedState: options.properties.has("supermemoryRuntimeStateHome"), unresolved: [] };
  }
  return dependencyFactsForRuntime(source, options.properties.get("supermemoryRuntime"), declarations, functions);
}

function forwardedParameterName(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapExpression(expression);
  return ts.isIdentifier(unwrapped) ? unwrapped.text : undefined;
}

function isForwardingArgument(expression: ts.Expression, parameterNames: readonly string[]): boolean {
  const direct = forwardedParameterName(expression);
  if (direct && parameterNames.includes(direct)) return true;
  const unwrapped = unwrapExpression(expression);
    if (!ts.isObjectLiteralExpression(unwrapped)) return false;
    let forwardsParameter = false;
    for (const property of unwrapped.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spreadName = forwardedParameterName(property.expression);
      if (spreadName && parameterNames.includes(spreadName)) forwardsParameter = true;
      else return false;
      continue;
      }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === "deckConfig") continue;
    if (!ts.isPropertyAssignment(property) || propertyName(property.name) !== "deckConfig") return false;
  }
  return forwardsParameter;
}

function collectForwardingWrappers(source: ts.SourceFile, baseTargets: ReadonlyMap<string, LaunchTarget>): Map<string, LaunchTarget> {
  const wrappers = new Map<string, LaunchTarget>();
  const inspectFunction = (name: string, parameters: readonly string[], body: ts.ConciseBody) => {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const target = baseTargets.get(node.expression.text);
        const arg = node.arguments[0] ? unwrapExpression(node.arguments[0]) : undefined;
        if (target && arg && isForwardingArgument(arg, parameters)) wrappers.set(name, target);
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  };
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) inspectFunction(statement.name.text, parameterNames(statement.parameters), statement.body);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer ? unwrapExpression(declaration.initializer) : undefined;
        if (ts.isIdentifier(declaration.name) && initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) inspectFunction(declaration.name.text, parameterNames(initializer.parameters), initializer.body);
      }
    }
  }
  return wrappers;
}

function isForwardingEdge(node: ts.CallExpression, target: LaunchTarget, currentParameters: readonly string[] | undefined): boolean {
  const arg = node.arguments[0] ? unwrapExpression(node.arguments[0]) : undefined;
  return !!arg && !!currentParameters && target === "runPiLaunch" && isForwardingArgument(arg, currentParameters);
}

function collectLaunchCallSitesFromSources(sources: readonly SourceInput[]): LaunchCallSite[] {
  const calls: LaunchCallSite[] = [];
  for (const input of sources) {
    const source = ts.createSourceFile(input.file, input.text, ts.ScriptTarget.Latest, true, input.file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const declarations = collectDeclarations(source);
    const functions = [...collectImportedFunctionReturns(source), ...collectFunctionReturns(source)];
    const forOfBindings = collectForOfBindings(source);
    const importedTargets = importedLaunchTargets(source);
    const localTargets = new Map([...importedTargets, ...collectForwardingWrappers(source, importedTargets)]);
    const functionStack: string[][] = [];
    const visit = (node: ts.Node) => {
      const pushed = (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) ? parameterNames(node.parameters) : undefined;
      if (pushed) functionStack.push(pushed);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const target = localTargets.get(node.expression.text);
        if (target) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          const optionExpression = node.arguments[0] ? unwrapExpression(node.arguments[0]) : undefined;
          const forwardingEdge = isForwardingEdge(node, target, functionStack[functionStack.length - 1]);
          if (forwardingEdge) {
            calls.push({ file: input.file, line: position.line + 1, target, enablement: "unknown", hasFakeTransport: true, hasIsolatedState: true, forwardingEdge: true, unresolved: [] });
          } else if (optionExpression) {
            const options = resolveObjectExpression(source, optionExpression, declarations, functions);
            const enablement = objectEnablement(source, options, declarations, functions, forOfBindings);
            const dependencies = dependencyFactsForCall(source, target, options, declarations, functions);
            calls.push({
              file: input.file,
              line: position.line + 1,
              target,
              enablement,
              hasFakeTransport: dependencies.hasFakeTransport,
              hasIsolatedState: dependencies.hasIsolatedState,
              forwardingEdge: false,
              unresolved: [...options.unresolved, ...dependencies.unresolved],
            });
          } else {
            calls.push({ file: input.file, line: position.line + 1, target, enablement: "unknown", hasFakeTransport: false, hasIsolatedState: false, forwardingEdge: false, unresolved: ["missing options argument"] });
          }
        }
      }
      ts.forEachChild(node, visit);
      if (pushed) functionStack.pop();
    };
    visit(source);
  }
  return calls;
}

function collectLaunchCallSites(root: string): LaunchCallSite[] {
  return collectLaunchCallSitesFromSources(sourceFiles(root));
}

function unsafeRequiredDependencies(calls: readonly LaunchCallSite[]): string[] {
  return calls
    .filter((call) => !call.forwardingEdge && call.enablement !== "disabled" && (!call.hasFakeTransport || !call.hasIsolatedState))
    .map((call) => `${call.file}:${call.line} ${call.target} enablement=${call.enablement} transport=${call.hasFakeTransport} state=${call.hasIsolatedState}`);
}

function unresolvedCalls(calls: readonly LaunchCallSite[]): string[] {
  return calls
    .filter((call) => !call.forwardingEdge && call.unresolved.length > 0)
    .map((call) => `${call.file}:${call.line} ${call.target} unresolved=${call.unresolved.join("; ")}`);
}

function syntheticCalls(body: string, file = "synthetic.test.ts"): LaunchCallSite[] {
  return collectLaunchCallSitesFromSources([{ file, text: body }]);
}

const SYNTHETIC_IMPORTS = `
import { runOpenCodeLaunch } from "./opencode-launch-command";
import { runPiLaunch } from "./pi-launch-command";
import { runPiLaunchLegacyCompatibility as runLegacyPiLaunch } from "./pi-launch-command-legacy-compatibility.test-support";
import { runRunnerLaunch } from "./runner-launch-command";
`;

describe("Supermemory launch test hermeticity", () => {
  test("enabled-memory launch fixtures inject fake transport and isolated state structurally", () => {
    const calls = collectLaunchCallSites(process.cwd());
    const byTarget = Object.fromEntries(["createSupermemoryRuntimeHost", "runOpenCodeLaunch", "runPiLaunch", "runRunnerLaunch"].map((target) => [target, calls.filter((call) => call.target === target).length]));

    expect({ total: calls.length, byTarget, enabled: calls.filter((call) => call.enablement === "enabled").length, unknownSafe: calls.filter((call) => call.enablement === "unknown" && (call.hasFakeTransport && call.hasIsolatedState || call.forwardingEdge)).length, unknownUnsafe: calls.filter((call) => call.enablement === "unknown" && !call.forwardingEdge && (!call.hasFakeTransport || !call.hasIsolatedState)).length, forwarding: calls.filter((call) => call.forwardingEdge).length, unsafe: unsafeRequiredDependencies(calls).length }).toEqual({
      total: 81,
      byTarget: { createSupermemoryRuntimeHost: 18, runOpenCodeLaunch: 7, runPiLaunch: 36, runRunnerLaunch: 20 },
      enabled: 33,
      unknownSafe: 13,
      unknownUnsafe: 0,
      forwarding: 2,
      unsafe: 0,
    });
    expect(unresolvedCalls(calls)).toEqual([]);
    expect(unsafeRequiredDependencies(calls)).toEqual([]);
  });

  test("detects enabled helper plus identifier runtime missing isolated state", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
function enabledConfig() { return { adaptiveMemory: { enabled: true, activeProvider: "supermemory" } }; }
const runtime = { transport };
runPiLaunch({ deckConfig: enabledConfig(), supermemoryRuntime: runtime });
`);

    expect(unsafeRequiredDependencies(calls)).toEqual(["synthetic.test.ts:9 runPiLaunch enablement=enabled transport=true state=false"]);
  });

  test("treats adaptiveMemory enabled true as enabled without activeProvider", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
function enabledConfig() { return { adaptiveMemory: { enabled: true } }; }
const runtimeBase = { transport };
const completeRuntime = { ...runtimeBase, stateHome: "/tmp/state" };
runPiLaunch({ deckConfig: { adaptiveMemory: { enabled: true } }, supermemoryRuntime: { transport } });
runPiLaunch({ deckConfig: enabledConfig(), supermemoryRuntime: { transport } });
runPiLaunch({ ...{ deckConfig: enabledConfig(), supermemoryRuntime: completeRuntime } });
`);

    expect(calls.map((call) => call.enablement)).toEqual(["enabled", "enabled", "enabled"]);
    expect(unsafeRequiredDependencies(calls)).toEqual([
      "synthetic.test.ts:10 runPiLaunch enablement=enabled transport=true state=false",
      "synthetic.test.ts:11 runPiLaunch enablement=enabled transport=true state=false",
    ]);
  });

  test("helper names do not confer runtime dependency safety", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
function fakehermeticSupermemoryRuntime() { return { transport }; }
function hermeticSupermemoryRuntime() { return { transport, stateHome: "/tmp/state" }; }
runPiLaunch({ deckConfig: { adaptiveMemory: { enabled: true } }, supermemoryRuntime: fakehermeticSupermemoryRuntime() });
runPiLaunch({ deckConfig: { adaptiveMemory: { enabled: true } }, supermemoryRuntime: hermeticSupermemoryRuntime() });
`);

    expect(calls.map((call) => ({ transport: call.hasFakeTransport, state: call.hasIsolatedState }))).toEqual([
      { transport: true, state: false },
      { transport: true, state: true },
    ]);
    expect(unsafeRequiredDependencies(calls)).toEqual(["synthetic.test.ts:9 runPiLaunch enablement=enabled transport=true state=false"]);
  });

  test("getDefaultDeckConfig calls require local structural provenance", () => {
    const localEnabled = syntheticCalls(`${SYNTHETIC_IMPORTS}
function getDefaultDeckConfig() { return { adaptiveMemory: { enabled: true } }; }
runPiLaunch({ deckConfig: getDefaultDeckConfig(), supermemoryRuntime: { transport } });
`);
    const localDisabled = syntheticCalls(`${SYNTHETIC_IMPORTS}
function getDefaultDeckConfig() { return { adaptiveMemory: { enabled: false } }; }
runPiLaunch({ deckConfig: getDefaultDeckConfig() });
`);
    const importedAuthoritative = syntheticCalls(`${SYNTHETIC_IMPORTS}
import { getDefaultDeckConfig } from "@deck/core";
runPiLaunch({ deckConfig: getDefaultDeckConfig() });
`);
    const importedUnknown = syntheticCalls(`${SYNTHETIC_IMPORTS}
import { getDefaultDeckConfig } from "external-config";
runPiLaunch({ deckConfig: getDefaultDeckConfig() });
`);

    expect(localEnabled.map((call) => call.enablement)).toEqual(["enabled"]);
    expect(unsafeRequiredDependencies(localEnabled)).toEqual(["synthetic.test.ts:8 runPiLaunch enablement=enabled transport=true state=false"]);
    expect(localDisabled.map((call) => call.enablement)).toEqual(["disabled"]);
    expect(unsafeRequiredDependencies(localDisabled)).toEqual([]);
    expect(importedAuthoritative.map((call) => call.enablement)).toEqual(["disabled"]);
    expect(unsafeRequiredDependencies(importedAuthoritative)).toEqual([]);
    expect(importedUnknown.map((call) => call.enablement)).toEqual(["unknown"]);
    expect(unsafeRequiredDependencies(importedUnknown)).toEqual(["synthetic.test.ts:8 runPiLaunch enablement=unknown transport=false state=false"]);
  });

  test("detects identifier option objects missing fake transport", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
const options = { deckConfig: { adaptiveMemory: { enabled: true, activeProvider: "supermemory" } }, supermemoryRuntimeStateHome: "/tmp/state" };
runOpenCodeLaunch(options);
`);

    expect(unsafeRequiredDependencies(calls)).toEqual(["synthetic.test.ts:8 runOpenCodeLaunch enablement=enabled transport=false state=true"]);
  });

  test("detects missing dependency hidden behind object spread", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
const base = { deckConfig: { adaptiveMemory: { enabled: true, activeProvider: "supermemory" } }, supermemoryRuntime: { transport } };
runPiLaunch({ ...base });
`);

    expect(unsafeRequiredDependencies(calls)).toEqual(["synthetic.test.ts:8 runPiLaunch enablement=enabled transport=true state=false"]);
  });

  test("marks unresolved target arguments unknown instead of silently skipping them", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
runRunnerLaunch(makeOptions());
`);

    expect(calls).toHaveLength(1);
    expect(unresolvedCalls(calls)).toEqual(["synthetic.test.ts:7 runRunnerLaunch unresolved=non-object CallExpression"]);
    expect(unsafeRequiredDependencies(calls)).toEqual(["synthetic.test.ts:7 runRunnerLaunch enablement=unknown transport=false state=false"]);
  });

  test("classifies positive disabled and enabled helpers with identifier/spread dependencies", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
function disabledConfig() { return { adaptiveMemory: { enabled: false, activeProvider: "none" } }; }
function enabledConfig() { return { adaptiveMemory: { enabled: true, activeProvider: "supermemory" } }; }
const runtimeBase = { transport };
const runtime = { ...runtimeBase, stateHome: "/tmp/state" };
runPiLaunch({ deckConfig: disabledConfig() });
runPiLaunch({ deckConfig: enabledConfig(), supermemoryRuntime: runtime });
`);

    expect(calls.map((call) => call.enablement)).toEqual(["disabled", "enabled"]);
    expect(unresolvedCalls(calls)).toEqual([]);
    expect(unsafeRequiredDependencies(calls)).toEqual([]);
  });

  test("detects nested runRunnerLaunch helper-enabled composition missing isolated runtime state", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
function enabledConfig() { return { adaptiveMemory: { enabled: true, activeProvider: "supermemory" } }; }
const runtime = { transport };
runRunnerLaunch({ launch: { deckConfig: enabledConfig() }, supermemoryRuntime: runtime });
`);

    expect(unsafeRequiredDependencies(calls)).toEqual(["synthetic.test.ts:9 runRunnerLaunch enablement=enabled transport=true state=false"]);
  });

  test("follows structurally valid forwarding wrappers to their call sites", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
function forward(options) { return runPiLaunch(options); }
const runtime = { transport, stateHome: "/tmp/state" };
forward({ deckConfig: { adaptiveMemory: { activeProvider: "supermemory" } }, supermemoryRuntime: runtime });
`);

    expect(calls.map((call) => ({ target: call.target, forwarding: call.forwardingEdge, enablement: call.enablement }))).toEqual([
      { target: "runPiLaunch", forwarding: true, enablement: "unknown" },
      { target: "runPiLaunch", forwarding: false, enablement: "enabled" },
    ]);
    expect(unresolvedCalls(calls)).toEqual([]);
    expect(unsafeRequiredDependencies(calls)).toEqual([]);
  });

  test("does not trust mutating wrappers that drop runtime dependencies", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
function dropRuntime(options) { return runPiLaunch({ deckConfig: options.deckConfig }); }
dropRuntime({ deckConfig: { adaptiveMemory: { activeProvider: "supermemory" } }, supermemoryRuntime: { transport, stateHome: "/tmp/state" } });
`);

    expect(calls.map((call) => call.forwardingEdge)).toEqual([false]);
    expect(unsafeRequiredDependencies(calls)).toEqual(["synthetic.test.ts:7 runPiLaunch enablement=unknown transport=false state=false"]);
  });

  test("hard-coded enabled calls in the legacy support path are not trusted by pathname", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
runPiLaunch({ deckConfig: { adaptiveMemory: { activeProvider: "supermemory" } }, supermemoryRuntime: { transport } });
`, "apps/cli/src/pi-launch-command-legacy-compatibility.test-support.ts");

    expect(unsafeRequiredDependencies(calls)).toEqual(["apps/cli/src/pi-launch-command-legacy-compatibility.test-support.ts:7 runPiLaunch enablement=enabled transport=true state=false"]);
  });

  test("unresolved wrapper callers are reported rather than skipped", () => {
    const calls = syntheticCalls(`${SYNTHETIC_IMPORTS}
function forward(options) { return runPiLaunch(options); }
forward(makeOptions());
`);

    expect(calls).toHaveLength(2);
    expect(unresolvedCalls(calls)).toEqual(["synthetic.test.ts:8 runPiLaunch unresolved=non-object CallExpression"]);
    expect(unsafeRequiredDependencies(calls)).toEqual(["synthetic.test.ts:8 runPiLaunch enablement=unknown transport=false state=false"]);
  });
});
