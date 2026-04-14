**Final, precise prompt:**

> Design a desktop application with an integrated AI agent based on Open SWE by the LangChain team.
> The application should consistently implement **Spec-Driven Development** and provide a **phase-based development environment (IDE)**.
>
> ## Core Idea: Phase-Based UI (Progressive Disclosure)
>
> The user interface always shows **only the current development artifact type** and hides everything else:
>
> 1. **Spec Phase**
>
>    * Visible: Specification (Spec)
>    * Input: Chat + optional structured editor
>    * No access to code
> 2. **User Story Phase**
>
>    * Visible: User Stories
>    * Generated from the Spec
>    * Editing via chat or manually
>    * Spec remains referenceable but not in focus
> 3. **Technical Story Phase**
>
>    * Visible: Technical Stories
>    * Derived from User Stories
>    * Editable
> 4. **Implementation Phase**
>
>    * **Only now does the code become visible**
>    * Unlocks an integrated, minimal code editor
>    * Focus: Implementation of the Technical Stories
>
> 👉 Goal: The user should **never see code too early**, but be strictly guided along the Spec-Driven workflow.
>
> ---
>
> ## Workflow
>
> 1. **Project Start**
>
>    * Automatic creation of a new Git branch
> 2. **Spec Creation**
>
>    * User describes requirements in chat
>    * Agent generates a structured Spec
>    * Iterative improvement possible (chat + editor)
> 3. **Derivation**
>
>    * Spec → User Stories
>    * User Stories → Technical Stories
> 4. **Implementation**
>
>    * Decomposition into small tasks (chunks)
>    * For each Technical Story:
>
>      * dedicated sub-agent
>      * dedicated context window
> 5. **Agent Modes**
>
>    * **YOLO Mode**:
>
>      * Fully automatic processing of all Technical Stories
>      * Can run unattended (e.g., overnight)
>    * **Human-in-the-Loop Mode**:
>
>      * Tool calls must be confirmed
>
> ---
>
> ## Testing System (Central Component)
>
> **Automatically generated and iteratively improved:**
>
> * **Unit Tests**
>
>   * Based on Technical Stories
> * **Integration Tests**
>
>   * Based on User Stories
>   * Technologies:
>
>     * Web: Playwright (e.g., React)
>     * Mobile: Flutter, iOS, Android
> * **Test Loop (autonomous)**
>
>   * Tests are continuously executed
>   * Agent decides:
>
>     * Fix the code **or**
>     * Correct the test
>   * Goal:
>
>     * All tests pass (Unit, Integration, End-to-End)
>     * Behavior matches the User Stories exactly
>
> ---
>
> ## Completion
>
> * Automatic merge into the main branch after successful testing
>
> ---
>
> ## Collaboration & Structure
>
> * Each Spec gets its own folder in the repository
> * Multiple Specs can be developed in parallel
> * Git-based collaboration is supported
>
> ---
>
> ## Technical Requirements
>
> * Desktop app (e.g., Electron, Tauri, or similar)
> * Integrated minimal code editor (visible only in the implementation phase)
> * Chat interface as the primary control mechanism
> * Clear separation of:
>
>   * Spec
>   * User Stories
>   * Technical Stories
>   * Code
>
> ---
>
> ## System Goal
>
> A focused development environment that:
>
> * Strictly guides developers through Spec-Driven Development
> * Prevents context overload
> * Efficiently orchestrates AI agents
> * And enables autonomous software development (including testing)

---

## Implementation Checklist

### Foundation
- [x] Choose desktop framework (Electron, Tauri, or similar) — **Electron**
- [x] Set up project scaffolding and build pipeline
- [ ] Integrate Open SWE (LangChain) as the agent backbone
- [ ] Implement chat interface as primary control mechanism
- [ ] Implement Git integration (auto-branch on project start)
- [ ] Define repository folder structure (one folder per Spec)
- [ ] Support parallel Spec development

### Phase-Based UI (Progressive Disclosure)
- [ ] Implement phase state machine (Spec → User Story → Technical Story → Implementation)
- [ ] Build Spec Phase view (spec only, no code access)
- [ ] Build User Story Phase view (stories visible, spec referenceable)
- [ ] Build Technical Story Phase view (editable technical stories)
- [ ] Build Implementation Phase view with integrated minimal code editor
- [ ] Enforce code visibility lock until Implementation Phase
- [ ] Provide structured editor option alongside chat in each phase

### Agent Workflow
- [ ] Spec generation from chat input
- [ ] Iterative spec refinement (chat + editor)
- [ ] Derive User Stories from Spec
- [ ] Derive Technical Stories from User Stories
- [ ] Task decomposition (chunking) per Technical Story
- [ ] Spawn dedicated sub-agent with isolated context window per Technical Story

### Agent Modes
- [ ] Implement YOLO Mode (fully autonomous, unattended runs)
- [ ] Implement Human-in-the-Loop Mode (tool-call confirmation)
- [ ] Mode switch UI

### Testing System
- [ ] Auto-generate Unit Tests from Technical Stories
- [ ] Auto-generate Integration Tests from User Stories
- [ ] Playwright integration for web targets (e.g., React)
- [ ] Flutter test integration for mobile
- [ ] iOS test integration
- [ ] Android test integration
- [ ] Continuous autonomous test loop runner
- [ ] Agent decision logic: fix code vs. correct test
- [ ] End-to-end test coverage aligned with User Stories

### Completion & Merge
- [ ] Auto-merge into main branch after all tests pass
- [ ] Safety checks before merge (all tests green, branch up-to-date)

### Clear Artifact Separation
- [ ] Spec artifact storage
- [ ] User Stories artifact storage
- [ ] Technical Stories artifact storage
- [ ] Code artifact storage
- [ ] Cross-referencing between artifacts without breaking focus
