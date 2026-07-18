<script lang="ts">
  import { onMount } from "svelte";
  import { getIgnorePatterns, setIgnorePatterns, getIgnoreGroupNames, setIgnoreGroupNames, ruleMatches, ruleToRegex, generalizePatterns, type IgnoreRule } from "../lib/rules.ts";
  import { getActionLog, clearActionLog, ACTION_LOG_KEY, type ActionLogEntry } from "../lib/actionLog.ts";

  let ignorePatterns = $state<IgnoreRule[]>([]);
  let ignoreGroupNames = $state<IgnoreRule[]>([]);
  let newIgnorePattern = $state("");
  let newIgnoreGroupName = $state("");
  let actionLog = $state<ActionLogEntry[]>([]);

  onMount(async () => {
    ignorePatterns = await getIgnorePatterns();
    ignoreGroupNames = await getIgnoreGroupNames();
    actionLog = await getActionLog();
  });

  $effect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[ACTION_LOG_KEY]) {
        actionLog = Array.isArray(changes[ACTION_LOG_KEY].newValue) ? changes[ACTION_LOG_KEY].newValue : [];
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  });

  function formatLogTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  async function handleClearLog() {
    await clearActionLog();
    actionLog = [];
  }

  let newPatternIsRegex = $state(false);
  let newPatternCaseSensitive = $state(false);
  let newGroupIsRegex = $state(false);
  let newGroupCaseSensitive = $state(false);

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

  let selectedUrlPatterns = $state<Set<string>>(new Set());
  let selectedGroupNames = $state<Set<string>>(new Set());

  function toggleSelect(set: Set<string>, pattern: string) {
    const next = new Set(set);
    if (next.has(pattern)) next.delete(pattern); else next.add(pattern);
    return next;
  }

  function combineRegex(rules: IgnoreRule[], selected: Set<string>): string {
    const parts = rules.filter((r) => selected.has(r.pattern)).map((r) => ruleToRegex(r));
    return parts.length === 1 ? parts[0] : `(${parts.join("|")})`;
  }

  function applyGenerated(target: "url" | "group", regex: string) {
    if (target === "url") {
      newIgnorePattern = regex;
      newPatternIsRegex = true;
      selectedUrlPatterns = new Set();
    } else {
      newIgnoreGroupName = regex;
      newGroupIsRegex = true;
      selectedGroupNames = new Set();
    }
  }

  async function addIgnorePattern() {
    const v = newIgnorePattern.trim();
    if (!v || ignorePatterns.some((r) => r.pattern === v)) return;
    ignorePatterns = [...ignorePatterns, {
      pattern: v, enabled: true,
      ...(newPatternIsRegex ? { isRegex: true } : {}),
      ...(newPatternCaseSensitive ? { caseSensitive: true } : {}),
    }];
    newIgnorePattern = "";
    newPatternIsRegex = false;
    newPatternCaseSensitive = false;
    await setIgnorePatterns(ignorePatterns);
  }

  async function removeIgnorePattern(p: string) {
    ignorePatterns = ignorePatterns.filter((r) => r.pattern !== p);
    await setIgnorePatterns(ignorePatterns);
  }

  async function toggleIgnorePattern(p: string) {
    ignorePatterns = ignorePatterns.map((r) => r.pattern === p ? { ...r, enabled: !r.enabled } : r);
    await setIgnorePatterns(ignorePatterns);
  }

  async function toggleIgnorePatternCase(p: string) {
    ignorePatterns = ignorePatterns.map((r) => r.pattern === p ? { ...r, caseSensitive: !r.caseSensitive || undefined } : r);
    await setIgnorePatterns(ignorePatterns);
  }

  async function addIgnoreGroupName() {
    const v = newIgnoreGroupName.trim();
    if (!v || ignoreGroupNames.some((r) => r.pattern === v)) return;
    ignoreGroupNames = [...ignoreGroupNames, {
      pattern: v, enabled: true,
      ...(newGroupIsRegex ? { isRegex: true } : {}),
      ...(newGroupCaseSensitive ? { caseSensitive: true } : {}),
    }];
    newIgnoreGroupName = "";
    newGroupIsRegex = false;
    newGroupCaseSensitive = false;
    await setIgnoreGroupNames(ignoreGroupNames);
  }

  async function removeIgnoreGroupName(p: string) {
    ignoreGroupNames = ignoreGroupNames.filter((r) => r.pattern !== p);
    await setIgnoreGroupNames(ignoreGroupNames);
  }

  async function toggleIgnoreGroupName(p: string) {
    ignoreGroupNames = ignoreGroupNames.map((r) => r.pattern === p ? { ...r, enabled: !r.enabled } : r);
    await setIgnoreGroupNames(ignoreGroupNames);
  }

  async function toggleIgnoreGroupNameCase(p: string) {
    ignoreGroupNames = ignoreGroupNames.map((r) => r.pattern === p ? { ...r, caseSensitive: !r.caseSensitive || undefined } : r);
    await setIgnoreGroupNames(ignoreGroupNames);
  }

  async function addCurrentGroupToIgnore() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!active || active.groupId === -1) return;
    const group = (await chrome.tabGroups.query({})).find((g) => g.id === active.groupId);
    if (!group?.title) return;
    if (!ignoreGroupNames.some((r) => r.pattern === group.title)) {
      ignoreGroupNames = [...ignoreGroupNames, { pattern: group.title!, enabled: true }];
      await setIgnoreGroupNames(ignoreGroupNames);
    }
  }
