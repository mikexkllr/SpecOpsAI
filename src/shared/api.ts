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
  specPath: string;
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

export interface WorkerMessage {
  role: "user" | "agent";
  text: string;
}

export type WorkerStatus = "idle" | "decomposing" | "running" | "done";

export interface WorkerState {
  storyId: string;
  tasks: TaskChunk[];
  messages: WorkerMessage[];
  status: WorkerStatus;
  error?: string;
}

export type WorkerStore = Record<string, WorkerState>;

export interface WorkerDecomposeRequest {
  specPath: string;
  story: TechnicalStory;
  artifacts: ArtifactFiles;
}

export interface WorkerChatRequest {
  specPath: string;
  story: TechnicalStory;
  artifacts: ArtifactFiles;
  message: string;
}

export interface WorkerRunTaskRequest {
  specPath: string;
  story: TechnicalStory;
  artifacts: ArtifactFiles;
  taskId: string;
  autoComplete: boolean;
}

export interface GenerateUnitTestsRequest {
  specPath: string;
  story: TechnicalStory;
  artifacts: ArtifactFiles;
}

export interface GenerateUnitTestsResult {
  storyId: string;
  path: string;
  content: string;
  summary: string;
  error?: string;
}

export interface UserStory {
  id: string;
  title: string;
  body: string;
}

export interface GenerateIntegrationTestsRequest {
  specPath: string;
  story: UserStory;
  artifacts: ArtifactFiles;
}

export type IntegrationTestFramework =
  | "playwright"
  | "flutter"
  | "xcuitest"
  | "espresso"
  | "generic";

export interface GenerateIntegrationTestsResult {
  storyId: string;
  path: string;
  content: string;
  summary: string;
  framework: IntegrationTestFramework;
  error?: string;
}

export interface TestRunResult {
  file: string;
  passed: boolean;
  stdout: string;
  stderr: string;
  duration: number;
}

export type TestLoopVerdict = "fix-code" | "fix-test";

export interface TestLoopIteration {
  iteration: number;
  results: TestRunResult[];
  failures: number;
  verdict?: TestLoopVerdict;
  agentSummary?: string;
}

export type TestLoopStatus =
  | "idle"
  | "running-tests"
  | "analyzing"
  | "fixing"
  | "passed"
  | "max-iterations"
  | "error"
  | "stopped";

export interface TestLoopState {
  status: TestLoopStatus;
  iterations: TestLoopIteration[];
  maxIterations: number;
  error?: string;
}

export interface TestLoopRequest {
  specPath: string;
  artifacts: ArtifactFiles;
  maxIterations?: number;
}

export interface MergeCheckResult {
  ready: boolean;
  branch: string;
  mainBranch: string;
  issues: string[];
  testsPassed: boolean;
  workingTreeClean: boolean;
  branchUpToDate: boolean;
}

export interface MergeResult {
  ok: boolean;
  branch: string;
  mainBranch: string;
  check: MergeCheckResult;
  mergedAt?: string;
  error?: string;
}

export type ProviderId = "anthropic" | "openai" | "google" | "ollama";

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
    id: "google",
    label: "Google Gemini",
    needsApiKey: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-pro",
    suggestedModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-pro"],
    description: "Gemini models via Google Generative Language API.",
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
  readWorkers(specPath: string): Promise<WorkerStore>;
  decomposeStory(request: WorkerDecomposeRequest): Promise<WorkerState>;
  workerChat(request: WorkerChatRequest): Promise<WorkerState>;
  runWorkerTask(request: WorkerRunTaskRequest): Promise<WorkerState>;
  generateUnitTests(
    request: GenerateUnitTestsRequest,
  ): Promise<GenerateUnitTestsResult>;
  generateIntegrationTests(
    request: GenerateIntegrationTestsRequest,
  ): Promise<GenerateIntegrationTestsResult>;
  updateTaskStatus(
    specPath: string,
    storyId: string,
    taskId: string,
    status: TaskStatus,
  ): Promise<WorkerState>;
  resetWorker(specPath: string, storyId: string): Promise<WorkerStore>;
  stopWorker(specPath: string, storyId: string): Promise<void>;
  startTestLoop(request: TestLoopRequest): Promise<void>;
  stopTestLoop(): Promise<void>;
  getTestLoopState(): Promise<TestLoopState>;
  onTestLoopUpdate(callback: (state: TestLoopState) => void): () => void;
  checkMerge(specPath: string): Promise<MergeCheckResult>;
  mergeToMain(specPath: string): Promise<MergeResult>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<boolean>;
  closeWindow(): Promise<void>;
  isWindowMaximized(): Promise<boolean>;
  onMaximizedChange(callback: (maximized: boolean) => void): () => void;
}

declare global {
  interface Window {
    specops: SpecOpsApi;
  }
}

export {};
