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
      sourcemap: "inline",
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
    permissions: ["tabs", "tabGroups", "bookmarks", "history", "storage", "alarms"],
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Ctrl+E",
          mac: "Command+E",
        },
        description: "Open TabOrdo command palette",
      },
    },
  },
});
