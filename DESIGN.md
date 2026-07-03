---
name: TabOrdo
description: Keyboard-first tab manager for Chrome
colors:
  primary: "#6366f1"
  primary-hover: "#4f46e5"
  surface: "#1e1e2e"
  surface-hover: "#2a2a3e"
  surface-active: "#35354d"
  border: "#3b3b52"
  text: "#e4e4ef"
  text-muted: "#9999b0"
  accent-red: "#f87171"
  accent-green: "#4ade80"
  accent-blue: "#60a5fa"
  accent-yellow: "#facc15"
  accent-purple: "#a78bfa"
  accent-cyan: "#22d3ee"
  accent-orange: "#fb923c"
  accent-pink: "#f472b6"
typography:
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.05em"
  title:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "#ffffff"
  button-default:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  button-default-hover:
    backgroundColor: "{colors.surface-active}"
    textColor: "{colors.text}"
  button-danger:
    backgroundColor: "rgba(248, 113, 113, 0.05)"
    textColor: "{colors.accent-red}"
    rounded: "{rounded.lg}"
    padding: "10px 12px"
  input-default:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  chip-toggle-on:
    backgroundColor: "rgba(99, 102, 241, 0.15)"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  chip-toggle-off:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  tab-card-default:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  tab-card-selected:
    backgroundColor: "rgba(99, 102, 241, 0.1)"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
---

# Design System: TabOrdo

## 1. Overview

**Creative North Star: "The Command Station"**

TabOrdo's interface is a cockpit: every control in reach, nothing wasted, focused calm under complexity. The 400×600px popup is a dense control surface where information glows against dark panels. Density is a feature, not a compromise — the user has 150 tabs and needs to act on them in seconds, not browse a spacious layout.

