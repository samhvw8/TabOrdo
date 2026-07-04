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
      minify: false,
    },
  }),
  manifest: {
    name: "TabOrdo",
    description: "Sort, group, deduplicate and manage your tabs with a command palette",
    icons: {
      16: "assets/icon-16.png",
      32: "assets/icon-32.png",
      48: "assets/icon-48.png",
      128: "assets/icon-128.png",
    },
    permissions: ["tabs", "tabGroups", "bookmarks", "history", "storage", "alarms", "scripting", "activeTab"],
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
