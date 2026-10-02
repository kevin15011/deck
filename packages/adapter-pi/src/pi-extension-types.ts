/**
 * Pi extension contract types. Type-only re-exports of the real Pi 1.0 API so Deck extensions are typed against
 * Pi itself (the dev dependency is never loaded at runtime from adapter code).
 */
export type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
