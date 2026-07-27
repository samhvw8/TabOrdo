<script lang="ts">
  import { onMount } from "svelte";
  import { getRules, saveRules, getAutoGroup, setAutoGroup, populateFromCurrentGroups, mergeRules, domainMatches, type GroupRule } from "../lib/rules.ts";
  import { getFullHostname } from "../lib/tabs.ts";

  let {
    onclose,
  }: {
    onclose: () => void;
  } = $props();

  let rules = $state<GroupRule[]>([]);
  let autoGroup = $state(false);
  let mergeSource = $state<string | null>(null);
  let statusMsg = $state("");
  let newName = $state("");
  let newPatterns = $state("");
  let newColor = $state<chrome.tabGroups.ColorEnum>("blue");

  const COLORS: chrome.tabGroups.ColorEnum[] = [
    "blue", "cyan", "green", "yellow", "orange", "pink", "purple", "red", "grey",
  ];

  const colorClasses: Record<string, string> = {
    blue: "bg-accent-blue", cyan: "bg-accent-cyan", green: "bg-accent-green",
    yellow: "bg-accent-yellow", orange: "bg-accent-orange", pink: "bg-accent-pink",
    purple: "bg-accent-purple", red: "bg-accent-red", grey: "bg-border",
  };

  onMount(async () => {
    rules = await getRules();
    autoGroup = await getAutoGroup();
  });

  async function save() {
    await saveRules(rules);
  }

  async function toggleAutoGroup() {
    autoGroup = !autoGroup;
    await setAutoGroup(autoGroup);
  }

  function normalizePattern(p: string): string {
    const trimmed = p.trim();
    if (trimmed.includes("://")) {
      const host = getFullHostname(trimmed);
      return host || trimmed;
    }
    return trimmed;
  }

  function parsePatterns(input: string): string[] {
    return input.split(",").map(normalizePattern).filter(Boolean);
  }

  async function addRule() {
    if (!newName.trim() || !newPatterns.trim()) return;
    rules = [...rules, {
      id: crypto.randomUUID(),
      name: newName.trim(),
      color: newColor,
      patterns: parsePatterns(newPatterns),
    }];
    newName = "";
    newPatterns = "";
    newColor = "blue";
    await save();
  }

  async function removeRule(id: string) {
    rules = rules.filter((r) => r.id !== id);
    if (mergeSource === id) mergeSource = null;
    await save();
  }

  async function updatePatterns(id: string, value: string) {
    rules = rules.map((r) =>
      r.id === id ? { ...r, patterns: parsePatterns(value) } : r
    );
    await save();
  }

  async function addCurrentTab(id: string) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const host = getFullHostname(tab.url);
    if (!host) return;
    const rule = rules.find((r) => r.id === id);
    if (!rule || rule.patterns.includes(host)) {
      flash(rule?.patterns.includes(host) ? `${host} already in patterns` : "Rule not found");
      return;
    }
    rules = rules.map((r) =>
      r.id === id ? { ...r, patterns: [...r.patterns, host] } : r
    );
    await save();
    flash(`Added ${host}`);
  }

  async function updateColor(id: string, color: chrome.tabGroups.ColorEnum) {
    rules = rules.map((r) => r.id === id ? { ...r, color } : r);
    await save();
  }

  async function updateName(id: string, name: string) {
    rules = rules.map((r) => r.id === id ? { ...r, name } : r);
    await save();
  }

  async function handleMerge(targetId: string) {
    if (!mergeSource || mergeSource === targetId) return;
    await mergeRules(targetId, mergeSource);
    rules = await getRules();
    mergeSource = null;
    flash("Rules merged");
  }

  async function handlePopulate() {
    const count = await populateFromCurrentGroups();
    rules = await getRules();
    flash(count > 0 ? `Added ${count} rule(s) from groups` : "No new groups to add");
  }

  async function addFromCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const host = getFullHostname(tab.url);
    if (!host) return;
    const domain = host.replace(/^www\./, "").split(".").slice(-2).join(".");
    newName = domain;
    newPatterns = host;
    newColor = "blue";
  }

  function flash(msg: string) {
    statusMsg = msg;
    setTimeout(() => { statusMsg = ""; }, 2500);
  }

  let testerOpen = $state(false);
  let testerInput = $state("");

  // Mirrors matchDomainToRule: rules are tried in list order and the first pattern hit wins.
  // Reporting the losers matters as much as the winner — rule order is invisible in this editor,
  // so a rule permanently shadowed by an earlier one looks identical to one that works.
  let testerResult = $derived.by(() => {
    const raw = testerInput.trim();
    if (!raw) return null;
    const host = raw.includes("://") ? getFullHostname(raw) : raw;
    const hits: { rule: GroupRule; pattern: string }[] = [];
    if (host) {
      for (const rule of rules) {
        if (!Array.isArray(rule.patterns)) continue;
        const pattern = rule.patterns.find((p) => {
          try { return domainMatches(host, p); } catch { return false; }
        });
        if (pattern) hits.push({ rule, pattern });
      }
    }
    return { host: host || raw, hits };
  });
