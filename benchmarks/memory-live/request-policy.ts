import { fail } from './security';
/** Legacy metadata predicates used by the pinned hooks; selectors cannot be smuggled in values. */
export function validateFilters(value: unknown, depth = 0): void {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 5)
        fail('invalid_filter');
    const node = value as Record<string, unknown>, keys = Object.keys(node);
    if (keys.length === 1 && ['AND', 'OR'].includes(keys[0]!)) {
        const children = node[keys[0]!];
        if (!Array.isArray(children) || !children.length || children.length > 20)
            fail('invalid_filter');
        for (const child of children)
            validateFilters(child, depth + 1);
        return;
    }
    if (keys.length !== 3 || !keys.every(k => ['key', 'value', 'filterType'].includes(k)) || node.filterType !== 'metadata' || typeof node.key !== 'string' || typeof node.value !== 'string')
        fail('invalid_filter');
    if (!/^[a-z][a-z0-9_.-]{0,63}$/i.test(node.key) || /container.?tags?|namespaces?|projectIds?|^spaces?$/i.test(node.key))
        fail('filter_selector_forbidden');
    if (!node.value.length || node.value.length > 256 || /deck_eval_|sm_project_v1_|container.?tags?|namespaces?|projectIds?|\b(?:spaces?|scopes?|tags?)\s*[:=]|["{}\[\]<>]|(?:^|[\s:=])(?:default|legacy|production)(?:$|[\s,;])/i.test(node.value))
        fail('filter_selector_forbidden');
}
export const nativeOrRuntimeId = (id: string) => /^(?:deck_conversation_[a-f0-9]{16}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|opencode:capture:[a-f0-9]{64})$/.test(id);
/** This denylist complements the endpoint allowlist; even scoped bodies cannot authorize account operations. */
export function rejectAccountEndpoint(path: string, method: string): void {
    let decoded: string;
    try {
        decoded = decodeURIComponent(path);
    }
    catch {
        fail('invalid_endpoint_encoding');
    }
    if (/^\/(?:v\d+\/)?(?:settings|organizations?|organizational[-_]?context|auth|scoped[-_]?keys?|billing|connectors?|connections?|spaces?|projects?|namespaces)(?:\/|$)/i.test(decoded) || /^\/ns\/?$/.test(decoded))
        fail('account_endpoint_forbidden');
    if (['PATCH', 'PUT'].includes(method) && !/^\/ns\/deck_eval_[a-z0-9_]+(?:\/profile\/buckets)?$/.test(path))
        fail('account_modification_forbidden');
}
/** Published v5 namespace configuration only. Unknown fields and selector-bearing aliases stay forbidden. */
export function namespaceConfiguration(path: string, method: string, body: Record<string, unknown>): string | undefined {
    const match = path.match(/^\/ns\/(deck_eval_[a-z0-9_]+)(\/profile\/buckets)?$/);
    if (!match || !(match[2] ? ['PUT', 'DELETE'].includes(method) : method === 'PATCH'))
        return undefined;
    if (Object.keys(body).length !== 1)
        fail('invalid_namespace_configuration');
    if (!match[2]) {
        if (!Object.hasOwn(body, 'supportingContext') || !(body.supportingContext === null || typeof body.supportingContext === 'string' && body.supportingContext.length <= 1500))
            fail('invalid_namespace_configuration');
    }
    else {
        const buckets = body.buckets, slug = (s: unknown) => typeof s === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s);
        if (method === 'DELETE') {
            if (!Array.isArray(buckets) || !buckets.length || buckets.length > 50 || !buckets.every(slug) || new Set(buckets).size !== buckets.length)
                fail('invalid_namespace_buckets');
        }
        else if (!buckets || typeof buckets !== 'object' || Array.isArray(buckets) || !Object.keys(buckets).length || Object.keys(buckets).length > 50 || Object.entries(buckets).some(([k, v]) => !slug(k) || typeof v !== 'string' || v.length > 2000))
            fail('invalid_namespace_buckets');
    }
    return match[1]!;
}
