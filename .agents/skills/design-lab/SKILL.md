---
name: design-lab
description: Conduct design interviews, generate five distinct UI variations in a temporary design lab, collect feedback, and produce implementation plans. Use when the user wants to explore UI design options, redesign existing components, or create new UI with multiple approaches to compare.
---

# Design Lab Skill

This skill implements a complete design exploration workflow: interview, generate variations, collect feedback, refine, preview, and finalize.

## CRITICAL: Cleanup Behavior

**All temporary files MUST be deleted when the process ends, whether by:**
- User confirms final design → cleanup, then generate plan
- User aborts/cancels → cleanup immediately, no plan generated

**Never leave `.claude-design/` or `__design_lab` routes behind.** If the user says "cancel", "abort", "stop", or "nevermind" at any point, confirm and then delete all temporary artifacts.

---

## Phase 0: Preflight Detection

Before starting the interview, automatically detect:

### Package Manager
Check for lock files in the project root:
- `pnpm-lock.yaml` → use `pnpm`
- `yarn.lock` → use `yarn`
- `package-lock.json` → use `npm`
- `bun.lockb` → use `bun`

### Framework Detection
Check for config files:
- `next.config.js` or `next.config.mjs` or `next.config.ts` → **Next.js**
  - Check for `app/` directory → App Router
  - Check for `pages/` directory → Pages Router
- `vite.config.js` or `vite.config.ts` → **Vite**
- `remix.config.js` → **Remix**
- `nuxt.config.js` or `nuxt.config.ts` → **Nuxt**
- `astro.config.mjs` → **Astro**

### Styling System Detection
Check `package.json` dependencies and config files:
- `tailwind.config.js` or `tailwind.config.ts` → **Tailwind CSS**
- `@mui/material` in dependencies → **Material UI**
- `@chakra-ui/react` in dependencies → **Chakra UI**
- `antd` in dependencies → **Ant Design**
- `styled-components` in dependencies → **styled-components**
- `@emotion/react` in dependencies → **Emotion**
- `.css` or `.module.css` files → **CSS Modules**

### Design Memory Check
Look for existing Design Memory file:
- `docs/design-memory.md`
- `DESIGN_MEMORY.md`
- `.claude-design/design-memory.md`

If found, read it and use to prefill defaults and skip redundant questions.

### Visual Style Inference (CRITICAL)

**DO NOT use generic/predefined styles. Extract visual language from the project:**

**If Tailwind detected**, read `tailwind.config.js` or `tailwind.config.ts`:
```javascript
// Extract and use:
theme.colors      // Color palette
theme.spacing     // Spacing scale
theme.borderRadius // Radius values
theme.fontFamily  // Typography
theme.boxShadow   // Elevation system
```

**If CSS Variables exist**, read `globals.css`, `variables.css`, or `:root` definitions:
```css
:root {
  --color-*     /* Color tokens */
  --spacing-*   /* Spacing tokens */
  --font-*      /* Typography tokens */
  --radius-*    /* Border radius tokens */
}
```

**If UI library detected** (MUI, Chakra, Ant), read the theme configuration:
- MUI: `theme.ts` or `createTheme()` call
- Chakra: `theme/index.ts` or `extendTheme()` call
- Ant: `ConfigProvider` theme prop

**Always scan existing components** to understand patterns:
- Find 2-3 existing buttons → note their styling patterns
- Find 2-3 existing cards → note padding, borders, shadows
- Find existing forms → note input styles, label placement
- Find existing typography → note heading sizes, body text

**Store inferred styles in the Design Brief** for consistent use across all variants.

---

## Phase 1: Interview

Use the **AskUserQuestion** tool for all interview steps. Adapt questions based on Design Memory if it exists.

### Step 1.1: Scope & Target

Ask these questions (can combine into single AskUserQuestion with multiple questions):

**Question 1: Scope**
- Header: "Scope"
- Question: "Are we designing a single component or a full page?"
- Options:
  - "Component" - A reusable UI element (button, card, form, modal, etc.)
  - "Page" - A complete page or screen layout

**Question 2: New or Redesign**
- Header: "Type"
- Question: "Is this a new design or a redesign of something existing?"
- Options:
  - "New" - Creating something from scratch
  - "Redesign" - Improving an existing component/page

If "Redesign" selected, ask:
**Question 3: Existing Path**
- Header: "Location"
- Question: "What is the file path or route of the existing UI?"
- Options: (let user provide via "Other")

If target is unclear, propose a name based on repo patterns and confirm.

### Step 1.2: Pain Points & Inspiration

**Question 1: Pain Points**
- Header: "Problems"
- Question: "What are the top pain points with the current design (or what should this new design avoid)?"
- Options:
  - "Too cluttered/dense" - Information overload, hard to scan
  - "Unclear hierarchy" - Primary actions aren't obvious
  - "Poor mobile experience" - Doesn't work well on small screens
  - "Outdated look" - Feels old or inconsistent with brand
- multiSelect: true

