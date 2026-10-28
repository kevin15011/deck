import { isAlias, isMap, isScalar, parseDocument, visit } from 'yaml';

/** Additive config initialization only. Unknown schemas/structures are never guessed. */
export function planOpenSpecInitialization(source?: string): string {
  if (source !== undefined && Buffer.byteLength(source) > 128 * 1024) throw new Error('config-budget-exceeded');
  const doc = parseDocument(source ?? 'schema: spec-driven\n', { uniqueKeys: true, keepSourceTokens: true });
  if (doc.errors.length || !isMap(doc.contents)) throw new Error('config-malformed');
  let nodes = 0;
  visit(doc, (_key, node, path) => {
    if (++nodes > 4096 || path.length > 32 || isAlias(node)) throw new Error('config-unsupported');
  });
  if (doc.contents.items.some(pair => !isScalar(pair.key) || typeof pair.key.value !== 'string')) throw new Error('config-unsupported');
  const schema = doc.get('schema'), initialized = doc.get('initialized');
  if (schema !== undefined && schema !== 'spec-driven' || initialized !== undefined && typeof initialized !== 'boolean') throw new Error('config-unsupported');
  if (initialized === true) return source!;
  if (schema === undefined) doc.set('schema', 'spec-driven');
  doc.set('initialized', true);
  const result = doc.toString({ lineWidth: 0 });
  if (parseDocument(result).get('initialized') !== true) throw new Error('config-postcondition-failed');
  return result;
}
