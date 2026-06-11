import { z } from "zod";
import type {
  ArtifactFiles,
  EditorAgentRequest,
  EditorAgentResult,
  MarkedStory,
} from "../shared/api";
import { buildChatModel } from "./models";
import { getActiveProvider } from "./settings";
import { loadDeps } from "./deepagentsDeps";
import { buildProjectBackend, turnsToLcMessages } from "./agentCommon";
import { projectContextSections } from "./projectContext";
import { workerSubagents } from "./workerSubagents";
import { readWorkers, markStoryImplemented } from "./worker";
import { projectRoot, lastAssistantText, isAbortError } from "./utils";

// One in-flight run per spec, so the editor's stop button can abort it.
const controllers = new Map<string, AbortController>();

export function stopEditorAgent(specPath: string): void {
  controllers.get(specPath)?.abort();
}

function contextSections(artifacts: ArtifactFiles): string[] {
  const out: string[] = [];
  if (artifacts.spec.trim()) out.push("## Spec", artifacts.spec.trim(), "");
  if (artifacts.userStories.trim())
    out.push("## User Stories", artifacts.userStories.trim(), "");
  if (artifacts.technicalStories.trim())
    out.push("## Technical Stories", artifacts.technicalStories.trim(), "");
  return out;
}

export async function runEditorAgent(
  req: EditorAgentRequest,
): Promise<EditorAgentResult> {
  // Abort any previous run for this spec before starting a new one.
  controllers.get(req.specPath)?.abort();
  const ac = new AbortController();
  controllers.set(req.specPath, ac);
  // Hoisted so a stopped run still reports stories it managed to mark first.
  const marked: MarkedStory[] = [];
  try {
    const cfg = await getActiveProvider();
    const { deepagents, tools: T } = await loadDeps();
    const model = await buildChatModel(cfg);
    const root = projectRoot(req.specPath);

    // A technical story is "done" when its worker state says so. Only whole
    // technical stories can be marked — never individual sub-tasks.
    const store = await readWorkers(req.specPath);
    const storyIndex = new Map(req.stories.map((s) => [s.id, s]));
    const openStories = req.stories.filter((s) => store[s.id]?.status !== "done");

    const listStories = T.tool(
      async () =>
        openStories.length
          ? openStories.map((s) => `- ${s.id} — ${s.title || "(untitled)"}`).join("\n")
          : "(no open technical stories)",
      {
        name: "list_open_stories",
        description:
          "List technical stories that are not yet done, with their ids — the only units you may mark done.",
        schema: z.object({}),
      },
    );

    const markStory = T.tool(
      async (input: { storyId: string }) => {
        const story = storyIndex.get(input.storyId);
        if (!story) return `No technical story with id ${input.storyId}.`;
        await markStoryImplemented(req.specPath, input.storyId);
        if (!marked.some((m) => m.storyId === input.storyId)) {
          marked.push({ storyId: input.storyId, title: story.title });
        }
        return `Marked technical story ${input.storyId} as done.`;
      },
      {
        name: "mark_story_implemented",
        description:
          "Mark a whole TECHNICAL STORY as done once the code genuinely satisfies it (be conservative). Only technical stories can be marked — not sub-tasks. Use the story id (e.g. TS-2) from list_open_stories.",
        schema: z.object({ storyId: z.string() }),
      },
    );

    const openBlock = openStories.length
      ? openStories.map((s) => `- ${s.id} — ${s.title || "(untitled)"}`).join("\n")
      : "(all technical stories are done)";

    const system = [
      "You are a coding agent embedded directly in the SpecOps code editor.",
      "You implement features and fixes by editing the project's real files, and you keep the technical stories in sync with the code.",
      "",
      "## What you can do",
      "- Read and edit any file in the project with your filesystem tools (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`), rooted at the project root. MAKE the changes — do not just describe them.",
      "- Mark a whole TECHNICAL STORY done with `mark_story_implemented` once the code genuinely satisfies it (be conservative). Only technical stories are markable — never individual sub-tasks. Use `list_open_stories` for ids.",
      "- Delegate large survey / planning passes to your `task` subagents when useful.",
      "",
      "## How to respond",
      "After doing the work, reply in 1–4 sentences: what you changed (cite file paths) and which technical stories you marked done. Don't paste whole files back.",
      "",
      ...(await projectContextSections(root)),
      "",
      ...contextSections(req.artifacts),
      "## Open technical stories (candidates to implement / mark done)",
      openBlock,
    ].join("\n");

    const agent = deepagents.createDeepAgent({
      model,
      systemPrompt: system,
      backend: await buildProjectBackend(root),
      tools: [listStories, markStory],
      subagents: workerSubagents,
    });

    const lcMessages = await turnsToLcMessages(req.history, req.message);
    const result = await agent.invoke({ messages: lcMessages }, { signal: ac.signal });
    return { reply: lastAssistantText(result) || "(no reply)", markedImplemented: marked };
  } catch (err) {
    return {
      reply: "",
      markedImplemented: marked,
      error: isAbortError(err) ? "Stopped by user." : (err as Error).message,
    };
  } finally {
    if (controllers.get(req.specPath) === ac) controllers.delete(req.specPath);
  }
}