</script>

<div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
  <div class="text-xs font-semibold text-text mb-2">Settings</div>

  <!-- Ignore Lists -->
  <div class="mb-3">
    <div class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Ignore Lists</div>

    <!-- Ignore URL patterns -->
    <div class="p-2 rounded-md bg-surface-hover border border-border mb-2">
      <div class="text-xs text-text font-medium mb-1">Ignored URL patterns</div>
      <div class="text-[10px] text-text-muted mb-1.5">
        Tabs matching these won't be auto-grouped. Wildcards supported (e.g. <code class="px-0.5 bg-surface rounded">localhost:*</code>). Use <code class="px-0.5 bg-surface rounded">.*</code> toggle for regex.
      </div>
      <div class="flex gap-1 mb-1">
        <input
          type="text"
          class="flex-1 min-w-0 px-1.5 py-1 rounded border border-border bg-surface text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
          placeholder="e.g. localhost:5763"
          bind:value={newIgnorePattern}
          onkeydown={(e) => { if (e.key === "Enter") addIgnorePattern(); }}
        />
        <button
          class="shrink-0 px-1.5 py-1 rounded text-[10px] font-medium border transition-colors {newPatternIsRegex ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/40' : 'bg-surface text-text-muted border-border hover:text-text'}"
          onclick={() => newPatternIsRegex = !newPatternIsRegex}
          title={newPatternIsRegex ? "Regex mode (click for wildcard)" : "Wildcard mode (click for regex)"}
        >.*</button>
        <button
          class="shrink-0 px-1.5 py-1 rounded text-[10px] font-medium border transition-colors {newPatternCaseSensitive ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/40' : 'bg-surface text-text-muted border-border hover:text-text'}"
          onclick={() => newPatternCaseSensitive = !newPatternCaseSensitive}
          title={newPatternCaseSensitive ? "Case sensitive (click for insensitive)" : "Case insensitive (click for sensitive)"}
        >Aa</button>
        <button
          class="shrink-0 px-2 py-1 rounded text-[10px] font-medium bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-40"
          onclick={addIgnorePattern}
          disabled={!newIgnorePattern.trim()}
        >Add</button>
      </div>
      {#if ignorePatterns.length > 0}
        <div class="flex flex-wrap gap-1">
          {#each ignorePatterns as rule}
            <span
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] cursor-pointer select-none
                {selectedUrlPatterns.has(rule.pattern) ? 'ring-1 ring-primary bg-primary/10 border-primary/40' : rule.enabled ? 'bg-surface border-border text-text' : 'bg-surface/50 border-border/50 text-text-muted line-through'}"
              role="option"
              aria-selected={selectedUrlPatterns.has(rule.pattern)}
              onclick={(e) => { if (e.shiftKey) selectedUrlPatterns = toggleSelect(selectedUrlPatterns, rule.pattern); }}
              onkeydown={(e) => { if (e.key === " ") { e.preventDefault(); selectedUrlPatterns = toggleSelect(selectedUrlPatterns, rule.pattern); } }}
              tabindex="0"
              title="Shift+click to select for regex generation"
            >
              <button class="w-2 h-2 rounded-full shrink-0 {rule.enabled ? 'bg-accent-green' : 'bg-border'}" onclick={(e) => { e.stopPropagation(); toggleIgnorePattern(rule.pattern); }} title={rule.enabled ? "Disable" : "Enable"}></button>
              {#if rule.isRegex}<span class="text-accent-cyan opacity-60" title="Regex">.*</span>{/if}
              {rule.pattern}
              <button class="opacity-50 hover:opacity-100 transition-opacity {rule.caseSensitive ? 'text-accent-cyan' : 'text-text-muted'}" onclick={(e) => { e.stopPropagation(); toggleIgnorePatternCase(rule.pattern); }} title={rule.caseSensitive ? "Case sensitive" : "Case insensitive"}>Aa</button>
              <button class="text-text-muted hover:text-accent-red transition-colors" onclick={(e) => { e.stopPropagation(); removeIgnorePattern(rule.pattern); }} title="Remove">&times;</button>
            </span>
          {/each}
        </div>
        {#if selectedUrlPatterns.size > 0}
          <div class="flex items-center gap-1 mt-1">
            <button
              class="px-2 py-0.5 rounded text-[10px] font-medium bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors"
              onclick={() => applyGenerated("url", generalizePatterns(ignorePatterns.filter((r) => selectedUrlPatterns.has(r.pattern))))}
              title="Find common pattern across selected rules and generate a generic regex"
            >Generalize ({selectedUrlPatterns.size})</button>
            <button
              class="px-2 py-0.5 rounded text-[10px] font-medium bg-surface text-text-muted border border-border hover:text-text transition-colors"
              onclick={() => applyGenerated("url", combineRegex(ignorePatterns, selectedUrlPatterns))}
              title="Combine selected rules into one regex with alternation (|)"
            >Combine</button>
            <button
              class="px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:text-text transition-colors"
              onclick={() => selectedUrlPatterns = new Set()}
            >Clear</button>
          </div>
        {/if}
        <div class="text-[9px] text-text-muted/60 mt-1">Shift+click rules to select · Generalize finds common pattern · Combine joins with OR</div>
      {/if}
    </div>

    <!-- Ignore group names -->
    <div class="p-2 rounded-md bg-surface-hover border border-border">
      <div class="text-xs text-text font-medium mb-1">Ignored group names</div>
      <div class="text-[10px] text-text-muted mb-1.5">
        Groups matching these won't be auto-ungrouped. Wildcards supported (e.g. <code class="px-0.5 bg-surface rounded">*Claude*</code>). Use <code class="px-0.5 bg-surface rounded">.*</code> toggle for regex.
      </div>
      <div class="flex gap-1 mb-1">
        <input
          type="text"
          class="flex-1 min-w-0 px-1.5 py-1 rounded border border-border bg-surface text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
          placeholder="e.g. *Claude* or claude"
          bind:value={newIgnoreGroupName}
          onkeydown={(e) => { if (e.key === "Enter") addIgnoreGroupName(); }}
        />
        <button
          class="shrink-0 px-1.5 py-1 rounded text-[10px] font-medium border transition-colors {newGroupIsRegex ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/40' : 'bg-surface text-text-muted border-border hover:text-text'}"
          onclick={() => newGroupIsRegex = !newGroupIsRegex}
          title={newGroupIsRegex ? "Regex mode (click for wildcard)" : "Wildcard mode (click for regex)"}
        >.*</button>
        <button
          class="shrink-0 px-1.5 py-1 rounded text-[10px] font-medium border transition-colors {newGroupCaseSensitive ? 'bg-accent-cyan/20 text-accent-cyan border-accent-cyan/40' : 'bg-surface text-text-muted border-border hover:text-text'}"
          onclick={() => newGroupCaseSensitive = !newGroupCaseSensitive}
          title={newGroupCaseSensitive ? "Case sensitive (click for insensitive)" : "Case insensitive (click for sensitive)"}
        >Aa</button>
        <button
          class="shrink-0 px-2 py-1 rounded text-[10px] font-medium bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-40"
          onclick={addIgnoreGroupName}
          disabled={!newIgnoreGroupName.trim()}
        >Add</button>
        <button
          class="shrink-0 px-2 py-1 rounded text-[10px] font-medium bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30 hover:bg-accent-cyan/25 transition-colors"
          onclick={addCurrentGroupToIgnore}
          title="Add the active tab's group name to ignore list"
        >+ Current</button>
      </div>
      {#if ignoreGroupNames.length > 0}
        <div class="flex flex-wrap gap-1">
          {#each ignoreGroupNames as rule}
            <span
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] cursor-pointer select-none
                {selectedGroupNames.has(rule.pattern) ? 'ring-1 ring-primary bg-primary/10 border-primary/40' : rule.enabled ? 'bg-surface border-border text-text' : 'bg-surface/50 border-border/50 text-text-muted line-through'}"
              role="option"
              aria-selected={selectedGroupNames.has(rule.pattern)}
              onclick={(e) => { if (e.shiftKey) selectedGroupNames = toggleSelect(selectedGroupNames, rule.pattern); }}
              onkeydown={(e) => { if (e.key === " ") { e.preventDefault(); selectedGroupNames = toggleSelect(selectedGroupNames, rule.pattern); } }}
              tabindex="0"
              title="Shift+click to select for regex generation"
            >
              <button class="w-2 h-2 rounded-full shrink-0 {rule.enabled ? 'bg-accent-green' : 'bg-border'}" onclick={(e) => { e.stopPropagation(); toggleIgnoreGroupName(rule.pattern); }} title={rule.enabled ? "Disable" : "Enable"}></button>
              {#if rule.isRegex}<span class="text-accent-cyan opacity-60" title="Regex">.*</span>{/if}
              {rule.pattern}
              <button class="opacity-50 hover:opacity-100 transition-opacity {rule.caseSensitive ? 'text-accent-cyan' : 'text-text-muted'}" onclick={(e) => { e.stopPropagation(); toggleIgnoreGroupNameCase(rule.pattern); }} title={rule.caseSensitive ? "Case sensitive" : "Case insensitive"}>Aa</button>
              <button class="text-text-muted hover:text-accent-red transition-colors" onclick={(e) => { e.stopPropagation(); removeIgnoreGroupName(rule.pattern); }} title="Remove">&times;</button>
            </span>
          {/each}
        </div>
        {#if selectedGroupNames.size > 0}
          <div class="flex items-center gap-1 mt-1">
            <button
              class="px-2 py-0.5 rounded text-[10px] font-medium bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors"
              onclick={() => applyGenerated("group", generalizePatterns(ignoreGroupNames.filter((r) => selectedGroupNames.has(r.pattern))))}
              title="Find common pattern across selected rules and generate a generic regex"
            >Generalize ({selectedGroupNames.size})</button>
            <button
              class="px-2 py-0.5 rounded text-[10px] font-medium bg-surface text-text-muted border border-border hover:text-text transition-colors"
              onclick={() => applyGenerated("group", combineRegex(ignoreGroupNames, selectedGroupNames))}
              title="Combine selected rules into one regex with alternation (|)"
            >Combine</button>
            <button
              class="px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:text-text transition-colors"
              onclick={() => selectedGroupNames = new Set()}
            >Clear</button>
          </div>
        {/if}
        <div class="text-[9px] text-text-muted/60 mt-1">Shift+click rules to select · Generalize finds common pattern · Combine joins with OR</div>
      {/if}
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
              <span class="text-text-muted/70 shrink-0 w-14">{formatLogTime(entry.ts)}</span>
              <span class="font-medium text-text shrink-0">{entry.action}</span>
              <span class="text-text-muted truncate" title={entry.detail}>{entry.detail}</span>
            </div>
          {/each}
        </div>
        <button
          class="mt-1.5 px-2 py-0.5 rounded text-[10px] font-medium bg-surface text-text-muted border border-border hover:text-text transition-colors"
          onclick={handleClearLog}
        >Clear</button>
      {/if}
    </div>
  </div>
</div>