</script>

<div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
  <div class="flex items-center justify-between mb-2">
    <span class="text-xs font-semibold text-text">Group Rules</span>
    <button class="text-[10px] text-text-muted hover:text-text transition-colors" onclick={onclose}>Back</button>
  </div>

  <!-- Auto-group toggle -->
  <div class="flex items-center justify-between py-1.5 px-2 mb-2 rounded-md bg-surface-hover border border-border">
    <div>
      <div class="text-xs text-text font-medium">Auto-group new tabs</div>
      <div class="text-[10px] text-text-muted">Automatically group tabs matching rules</div>
    </div>
    <button
      class="w-9 h-5 rounded-full transition-colors relative {autoGroup ? 'bg-primary' : 'bg-border'}"
      onclick={toggleAutoGroup}
      title={autoGroup ? "Disable auto-group" : "Enable auto-group"}
    >
      <span class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform {autoGroup ? 'left-[18px]' : 'left-0.5'}"></span>
    </button>
  </div>

  <!-- Action buttons -->
  <div class="flex gap-1.5 mb-2">
    <button
      class="flex-1 px-2 py-1 rounded bg-surface-hover border border-border text-[10px] text-text-muted hover:text-text transition-colors"
      onclick={handlePopulate}
    >Import from groups</button>
    <button
      class="flex-1 px-2 py-1 rounded bg-surface-hover border border-border text-[10px] text-text-muted hover:text-text transition-colors"
      onclick={addFromCurrentTab}
    >+ Current tab</button>
    {#if mergeSource}
      <button
        class="px-2 py-1 rounded bg-accent-red/10 border border-accent-red/30 text-[10px] text-accent-red"
        onclick={() => { mergeSource = null; }}
      >Cancel merge</button>
    {/if}
  </div>

  <!-- Rule tester -->
  <div class="mb-2">
    <button
      class="text-[10px] text-text-muted hover:text-text transition-colors"
      onclick={() => { testerOpen = !testerOpen; }}
      aria-expanded={testerOpen}
    >{testerOpen ? "▾" : "▸"} Test a URL against these rules</button>
    {#if testerOpen}
      <div class="mt-1 p-2 rounded-md bg-surface-hover border border-border">
        <input
          type="text"
          class="w-full px-1.5 py-1 rounded border border-border bg-surface text-[11px] text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
          placeholder="news.ycombinator.com or https://…"
          bind:value={testerInput}
        />
        {#if testerResult}
          <div class="mt-1.5 text-[10px]">
            {#if testerResult.hits.length === 0}
              <span class="text-text-muted">No rule matches <span class="font-mono text-text">{testerResult.host}</span> — it would fall back to grouping by domain.</span>
            {:else}
              {@const winner = testerResult.hits[0]}
              <div class="flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full shrink-0 {colorClasses[winner.rule.color] || 'bg-border'}"></span>
                <span class="font-medium text-text">{winner.rule.name}</span>
                <span class="text-text-muted">via</span>
                <span class="font-mono text-text-muted truncate">{winner.pattern}</span>
              </div>
              {#if testerResult.hits.length > 1}
                <div class="mt-1 text-text-muted/80">
                  Also matches, but never fires for this URL (listed later):
                  {#each testerResult.hits.slice(1) as h, i}<span class="text-text-muted">{i > 0 ? ", " : " "}{h.rule.name}</span>{/each}
                </div>
              {/if}
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if statusMsg}
    <div class="text-[10px] text-accent-green mb-2 px-1">{statusMsg}</div>
  {/if}

  <!-- Rules list -->
  {#each rules as rule}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="mb-2 p-2 rounded-lg border transition-colors
      {mergeSource === rule.id ? 'border-primary bg-primary/5' :
       mergeSource ? 'border-accent-green/50 bg-accent-green/5 cursor-pointer' : 'border-border bg-surface-hover'}"
      onclick={() => { if (mergeSource && mergeSource !== rule.id) handleMerge(rule.id); }}
      role={mergeSource && mergeSource !== rule.id ? "button" : undefined}
      tabindex={mergeSource && mergeSource !== rule.id ? 0 : undefined}
      onkeydown={(e) => { if (e.key === "Enter" && mergeSource && mergeSource !== rule.id) handleMerge(rule.id); }}
    >
      <div class="flex items-center gap-2 mb-1.5">
        <div class="flex gap-0.5">
          {#each COLORS as c}
            <button
              class="w-3 h-3 rounded-full transition-all {colorClasses[c]} {rule.color === c ? 'ring-1 ring-white ring-offset-1 ring-offset-surface' : 'opacity-40 hover:opacity-70'}"
              onclick={(e) => { e.stopPropagation(); updateColor(rule.id, c); }}
              title={c}
            ></button>
          {/each}
        </div>
        <input
          value={rule.name}
          onchange={(e) => updateName(rule.id, (e.target as HTMLInputElement).value)}
          onclick={(e) => e.stopPropagation()}
          class="flex-1 bg-transparent border-b border-border text-xs text-text font-medium outline-none focus:border-primary px-0.5"
        />
        <button
          class="text-[10px] text-accent-green hover:text-accent-green/80 transition-colors"
          onclick={(e) => { e.stopPropagation(); addCurrentTab(rule.id); }}
          title="Add current tab's domain to this rule"
        >+Tab</button>
        <button
          class="text-[10px] text-accent-blue hover:text-accent-blue/80 transition-colors"
          onclick={(e) => { e.stopPropagation(); mergeSource = mergeSource === rule.id ? null : rule.id; }}
          title="Select to merge with another rule"
        >{mergeSource === rule.id ? "Merging..." : "Merge"}</button>
        <button
          class="text-[10px] text-accent-red hover:text-accent-red/80 transition-colors"
          onclick={(e) => { e.stopPropagation(); removeRule(rule.id); }}
        >Del</button>
      </div>
      <input
        value={rule.patterns.join(", ")}
        onchange={(e) => updatePatterns(rule.id, (e.target as HTMLInputElement).value)}
        onclick={(e) => e.stopPropagation()}
        placeholder="domain.com, https://example.com/page, *.io"
        class="w-full bg-surface border border-border rounded px-1.5 py-1 text-[11px] text-text-muted outline-none focus:border-primary"
      />
      {#if mergeSource && mergeSource !== rule.id}
        <div class="text-[9px] text-accent-green mt-1">Click to merge into this rule</div>
      {/if}
    </div>
  {/each}

  {#if rules.length === 0}
    <div class="text-xs text-text-muted text-center py-4">No rules yet. Add one below or import from existing groups.</div>
  {/if}

  <!-- Add new rule -->
  <div class="mt-2 p-2 rounded-lg border border-dashed border-border">
    <div class="flex items-center gap-2 mb-1.5">
      <div class="flex gap-0.5">
        {#each COLORS as c}
          <button
            class="w-3 h-3 rounded-full transition-all {colorClasses[c]} {newColor === c ? 'ring-1 ring-white ring-offset-1 ring-offset-surface' : 'opacity-40 hover:opacity-70'}"
            onclick={() => { newColor = c; }}
            title={c}
          ></button>
        {/each}
      </div>
      <input
        bind:value={newName}
        placeholder="Group name"
        class="flex-1 bg-transparent border-b border-border text-xs text-text outline-none focus:border-primary px-0.5"
      />
    </div>
    <div class="flex items-center gap-1.5">
      <input
        bind:value={newPatterns}
        placeholder="github.com, *.github.io, *keyword*"
        class="flex-1 bg-surface border border-border rounded px-1.5 py-1 text-[11px] text-text-muted outline-none focus:border-primary"
        onkeydown={(e) => { if (e.key === 'Enter') addRule(); }}
      />
      <button
        class="px-2 py-1 rounded bg-primary text-white text-[10px] font-medium hover:bg-primary-hover transition-colors disabled:opacity-40"
        disabled={!newName.trim() || !newPatterns.trim()}
        onclick={addRule}
      >Add</button>
    </div>
  </div>

  <!-- Wildcard help -->
  <div class="mt-3 pt-2 border-t border-border">
    <div class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Pattern syntax</div>
    <div class="text-[10px] text-text-muted space-y-0.5">
      <div><code class="text-accent-blue">github.com</code> — exact + subdomains (docs.github.com)</div>
      <div><code class="text-accent-blue">*.github.io</code> — wildcard subdomains (user.github.io)</div>
      <div><code class="text-accent-blue">*google*</code> — contains "google" anywhere</div>
      <div><code class="text-accent-blue">https://example.com/page</code> — auto-extracts domain</div>
    </div>
  </div>
</div>
