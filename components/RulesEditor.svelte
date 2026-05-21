<script lang="ts">
  import { onMount } from "svelte";
  import { getRules, saveRules, getAutoGroup, setAutoGroup, populateFromCurrentGroups, mergeRules, type GroupRule } from "../lib/rules.ts";

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

  async function addRule() {
    if (!newName.trim() || !newPatterns.trim()) return;
    rules = [...rules, {
      id: crypto.randomUUID(),
      name: newName.trim(),
      color: newColor,
      patterns: newPatterns.split(",").map((p) => p.trim()).filter(Boolean),
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
      r.id === id ? { ...r, patterns: value.split(",").map((p) => p.trim()).filter(Boolean) } : r
    );
    await save();
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

  function flash(msg: string) {
    statusMsg = msg;
    setTimeout(() => { statusMsg = ""; }, 2500);
  }
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
    {#if mergeSource}
      <button
        class="px-2 py-1 rounded bg-accent-red/10 border border-accent-red/30 text-[10px] text-accent-red"
        onclick={() => { mergeSource = null; }}
      >Cancel merge</button>
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
        placeholder="domain.com, *.example.io, *keyword*"
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
    </div>
  </div>
</div>
