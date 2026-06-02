<script lang="ts">
  import { onMount } from "svelte";
  import { getRules, saveRules, getAutoGroup, setAutoGroup, populateFromCurrentGroups, mergeRules, getUseAI, type GroupRule } from "../lib/rules.ts";
  import { getFullHostname } from "../lib/tabs.ts";
  import { getAIStatus, suggestRulesStreaming, previewMatchingTabs, approveRule, type AIStatus, type TabMatch } from "../lib/ai.ts";

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

  // AI suggestion state — gated on useAI Settings toggle
  interface AIDraft {
    id: string;
    name: string;
    color: chrome.tabGroups.ColorEnum;
    patterns: string[];
    expanded: boolean;
    preview?: TabMatch[];
  }

  let useAI = $state(false);
  let aiStatus = $state<AIStatus>("unsupported");
  let aiStatusReason = $state<string | undefined>(undefined);
  let aiLoading = $state(false);
  let aiDrafts = $state<AIDraft[]>([]);
  let aiHint = $state("");
  let aiError = $state<string | undefined>(undefined);
  let aiAbortController: AbortController | undefined = undefined;

  const aiStatusDot: Record<AIStatus, string> = {
    available: "bg-accent-green",
    downloadable: "bg-accent-yellow",
    downloading: "bg-accent-yellow animate-pulse",
    unavailable: "bg-accent-red",
    unsupported: "bg-accent-red",
  };
  const aiStatusLabel: Record<AIStatus, string> = {
    available: "Gemini Nano ready",
    downloadable: "Model not downloaded",
    downloading: "Downloading…",
    unavailable: "Unavailable",
    unsupported: "Not supported",
  };
  const aiReady = $derived(aiStatus === "available" || aiStatus === "downloadable" || aiStatus === "downloading");

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
    useAI = await getUseAI();
    if (useAI) {
      const r = await getAIStatus();
      aiStatus = r.status;
      aiStatusReason = r.reason;
    }
  });

  async function aiGenerate() {
    aiAbortController?.abort();
    aiAbortController = new AbortController();
    aiLoading = true;
    aiError = undefined;
    aiDrafts = [];
    try {
      for await (const rule of suggestRulesStreaming(aiHint, aiAbortController.signal)) {
        aiDrafts = [...aiDrafts, {
          id: crypto.randomUUID(),
          name: rule.name,
          color: rule.color,
          patterns: rule.patterns,
          expanded: false,
        }];
      }
      if (aiDrafts.length === 0) {
        aiError = "No suggestions returned. Try a different hint or open more tabs.";
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        aiError = (e as Error).message || "AI request failed.";
      }
    } finally {
      aiLoading = false;
      aiAbortController = undefined;
    }
  }

  function aiAbort() {
    aiAbortController?.abort();
  }

  function aiUpdateDraft(id: string, patch: Partial<AIDraft>) {
    aiDrafts = aiDrafts.map((d) =>
      d.id === id
        // Clear cached preview if patterns change; user expectation: preview reflects current patterns.
        ? { ...d, ...patch, preview: patch.patterns ? undefined : d.preview }
        : d,
    );
  }

  async function aiToggleExpand(id: string) {
    const d = aiDrafts.find((x) => x.id === id);
    if (!d) return;
    const next = !d.expanded;
    aiUpdateDraft(id, { expanded: next });
    if (next && !d.preview) {
      const queried = d.patterns;
      const preview = await previewMatchingTabs(queried);
      // Only apply if patterns weren't edited mid-await — aiUpdateDraft creates
      // a new array reference whenever patterns change.
      const current = aiDrafts.find((x) => x.id === id);
      if (current && current.patterns === queried) {
        aiUpdateDraft(id, { preview });
      }
    }
  }

  function aiRemoveDraft(id: string) {
    aiDrafts = aiDrafts.filter((d) => d.id !== id);
  }

  async function aiApproveDraft(id: string) {
    const d = aiDrafts.find((x) => x.id === id);
    if (!d) return;
    await approveRule({ name: d.name, color: d.color, patterns: d.patterns });
    aiDrafts = aiDrafts.filter((x) => x.id !== id);
    rules = await getRules();
    flash(`Added "${d.name}"`);
  }

  async function aiApproveAll() {
    const drafts = [...aiDrafts];
    if (drafts.length === 0) return;
    for (const d of drafts) {
      await approveRule({ name: d.name, color: d.color, patterns: d.patterns });
    }
    aiDrafts = [];
    rules = await getRules();
    flash(`Added ${drafts.length} rule${drafts.length !== 1 ? "s" : ""}`);
  }

  async function aiGroupNow(id: string) {
    const d = aiDrafts.find((x) => x.id === id);
    if (!d || !d.preview || d.preview.length === 0) return;
    try {
      const tabIds = d.preview.map((m) => m.tabId);
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, { title: d.name, color: d.color });
      // Persist the rule only after the group exists, so a retry after failure
      // doesn't leave a duplicate rule behind.
      await approveRule({ name: d.name, color: d.color, patterns: d.patterns });
      aiDrafts = aiDrafts.filter((x) => x.id !== id);
      rules = await getRules();
      flash(`Grouped ${tabIds.length} tab${tabIds.length !== 1 ? "s" : ""} into "${d.name}"`);
    } catch (e) {
      flash(`Group failed: ${(e as Error).message}`);
    }
  }

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

  {#if useAI}
    <!-- AI suggestion subsection -->
    <div class="mb-2 p-2 rounded-md bg-surface-hover border border-border">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="w-2 h-2 rounded-full {aiStatusDot[aiStatus]}"></span>
        <span class="text-[11px] font-medium text-text flex-1 truncate">AI · {aiStatusLabel[aiStatus]}</span>
        {#if aiReady}
          {#if aiLoading}
            <button
              class="text-[10px] px-2 py-0.5 rounded bg-accent-red/15 text-accent-red hover:bg-accent-red/25 transition-colors"
              onclick={aiAbort}
            >Stop</button>
          {:else}
            <button
              class="text-[10px] px-2 py-0.5 rounded bg-primary text-white hover:bg-primary-hover transition-colors"
              onclick={aiGenerate}
            >{aiDrafts.length ? "Regenerate" : "Suggest"}</button>
          {/if}
        {/if}
      </div>

      {#if !aiReady && aiStatusReason}
        <div class="text-[10px] text-text-muted">{aiStatusReason}</div>
      {/if}

      {#if aiReady}
        <input
          bind:value={aiHint}
          placeholder="Optional hint: 'more granular', 'merge dev tools'…"
          class="w-full bg-surface border border-border rounded px-1.5 py-1 text-[11px] text-text outline-none focus:border-primary disabled:opacity-50"
          disabled={aiLoading}
          onkeydown={(e) => { if (e.key === "Enter" && !aiLoading) aiGenerate(); }}
        />
      {/if}

      {#if aiError}
        <div class="text-[10px] text-accent-red mt-1">{aiError}</div>
      {/if}

      {#if aiDrafts.length || aiLoading}
        <div class="flex items-center justify-between mt-2 mb-1">
          <span class="text-[10px] text-text-muted">
            {aiDrafts.length} suggestion{aiDrafts.length !== 1 ? "s" : ""}{aiLoading ? " · streaming…" : ""}
          </span>
          {#if aiDrafts.length > 1}
            <button
              class="text-[10px] text-accent-green hover:underline"
              onclick={aiApproveAll}
            >Add all</button>
          {/if}
        </div>

        {#each aiDrafts as d (d.id)}
          <div class="mt-1 p-1.5 rounded border border-border bg-surface">
            <div class="flex items-center gap-1 mb-1">
              <div class="flex gap-0.5">
                {#each COLORS as c}
                  <button
                    class="w-2.5 h-2.5 rounded-full transition-all {colorClasses[c]} {d.color === c ? 'ring-1 ring-white ring-offset-1 ring-offset-surface' : 'opacity-40 hover:opacity-70'}"
                    onclick={() => aiUpdateDraft(d.id, { color: c })}
                    title={c}
                    aria-label={c}
                  ></button>
                {/each}
              </div>
              <input
                value={d.name}
                onchange={(e) => aiUpdateDraft(d.id, { name: (e.target as HTMLInputElement).value })}
                class="flex-1 min-w-0 bg-transparent border-b border-border text-[11px] text-text font-medium outline-none focus:border-primary px-0.5"
              />
              <button
                class="text-[10px] text-text-muted hover:text-text transition-colors px-1"
                onclick={() => aiToggleExpand(d.id)}
                title="Preview matching tabs"
                aria-label="Preview matching tabs"
                aria-expanded={d.expanded}
              >{d.expanded ? "▾" : "▸"}{d.preview ? ` ${d.preview.length}` : ""}</button>
              <button
                class="text-[10px] text-accent-red hover:text-accent-red/80 transition-colors px-0.5"
                onclick={() => aiRemoveDraft(d.id)}
                title="Skip this suggestion"
                aria-label="Skip"
              >✕</button>
              <button
                class="text-[10px] px-1.5 py-0.5 rounded bg-primary text-white hover:bg-primary-hover transition-colors"
                onclick={() => aiApproveDraft(d.id)}
              >Add</button>
            </div>
            <input
              value={d.patterns.join(", ")}
              onchange={(e) => aiUpdateDraft(d.id, { patterns: parsePatterns((e.target as HTMLInputElement).value) })}
              placeholder="domain.com, *.io"
              class="w-full bg-surface-hover border border-border rounded px-1.5 py-1 text-[11px] text-text-muted outline-none focus:border-primary"
            />

            {#if d.expanded}
              {#if d.preview === undefined}
                <div class="text-[10px] text-text-muted mt-1 px-1">Looking up matching tabs…</div>
              {:else if d.preview.length === 0}
                <div class="text-[10px] text-text-muted mt-1 px-1">No open tabs match these patterns yet.</div>
              {:else}
                <div class="mt-1.5 space-y-0.5">
                  {#each d.preview.slice(0, 6) as m (m.tabId)}
                    <div class="flex items-center gap-1.5 px-1">
                      {#if m.favIconUrl}
                        <img src={m.favIconUrl} alt="" class="w-3 h-3 shrink-0" />
                      {:else}
                        <span class="w-3 h-3 shrink-0 rounded-sm bg-border"></span>
                      {/if}
                      <span class="text-[10px] text-text truncate flex-1">{m.title}</span>
                      <span class="text-[9px] text-text-muted shrink-0 max-w-[80px] truncate">{m.host}</span>
                    </div>
                  {/each}
                  {#if d.preview.length > 6}
                    <div class="text-[10px] text-text-muted px-1">+{d.preview.length - 6} more</div>
                  {/if}
                  <button
                    class="w-full mt-1 px-2 py-1 rounded bg-accent-green/15 text-accent-green text-[10px] font-medium hover:bg-accent-green/25 transition-colors"
                    onclick={() => aiGroupNow(d.id)}
                  >Group these {d.preview.length} tab{d.preview.length !== 1 ? "s" : ""} now</button>
                </div>
              {/if}
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}

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