**Question 2: Visual Inspiration**
- Header: "Visual style"
- Question: "What products or brands should I reference for visual inspiration?"
- Options:
  - "Stripe" - Clean, minimal, trustworthy
  - "Linear" - Dense, keyboard-first, developer-focused
  - "Notion" - Flexible, content-focused, playful
  - "Apple" - Premium, spacious, refined
- multiSelect: true

**Question 3: Functional Inspiration**
- Header: "Interactions"
- Question: "What interaction patterns should I emulate?"
- Options:
  - "Inline editing" - Edit in place without modals
  - "Progressive disclosure" - Show more as needed
  - "Optimistic updates" - Instant feedback, sync in background
  - "Keyboard shortcuts" - Power user efficiency

### Step 1.3: Brand & Style Direction

**Question 1: Brand Adjectives**
- Header: "Brand tone"
- Question: "What 3-5 adjectives describe the desired brand feel?"
- Options:
  - "Minimal" - Clean, simple, uncluttered
  - "Premium" - High-end, polished, refined
  - "Playful" - Fun, friendly, approachable
  - "Utilitarian" - Functional, efficient, no-nonsense
- multiSelect: true

**Question 2: Density**
- Header: "Density"
- Question: "What information density do you prefer?"
- Options:
  - "Compact" - More information visible, tighter spacing
  - "Comfortable" - Balanced spacing, easy scanning
  - "Spacious" - Generous whitespace, focused attention

**Question 3: Dark Mode**
- Header: "Dark mode"
- Question: "Is dark mode required?"
- Options:
  - "Yes" - Must support dark mode
  - "No" - Light mode only
  - "Nice to have" - Support if easy, not required

### Step 1.4: Persona & Jobs-to-be-Done

**Question 1: Primary User**
- Header: "User"
- Question: "Who is the primary end user?"
- Options:
  - "Developer" - Technical, keyboard-oriented
  - "Designer" - Visual, detail-oriented
  - "Business user" - Efficiency-focused, less technical
  - "End consumer" - General public, varied technical ability

**Question 2: Context**
- Header: "Context"
- Question: "What's the primary usage context?"
- Options:
  - "Desktop-first" - Primarily used on larger screens
  - "Mobile-first" - Primarily used on phones
  - "Both equally" - Must work well on all devices

**Question 3: Key Tasks**
- Header: "Key tasks"
- Question: "What are the top 3 tasks users must complete?"
- (Let user provide via "Other" - this is open-ended)

### Step 1.5: Constraints

**Question 1: Must-Keep Elements**
- Header: "Keep"
- Question: "Are there elements that must be preserved?"
- Options:
  - "Existing copy/labels" - Keep current text
  - "Current fields/inputs" - Keep form structure
  - "Navigation structure" - Keep current nav
  - "None" - Free to change everything

**Question 2: Technical Constraints**
- Header: "Constraints"
- Question: "Any technical constraints?"
- Options:
  - "No new dependencies" - Use existing libraries only
  - "Use existing components" - Build on current design system
  - "Must be accessible (WCAG)" - Strict accessibility requirements
  - "None" - No special constraints
- multiSelect: true

---

## Phase 2: Generate Design Brief

After the interview, create a structured Design Brief as JSON and save to `.claude-design/design-brief.json`:

```json
{
  "scope": "component|page",
  "isRedesign": true|false,
  "targetPath": "src/components/Example.tsx",
  "targetName": "Example",
  "painPoints": ["Too dense", "Primary action unclear"],
  "inspiration": {
    "visual": ["Stripe", "Linear"],
    "functional": ["Inline validation"]
  },
  "brand": {
    "adjectives": ["minimal", "trustworthy"],
    "density": "comfortable",
    "darkMode": true
  },
  "persona": {
    "primary": "Developer",
    "context": "desktop-first",
    "keyTasks": ["Complete checkout", "Review order", "Apply discount"]
  },
  "constraints": {
    "mustKeep": ["existing fields"],
    "technical": ["no new dependencies", "WCAG accessible"]
  },
  "framework": "nextjs-app",
  "packageManager": "pnpm",
  "stylingSystem": "tailwind"
}
```

Display a summary to the user before proceeding.

---

## Phase 3: Generate Design Lab

### Directory Structure

Create all files under `.claude-design/`:

```
.claude-design/
├── lab/
│   ├── page.tsx                 # Main lab page (framework-specific)
│   ├── variants/
│   │   ├── VariantA.tsx
│   │   ├── VariantB.tsx
│   │   ├── VariantC.tsx
│   │   ├── VariantD.tsx
│   │   └── VariantE.tsx
│   ├── components/
│   │   └── LabShell.tsx         # Lab layout wrapper
│   ├── feedback/                # Interactive feedback system
│   │   ├── types.ts             # TypeScript interfaces
│   │   ├── selector-utils.ts    # Element identification
│   │   ├── format-utils.ts      # Feedback formatting
│   │   ├── FeedbackOverlay.tsx  # Main overlay component
│   │   └── index.ts             # Module exports
│   └── data/
│       └── fixtures.ts          # Shared mock data
├── design-brief.json
└── run-log.md
```

