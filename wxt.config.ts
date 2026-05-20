import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  modules: ["@wxt-dev/module-svelte"],
  manifest: {
    name: "TabOrdo",
    description: "Sort, group, deduplicate and manage your tabs with a command palette",
    permissions: ["tabs", "tabGroups", "bookmarks", "history", "storage"],
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Ctrl+Shift+K",
          mac: "Command+Shift+K",
        },
        description: "Open TabOrdo command palette",
      },
    },
  },
});
