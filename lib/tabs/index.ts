// Barrel for the tab modules. Import sites use this path, so the split below is free to move.
//
// lib/tabs.ts had grown to 971 lines and 41 exports covering nine unrelated concerns, which made
// it the file every change touched and the one nobody could hold in their head.

export * from "./types.ts";
export * from "./query.ts";
export * from "./sort.ts";
export * from "./group.ts";
export * from "./dedup.ts";
export * from "./window.ts";
export * from "./close.ts";
export * from "./media.ts";
export * from "./order.ts";
export * from "./lock.ts";
// Re-exports recordOpener/forgetTab, whose write serialisation assumes the background service
// worker is the only writer — see the queue comment in tree.ts. The popup and the side panel
// import this barrel too, and each realm gets its own queue, so keep the writers to the
// background. The readers are safe anywhere: resolveParents filters against live tabs.
export * from "./tree.ts";

// Re-exported so existing importers keep their import site; the definitions live in url.ts.
export { getDomainMapper, getFullHostname, hashCode, type DomainMapper } from "../url.ts";
