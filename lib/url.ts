// URL helpers, as a leaf module.
//
// These used to live in tabs.ts, which made rules.ts import tabs.ts purely to reach
// getFullHostname — while tabs.ts imports rules.ts. That cycle was harmless while only
// function declarations crossed it (they hoist), but rules.ts now runs code at module scope
// to register its storage.onChanged listener, so evaluation order inside the cycle started
// deciding whether that listener exists at all. Same zero-dependency pattern as favicon.ts.

/**
 * Registrable-domain lookup, loaded on demand.
 *
 * tldts carries the full public-suffix trie: ~300 KB, HALF the popup bundle, parsed on every
 * single popup open. Nothing on the first-paint path needs it — the tab list renders
 * getFullHostname below, which is plain URL parsing. Only domain *actions* need real PSL
 * accuracy (so bbc.co.uk groups as bbc.co.uk and not co.uk), and every one of those is async.
 *
 * The parser is handed back as a function rather than exposed as a sync getDomain that might
 * run before the dynamic import resolves. You cannot call it without having awaited the load,
 * so there is no silent fall-back to naive parsing that would quietly regroup someone's tabs.
 */
export type DomainMapper = (url: string) => string;

let cachedMapper: DomainMapper | null = null;
let inflight: Promise<DomainMapper> | null = null;

export async function getDomainMapper(): Promise<DomainMapper> {
  if (cachedMapper) return cachedMapper;
  if (!inflight) {
    inflight = import("tldts").then(({ getDomain: tldtsDomain }) => {
      // Sort comparators ask for the same handful of URLs O(n log n) times, so memoise.
      const memo = new Map<string, string>();
      cachedMapper = (url: string): string => {
        const hit = memo.get(url);
        if (hit !== undefined) return hit;
        let out: string;
        try {
          out = tldtsDomain(url, { allowPrivateDomains: false }) || new URL(url).hostname;
        } catch {
          out = url;
        }
        memo.set(url, out);
        return out;
      };
      return cachedMapper;
    });
  }
  return inflight;
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
