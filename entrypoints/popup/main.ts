// Chrome keeps the popup hidden until this page's `load` event, and until then it can run the
// page at background priority: one open measured 20 ms to parse the HTML, then 1.7 s before this
// script's first line ran, while everything after the popup showed took 0.2 s. So nothing waits
// on `load` but the HTML and this file. No static imports, not even the stylesheet: each is one
// more fetch-and-run at that priority. The page shows its loading screen (index.html) first, and
// Svelte, the app and app.css are fetched and mounted once `load` has fired.

// Same prefix as lib/opentiming.ts, written by hand so this file imports nothing.
performance.mark("tabordo:script");

// Keys typed between the popup showing and the app mounting have no input to land in yet.
let typed = "";
const keep = (e: KeyboardEvent) => {
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typed += e.key;
};
window.addEventListener("keydown", keep);

async function start() {
  performance.mark("tabordo:load");
  const [{ mount }, { default: App }] = await Promise.all([
    import("svelte"),
    import("./App.svelte"),
    import("../../app.css"),
  ]);
  window.removeEventListener("keydown", keep);
  const target = document.getElementById("app")!;
  target.replaceChildren();
  mount(App, { target, props: { initialQuery: typed } });
  performance.mark("tabordo:mounted");
}

if (document.readyState === "complete") void start();
else window.addEventListener("load", () => void start(), { once: true });
