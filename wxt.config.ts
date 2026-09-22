import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  srcDir: ".",
  modules: ["@wxt-dev/module-svelte"],
  vite: () => ({
    plugins: [tailwindcss()],
    css: {
      transformer: "postcss",
    },
    build: {
      sourcemap: process.env.DEV_BUILD === "1" ? "inline" : false,
      minify: process.env.DEV_BUILD !== "1",
    },
  }),
  manifest: {
    name: "TabOrdo - Tab Manager & Organizer",
    description: "Sort, group, deduplicate and manage your tabs with a command palette",
    // 138 is the first stable release with the global LanguageModel (/aigroup). It also covers
    // everything older the code used to feature-test: storage getKeys (130), readingList (120),
    // sidePanel.open (116).
    minimum_chrome_version: "138",
    icons: {
      16: "assets/icon-16.png",
      32: "assets/icon-32.png",
      48: "assets/icon-48.png",
      128: "assets/icon-128.png",
    },
    permissions: ["tabs", "tabGroups", "bookmarks", "history", "storage", "alarms", "scripting", "activeTab", "readingList", "contextMenus", "sessions", "favicon"],
    side_panel: {
      default_path: "sidepanel.html",
    },
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Ctrl+Shift+E",
          mac: "Command+E",
        },
        description: "Open TabOrdo command palette",
      },
      "open-dashboard": {
        suggested_key: {
          default: "Ctrl+Shift+D",
          mac: "Command+Shift+E",
        },
        description: "Open TabOrdo dashboard (no search focus)",
      },
    },
  },
});
