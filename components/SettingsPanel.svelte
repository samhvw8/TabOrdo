<script lang="ts">
  import { onMount } from "svelte";
  import { getConfig, updateConfig, ruleMatches, ruleToRegex, generalizePatterns, type IgnoreRule } from "../lib/rules.ts";
  import { clearActionLog, type ActionLogEntry } from "../lib/actionLog.ts";
  import { relTime } from "../lib/format.ts";

  // App already keeps the log live for its automation strip, so it hands it down rather than
  // this panel holding a second storage subscription.
  let { actionLog }: { actionLog: ActionLogEntry[] } = $props();

  // The URL and group-name ignore lists share one editor: they differ only in their labels,
  // the config key they save to, and the group list's "+ Current" button.
  type IgnoreKey = "ignorePatterns" | "ignoreGroupNames";
  interface IgnoreEditor {
    key: IgnoreKey;
    rules: IgnoreRule[];
    draft: string;
    isRegex: boolean;
    caseSensitive: boolean;
    selected: Set<string>;
  }

  const newEditor = (key: IgnoreKey): IgnoreEditor =>
    ({ key, rules: [], draft: "", isRegex: false, caseSensitive: false, selected: new Set() });
  let urlList = $state(newEditor("ignorePatterns"));
  let groupList = $state(newEditor("ignoreGroupNames"));

  onMount(async () => {
    const config = await getConfig();
    urlList.rules = config.ignorePatterns;
    groupList.rules = config.ignoreGroupNames;
  });

  let testerOpen = $state(false);
  let testerPattern = $state("");
  let testerInput = $state("");
  let testerIsRegex = $state(false);
  let testerCaseSensitive = $state(false);
  let testerResult = $derived.by(() => {
    if (!testerPattern || !testerInput) return null;
    const rule: IgnoreRule = { pattern: testerPattern, enabled: true, isRegex: testerIsRegex, caseSensitive: testerCaseSensitive };
    try { return ruleMatches(testerInput, rule); } catch { return false; }
  });

  function toggleSelect(set: Set<string>, pattern: string) {
    const next = new Set(set);
    if (next.has(pattern)) next.delete(pattern); else next.add(pattern);
    return next;
  }

  function combineRegex(rules: IgnoreRule[], selected: Set<string>): string {
    const parts = rules.filter((r) => selected.has(r.pattern)).map((r) => ruleToRegex(r));
    return parts.length === 1 ? parts[0] : `(${parts.join("|")})`;
  }

  function applyGenerated(ed: IgnoreEditor, regex: string) {
    ed.draft = regex;
    ed.isRegex = true;
    ed.selected = new Set();
  }

  async function save(ed: IgnoreEditor, rules: IgnoreRule[]) {
    ed.rules = rules;
    await updateConfig((config) => { config[ed.key] = rules; });
  }

  async function addRule(ed: IgnoreEditor) {
    const v = ed.draft.trim();
    if (!v || ed.rules.some((r) => r.pattern === v)) return;
    const rule: IgnoreRule = {
      pattern: v, enabled: true,
      ...(ed.isRegex ? { isRegex: true } : {}),
      ...(ed.caseSensitive ? { caseSensitive: true } : {}),
    };
    ed.draft = "";
    ed.isRegex = false;
    ed.caseSensitive = false;
    await save(ed, [...ed.rules, rule]);
  }

  const removeRule = (ed: IgnoreEditor, p: string) => save(ed, ed.rules.filter((r) => r.pattern !== p));
  const toggleRule = (ed: IgnoreEditor, p: string) =>
    save(ed, ed.rules.map((r) => r.pattern === p ? { ...r, enabled: !r.enabled } : r));
  const toggleRuleCase = (ed: IgnoreEditor, p: string) =>
    save(ed, ed.rules.map((r) => r.pattern === p ? { ...r, caseSensitive: !r.caseSensitive || undefined } : r));

  async function addCurrentGroupToIgnore() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!active || active.groupId === -1) return;
    const group = (await chrome.tabGroups.query({})).find((g) => g.id === active.groupId);
    if (!group?.title) return;
    if (!groupList.rules.some((r) => r.pattern === group.title)) {
      await save(groupList, [...groupList.rules, { pattern: group.title!, enabled: true }]);
    }
  }
</script>

