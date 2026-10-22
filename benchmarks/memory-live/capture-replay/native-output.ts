/** Decode actual hook outputs; never score the JSON transport quoting as prose. */
export function nativeContext(output: string) {
    const contexts: string[] = [];
    for (const line of output.split('\n').filter(Boolean)) {
        try {
            const parsed = JSON.parse(line);
            const text = parsed.hookSpecificOutput?.additionalContext ?? parsed.additionalContext ?? parsed.systemMessage;
            if (typeof text === 'string' && /supermemory/i.test(text))
                contexts.push(text);
            if (Array.isArray(parsed.parts))
                for (const part of parsed.parts)
                    if (part.type === 'text' && /\[SUPERMEMORY\]|<supermemory-(?:context|recall)>/i.test(part.text ?? ''))
                        contexts.push(part.text);
        }
        catch { }
    }
    const text = contexts.join('\n');
    // A marked bullet starts one returned memory. OpenCode preserves newlines inside
    // a conversation hit; keep its continuation lines until a real envelope boundary.
    const units: string[] = [];
    for (const context of contexts) {
        let current: string[] = [];
        const flush = () => { if (current.length)
            units.push(current.join('\n').trim()); current = []; };
        for (const line of context.split('\n')) {
            const bullet = line.match(/^\s*(?:[-*•]\s*)?◪\s*(?:\[\d+%\]\s*)?(.*)$/);
            if (bullet) {
                flush();
                if (!/^(?:Recalled from supermemory for this prompt\b|supermemory(?:\s*[·:—-]?\s*recall)?(?:\s*\([^)]*\))?\s*$)/i.test(bullet[1]!.trim()))
                    current.push(bullet[1]!);
            }
            else if (/^\s*(?:<\/?supermemory-|\[SUPERMEMORY\]|#{1,3}\s|(?:User Profile|Recent Context|Project Memories|Relevant Memories):|When one(?: of these)? shapes your answer|Use these memories only when relevant)/i.test(line)) {
                flush();
            }
            else if (current.length) {
                current.push(line);
            }
        }
        flush();
    }
    return { text, units };
}
/** Raw native recall includes profile facts and profile-query hits, before plugin filtering. */
export function nativeRawUnits(observations: {
    endpoint: string;
    body: any;
}[]): string[] {
    const text = (value: any): string => typeof value === 'string' ? value : value?.memory ?? value?.content ?? value?.chunk ?? value?.text ?? '';
    return observations.flatMap(o => o.endpoint === '/v4/search' ? (o.body?.results ?? []) : o.endpoint === '/v4/profile' ? [...(o.body?.profile?.static ?? []), ...(o.body?.profile?.dynamic ?? []), ...(o.body?.searchResults?.results ?? [])] : []).map(text).filter(Boolean);
}