### Feedback System Setup (CRITICAL - NEVER SKIP)

**The FeedbackOverlay is the PRIMARY feature of the Design Lab.** Without it, users cannot provide interactive feedback. NEVER generate a Design Lab without the FeedbackOverlay.

**Reliability Strategy:** To avoid import path issues across different project configurations, create the FeedbackOverlay **directly in the route directory** (e.g., `app/design-lab/FeedbackOverlay.tsx`), NOT in `.claude-design/`. This ensures a simple relative import (`./FeedbackOverlay`) always works.

**Required Files in Route Directory:**
```
app/design-lab/           # or app/__design_lab/ if underscores work
├── page.tsx              # Main lab page with variants
└── FeedbackOverlay.tsx   # Self-contained overlay component (copy from templates)
```

**Template Source:** `design-and-refine/templates/feedback/FeedbackOverlay.tsx`

**Why this approach:**
- `.claude-design/` paths can fail due to bundler configurations
- Relative imports from the same directory always work
- The route directory gets deleted during cleanup anyway

### Route Integration

**Next.js App Router:**
Create `app/__design_lab/page.tsx` that imports from `.claude-design/lab/`

**Next.js Pages Router:**
Create `pages/__design_lab.tsx` that imports from `.claude-design/lab/`

**Vite React:**
- If React Router exists: add route to `/__design_lab`
- If no router: create a conditional render in `App.tsx` based on `?design_lab=true` query param

**Other frameworks:**
Create the most appropriate temporary route for the detected framework.

### Variant Generation Guidelines

**IMPORTANT:** Read `DESIGN_PRINCIPLES.md` for UX, interaction, and motion best practices. But **DO NOT use predefined visual styles**—infer them from the project.

**Apply universal principles (from DESIGN_PRINCIPLES.md):**
- **UX**: Nielsen's heuristics, cognitive load reduction, progressive disclosure
- **Component behavior**: Button states, form anatomy, card structure
- **Interaction**: Feedback patterns, state handling, optimistic updates
- **Motion**: Timing (150-300ms), easing (ease-out entrances, ease-in exits)
- **Accessibility**: Focus states, ARIA patterns, touch targets (44px min)

**Infer visual styles from the project:**
- Colors → from Tailwind config, CSS variables, or existing components
- Typography → from existing headings, body text in the codebase
- Spacing → from the project's spacing scale or existing patterns
- Border radius → from existing cards, buttons, inputs
- Shadows → from existing elevated components

---

Each variant MUST explore a different design axis. Do not create minor variations—make them meaningfully distinct. **Use the project's existing visual language for all variants.**

