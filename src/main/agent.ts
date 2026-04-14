import type {
  AgentTurn,
  AgentTurnRequest,
  AgentTurnResult,
  ArtifactFiles,
  Phase,
  ProviderConfig,
} from "../shared/api";
import { getActiveProvider } from "./settings";

interface PhaseConfig {
  artifact: keyof ArtifactFiles;
  label: string;
  guidance: string;
}

const PHASE_CONFIG: Record<Phase, PhaseConfig> = {
  spec: {
    artifact: "spec",
    label: "Specification",
    guidance: [
      "Produce a clear, structured software **Specification** in markdown.",
      "Cover: goals, user-visible behavior, constraints, non-goals.",
      "Do NOT include implementation details, user stories, or code.",
      "Refine the existing spec; never drop content the user already has unless they ask.",
    ].join(" "),
  },
  "user-story": {
    artifact: "userStories",
    label: "User Stories",
    guidance: [
      "Derive **User Stories** from the spec in the standard form:",
      "`- As a <role>, I want <capability>, so that <value>.`",
      "One story per bullet. Group related stories under `## Epic: ...` headings.",
    ].join(" "),
  },
  "technical-story": {
    artifact: "technicalStories",
    label: "Technical Stories",
    guidance: [
      "Derive **Technical Stories** from the user stories.",
      "Each story: an ID (`TS-1`, `TS-2`…), a one-line title, a short description, and acceptance criteria.",
      "These will each become a sub-agent task — keep them small and self-contained.",
    ].join(" "),
  },
  implementation: {
    artifact: "code",
    label: "Implementation",
    guidance: [
      "This phase implements the technical stories. Return code or scaffolding notes.",
      "Open SWE will drive real code changes later — for now, sketch the implementation plan.",
    ].join(" "),
  },
};

function buildSystemPrompt(phase: Phase, artifacts: ArtifactFiles): string {
  const cfg = PHASE_CONFIG[phase];
  const sections: string[] = [
    "You are the SpecOps AI agent, guiding a developer through Spec-Driven Development.",
    `Current phase: **${cfg.label}**.`,
    cfg.guidance,
    "",
    "Respond in EXACTLY this format, with no prose before or after:",
    "<artifact>",
    `...the complete updated ${cfg.label} as markdown...`,
    "</artifact>",
    "<reply>",
    "One to three sentences describing what you changed or what you need from the user.",
    "</reply>",
    "",
    "Always emit the FULL artifact, not a diff. If the user's message is only a question, repeat the existing artifact unchanged inside <artifact>.",
    "",
    "## Context from earlier phases",
  ];
  if (artifacts.spec.trim()) sections.push("### Spec", artifacts.spec.trim());
  if (phase !== "spec" && artifacts.userStories.trim())
    sections.push("### User Stories", artifacts.userStories.trim());
  if (
    (phase === "technical-story" || phase === "implementation") &&
    artifacts.technicalStories.trim()
  )
    sections.push("### Technical Stories", artifacts.technicalStories.trim());

  const current = artifacts[cfg.artifact].trim();
  sections.push(
    "",
    `## Current ${cfg.label} (to refine)`,
    current || "(empty — create from scratch based on the user's message)",
  );
  return sections.join("\n");
}

function parseResponse(text: string): { artifact?: string; reply: string } {
  const artifactMatch = text.match(/<artifact>([\s\S]*?)<\/artifact>/);
  const replyMatch = text.match(/<reply>([\s\S]*?)<\/reply>/);
  const artifact = artifactMatch ? artifactMatch[1].trim() : undefined;
  const reply = replyMatch ? replyMatch[1].trim() : text.trim();
  return { artifact, reply };
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function toMessages(history: AgentTurn[], userMessage: string): ChatMessage[] {
  const msgs: ChatMessage[] = history.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.text,
  }));
  msgs.push({ role: "user", content: userMessage });
  return msgs;
}

async function callAnthropic(
  cfg: ProviderConfig,
  system: string,
  messages: ChatMessage[],
): Promise<string> {
  if (!cfg.apiKey) throw new Error("Anthropic API key is not set. Configure it in Settings.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: cfg.model, max_tokens: 4096, system, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (
    data.content
      ?.map((b) => (b.type === "text" ? b.text ?? "" : ""))
      .join("")
      .trim() ?? ""
  );
}

async function callOpenAI(
  cfg: ProviderConfig,
  system: string,
  messages: ChatMessage[],
): Promise<string> {
  if (!cfg.apiKey) throw new Error("OpenAI API key is not set. Configure it in Settings.");
  const base = cfg.baseUrl?.replace(/\/$/, "") || "https://api.openai.com/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function callOllama(
  cfg: ProviderConfig,
  system: string,
  messages: ChatMessage[],
): Promise<string> {
  const base = cfg.baseUrl?.replace(/\/$/, "") || "http://localhost:11434";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content?.trim() ?? "";
}

async function callOpenSwe(
  cfg: ProviderConfig,
  system: string,
  messages: ChatMessage[],
): Promise<string> {
  if (!cfg.baseUrl) throw new Error("Open SWE base URL is not set. Configure it in Settings.");
  const base = cfg.baseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/runs/wait`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cfg.apiKey ? { "x-api-key": cfg.apiKey } : {}),
    },
    body: JSON.stringify({
      assistant_id: cfg.model || "open-swe",
      input: { system, messages },
    }),
  });
  if (!res.ok)
    throw new Error(`Open SWE ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = (await res.json()) as {
    output?: string;
    messages?: Array<{ content?: string }>;
  };
  if (typeof data.output === "string") return data.output.trim();
  const last = data.messages?.[data.messages.length - 1]?.content;
  return typeof last === "string" ? last.trim() : "";
}

async function dispatch(
  cfg: ProviderConfig,
  system: string,
  messages: ChatMessage[],
): Promise<string> {
  switch (cfg.id) {
    case "anthropic":
      return callAnthropic(cfg, system, messages);
    case "openai":
      return callOpenAI(cfg, system, messages);
    case "ollama":
      return callOllama(cfg, system, messages);
    case "openswe":
      return callOpenSwe(cfg, system, messages);
  }
}

export async function runAgentTurn(req: AgentTurnRequest): Promise<AgentTurnResult> {
  const cfg = await getActiveProvider();
  const phaseCfg = PHASE_CONFIG[req.phase];
  const system = buildSystemPrompt(req.phase, req.artifacts);
  const messages = toMessages(req.history, req.message);

  let text: string;
  try {
    text = await dispatch(cfg, system, messages);
  } catch (err) {
    return { reply: `Agent error: ${(err as Error).message}` };
  }

  const { artifact, reply } = parseResponse(text);
  return {
    reply: reply || "(no reply)",
    artifact:
      artifact !== undefined ? { key: phaseCfg.artifact, content: artifact } : undefined,
  };
}