{#snippet ignoreEditor(ed: IgnoreEditor, title: string, effect: string, example: string, placeholder: string, onAddCurrent?: () => void)}
  <div class="p-2 rounded-md bg-surface-hover border border-border">
    <div class="text-xs text-text font-medium mb-1">{title}</div>
    <div class="text-[10px] text-text-muted mb-1.5">
      {effect} Wildcards supported (e.g. <code class="px-0.5 bg-surface rounded">{example}</code>). Use <code class="px-0.5 bg-surface rounded">.*</code> toggle for regex.
    </div>
    <div class="flex gap-1 mb-1">
      <input
        type="text"
        class="flex-1 min-w-0 px-1.5 py-1 rounded border border-border bg-surface text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
        {placeholder}
        bind:value={ed.draft}
        onkeydown={(e) => { if (e.key === "Enter") addRule(ed); }}
      />
      <button
        class="shrink-0 px-1.5 py-1 rounded text-[10px] font-medium border transition-colors {ed.isRegex ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/40' : 'bg-surface text-text-muted border-border hover:text-text'}"
        onclick={() => ed.isRegex = !ed.isRegex}
        title={ed.isRegex ? "Regex mode (click for wildcard)" : "Wildcard mode (click for regex)"}
      >.*</button>
      <button
        class="shrink-0 px-1.5 py-1 rounded text-[10px] font-medium border transition-colors {ed.caseSensitive ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/40' : 'bg-surface text-text-muted border-border hover:text-text'}"
        onclick={() => ed.caseSensitive = !ed.caseSensitive}
        title={ed.caseSensitive ? "Case sensitive (click for insensitive)" : "Case insensitive (click for sensitive)"}
      >Aa</button>
      <button
        class="shrink-0 px-2 py-1 rounded text-[10px] font-medium bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-40"
        onclick={() => addRule(ed)}
        disabled={!ed.draft.trim()}
      >Add</button>
      {#if onAddCurrent}
        <button
          class="shrink-0 px-2 py-1 rounded text-[10px] font-medium bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30 hover:bg-accent-cyan/25 transition-colors"
          onclick={onAddCurrent}
          title="Add the active tab's group name to ignore list"
        >+ Current</button>
      {/if}
    </div>
    {#if ed.rules.length > 0}
      <div class="flex flex-wrap gap-1">
        {#each ed.rules as rule}
          <span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] cursor-pointer select-none
              {ed.selected.has(rule.pattern) ? 'ring-1 ring-primary bg-primary/10 border-primary/40' : rule.enabled ? 'bg-surface border-border text-text' : 'bg-surface/50 border-border/50 text-text-muted line-through'}"
            role="option"
            aria-selected={ed.selected.has(rule.pattern)}
            onclick={(e) => { if (e.shiftKey) ed.selected = toggleSelect(ed.selected, rule.pattern); }}
            onkeydown={(e) => { if (e.key === " ") { e.preventDefault(); ed.selected = toggleSelect(ed.selected, rule.pattern); } }}
            tabindex="0"
            title="Shift+click to select for regex generation"
          >
            <button class="w-2 h-2 rounded-full shrink-0 {rule.enabled ? 'bg-accent-green' : 'bg-border'}" onclick={(e) => { e.stopPropagation(); toggleRule(ed, rule.pattern); }} title={rule.enabled ? "Disable" : "Enable"}></button>
            {#if rule.isRegex}<span class="text-accent-cyan opacity-60" title="Regex">.*</span>{/if}
            {rule.pattern}
            <button class="opacity-50 hover:opacity-100 transition-opacity {rule.caseSensitive ? 'text-accent-cyan' : 'text-text-muted'}" onclick={(e) => { e.stopPropagation(); toggleRuleCase(ed, rule.pattern); }} title={rule.caseSensitive ? "Case sensitive" : "Case insensitive"}>Aa</button>
            <button class="text-text-muted hover:text-accent-red transition-colors" onclick={(e) => { e.stopPropagation(); removeRule(ed, rule.pattern); }} title="Remove">&times;</button>
          </span>
        {/each}
      </div>
      {#if ed.selected.size > 0}
        <div class="flex items-center gap-1 mt-1">
          <button
            class="px-2 py-0.5 rounded text-[10px] font-medium bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors"
            onclick={() => applyGenerated(ed, generalizePatterns(ed.rules.filter((r) => ed.selected.has(r.pattern))))}
            title="Find common pattern across selected rules and generate a generic regex"
          >Generalize ({ed.selected.size})</button>
          <button
            class="px-2 py-0.5 rounded text-[10px] font-medium bg-surface text-text-muted border border-border hover:text-text transition-colors"
            onclick={() => applyGenerated(ed, combineRegex(ed.rules, ed.selected))}
            title="Combine selected rules into one regex with alternation (|)"
          >Combine</button>
          <button
            class="px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:text-text transition-colors"
            onclick={() => ed.selected = new Set()}
          >Clear</button>
        </div>
      {/if}
      <div class="text-[9px] text-text-muted/60 mt-1">Shift+click rules to select · Generalize finds common pattern · Combine joins with OR</div>
    {/if}
  </div>
{/snippet}

<div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
  <div class="text-xs font-semibold text-text mb-2">Settings</div>

  <!-- Ignore Lists -->
  <div class="mb-3">
    <div class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Ignore Lists</div>

    <div class="grid gap-2">
      {@render ignoreEditor(urlList, "Ignored URL patterns", "Tabs matching these won't be auto-grouped.", "localhost:*", "e.g. localhost:5763")}
      {@render ignoreEditor(groupList, "Ignored group names", "Groups matching these won't be auto-ungrouped.", "*Claude*", "e.g. *Claude* or claude", addCurrentGroupToIgnore)}
    </div>

    <!-- Pattern tester -->
    <div class="mt-2">
      <button
        class="text-[10px] text-text-muted hover:text-text transition-colors flex items-center gap-1"
        onclick={() => testerOpen = !testerOpen}
      >
        <span class="inline-block transition-transform {testerOpen ? 'rotate-90' : ''}" style="font-size:8px">&#9654;</span>
        Test pattern
      </button>
      {#if testerOpen}
        <div class="mt-1 p-2 rounded-md bg-surface-hover border border-border">
          <div class="flex gap-1 mb-1">
            <input
              type="text"
              class="flex-1 min-w-0 px-1.5 py-1 rounded border border-border bg-surface text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
              placeholder="Pattern"
              bind:value={testerPattern}
            />
            <button
              class="shrink-0 px-1.5 py-1 rounded text-[10px] font-medium border transition-colors {testerIsRegex ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/40' : 'bg-surface text-text-muted border-border hover:text-text'}"
              onclick={() => testerIsRegex = !testerIsRegex}
              title={testerIsRegex ? "Regex" : "Wildcard"}
            >.*</button>
            <button
              class="shrink-0 px-1.5 py-1 rounded text-[10px] font-medium border transition-colors {testerCaseSensitive ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/40' : 'bg-surface text-text-muted border-border hover:text-text'}"
              onclick={() => testerCaseSensitive = !testerCaseSensitive}
              title={testerCaseSensitive ? "Case sensitive" : "Case insensitive"}
            >Aa</button>
          </div>
          <div class="flex gap-1 items-center">
            <input
              type="text"
              class="flex-1 min-w-0 px-1.5 py-1 rounded border border-border bg-surface text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
              placeholder="Test input"
              bind:value={testerInput}
            />
            {#if testerResult !== null}
              <span class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded {testerResult ? 'bg-accent-green/15 text-accent-green' : 'bg-accent-red/15 text-accent-red'}">
                {testerResult ? "Match" : "No match"}
              </span>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Automation activity -->
  <div class="mb-3">
    <div class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Automation Activity</div>
    <div class="p-2 rounded-md bg-surface-hover border border-border">
      <div class="text-[10px] text-text-muted mb-1.5">
        Recent automatic grouping/ungrouping actions taken by TabOrdo. Use this to diagnose conflicts with other extensions.
      </div>
      {#if actionLog.length === 0}
        <div class="text-[10px] text-text-muted italic">No automation activity yet.</div>
      {:else}
        <div class="flex flex-col gap-0.5 max-h-44 overflow-y-auto">
          {#each actionLog as entry (entry.ts + entry.detail)}
            <div class="flex items-baseline gap-1.5 text-[10px] leading-4">
              <span class="text-text-muted/70 shrink-0 w-14">{relTime(entry.ts)}</span>
              <span class="font-medium text-text shrink-0">{entry.action}</span>
              <span class="text-text-muted truncate" title={entry.detail}>{entry.detail}</span>
            </div>
          {/each}
        </div>
        <button
          class="mt-1.5 px-2 py-0.5 rounded text-[10px] font-medium bg-surface text-text-muted border border-border hover:text-text transition-colors"
          onclick={clearActionLog}
        >Clear</button>
      {/if}
    </div>
  </div>
</div>