The system is built on restrained color strategy: a deep indigo-tinted dark surface with a single indigo primary accent used sparingly for active states and primary actions. Eight semantic accent colors exist for tab group identification (mapped to Chrome's native group color API), but they never compete with the primary — they appear at low opacity as background tints and small dots.

This system explicitly rejects: corporate SaaS heaviness (Salesforce, Jira), dated browser extension aesthetics (OneTab, Tab Wrangler), and flashy decoration (neon, glassmorphism). If a control doesn't help the user act on tabs faster, it doesn't exist.

**Key Characteristics:**
- Dense, information-rich panels within a fixed 400×600px viewport
- Single font family (Inter) at compact sizes (10–14px range)
- Dark-only theme with indigo-tinted neutrals
- Accent colors reserved for semantic meaning (group identity, state, severity)
- Keyboard-first interaction model with mouse as secondary

## 2. Colors: The Night Station Palette

The palette is built on a cool indigo-tinted dark surface. Colors carry meaning, never decoration.

### Primary
- **Station Indigo** (#6366f1): Active states, primary buttons, search focus ring, sidebar selection, current section indicator. The only color that asserts itself. Used on ≤10% of any screen.
- **Station Indigo Deep** (#4f46e5): Hover state for primary actions only.

### Neutral
- **Deep Panel** (#1e1e2e): Body background, the base surface of every screen.
- **Raised Panel** (#2a2a3e): Hover states on interactive rows, sidebar background, input backgrounds, secondary surfaces.
- **Active Panel** (#35354d): Active/selected states on list items, search result highlight.
- **Panel Edge** (#3b3b52): All borders, dividers, separators, scrollbar thumb. The structural skeleton.
- **High Text** (#e4e4ef): Primary body text, tab titles, heading text. Must hit 4.5:1 against Deep Panel.
- **Low Text** (#9999b0): Secondary information (URLs, metadata, hints, placeholders). Contrast ratio against Deep Panel: ~5.2:1.

### Tertiary (Semantic Accents)
Eight accent colors mapped 1:1 to Chrome's tab group color API. Used exclusively for group identification:
- **Signal Red** (#f87171): Danger actions, close buttons, error states, `red` groups.
- **Signal Green** (#4ade80): Success confirmations, enabled toggles, `green` groups.
- **Signal Blue** (#60a5fa): Audio indicators, bookmark markers, `blue` groups.
- **Signal Yellow** (#facc15): Pin indicators, archive count, `yellow` groups.
- **Signal Purple** (#a78bfa): Audio controls, mute toggles, `purple` groups.
- **Signal Cyan** (#22d3ee): Regex/mode toggles, window badges, `cyan` groups.
- **Signal Orange** (#fb923c): Auto-sort toggle, `orange` groups.
- **Signal Pink** (#f472b6): Auto-discard toggle, `pink` groups.

### Named Rules
**The 10% Rule.** Station Indigo appears on at most 10% of any given screen. A selected sidebar icon, a focused input border, a primary button. Its rarity makes it the signal in the noise.

**The Low-Opacity Rule.** Accent colors never appear at full saturation on surfaces. Group backgrounds use 5% opacity (`bg-accent-*/5`), borders use 30-40% opacity. Full saturation is reserved for the 2px group dot and status text only.

## 3. Typography

**Body Font:** Inter (with system-ui, -apple-system, sans-serif fallback)

**Character:** One family, multiple weights. Inter at 13px is the workhorse — compact enough for density, legible enough for scanning. The type system is deliberately narrow: 10px for metadata up to 14px for section headers. No display sizes exist; this is a tool, not a landing page.

### Hierarchy
- **Title** (600, 12-13px, 1.4): Section headers ("Settings", "Command Guide"), group titles in the dashboard.
- **Body** (400, 13px, 1.4): Tab titles, result list items, primary readable text. The default.
- **Body Small** (400, 12px, 1.4): Input text, button labels, secondary readable text.
- **Label** (600, 10px, 1.2, 0.05em tracking, uppercase): Category headers ("SEARCH", "ACTION"), toggle labels, metadata headers. Always uppercase with wide tracking.
- **Micro** (500, 10px, 1.2): Status indicators, counts, keyboard hints, chip text. The smallest readable size.
- **Nano** (400, 9px, 1.2): Window badges, fine-print hints. Used sparingly.

### Named Rules
**The No-Display Rule.** There are no headings above 14px. Every screen fits in a 400×600px popup. Display typography is structurally impossible and would waste the user's scarce viewport.

## 4. Elevation

TabOrdo is flat by default. Depth is conveyed through tonal layering, not shadows: Deep Panel → Raised Panel → Active Panel creates a three-step elevation ramp through lightness alone.

The one exception: tooltips use `shadow-lg` to float above the interface. Everything else is tonal.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat. The three-step tonal ramp (Deep → Raised → Active) handles all depth needs. Shadows are reserved for floating overlays (tooltips only). If something needs to "pop," it gets a lighter surface, not a shadow.

## 5. Components

### Buttons
TabOrdo has three button registers, each for a specific density context:

**Action Buttons (Dashboard Grid)**
- **Shape:** Rounded corners (8px radius), full-width within grid cell
- **Default:** Border `border` color, `surface-hover` background, `text` color. Icon (emoji) above label, column layout.
- **Hover:** `surface-active` background, `text-muted/30` border.
- **Disabled:** 40% opacity, `not-allowed` cursor.
- **Danger variant:** `accent-red/5` background, `accent-red/30` border, `accent-red` text. Hover shifts to `accent-red/10`.

**Inline Buttons (Text-level)**
- **Shape:** Rounded (4-6px), compact padding (4-8px horizontal).
- **Primary:** `primary` background, white text. Hover: `primary-hover`.
- **Ghost:** Transparent background, `text-muted` color. Hover: `text` color.

**Toggle Chips (Feature Switches)**
- **Shape:** Rounded (6px), pill-like with status dot + label.
- **Off:** `surface-hover` background, `border` border, `text-muted` text, `border`-colored dot.
- **On:** Each toggle has its own accent color at 15% opacity background, accent-colored text and dot, accent/30 border. (Rules=green, Auto=indigo, Ungroup=purple, Sort=orange, Pin=cyan, Discard=pink.)

### Cards / Containers
**Tab Group Cards**
- **Corner Style:** Rounded (8px radius)
- **Background:** Accent color at 5% opacity, color-coded to Chrome group color.
- **Border:** Accent color at 40% opacity, 1px.
- **Internal Padding:** 4px grid gap between tab rows.
- **Header:** Group title with color dot (2×2 rounded-full), tab count, collapse chevron, "Extract" and "Sort" text actions.

**Tab Cards (List Items)**
- **Shape:** Rounded (6px radius)
- **Default:** Transparent background, transparent border. Favicon + title + URL hostname.
- **Hover:** `surface-hover` background.
- **Selected:** `primary/10` background, `primary/30` border.
- **Close button:** Opacity-0 by default, appears on group hover. Red accent on hover.

### Inputs / Fields
**Search Input**
- **Style:** Full-width, `surface-hover` background, `border` border, 8px rounded.
- **Focus:** Border shifts to `primary`. No shadow, no glow.
- **Command overlay:** When input starts with `/` or `@`, text goes transparent; an overlay renders the command prefix in `primary` color and the rest in `text` color.
- **Search icon:** 14px Lucide magnifying glass, `text-muted` color, positioned left.

### Navigation
**Sidebar**
- **Style:** 48px wide vertical strip, `surface` background, `border` right border.
- **Items:** 36×36px icon buttons, `surface-hover` background by default.
- **Active:** `primary` background, white icon.
- **Icons:** 16px Lucide stroke icons (dashboard grid, pin, sliders, gear).

### Signature Component: Command Palette
The search input doubles as a command palette. Typing `/` surfaces command hints with category-colored labels. Typing `@` enters triage mode. The palette auto-shows when query is non-empty and auto-hides when cleared. Tab completion fills the selected command. This is the primary interaction surface and the reason the extension exists.

## 6. Do's and Don'ts

### Do:
- **Do** use the three-step tonal ramp (Deep → Raised → Active) for all surface hierarchy. Never reach for shadows except on tooltips.
- **Do** keep accent colors at low opacity on surfaces (5% bg, 30-40% borders). Full saturation only on dots, status text, and icons.
- **Do** use Inter at 13px as the default text size. The 10-14px range covers every need.
- **Do** use emoji for action button icons — they're compact, recognizable, and render without a sprite sheet or icon library. Inline SVG for structural icons (sidebar, close, chevrons).
- **Do** show close buttons only on hover (`opacity-0 group-hover:opacity-100`). Density means hiding destructive actions until the user signals intent.
- **Do** use Chrome's native 9-color group palette for tab groups. Never invent custom group colors.
- **Do** use `transition-colors` on interactive elements. Keep transitions under 200ms.

### Don't:
- **Don't** add shadows to cards, panels, or buttons. TabOrdo is tonally layered, not elevated. The Flat-By-Default Rule applies everywhere except tooltips.
- **Don't** introduce display-sized text (above 14px). The popup viewport is 400×600px; large headings waste the user's space.
- **Don't** make the interface look like corporate SaaS (Salesforce, Jira) — no heavy chrome, no deep nesting, no three-click workflows.
- **Don't** apply dated browser extension aesthetics (OneTab, Tab Wrangler) — no icon-heavy rows, no blocky layouts, no Chrome Web Store 2018 energy.
- **Don't** use flashy decoration — no neon, no glassmorphism, no gradients, no animated backgrounds.
- **Don't** use accent colors at full saturation on backgrounds. `bg-accent-green` on a card is a visual shout; `bg-accent-green/5` is an identification whisper.
- **Don't** add new top-level colors. The 8 semantic accents map to Chrome's API. A 9th accent means you're decorating, not communicating.
- **Don't** put borders thicker than 1px on any element. This is a compact, precise interface. Thick borders consume pixels that belong to content.
