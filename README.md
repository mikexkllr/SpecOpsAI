# SpecOps AI

A desktop IDE for **Spec-Driven Development** with an integrated AI agent harness
built on [`deepagents`](https://www.npmjs.com/package/deepagents) (LangChain).
The app forces the developer through four ordered phases — Spec → User Stories →
Technical Stories → Implementation — and only unlocks the code editor in the
last phase. Every chat, sub-agent and test-loop runs through the same agent
harness, against any of four configurable model providers
(Anthropic, OpenAI, Google Gemini, or local Ollama).

---

## Table of Contents

1. [Interface design](#interface-design)
2. [What the chatbot does in each phase](#what-the-chatbot-does-in-each-phase)
3. [Agent modes (HITL vs YOLO)](#agent-modes-hitl-vs-yolo)
4. [Testing system](#testing-system)
5. [Project / spec layout on disk](#project--spec-layout-on-disk)
6. [Technical architecture](#technical-architecture)
7. [File-by-file walkthrough](#file-by-file-walkthrough)
8. [Build & run](#build--run)

---

## Interface design

The UI takes visual cues from terminal-first dev tools — Claude Code and
OpenCode in particular — and leans into a monospace, dense, "prompt line"
aesthetic rather than a conventional dashboard look.

### Design tokens

All colors, type, and spacing live as CSS custom properties at the top of
[styles.css](src/renderer/styles.css#L1-L54):

- **Type** — [JetBrains Mono](https://www.jetbrains.com/mono/) everywhere in the
  shell (`--font-mono`), [Inter](https://rsms.me/inter/) reserved for rendered
  markdown prose inside the preview pane (`--font-sans`). Font scale runs
  `11 / 12 / 13 / 14 / 16 px`.
- **Surfaces** — four warm-black layers (`--bg-0` … `--bg-3`) plus a
  `--bg-overlay` for the settings modal, with matching
  `--border-subtle / --border / --border-strong` dividers.
- **Foreground** — four tiers (`--fg-0` primary through `--fg-3` faint) on a
  warm off-white so the mono type does not read as clinical blue-white.
- **Accent — Claude coral.** `--accent: #d97757` is the single brand hue: it
  drives the primary button, the focus ring (`input:focus` → accent border),
  active phase tab underlines, the story-list active indicator, user chat
  bubbles, markdown `h1/h3` headings, and the brand glyph in the header.
- **Semantic palette** — ANSI-flavored `--ok / --warn / --danger / --info /
  --magenta`, each with a matching `-soft` variant for soft-tinted backgrounds.
  These back the `.badge`, `.notice`, `.status-text`, `.iter`, and
  `.task-item .task-status.*` components.

The palette is tuned warm on purpose — every bg and fg has a subtle yellow
cast so the coral accent reads as "same family" rather than as a bolt-on
highlight on cold grey.

### Motifs

- **Prompt glyphs.** `▸` marks section titles, the brand, and editor headers;
  `$` prefixes the project bar; `❯` prefixes user chat messages; `●` prefixes
  agent messages; `◌` pulses while the agent is thinking
  ([styles.css @keyframes pulse](src/renderer/styles.css)).
- **ASCII banner.** The empty state renders a hand-drawn
  `▗▄▖  ▗▄▄▖ ▗▄▄▄▖ ▗▄▄▖` banner in coral ([App.tsx EmptyState](src/renderer/App.tsx))
  instead of a graphic, reinforcing the "this is a terminal, not a dashboard"
  frame.
- **Sharp corners, thin dividers.** Radius is either `4px` (`--radius`) or
  `6px` (`--radius-lg`) and dividers are strictly 1px. No drop shadows except
  under the settings modal.
- **Frameless window, custom chrome.** The Electron window is frameless; the
  app header is a drag region (`-webkit-app-region: drag`) and
  `<WindowControls />` ([App.tsx](src/renderer/App.tsx)) renders the
  minimize / maximize / close triplet as inline SVG buttons with a coral-less
  hover — the close button flips to `--danger` on hover to match the rest of
  the chrome's color language.
- **Subtle animations.** 120 ms hover transitions on buttons/inputs; the
  thinking indicator is the only animation that loops.

### Component class catalog

All styling is class-driven. The reusable classes, all defined in
[styles.css](src/renderer/styles.css):

| Class(es) | Purpose |
|---|---|
| `.app`, `.app-header`, `.header-meta`, `.header-status`, `.brand` | Top-level shell and frameless drag region. |
| `.btn`, `.btn-primary`, `.btn-success`, `.btn-danger`, `.btn-ghost`, `.btn-icon`, `.btn-sm` | The one button system. Primary is coral; success/danger use soft semantic tints. |
| `.mode-toggle` (+ `.active.hitl` / `.active.yolo`) | HITL/YOLO segmented toggle in the header. |
| `.projectbar` (+ `.prompt-prefix`, `.project-info`) | The shell-prompt-styled project selector row. |
| `.phasenav` (+ `.step-num`, `.active`) | Phase tabs with step numbers in `[1]` brackets. |
| `.editor-header` (+ `.title`, `.subtitle`) | The `▸ title / subtitle` header above each artifact editor. |
| `.code-editor` | The monospace textarea used for the legacy code view. |
| `.chat`, `.chat-header`, `.chat-log`, `.chat-msg.user / .agent / .thinking`, `.chat-input-row`, `.chat-empty` | All chat surfaces — phase chat and sub-agent chat both use these. |
| `.refs-collapsed`, `.refs-drawer`, `.refs-header`, `.refs-tabs`, `.refs-content` | Upstream-references side drawer. |
| `.tabs` | The implementation-view tab strip (`sub-agents / integration tests / test loop / code notes`). |
| `.story-list` (+ `.story-id`, `.story-title`, `.story-meta`) | Left sidebar of decomposable stories. Active item gets a coral left border. |
| `.story-workspace`, `.story-head`, `.story-toolbar`, `.task-list`, `.task-item` (+ `.task-status.pending / .in-progress / .done`) | Per-story workspace — head, action toolbar, decomposed task list. |
| `.badge.hitl / .yolo / .ok / .warn / .danger / .info / .magenta` | Uppercase mono pills used for framework labels, iteration results, and mode indicators. |
| `.notice.info / .ok / .warn / .danger` | Banner for generated-test results, merge outcomes, HITL approval prompts, etc. |
| `.card`, `.iter`, `.iter-head`, `.test-row`, `pre.code-block` (+ `.failure`) | Test-loop iteration cards and code-block output. |
| `.overlay`, `.modal`, `.modal-header / -body / -side / -content / -footer`, `.field`, `.field-label`, `.option-card`, `.section-title`, `.section-subtitle` | Settings modal. |
| `.empty-state` (+ `.ascii`, `.msg`) | ASCII-banner empty state. |
| `.window-controls`, `.wc-btn`, `.wc-close` | Frameless-window chrome. |

The legacy `MarkdownEditor` (wrapper around `react-markdown-editor-lite`) is
themed with a scoped `<style>` block inside
[MarkdownEditor.tsx](src/renderer/MarkdownEditor.tsx), reading from the same
CSS variables so the embedded editor visually merges with the rest of the
shell (caret is coral, `h1` gets the `▸` prefix, `blockquote` gets a coral
left bar, `code` uses `--bg-2`, etc.).

### Changing the look

Because every color, font, and radius is a CSS variable at
[styles.css:5](src/renderer/styles.css#L5), the most common retheming
task — re-skinning to a different accent — is a one-line change to `--accent`,
`--accent-soft`, `--accent-strong`, and `--accent-fg`. Surface/foreground
adjustments are likewise one `var(...)` edit away and propagate everywhere
including the markdown preview.

---

## What the chatbot does in each phase

The UI shows **only the artifact for the current phase** ([App.tsx:218-241](src/renderer/App.tsx#L218-L241)).
Each phase has its own chat history (`messagesByPhase`, [App.tsx:31-36](src/renderer/App.tsx#L31-L36))
and its own system prompt that instructs the agent what to produce.

All four phases share the same machinery:
[`runAgentTurn`](src/main/agent.ts#L143-L188) builds a per-phase system prompt,
runs a deepagent, and returns `{ reply, artifact? }`.

Two capabilities are wired into every phase chatbot:

- **Real codebase access.** Each turn builds a `FilesystemBackend` rooted at
  the project root ([agent.ts:170](src/main/agent.ts#L170)), giving the agent
  `ls`, `read_file`, `write_file`, `edit_file`, `glob`, and `grep` over the
  entire repo. This is the same backend the per-story sub-agent chat uses,
  so the phase agent can ground its spec/story revisions in the real code
  (e.g. grep for IPC channels before writing a spec section about them).
- **`update_artifact` tool.** A structured tool (zod schema `{ content: string }`)
  is registered on every turn ([agent.ts:155-167](src/main/agent.ts#L155-L167)).
  The agent calls it exactly once when it intends to persist an updated
  artifact, passing the **full** updated markdown — never a diff. The tool
  captures the content in a closure; `runAgentTurn` surfaces it as
  `result.artifact`, and the renderer flushes it to disk via the existing
  `writeArtifact` path ([App.tsx:122-127](src/renderer/App.tsx#L122-L127)).
  If the user's message is a pure question, the agent skips the tool and the
  artifact file on disk is untouched.

The agent's final assistant message is returned verbatim as the chat `reply`.
There is no XML fencing — the old `<artifact>` / `<reply>` protocol has been
replaced end-to-end by the `update_artifact` tool call.

### 1. Spec phase

- **What you see:** the `spec.md` markdown editor on the left and a chat panel on the right ([PhaseView.tsx:13-23](src/renderer/PhaseView.tsx#L13-L23)).
- **Code is hidden.** The implementation tab is not even reachable.
- **Chatbot job** (system prompt at [agent.ts:36-45](src/main/agent.ts#L36-L45)):
  - Produce a clear, structured Specification in markdown.
  - Cover goals, user-visible behavior, constraints, and non-goals.
  - **Do not** include implementation details, user stories, or code.
  - Refine the existing spec without dropping content the user already has.
- **Context fed in:** only the current spec markdown (no later artifacts exist yet).

### 2. User Story phase

- **What you see:** the `user-stories.md` editor + chat ([PhaseView.tsx:24-34](src/renderer/PhaseView.tsx#L24-L34)).
- **Chatbot job** (prompt at [agent.ts:46-53](src/main/agent.ts#L46-L53)):
  - Derive **User Stories** from the Spec in standard form
    `- As a <role>, I want <capability>, so that <value>.`
  - One story per bullet, grouped under `## Epic: …` headings.
- **Context fed in:** the Spec is included in the system prompt as reference
  ([agent.ts:99](src/main/agent.ts#L99)) so the model can re-derive consistently.

### 3. Technical Story phase

- **What you see:** the `technical-stories.md` editor + chat ([PhaseView.tsx:35-45](src/renderer/PhaseView.tsx#L35-L45)).
- **Chatbot job** (prompt at [agent.ts:55-62](src/main/agent.ts#L55-L62)):
  - Derive **Technical Stories** from the User Stories.
  - Each story has an ID (`TS-1`, `TS-2`, …), a one-line title, a short
    description, and acceptance criteria.
  - Stories must be small and self-contained — each will become a sub-agent task.
- **Context fed in:** Spec **and** User Stories ([agent.ts:100-105](src/main/agent.ts#L100-L105)).

### 4. Implementation phase

This is the only phase where the code becomes visible, and it is also the
richest UI. It does **not** use `PhaseView` — it switches to the
[`ImplementationView`](src/renderer/ImplementationView.tsx) component
([App.tsx:221-229](src/renderer/App.tsx#L221-L229)), which exposes four tabs:

- **`stories`** — the per-story sub-agent workspace.
- **`integration`** — integration-test generation per User Story.
- **`testloop`** — the autonomous test-fix loop.
- **`code`** — a minimal markdown/code editor for `code.md`.

For each Technical Story (parsed from `technical-stories.md` via
[`parseTechnicalStories`](src/renderer/technical-stories.ts)) the agent can:

1. **Decompose the story** — call
   [`decomposeStory`](src/main/subagent.ts#L133-L211).
   A deepagent is given a `emit_tasks` tool whose schema
   ([subagent.ts:153-166](src/main/subagent.ts#L153-L166)) requires 2-8 task
   chunks with `{id, title, description}`. The chunks are stored in
   `<spec>/.specops/subagents.json`.
2. **Chat with a sub-agent** scoped to that one story
   ([`subAgentChat`](src/main/subagent.ts#L259-L303)). The sub-agent has a
   completely separate context window and is given **real filesystem tools**
   (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`) rooted at the
   project root via deepagents’ `FilesystemBackend`
   ([subagent.ts:247-253](src/main/subagent.ts#L247-L253)). It is instructed to
   actually edit files, not describe edits in prose
   ([subagent.ts:226-228](src/main/subagent.ts#L226-L228)).
3. **Run a single decomposed task** — `runSubAgentTask`
   ([subagent.ts:317-381](src/main/subagent.ts#L317-L381)) prompts the sub-agent
   with a focused per-task message ([subagent.ts:305-315](src/main/subagent.ts#L305-L315))
   and optionally auto-marks the task as `done` (`autoComplete=true` in YOLO mode).
4. **Generate unit tests** for the story
   ([`generateUnitTests`](src/main/subagent.ts#L443-L493)).
5. **Generate integration tests** for any User Story
   ([`generateIntegrationTests`](src/main/subagent.ts#L596-L646)).
6. **Start the autonomous test loop** — see [Testing system](#testing-system).

---

## Agent modes (HITL vs YOLO)

The mode is a single setting (`agentMode`) saved in `settings.json`
([settings.ts:28-32](src/main/settings.ts#L28-L32)) and toggled in the header
([App.tsx:174-184](src/renderer/App.tsx#L174-L184)).

- **HITL — Human-in-the-loop (default).** Each Technical Story task has to be
  approved before the sub-agent runs it. Status flips: `pending →
  in-progress` only when you click; the agent must pause for explicit
  confirmation in the UI before touching files.
- **YOLO — Autonomous.** The Implementation view can chain through every
  decomposed task of every story without confirmation, marking each as `done`
  when the sub-agent reply comes back (`autoComplete=true` is forwarded to
  [`runSubAgentTask`](src/main/subagent.ts#L317-L381)). Designed for unattended
  overnight runs.

The mode is read by `ImplementationView` and used to decide whether to gate
runs behind `pendingApproval`
([ImplementationView.tsx:82-87](src/renderer/ImplementationView.tsx#L82-L87)).

---

## Testing system

### Unit tests
- Generated **per Technical Story** by [`generateUnitTests`](src/main/subagent.ts#L443-L493).
- Output path: `tests/unit/<storyId>.test.md`
  ([subagent.ts:406-409](src/main/subagent.ts#L406-L409)).
- The sub-agent gets `write_file` access via `FilesystemBackend` and is
  instructed to write the test spec **itself**, then reply with a one-sentence
  summary ([subagent.ts:411-441](src/main/subagent.ts#L411-L441)).

### Integration tests
- Generated **per User Story** by [`generateIntegrationTests`](src/main/subagent.ts#L596-L646).
- Framework auto-detection ([subagent.ts:495-501](src/main/subagent.ts#L495-L501)):
  - regex hits on `react|next.js|vue|svelte|angular|web app|browser|playwright`
    → **Playwright** (TypeScript) → output at `tests/integration/<storyId>.spec.ts`.
  - otherwise → **generic** Given/When/Then markdown at
    `tests/integration/<storyId>.test.md`.
- The Playwright prompt section ([subagent.ts:542-557](src/main/subagent.ts#L542-L557))
  hard-constrains the agent to import only `@playwright/test`, use semantic
  locators, and emit valid TypeScript that passes `tsc --noEmit`.

### Autonomous test loop
Implemented in [`test-loop.ts`](src/main/test-loop.ts). Lifecycle:

1. **Discover tests** — walk `tests/` recursively for `*.{test,spec}.{ts,tsx,js,jsx,md}`
   ([test-loop.ts:81-101](src/main/test-loop.ts#L81-L101)).
2. **Run each test** with the right command
   ([test-loop.ts:124-133](src/main/test-loop.ts#L124-L133)):
   - `*.spec.ts` / `*.spec.tsx` → `npx --yes playwright test … --reporter=line`
   - `*.test.{ts,tsx,js,jsx}` → `npx --yes vitest run …` with a Jest fallback
   - `*.test.md` → treated as documentation, marked passed and skipped
3. **If anything failed, run the fix-agent** ([test-loop.ts:219-264](src/main/test-loop.ts#L219-L264)).
   The agent is given a `verdict` tool (`fix-code | fix-test`) that it must
   call exactly once before applying any change, plus the same filesystem tools
   as the sub-agents. Decision rules ([test-loop.ts:198-202](src/main/test-loop.ts#L198-L202)):
   - test matches the Spec → fix the **code**
   - test contradicts the Spec → fix the **test**
4. Repeat for up to `maxIterations` (default 5,
   [test-loop.ts:33](src/main/test-loop.ts#L33)).
5. Status streams live to the renderer via the `testloop:update` IPC channel
   ([main.ts:139-143](src/main/main.ts#L139-L143)).

State is exposed as `TestLoopState` ([api.ts:159-164](src/shared/api.ts#L159-L164))
with statuses `idle | running-tests | analyzing | fixing | passed |
max-iterations | error | stopped`.

---

## Project / spec layout on disk

When you open a folder, the app initializes a git repo if needed
([project.ts:30-43](src/main/project.ts#L30-L43)) and creates `specs/`. Each
spec lives in its own folder with its own git branch:

```
<your-project>/
├── .git/
├── README.md                       # auto-created on first init
├── specs/
│   ├── my-first-spec/              # one folder per spec
│   │   ├── .specops.json           # SpecInfo metadata (id, name, branch, createdAt)
│   │   ├── .specops/
│   │   │   └── subagents.json      # decomposed tasks + chat history per story
│   │   ├── spec.md
│   │   ├── user-stories.md
│   │   ├── technical-stories.md
│   │   └── code.md
│   └── another-spec/…
└── tests/
    ├── unit/<storyId>.test.md
    └── integration/<storyId>.spec.ts | .test.md
```

- A new spec creates a branch `spec/<slug>` ([project.ts:117-123](src/main/project.ts#L117-L123)).
- Slugs are made unique by suffixing `-2`, `-3`, … ([project.ts:54-61](src/main/project.ts#L54-L61)).
- The four artifact files map 1:1 to `ArtifactFiles` keys
  ([project.ts:9-14](src/main/project.ts#L9-L14)).
- Multiple specs can be developed in parallel; each gets its own branch and
  folder, and the UI lets you switch between them in the project bar.

---

## Technical architecture

The app is a standard three-process Electron app:

```
┌─────────────────────────────────────────────────────────────────┐
│ Renderer  (React 18 + Vite)                                     │
│  src/renderer/*.tsx                                             │
│   App ─ ProjectBar ─ PhaseNav ─ PhaseView | ImplementationView  │
│                                  └─ Chat (per-phase)            │
│                                                                 │
│   talks to main only via window.specops.* (typed by SpecOpsApi) │
└────────────────────────────┬────────────────────────────────────┘
                             │ contextBridge.exposeInMainWorld
┌────────────────────────────┴────────────────────────────────────┐
│ Preload  (src/preload/preload.ts)                               │
│   thin ipcRenderer.invoke wrappers + onTestLoopUpdate listener  │
└────────────────────────────┬────────────────────────────────────┘
                             │ ipcMain.handle (project:*, agent:*,│
                             │ subagent:*, testloop:*, settings:*)│
┌────────────────────────────┴────────────────────────────────────┐
│ Main  (Node, Electron)                                          │
│  main.ts        IPC wiring + window creation                    │
│  project.ts     git init, branch-per-spec, artifact read/write  │
│  settings.ts    settings.json (provider config + agentMode)     │
│  models.ts      Anthropic/OpenAI/Google/Ollama → BaseChatModel  │
│  agent.ts       phase chatbot (FS tools + update_artifact tool) │
│  subagent.ts    per-story decomposition / chat / task / tests   │
│  test-loop.ts   discover → run → analyze → fix loop             │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
                      deepagents (LangChain)
                             │
                             ▼
              Anthropic | OpenAI | Google | Ollama
```

Two patterns are worth calling out:

### ESM-from-CJS dynamic loader

`deepagents` and `@langchain/*` are pure ESM, but the Electron main process is
compiled to CommonJS (`tsconfig.main.json` → `dist/main/*.js`). Every main-side
file that needs them uses the same trick to bypass TypeScript’s `require`
rewriting:

```ts
async function loadDeepagents(): Promise<typeof DeepAgents> {
  return await (Function('return import("deepagents")')() as Promise<typeof DeepAgents>);
}
```

(see [agent.ts:5-7](src/main/agent.ts#L5-L7), [subagent.ts:7-19](src/main/subagent.ts#L7-L19),
[test-loop.ts:19-31](src/main/test-loop.ts#L19-L31), [models.ts:9-11](src/main/models.ts#L9-L11)).
`Function('return import("…")')()` evaluates a real dynamic `import()` at
runtime, which TypeScript otherwise lowers to `require()` and breaks ESM.

### Provider abstraction

[`buildChatModel`](src/main/models.ts#L13-L42) takes a `ProviderConfig` and
returns a LangChain `BaseChatModel`. The four supported providers are described
declaratively in [`PROVIDER_DESCRIPTORS`](src/shared/api.ts#L199-L235), which
the Settings UI uses to render forms and defaults. The active provider is
resolved on every agent invocation via [`getActiveProvider`](src/main/settings.ts#L85-L88),
so changing it in Settings takes effect on the next message.

---

## File-by-file walkthrough

### Main process — `src/main/`

| File | Purpose |
|---|---|
| [main.ts](src/main/main.ts) | Creates the `BrowserWindow` and registers every `ipcMain.handle` for `project:*`, `spec:*`, `agent:*`, `subagent:*`, `testloop:*`, `settings:*`. Also rebroadcasts test-loop state to all renderer windows ([main.ts:139-143](src/main/main.ts#L139-L143)). |
| [agent.ts](src/main/agent.ts) | The **phase chatbot**. Builds a per-phase system prompt ([agent.ts:74-112](src/main/agent.ts#L74-L112)), constructs a deepagent with a `FilesystemBackend` rooted at the project root and a per-turn `update_artifact` tool ([agent.ts:143-188](src/main/agent.ts#L143-L188)), then returns `{ reply, artifact? }`. The artifact is populated only if the agent actually called `update_artifact` during the turn. |
| [models.ts](src/main/models.ts) | Provider factory. Lazily ESM-imports `@langchain/anthropic`, `@langchain/openai`, `@langchain/google-genai`, or `@langchain/ollama` and returns a typed `BaseChatModel`. |
| [project.ts](src/main/project.ts) | All filesystem + git work. `openProject` ensures a git repo and a `specs/` dir; `createSpec` slugifies the name, creates a `spec/<slug>` branch, writes the four empty artifact files plus `.specops.json`. `readArtifacts` / `writeArtifact` map artifact keys to filenames. |
| [settings.ts](src/main/settings.ts) | Loads/saves `settings.json` from `app.getPath("userData")`, deep-merges it against the descriptor defaults, and caches the result. Exposes `getActiveProvider()` for agent code. |
| [subagent.ts](src/main/subagent.ts) | The implementation-phase brain. Stores per-story state in `<spec>/.specops/subagents.json`. Implements: `decomposeStory` (forced `emit_tasks` tool call), `subAgentChat` (free-form chat with filesystem tools), `runSubAgentTask` (single decomposed-task execution with optional auto-complete), `generateUnitTests`, `generateIntegrationTests` (with framework auto-detect), `updateTaskStatus`, `resetSubAgent`. |
| [test-loop.ts](src/main/test-loop.ts) | The autonomous test loop. Owns a single `currentState`, emits updates to a single `listener` (wired in `main.ts` to broadcast over IPC). Handles run / analyze / fix / stop / iteration cap. |

### Preload — `src/preload/`

| File | Purpose |
|---|---|
| [preload.ts](src/preload/preload.ts) | Exposes a typed `window.specops` (the `SpecOpsApi` interface from `shared/api.ts`) using `contextBridge`. Every method is a thin `ipcRenderer.invoke` wrapper, except `onTestLoopUpdate`, which subscribes to the pushed `testloop:update` channel and returns an unsubscribe function. |

### Renderer — `src/renderer/`

| File | Purpose |
|---|---|
| [main.tsx](src/renderer/main.tsx) | React entry point — mounts `<App />` into `index.html`. |
| [index.html](src/renderer/index.html) | Minimal shell — loads `styles.css` and the bundled React entry. |
| [styles.css](src/renderer/styles.css) | The entire design system: CSS variables (palette, type scale, radii) at `:root`, plus every reusable component class (`.btn`, `.chat-msg`, `.badge`, `.modal`, `.story-list`, etc.). See [Interface design](#interface-design) for the catalog. |
| [App.tsx](src/renderer/App.tsx) | Top-level state holder: project, active spec, current phase, per-phase chat history, artifacts, settings. Owns the **debounced auto-save** of artifact edits ([App.tsx:84-102](src/renderer/App.tsx#L84-L102)) — a 300 ms timer per artifact key, force-flushed when the agent updates it. Renders the frameless header (brand, HITL/YOLO toggle, provider button, `<WindowControls />`), the project bar, the phase nav, and either `PhaseView + Chat` (phases 1-3) or `ImplementationView` (phase 4). |
| [ProjectBar.tsx](src/renderer/ProjectBar.tsx) | Open project / list specs / create spec. |
| [PhaseNav.tsx](src/renderer/PhaseNav.tsx) | Tab-style nav across the four phases, with locking based on `canAdvance` ([phases.ts:12-23](src/renderer/phases.ts#L12-L23)). |
| [PhaseView.tsx](src/renderer/PhaseView.tsx) | The single-artifact editor for phases 1-3. Spec / User Stories / Technical Stories use the rich `MarkdownEditor`; the legacy code editor branch uses a plain `<textarea>`. |
| [Chat.tsx](src/renderer/Chat.tsx) | The right-hand chat panel for phases 1-3. Stateless w.r.t. history (it’s passed from `App`). Submit on Enter, Shift+Enter for newline. |
| [ImplementationView.tsx](src/renderer/ImplementationView.tsx) | The four-tab implementation workspace (`stories`, `integration`, `testloop`, `code`). Drives all `subagent:*` and `testloop:*` IPC calls and renders task lists, sub-agent chat per story, generated test previews, and the live test-loop status. |
| [MarkdownEditor.tsx](src/renderer/MarkdownEditor.tsx) | Wrapper around `react-markdown-editor-lite` with `marked` for preview. Includes a scoped `<style>` block that retints the third-party editor against the shared CSS variables so it visually merges with the rest of the shell. |
| [Settings.tsx](src/renderer/Settings.tsx) | The provider-configuration modal: pick provider, enter API key / base URL / model. Persists via `settings:save`. |
| [phases.ts](src/renderer/phases.ts) | `Phase` enum, ordering, labels, `canAdvance`, `nextPhase` / `prevPhase`, and the renderer-side `Artifacts` type (mirrors `ArtifactFiles`). |
| [user-stories.ts](src/renderer/user-stories.ts) | Markdown → `UserStory[]` parser used by the integration-test tab. |
| [technical-stories.ts](src/renderer/technical-stories.ts) | Markdown → `TechnicalStory[]` parser used by the implementation tab. |

### Shared — `src/shared/`

| File | Purpose |
|---|---|
| [api.ts](src/shared/api.ts) | The single source of truth for IPC types: `ProjectInfo`, `SpecInfo`, `ArtifactFiles`, `Phase`, `AgentTurnRequest/Result`, `TechnicalStory`, `UserStory`, `TaskChunk`, `SubAgentState`, `TestLoopState`, `ProviderConfig`, `AppSettings`, plus the `SpecOpsApi` interface that the preload implements and the renderer consumes. Also exports `PROVIDER_DESCRIPTORS`, the declarative provider catalog used by both sides. |

---

## Build & run

Requirements: Node 18+ (Electron 33 ships its own Chromium).

```bash
npm install

# typecheck both tsconfigs (main and renderer)
npm run typecheck

# dev: builds main, starts vite dev server, then launches Electron
npm run dev

# production build (renderer to dist/, main to dist/main/)
npm run build

# run the prod build
npm start
```

Project structure:

```
src/
├── main/        compiled by tsconfig.main.json → dist/main/*.js  (CommonJS)
├── preload/     compiled by tsconfig.main.json → dist/preload/preload.js
├── renderer/    bundled by Vite → dist/index.html + assets       (ESM)
└── shared/      type-only, imported from both sides
```

The Electron entry point is `dist/main/main.js` (set in `package.json` `main`).
In dev, the renderer is served from `http://localhost:5173`; in prod, it’s
loaded from `dist/index.html`.
