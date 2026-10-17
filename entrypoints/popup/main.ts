// Chrome keeps the popup hidden until this page's `load` event, and until then it can run the
// page at background priority: one open measured 20 ms to parse the HTML, then 1.7 s before this
// script's first line ran, while everything after the popup showed took 0.2 s. So nothing waits
// on `load` but the HTML and this file. No static imports, not even the stylesheet: each is one
// more fetch-and-run at that priority. The page shows its loading screen (index.html) first, and
// Svelte, the app and app.css are fetched and mounted once `load` has fired.

// Same prefix as lib/opentiming.ts, written by hand so this file imports nothing.
performance.mark("tabordo:script");

// Start the first-paint Chrome IPC reads immediately at `script started`, before `load` and
// before Svelte and App.svelte finish loading. Extension `chrome.*` IPCs do not touch Blink's
// ResourceFetcher (`Document::ShouldComplete()`), so they never hold `load` or `DidStopLoading()`,
// and they resolve in the browser process while the renderer is still compiling the app chunk.
const initialBoot = {
  tabs: chrome.tabs.query({}),
  groups: chrome.tabGroups.query({}),
  win: chrome.windows.getCurrent(),
  local: chrome.storage.local.get([
    "rulesConfig",
    "collapsedGroups",
    "dashboardActionIds",
    "onboardingDismissed",
    "pinnedTabs",
  ]),
  session: chrome.storage.session.get("openMode").catch(() => ({}) as Record<string, unknown>),
};

// Keys typed between the popup showing and the app mounting have no input to land in yet.
let typed = "";
const keep = (e: KeyboardEvent) => {
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typed += e.key;
};
window.addEventListener("keydown", keep);

async function start() {
  const [{ mount }, { default: App }] = await Promise.all([
    import("svelte"),
    import("./App.svelte"),
    import("../../app.css"),
  ]);
  window.removeEventListener("keydown", keep);
  const target = document.getElementById("app")!;
  target.replaceChildren();
  mount(App, { target, props: { initialQuery: typed, initialBoot } });
  performance.mark("tabordo:mounted");
}

// Step out of `Document::DispatchLoadEventAndFinalize()` so `Document::CheckCompletedInternal()`
// finishes `DidFinishLoad` + `DidStopLoading` (`ExtensionViewViews::OnLoaded()`) before Vite's
// preload helper injects `<link rel="stylesheet">`. Use `MessageChannel` (`TaskType::kPostedMessage`)
// rather than `setTimeout(..., 0)`: Blink's `DOMTimer` queue is throttled in hidden frames until
// the browser UI thread sends `WasShown()` back (~200+ ms later).
function onLoaded() {
  performance.mark("tabordo:load");
  const ch = new MessageChannel();
  ch.port1.onmessage = () => void start();
  ch.port2.postMessage(null);
}

if (document.readyState === "complete") onLoaded();
else window.addEventListener("load", onLoaded, { once: true });
