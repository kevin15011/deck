/** Process-local routing between separately bundled native extensions, never caller authority. */
const KEY = Symbol.for("deck.pi.native-preparation-routes.v1");
type Route = (request: unknown, cwd: string) => void;
const host = globalThis as typeof globalThis & { [KEY]?: Map<string, Route> };
const routes = host[KEY] ??= new Map<string, Route>();
const key = (sessionId: string, sessionFile: string) => JSON.stringify([sessionId, sessionFile]);

export function registerNativePreparationRoute(sessionId: string, sessionFile: string, route: Route): () => void {
  const id = key(sessionId, sessionFile);
  routes.set(id, route);
  return () => { if (routes.get(id) === route) routes.delete(id); };
}

export function routeNativePreparation(sessionId: string, sessionFile: unknown, request: unknown, cwd: string): boolean {
  if (typeof sessionFile !== "string" || !sessionFile) return false;
  const route = routes.get(key(sessionId, sessionFile));
  if (!route) return false;
  route(request, cwd);
  return true;
}
