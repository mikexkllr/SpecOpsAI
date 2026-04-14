export interface SpecInfo {
  id: string;
  name: string;
  path: string;
  branch: string;
  createdAt: string;
}

export interface ProjectInfo {
  path: string;
  name: string;
  specs: SpecInfo[];
}

export interface ArtifactFiles {
  spec: string;
  userStories: string;
  technicalStories: string;
  code: string;
}

export type Phase = "spec" | "user-story" | "technical-story" | "implementation";

export interface AgentTurn {
  role: "user" | "agent";
  text: string;
}

export interface AgentTurnRequest {
  phase: Phase;
  artifacts: ArtifactFiles;
  history: AgentTurn[];
  message: string;
}

export interface AgentTurnResult {
  reply: string;
  artifact?: { key: keyof ArtifactFiles; content: string };
}

export interface TechnicalStory {
  id: string;
  title: string;
  body: string;
}

export type TaskStatus = "pending" | "in-progress" | "done";

export interface TaskChunk {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
}

export interface SubAgentMessage {
  role: "user" | "agent";
  text: string;
}

export type SubAgentStatus = "idle" | "decomposing" | "running" | "done";

export interface SubAgentState {
  storyId: string;
  tasks: TaskChunk[];
  messages: SubAgentMessage[];
  status: SubAgentStatus;
  error?: string;
}

export type SubAgentStore = Record<string, SubAgentState>;

export interface SubAgentDecomposeRequest {
  specPath: string;
  story: TechnicalStory;
  artifacts: ArtifactFiles;
}

export interface SubAgentChatRequest {
  specPath: string;
  story: TechnicalStory;
  artifacts: ArtifactFiles;
  message: string;
}

export interface SubAgentRunTaskRequest {
  specPath: string;
  story: TechnicalStory;
  artifacts: ArtifactFiles;
  taskId: string;
  autoComplete: boolean;
}

export type ProviderId = "anthropic" | "openai" | "ollama" | "openswe";

export interface ProviderConfig {
  id: ProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export type AgentMode = "yolo" | "hitl";

export interface AppSettings {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  agentMode: AgentMode;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  needsApiKey: boolean;
  defaultBaseUrl?: string;
  defaultModel: string;
  suggestedModels: string[];
  description: string;
}

export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    needsApiKey: true,
    defaultModel: "claude-sonnet-4-5",
    suggestedModels: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
    description: "Claude models via api.anthropic.com.",
  },
  {
    id: "openai",
    label: "OpenAI",
    needsApiKey: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    suggestedModels: ["gpt-4o", "gpt-4o-mini", "o1-mini"],
    description: "OpenAI Chat Completions API (or any compatible endpoint).",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    needsApiKey: false,
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "llama3.1",
    suggestedModels: ["llama3.1", "qwen2.5-coder", "mistral"],
    description: "Local models via Ollama.",
  },
  {
    id: "openswe",
    label: "LangChain Open SWE",
    needsApiKey: true,
    defaultBaseUrl: "http://localhost:2024",
    defaultModel: "open-swe",
    suggestedModels: ["open-swe"],
    description:
      "LangGraph-served Open SWE agent. Intended for the Implementation phase.",
  },
];

export interface SpecOpsApi {
  version: string;
  openProject(): Promise<ProjectInfo | null>;
  listSpecs(projectPath: string): Promise<SpecInfo[]>;
  createSpec(projectPath: string, name: string): Promise<SpecInfo>;
  readArtifacts(specPath: string): Promise<ArtifactFiles>;
  writeArtifact(
    specPath: string,
    artifact: keyof ArtifactFiles,
    content: string,
  ): Promise<void>;
  agentChat(request: AgentTurnRequest): Promise<AgentTurnResult>;
  readSubAgents(specPath: string): Promise<SubAgentStore>;
  decomposeStory(request: SubAgentDecomposeRequest): Promise<SubAgentState>;
  subAgentChat(request: SubAgentChatRequest): Promise<SubAgentState>;
  runSubAgentTask(request: SubAgentRunTaskRequest): Promise<SubAgentState>;
  updateTaskStatus(
    specPath: string,
    storyId: string,
    taskId: string,
    status: TaskStatus,
  ): Promise<SubAgentState>;
  resetSubAgent(specPath: string, storyId: string): Promise<SubAgentStore>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
}

declare global {
  interface Window {
    specops: SpecOpsApi;
  }
}

export {};
