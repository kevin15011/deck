export type JsonNode = { value: unknown; start: number; end: number; properties?: Map<string, { node: JsonNode; start: number; comma?: number; previousComma?: number }>; elements?: Array<{ node: JsonNode; comma?: number; previousComma?: number }> };
/** Small JSONC range reader, for precise deletions that retain sibling bytes/comments. No evaluation. */
export function jsonRanges(text: string): JsonNode {
  let at = 0;
  const skip = () => { for (;;) { const match = /^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/.exec(text.slice(at)); if (!match) return; at += match[0].length; } };
  const parse = (): JsonNode => {
    skip(); const start = at;
    if (text[at] === '{') {
      at++; const properties: NonNullable<JsonNode['properties']> = new Map(); const value: Record<string, unknown> = {}; let previousComma: number | undefined;
      skip();
      while (text[at] !== '}') {
        skip(); const propertyStart = at; const keyNode = parse();
        if (typeof keyNode.value !== 'string' || properties.has(keyNode.value)) throw new Error('Duplicate or invalid JSON key');
        skip(); if (text[at++] !== ':') throw new Error('Invalid JSON property');
        const node = parse(); skip(); let comma: number | undefined;
        if (text[at] === ',') { comma = at++; } else if (text[at] !== '}') throw new Error('Invalid JSON object');
        properties.set(keyNode.value, { node, start: propertyStart, comma, previousComma });
        Object.defineProperty(value, keyNode.value, { value: node.value, enumerable: true }); previousComma = comma; skip();
        if (at >= text.length) throw new Error('Unterminated JSON object');
      }
      at++; return { value, start, end: at, properties };
    }
    if (text[at] === '[') {
      at++; const value: unknown[] = []; const elements: NonNullable<JsonNode['elements']> = []; let previousComma: number | undefined; skip();
      while (text[at] !== ']') {
        const node = parse(); value.push(node.value); skip(); let comma: number | undefined;
        if (text[at] === ',') comma = at++; else if (text[at] !== ']') throw new Error('Invalid JSON array');
        elements.push({ node, comma, previousComma }); previousComma = comma;
        skip(); if (at >= text.length) throw new Error('Unterminated JSON array');
      }
      at++; return { value, start, end: at, elements };
    }
    const match = /^(?:"(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (!match) throw new Error('Invalid JSON value'); at += match[0].length; return { value: JSON.parse(match[0]), start, end: at };
  };
  const node = parse(); skip(); if (at !== text.length) throw new Error('Trailing JSON content'); return node;
}