**Variant A: Information Hierarchy Focus**
- Restructure content hierarchy (what's most important?)
- Apply Gestalt proximity—group related items closer
- One primary action per view
- Use existing typography scale to create clear levels

**Variant B: Layout Model Exploration**
- Try a different layout approach (card vs list vs table vs split-pane)
- Apply card anatomy or table behavior patterns from DESIGN_PRINCIPLES
- Consider responsive behavior at each breakpoint
- Use the project's existing grid/layout system

**Variant C: Density Variation**
- If brief says "comfortable", try a more compact version
- If brief says "compact", try a more spacious version
- Use the project's existing spacing tokens—just apply them differently
- Show the tradeoffs: more visible data vs easier scanning

**Variant D: Interaction Model**
- Different interaction pattern (modal vs inline vs panel vs drawer)
- Apply feedback patterns: immediate → progress → completion
- Implement all required states (loading, error, empty, disabled)
- Consider optimistic updates for non-destructive actions

**Variant E: Expressive Direction**
- Push the brand direction the user described in the interview
- Explore different uses of the project's existing design tokens
- More or less use of shadows, borders, background colors
- Apply motion where it adds meaning (hover, focus, transitions)

### Lab Page Requirements

The Design Lab page must include:

1. **Header** with:
   - Design Brief summary (target, scope, key requirements)
   - Instructions for reviewing

2. **Variant Grid** with:
   - Clear labels (A, B, C, D, E)
   - Brief rationale for each variant ("Why this exists")
   - The actual rendered variant
   - Notes highlighting key differences
   - **IMPORTANT:** Each variant container must have `data-variant="X"` attribute (where X is A, B, C, D, E, or F). This is required for the feedback system to identify which variant comments belong to.

3. **Responsive behavior**:
   - Desktop: side-by-side grid (2-3 columns)
   - Mobile: horizontal scroll or tabs

4. **Shared Data**:
   - All variants use the same fixture data from `data/fixtures.ts`
   - Ensures fair comparison

5. **Feedback Overlay** (CRITICAL - NEVER OMIT):

   ⚠️ **THIS IS THE MOST IMPORTANT REQUIREMENT** ⚠️

   The FeedbackOverlay enables users to click on elements and leave comments. Without it, the Design Lab is just a static page with no way to collect structured feedback.

   - Create `FeedbackOverlay.tsx` in the SAME directory as `page.tsx`
   - Import with relative path: `import { FeedbackOverlay } from './FeedbackOverlay'`
   - Render at the END of the page, after all variants
   - Pass `targetName` prop with the component/page name

   **Example integration:**

```tsx
import { FeedbackOverlay } from './FeedbackOverlay';  // Relative import - always works

export default function DesignLabPage() {
  return (
    <div className="min-h-screen bg-background">
      <header>...</header>

      <main>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <div data-variant="A">
            <VariantA />
          </div>
          <div data-variant="B">
            <VariantB />
          </div>
          {/* ... more variants */}
        </div>
      </main>

      {/* CRITICAL: FeedbackOverlay must be included */}
      <FeedbackOverlay targetName="ComponentName" />
    </div>
  );
}
```

   **If you forget the FeedbackOverlay, the user CANNOT provide feedback.** This defeats the entire purpose of the Design Lab.

### Code Quality

**Conventions:**
- Follow the project's existing code conventions (file naming, imports, etc.)
- Use the detected styling system (Tailwind, CSS modules, etc.)
- Use existing components from the project where appropriate

**Accessibility (from DESIGN_PRINCIPLES):**
- Semantic HTML: `<button>` not `<div onclick>`, `<nav>`, `<main>`, `<section>`
- Keyboard navigation: all interactive elements focusable and operable
- Focus states: visible `:focus-visible` with 2px ring and offset
- Color contrast: 4.5:1 for text, 3:1 for UI elements
- Touch targets: minimum 44x44px
- ARIA only when HTML semantics aren't enough

**States (every component needs):**
- Default, Hover, Focus, Active, Disabled, Loading, Error, Empty
- See DESIGN_PRINCIPLES "State Handling" section

**Motion:**
- Use appropriate timing: 150-200ms for micro-interactions, 200-300ms for transitions
- Use ease-out for entrances, ease-in for exits
- Respect `prefers-reduced-motion`

---

## Phase 4: Present Design Lab to User

After generating the lab files, **immediately** present the lab to the user. Do NOT attempt to:
- Start the dev server yourself (it runs forever and will block)
- Check if ports are open
- Open a browser
- Wait for any server response

### What to Do

1. **Output the lab location and URL:**
   ```
   ✅ Design Lab created!

   I've generated 5 design variants in `.claude-design/lab/`

   To view them:
   1. Make sure your dev server is running (run `pnpm dev` if not)
   2. Open: http://localhost:3000/__design_lab

   Take your time reviewing the variants side-by-side, then come back and tell me:
   - Which variant wins (A-E)
   - What you like about it
   - What should change
   ```

2. **Immediately proceed to Phase 5** - ask for feedback. Do NOT wait for the user to say they've opened the browser. Just present the feedback questions right away so they're ready when the user returns.

### Why Not Start the Server

Running `pnpm dev` or `npm run dev` starts a long-running process that never exits. If you run it, you'll wait forever. The user likely already has their dev server running, or can start it themselves in another terminal.

---

## Phase 5: Collect Feedback

After presenting the lab URL, the user can provide feedback in two ways:
1. **Interactive Feedback** (recommended): Using the built-in overlay in the browser
2. **Manual Feedback**: Via AskUserQuestion in the terminal

### Interactive Feedback (Primary Method)

The Design Lab includes a Figma-like feedback overlay. When presenting the lab, include these instructions:

```
✅ Design Lab created!

I've generated 5 design variants in `.claude-design/lab/`

To view and provide feedback:
1. Make sure your dev server is running (run `pnpm dev` if not)
2. Open: http://localhost:3000/__design_lab

**To add feedback:**
1. Click the "Add Feedback" button (bottom-right corner)
2. Click any element you want to comment on
3. Type your feedback and click "Save"
4. Repeat for all elements you want to comment on
5. Fill in the "Overall Direction" field (required)
6. Click "Submit All Feedback"
7. Paste the copied text here in the terminal

Or just describe your feedback manually below!
```

**When the user pastes feedback**, it will be in this format:

```markdown
## Design Lab Feedback

**Target:** ComponentName
**Comments:** 3

### Variant A
1. **Button** (`[data-testid='submit']`, button with "Submit")
   "Make this more prominent"

### Variant B
1. **Card** (`.product-card`, div with "Product Name")
   "Love this layout"

### Overall Direction
Go with Variant B's structure. Apply Variant A's button styling.
```

**How to parse and act on this feedback:**

1. **Read the Overall Direction** first - this guides your synthesis
2. **For each comment**, locate the element using:
   - Primary: The CSS selector in backticks (e.g., `[data-testid='submit']`)
   - Secondary: The element description (e.g., "button with 'Submit'")
3. **Apply the feedback** by editing the corresponding variant file

### Fallback: Manual Feedback via AskUserQuestion

If the user prefers not to use the interactive overlay (or pastes manual feedback), use the AskUserQuestion flow below:

### Stage 1: Check for a Winner

**Question 1: Ready to pick?**
- Header: "Decision"
- Question: "Is there one variant you like as is?"
- Options:
  - "Yes - I found one I like" - Ready to select a winner and refine
  - "No - I like parts of different ones" - Need to synthesize a new variant

### Stage 2A: If User Found a Winner

If user said "Yes", ask:

**Question 2a: Which one?**
- Header: "Winner"
- Question: "Which variant do you want to go with?"
- Options:
  - "Variant A" - [brief description of A]
  - "Variant B" - [brief description of B]
  - "Variant C" - [brief description of C]
  - "Variant D" - [brief description of D]
  - "Variant E" - [brief description of E]

**Question 3a: Any tweaks?**
- Header: "Tweaks"
- Question: "Any small changes needed, or is it good as is?"
- Options:
  - "Good as is" - No changes needed, proceed to final preview
  - "Minor tweaks needed" - I'll describe what to adjust

If "Minor tweaks needed", ask user to describe changes via text input.

Then proceed to **Phase 7: Final Preview**.

### Stage 2B: If User Wants to Synthesize

If user said "No - I like parts of different ones", ask:

**Question 2b: What do you like about each?**
- Header: "Feedback"
- Question: "What do you like about each variant? (mention specific elements from A, B, C, D, E)"
- (Let user provide detailed feedback via "Other" text input)

Example response format to guide user:
```
- A: Love the card layout and spacing
- B: The color scheme feels right
- C: The interaction on hover is great
- D: Nothing stands out
- E: The typography hierarchy is clearest
```

Then proceed to **Phase 6: Synthesize New Variant**.

---

## Phase 6: Synthesize New Variant

Based on the user's feedback about what they liked from each variant:

1. **Create a new hybrid variant** (Variant F) that combines:
   - The specific elements the user called out from each
   - The best structural decisions across all variants
   - Any patterns that appeared in multiple variants

2. **Replace the Design Lab** with a comparison view:
   - Show the new synthesized Variant F prominently
   - Keep 1-2 of the original variants that were closest for comparison
   - Remove variants that had nothing the user liked

3. **Update the `/__design_lab` route** to show the new arrangement

4. **Ask for feedback again:**

**Question: How's the new variant?**
- Header: "Review"
- Question: "How does the synthesized variant (F) look?"
- Options:
  - "This is it!" - Proceed to final preview
  - "Getting closer" - Need another iteration
  - "Went the wrong direction" - Let me clarify what I want

If "Getting closer" or "Went the wrong direction", gather more specific feedback and iterate. Support multiple synthesis passes until user is satisfied.

Then proceed to **Phase 7: Final Preview**.

---

## Phase 7: Final Preview

Once user is satisfied:

1. Create `.claude-design/preview/` directory:
   ```
   .claude-design/preview/
   ├── page.tsx                    # Preview page
   └── FinalDesign.tsx             # The winning design
   ```

2. Create route at `/__design_preview`

3. For redesigns, include before/after comparison:
   - Toggle switch or split view
   - Show original alongside proposed

4. Ask for final confirmation:

**Question: Confirm final design?**
- Header: "Confirm"
- Question: "Ready to finalize this design?"
- Options:
  - "Yes, finalize it" - Proceed to cleanup and generate implementation plan
  - "No, needs changes" - Tell me what to adjust
  - "Abort - cancel everything" - Delete all temp files, no plan generated

If "No, needs changes": gather feedback and iterate.
If "Abort": proceed to **Abort Handling** below.

---

## Abort Handling

If the user wants to cancel/abort at ANY point during the process (not just final confirmation), they may say things like:
- "cancel"
- "abort"
- "stop"
- "nevermind"
- "forget it"
- "I changed my mind"

When abort is detected:

1. **Confirm the abort:**
   - "Are you sure you want to cancel? This will delete all the design lab files I created."

2. **If confirmed, clean up immediately:**
   - Delete `.claude-design/` directory entirely
   - Delete temporary route files (`app/__design_lab/`, etc.)
   - Do NOT generate any implementation plan
   - Do NOT update Design Memory

3. **Acknowledge:**
   - "Design exploration cancelled. All temporary files have been cleaned up. Let me know if you want to start fresh later."

---

## Phase 8: Finalize

When user confirms (selected "Yes, finalize it"):

### 8.1: Cleanup

Delete all temporary files:
- Remove `.claude-design/` directory entirely
- Remove temporary route files:
  - `app/__design_lab/` (Next.js App Router)
  - `pages/__design_lab.tsx` (Next.js Pages Router)
  - `app/__design_preview/`
  - `pages/__design_preview.tsx`
  - Revert any `App.tsx` modifications (Vite)

**Safety rules:**
- ONLY delete files inside `.claude-design/`
- ONLY delete route files that the plugin created
- NEVER delete user-authored files
- Verify file paths before deletion

### 8.2: Generate Implementation Plan

Create `DESIGN_PLAN.md` in the project root:

```markdown
# Design Implementation Plan: [TargetName]

## Summary
- **Scope:** [component/page]
- **Target:** [file path]
- **Winner variant:** [A-E]
- **Key improvements:** [from feedback]

## Files to Change
- [ ] `src/components/Example.tsx` - Main component refactor
- [ ] `src/styles/example.css` - Style updates
- [ ] ... (list all affected files)

## Implementation Steps
1. [Specific step with code guidance]
2. [Next step]
3. ...

## Component API
- **Props:**
  - `prop1: type` - description
  - ...
- **State:**
  - Internal state requirements
- **Events:**
  - Callbacks and handlers

## Required UI States
- **Loading:** [description]
- **Empty:** [description]
- **Error:** [description]
- **Disabled:** [description]
- **Validation:** [description]

## Accessibility Checklist
- [ ] Keyboard navigation works
- [ ] Focus states visible
- [ ] Labels and aria-* attributes correct
- [ ] Color contrast meets WCAG AA
- [ ] Screen reader tested

## Testing Checklist
- [ ] Unit tests for logic
- [ ] Component tests for rendering
- [ ] Visual regression tests (if applicable)
- [ ] E2E smoke test (if applicable)

## Design Tokens
- [Any new tokens to add]
- [Existing tokens to use]

---

*Generated by Design Variations plugin*
```

### 8.3: Update Design Memory

Create or update `DESIGN_MEMORY.md`:

If new file:
```markdown
# Design Memory

## Brand Tone
- **Adjectives:** [from interview]
- **Avoid:** [anti-patterns discovered]

## Layout & Spacing
- **Density:** [preference]
- **Grid:** [if established]
- **Corner radius:** [if consistent]
- **Shadows:** [if consistent]

## Typography
- **Headings:** [font, weights used]
- **Body:** [font, size]
- **Emphasis:** [patterns]

## Color
- **Primary:** [color tokens]
- **Secondary:** [color tokens]
- **Neutral strategy:** [approach]
- **Semantic colors:** [error, success, warning]

## Interaction Patterns
- **Forms:** [validation approach, layout]
- **Modals/Drawers:** [when to use which]
- **Tables/Lists:** [preferred patterns]
- **Feedback:** [toast, inline, etc.]

## Accessibility Rules
- **Focus:** [visible focus approach]
- **Labels:** [labeling conventions]
- **Motion:** [reduced motion support]

## Repo Conventions
- **Component structure:** [file organization]
- **Styling approach:** [Tailwind classes, CSS modules, etc.]
- **Existing primitives:** [Button, Input, Card, etc.]

---

*Updated by Design Variations plugin*
```

If updating existing file:
- Append new patterns discovered
- Update any conflicting guidance with latest decisions
- Keep file concise and actionable

---

## Error Handling

### Framework Not Detected
If framework cannot be determined:
- Ask user: "I couldn't detect your framework. What are you using?"
- Provide common options: Next.js, Vite, Create React App, Vue, etc.

### Dev Server Fails
If dev server won't start:
- Check for port conflicts
- Provide manual instructions
- Suggest user starts server themselves

### Route Integration Fails
If can't create temporary route:
- Fall back to creating standalone HTML file
- Provide instructions for manual preview

### Cleanup Interrupted
If cleanup is interrupted:
- Log what was deleted vs remaining
- Provide manual cleanup instructions
- Never leave partial state without informing user

---

## Configuration Options

The plugin supports these optional configurations (via environment or project config):

- `DESIGN_AUTO_IMPLEMENT`: If `true`, implement the plan immediately after confirmation
- `DESIGN_KEEP_LAB`: If `true`, don't delete lab until explicit cleanup command
- `DESIGN_MEMORY_PATH`: Custom path for Design Memory file

---

## Example Session Flow

1. User: `/design-variations:design CheckoutSummary`
2. Plugin detects: Next.js App Router, Tailwind, pnpm
3. Plugin finds: No existing Design Memory
4. Plugin asks: Interview questions (5 steps)
5. Plugin generates: Design Brief summary
6. Plugin creates: `.claude-design/lab/` with 5 variants
7. Plugin creates: `app/__design_lab/page.tsx`
8. Plugin starts: `pnpm dev`
9. Plugin outputs: "Open http://localhost:3000/__design_lab"
10. User reviews variants in browser
11. Plugin asks: "Which variant wins?"
12. User: "Variant C, but change X and Y"
13. Plugin refines: Updates Variant C
14. User: "Looks good"
15. Plugin creates: Final preview at `/__design_preview`
16. User: "Confirmed"
17. Plugin: Deletes all temp files
18. Plugin: Generates `DESIGN_PLAN.md`
19. Plugin: Creates `DESIGN_MEMORY.md`
20. Plugin: "Done! See DESIGN_PLAN.md for implementation steps"

## Package Instructions (configured)

These instructions are enabled by the runner's native package instruction system.

## Codebase Memory Package

When performing structural code queries, prefer graph-based tools over grep:

### Tool Priority

1. **`search_graph`** — find functions, classes, routes, variables by pattern
2. **`trace_path`** — trace who calls a function or what it calls (modes: calls, data_flow, cross_service)
3. **`get_code_snippet`** — read specific function/class source code
4. **`query_graph`** — run Cypher queries for complex multi-hop patterns, aggregations, and cross-service analysis

### Architecture & Discovery

- **`get_architecture`** — high-level project summary: packages, services, dependencies, and project structure
- **`search_code`** — graph-augmented grep with modes: compact (signatures only), full (with source), files (just paths)
- **`detect_changes`** — detect code changes and their impact
- **`get_graph_schema`** — get node labels and edge types for Cypher queries

### ADR Management

- **`manage_adr`** — create or update Architecture Decision Records

### Traces & Indexing

- **`ingest_traces`** — ingest runtime traces to enhance the knowledge graph
- **`index_repository`** — index a repository. Modes: full, moderate, fast, cross-repo-intelligence
- **`list_projects`** — list all indexed projects
- **`delete_project`** — delete a project from the index
- **`index_status`** — get the indexing status of a project

### Graph Schema Reference

**Node Labels:** Project, Package, Folder, File, Module, Class, Function, Method, Interface, Enum, Type, Route, Resource

**Edge Types:** CONTAINS_PACKAGE, CONTAINS_FOLDER, CONTAINS_FILE, DEFINES, DEFINES_METHOD, IMPORTS, CALLS, HTTP_CALLS, ASYNC_CALLS, IMPLEMENTS, HANDLES, USAGE, CONFIGURES, WRITES, MEMBER_OF, TESTS, USES_TYPE, FILE_CHANGES_WITH

### Codex Tool Routing

Codex does not assume automatic search interception; call the configured codebase-memory MCP tools directly.

### Fallback Order

Fall back to file search only for non-code/config files or when graph is insufficient. Use grep/glob only for string literals, error messages, config values, or non-code files.

## Context Mode Package

Context-mode tools for large-output commands, parallel execution, and think-in-code processing.

### All Tools

- **`ctx_batch_execute`** — execute multiple commands in one call, auto-index all output, and search with multiple queries. Use concurrency 4-8 for I/O-bound batches, 1 for CPU-bound.
- **`ctx_execute`** — execute code in a sandboxed subprocess. Use for API calls, test runners, git queries, and data processing.
- **`ctx_execute_file`** — read a file and process it without loading contents into context. Use for log files, data files (CSV, JSON, XML), large source files for analysis.
- **`ctx_index`** — index documentation or knowledge content into a searchable BM25 knowledge base.
- **`ctx_search`** — search indexed content. Requires prior indexing via ctx_batch_execute, ctx_index, or ctx_fetch_and_index.
- **`ctx_fetch_and_index`** — fetches URL content, converts HTML to markdown, indexes into searchable knowledge base. Batch with concurrency 4-8 for parallel fetch.
- **`ctx_stats`** — context consumption statistics for the current session.
- **`ctx_doctor`** — diagnose context-mode installation.
- **`ctx_upgrade`** — upgrade context-mode to the latest version.
- **`ctx_purge`** — permanently delete indexed content. DESTRUCTIVE — cannot be undone.

### Tool Priority

0.MEMORY → 1.GATHER → 2.FOLLOW-UP → 3.PROCESSING → 4.WEB → 5.INDEX

### Think in Code Paradigm

Write JavaScript/TypeScript that processes FILE_CONTENT and prints only the answer. Don't manually analyze output — program the analysis. Use only Node.js built-ins (fs, path, child_process). Always wrap in try/catch. Handle null/undefined. Works on both Node.js and Bun.

### Parallel I/O Batches

For I/O-bound batches (network, gh, curl, multi-repo git reads), pass concurrency 4-8. For CPU-bound (npm test, build, lint) or stateful commands (ports, locks), keep concurrency 1.

### Output Rule

Write artifacts to FILES — never inline. Output to context only via console.log.

### Session Continuity

Skills and roles persist across the session. Search memory on resume.

### Codex Command Routing

**BLOCKED:** curl/wget, Inline HTTP (fetch, requests.get, etc.), direct web fetch outside configured context-mode MCP tools

**REDIRECTED:** Bash (>20 lines) → ctx_batch_execute/ctx_execute; Read (for analysis) → ctx_execute_file; grep/search (large results) → ctx_search after indexing

### Subagent Routing

Auto-injected.

## RTK CLI Proxy Package

Token-optimized CLI proxy. Automatic via Bash hook when installed; fallback instructions for manual use.

### Installation

- **`rtk init -g`** — install global Bash hook for automatic command interception
- Codex uses explicit RTK commands; no runner-specific RTK installer flag is assumed.

### Commands

- **Git:** `rtk git status`, `rtk git log`, `rtk git diff`, `rtk git push` (compact output)
- **Tests:** `rtk npm test`, `rtk cargo test`, `rtk pytest` (failures-only mode)
- **Docker:** `rtk docker ps`, `rtk docker logs <container>` (deduplicated)
- **Files:** `rtk ls`, `rtk read <file>`, `rtk grep <pattern>` (token-optimized)

### Analytics

- **`rtk gain`** — show token savings statistics
- **`rtk discover`** — find missed opportunities for token optimization

### Hook Bypass

Runner-native file and search tools do not pass through the Bash hook; use explicit RTK shell commands when filtering is required.

Adaptive memory is provided by the runner's configured memory system. The active provider injects its tool instructions into agent prompts.

### Automatic Scoping

Memories are scoped automatically without manual prefixes:

- **User scope**: Derived from your Supermemory token/API key. No userId needed.
- **Project scope**: Derived from x-sm-project header in MCP config. No manual scoping.

Save memories as plain content. Scoping is automatic.

### When to Save (proactive)

Save immediately after: architecture/design decisions, bug fixes (include root cause), non-obvious discoveries, configuration changes, established patterns, user preferences, gotchas or edge cases.

### Save Format

- **What**: One sentence — what was done
- **Why**: What motivated it (user request, bug, performance, etc.)
- **Where**: Files or paths affected (omit if none)
- **Learned**: Gotchas and edge cases (omit if none)

### When to Search

Reactive: "remember", "recall", "what did we do", "how did we solve", or references to past work. Proactive: when starting work that may overlap with past sessions.

### Session Close

Before ending: summarize goal, instructions, discoveries, accomplished items, next steps, and relevant files.

### Authority Rule

**OPENSPEC IS OFFICIAL CONTEXT — ADAPTIVE MEMORY IS ADVISORY.**

OpenSpec artifacts and Spec Registry are ALWAYS authoritative. Adaptive memory is advisory — it must never override official specifications.

### Fail-Open

If memory operations error or tools are unavailable: continue working normally. Never block agent work or surface errors to the user for memory issues.

### Provider: Supermemory

When the configured memory provider is "supermemory", use these MCP tools:

- `memory` (action: "save", content: "...") — commit a memory
- `memory` (action: "forget", content: "...") — remove a memory
- `recall` (query: "...", includeProfile?: boolean) — retrieve relevant memories

The Supermemory MCP server exposes these tools natively. Do not call raw MCP tools directly — use the tool names shown above.

Scoping is automatic: user from token, project from x-sm-project header. No manual containerTag required.

### Decision Examples

1. **Architecture decision made**
   - *Trigger*: Team chooses Zustand over Redux for state management
   - *Suggested topic key*: architecture/state-management
   - *Example content*: **What**: Chose Zustand over Redux. **Why**: Redux boilerplate too heavy for our use case. **Where**: src/store/.

2. **User preference correction**
   - *Trigger*: User corrects naming style assumption
   - *Suggested topic key*: preference/kevin
   - *Example content*: **What**: User prefers kebab-case CSS classes. **Where**: src/components/.

3. **Non-obvious discovery**
   - *Trigger*: Subtle memory leak found in useEffect cleanup
   - *Suggested topic key*: discovery/react-hooks-cleanup
   - *Example content*: **What**: useEffect without cleanup retains stale closures. **Where**: src/hooks/useAudioPlayer.ts.

4. **Bug fix with root cause**
   - *Trigger*: Fixed N+1 query in UserList
   - *Suggested topic key*: bugfix/n-plus-one-user-list
   - *Example content*: **What**: Fixed by eager-loading organization. **Where**: src/models/User.ts.

5. **Session-close summary**
   - *Trigger*: Ending session after implementation work
   - *Suggested topic key*: session/2026-05-23-deck-refactor
   - *Example content*: **Goal**: Refactor skills for parallel execution. **Accomplished**: Tasks 1-2.

### Suggested Topic Keys

| Work Type | Topic Key Pattern | Example |
|---|---|---|
| Architecture | architecture/<component-name> | architecture/auth-model |
| Bugfix | bugfix/<issue-description> | bugfix/null-pointer-list |
| Performance | performance/<area> | performance/user-list-query |
| Config | config/<what-changed> | config/database-url |
| Preference | preference/<user-name> | preference/kevin |
| Pattern | pattern/<pattern-name> | pattern/naming-convention |
| Discovery | discovery/<what-found> | discovery/react-hooks-cleanup |
| Session | session/<date>- <context> | session/2026-05-23-deck-refactor |
| Team | team/<topic> | team/onboarding-docs |
| Security | security/<concern> | security/api-key-storage |

### Save Trigger Matrix

| Lifecycle Moment | Save Action | Topic Key | Content Focus |
|---|---|---|---|
| Architecture decision made | Save immediately | architecture/<component> | What was decided, why |
| Bug fix completed | Save immediately | bugfix/<issue> | What was fixed, root cause |
| User preference learned | Save immediately | preference/<user> | What the preference is |
| Session close | Save before ending | session/<date>- <context> | Goal, discoveries, next steps |
| Non-obvious discovery | Save immediately | discovery/<what-found> | What was found, context |
| Configuration change | Save immediately | config/<what-changed> | What changed, why |
| Pattern established | Save immediately | pattern/<pattern-name> | What pattern, where |

### Provider: Engram

When the configured memory provider is "engram", use Engram's documented tool interface. The Engram adapter injects its specific instructions; follow those instead of these generic ones.
