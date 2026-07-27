// URL helpers, as a leaf module.
//
// These used to live in tabs.ts, which made rules.ts import tabs.ts purely to reach
// getFullHostname — while tabs.ts imports rules.ts. That cycle was harmless while only
// function declarations crossed it (they hoist), but rules.ts now runs code at module scope
// to register its storage.onChanged listener, so evaluation order inside the cycle started
// deciding whether that listener exists at all. Same zero-dependency pattern as favicon.ts.
import { getDomain as tldtsDomain } from "tldts";

export function getDomain(url: string): string {
  try {
    return tldtsDomain(url, { allowPrivateDomains: false }) || new URL(url).hostname;
  } catch {
    return url;
  }
}

export function getFullHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
