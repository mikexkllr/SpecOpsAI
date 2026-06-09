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

// One entry in a persisted agent-turn trace: reasoning ("thinking"), nested
// subagent visible text ("subtext"), or a tool call. Mirrors the live activity
// the chat renders while a turn runs, so it can be saved and replayed.
export type AgentActivityItem =
  | { kind: "thinking"; depth: number; text: string }
  | { kind: "subtext"; depth: number; text: string }
  | {
      kind: "tool";
      depth: number;
      name: string;
      input?: unknown;
      output?: string;
      done: boolean;
      toolCallId?: string;
    };

export interface AgentTurn {
  role: "user" | "agent";
  text: string;
  // Present on agent turns only: the captured thinking / tool-call trace.
  activity?: AgentActivityItem[];
}

export interface SessionState {
  projectPath?: string;
  activeSpecId?: string;
  phase?: Phase;
}

// Per-phase conversation; structurally identical to ChatMessage in Chat.tsx.
export type ChatHistory = Record<Phase, AgentTurn[]>;

export interface AgentTurnRequest {
  specPath: string;
  phase: Phase;
  artifacts: ArtifactFiles;
  history: AgentTurn[];
  message: string;
  // Correlates the live `agent:event` stream below with this turn. The renderer
  // generates it; the main process stamps every streamed event with it.
  turnId?: string;
}

export interface AgentTurnResult {
  reply: string;
  artifact?: { key: keyof ArtifactFiles; content: string };
}

// Live events emitted while a phase agent turn is running, so the UI can show
// intermediate thinking, streaming reply text, and tool calls as they happen.
// `depth` is 0 for the top-level agent and >0 for nested deepagents subagents
// (work delegated through the built-in `task` tool).
export type AgentStreamEvent = { turnId: string; depth: number } & (
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool-start"; name: string; input: unknown; toolCallId?: string }
  | { kind: "tool-end"; name: string; output: string; toolCallId?: string }
);

export interface TechnicalStory {
  id: string;
  title: string;
  body: string;
}

export type CodingAgentId =
  | "claude-code"
  | "deepagent"
  | "gh-copilot"
  | "codex"
  | "antigravity";

export type TaskStatus = "pending" | "in-progress" | "needs-attention" | "done";

export interface TaskChunk {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
}

export interface WorkerMessage {
  role: "user" | "agent" | "terminal" | "reviewer";
  text: string;
}

export type ReviewVerdict = "approved" | "changes-requested";

export interface ReviewTaskRequest {
  specPath: string;
  story: TechnicalStory;
  task: TaskChunk;
  artifacts: ArtifactFiles;
}

export interface ReviewTaskResult {
  verdict: ReviewVerdict;
  summary: string;
  error?: string;
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

// --- Code Studio (interactive viewer / editor / reviewer) ------------------

// One node in the project source tree, rooted at the project root. Paths are
// posix-style and relative to the root (e.g. "src/main/worker.ts").
export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
}

export interface ProjectFileResult {
  path: string;
  content: string;
  // true when the file looked binary or exceeded the read cap — content is then
  // a short placeholder rather than the real bytes.
  binary: boolean;
  tooLarge: boolean;
}

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

// One file's entry in a GitHub/Devin-style review: the agent's own description
// of what it changed in that file and why.
export interface FileReview {
  path: string;
  status: FileChangeStatus;
  summary: string;
}

// A technical story the agent decided was satisfied by the changes and marked
// done on its own. Only whole technical stories are markable — not sub-tasks.
export interface MarkedStory {
  storyId: string;
  title: string;
}

export interface CodeReviewReport {
  overview: string;
  files: FileReview[];
  markedImplemented: MarkedStory[];
  error?: string;
}

export interface GenerateCodeReviewRequest {
  specPath: string;
  artifacts: ArtifactFiles;
  stories: TechnicalStory[];
}

// A follow-up question about an existing review (the Q&A chat). The review
// `report` is passed back so answers stay grounded in what was reviewed.
export interface CodeReviewRequest {
  specPath: string;
  // The file the user is focused on in the editor, if any.
  focusPath?: string;
  // The user's question about the review.
  instruction: string;
  // Prior Q&A turns, so the agent keeps context.
  history: AgentTurn[];
  artifacts: ArtifactFiles;
  report?: CodeReviewReport;
}

export interface CodeReviewResult {
  markdown: string;
  error?: string;
}

// The coding agent embedded in the code editor: it edits files for real and can
// mark technical-story tasks implemented.
export interface EditorAgentRequest {
  specPath: string;
  artifacts: ArtifactFiles;
  stories: TechnicalStory[];
  history: AgentTurn[];
  message: string;
}

export interface EditorAgentResult {
  reply: string;
  markedImplemented: MarkedStory[];
  error?: string;
}

export type ProviderId = "anthropic" | "openai" | "google" | "ollama" | "bedrock";

// How a provider exposes extended thinking / reasoning, and thus which control
// the Settings form renders for it:
//   budget → on/off + a token budget   (Anthropic, Gemini)
//   effort → on/off + low/medium/high  (OpenAI reasoning models)
//   toggle → on/off only               (Ollama)
//   none   → not configurable
export type ThinkingControl = "budget" | "effort" | "toggle" | "none";

export interface ThinkingConfig {
  enabled: boolean;
  budgetTokens?: number; // budget-style providers
  effort?: "low" | "medium" | "high"; // effort-style providers
}

export interface ProviderConfig {
  id: ProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  thinking?: ThinkingConfig;
  // AWS Bedrock (Converse API) only. Leave credentials blank to fall back to the
  // default AWS credential chain (env vars, ~/.aws, instance role…).
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export type AgentMode = "yolo" | "hitl";

export interface AppSettings {
  activeProvider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  agentMode: AgentMode;
  codingAgent: CodingAgentId;
  devServerUrl?: string;
  // When true, the app checks GitHub Releases for a newer version on startup and
  // downloads it in the background. The user always confirms the final restart.
  autoUpdate?: boolean;
}

// Phases of the auto-updater state machine, mirrored to the renderer so the
// Settings UI can show progress and offer the right action.
export type UpdateState =
  | "idle" // never checked, or check finished with no update
  | "checking" // contacting GitHub Releases
  | "available" // a newer version exists (download may be in progress)
  | "downloading" // actively pulling the update package
  | "downloaded" // ready to install on restart
  | "not-available" // checked, already on the latest version
  | "error" // last check/download failed
  | "disabled"; // updates unavailable (e.g. running unpackaged in dev)

export interface UpdateStatus {
  state: UpdateState;
  // The version currently running.
  currentVersion: string;
  // The version offered by the latest release, once known.
  newVersion?: string;
  // 0–100 while downloading.
  progressPercent?: number;
  // Human-readable detail for the "error" state.
  error?: string;
  // GitHub release notes for the available version, when provided.
  releaseNotes?: string;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  needsApiKey: boolean;
  needsAwsCreds?: boolean; // renders AWS region + access key/secret fields (Bedrock)
  defaultBaseUrl?: string;
  defaultModel: string;
  suggestedModels: string[];
  description: string;
  thinking: ThinkingControl;
  defaultThinkingBudget?: number; // for budget-style providers
}

export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    needsApiKey: true,
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5",
    suggestedModels: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
    description: "Claude models via api.anthropic.com.",
    thinking: "budget",
    defaultThinkingBudget: 2048,
  },
  {
    id: "openai",
    label: "OpenAI",
    needsApiKey: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    suggestedModels: ["gpt-4o", "gpt-4o-mini", "o1-mini"],
    description: "OpenAI Chat Completions API (or any compatible endpoint).",
    thinking: "effort",
  },
  {
    id: "google",
    label: "Google Gemini",
    needsApiKey: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-pro",
    suggestedModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-pro"],
    description: "Gemini models via Google Generative Language API.",
    thinking: "budget",
    defaultThinkingBudget: 2048,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    needsApiKey: false,
    defaultBaseUrl: "http://localhost:11434",
    defaultModel: "llama3.1",
    suggestedModels: ["llama3.1", "qwen2.5-coder", "mistral"],
    description: "Local models via Ollama.",
    thinking: "toggle",
  },
  {
    id: "bedrock",
    label: "AWS Bedrock (Converse)",
    needsApiKey: false,
    needsAwsCreds: true,
    defaultModel: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    suggestedModels: [
      "anthropic.claude-sonnet-4-5-20250929-v1:0",
      "anthropic.claude-haiku-4-5-20251001-v1:0",
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    ],
    description:
      "Claude (and other) models via the AWS Bedrock Converse API. Authenticate with a Bedrock API key (bearer token) + endpoint + region — like a company proxy/gateway — or with AWS access keys.",
    thinking: "budget",
    defaultThinkingBudget: 2048,
  },
];

export interface SpecOpsApi {
  version: string;
  openProject(): Promise<ProjectInfo | null>;
  listSpecs(projectPath: string): Promise<SpecInfo[]>;
  createSpec(projectPath: string, name: string): Promise<SpecInfo>;
  loadProject(projectPath: string): Promise<ProjectInfo | null>;
  getSession(): Promise<SessionState>;
  saveSession(session: SessionState): Promise<SessionState>;
  readChat(specPath: string): Promise<ChatHistory>;
  writeChat(specPath: string, history: ChatHistory): Promise<void>;
  readArtifacts(specPath: string): Promise<ArtifactFiles>;
  writeArtifact(
    specPath: string,
    artifact: keyof ArtifactFiles,
    content: string,
  ): Promise<void>;
  agentChat(request: AgentTurnRequest): Promise<AgentTurnResult>;
  onAgentEvent(callback: (event: AgentStreamEvent) => void): () => void;
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
  reviewTask(request: ReviewTaskRequest): Promise<ReviewTaskResult>;
  readProjectTree(specPath: string): Promise<FileNode[]>;
  readProjectFile(specPath: string, relPath: string): Promise<ProjectFileResult>;
  writeProjectFile(specPath: string, relPath: string, content: string): Promise<void>;
  generateCodeReview(request: GenerateCodeReviewRequest): Promise<CodeReviewReport>;
  reviewCode(request: CodeReviewRequest): Promise<CodeReviewResult>;
  runEditorAgent(request: EditorAgentRequest): Promise<EditorAgentResult>;
  stopEditorAgent(specPath: string): Promise<void>;
  startTestLoop(request: TestLoopRequest): Promise<void>;
  stopTestLoop(): Promise<void>;
  getTestLoopState(): Promise<TestLoopState>;
  onTestLoopUpdate(callback: (state: TestLoopState) => void): () => void;
  checkMerge(specPath: string): Promise<MergeCheckResult>;
  mergeToMain(specPath: string): Promise<MergeResult>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  quitAndInstallUpdate(): Promise<void>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<boolean>;
  closeWindow(): Promise<void>;
  isWindowMaximized(): Promise<boolean>;
  onMaximizedChange(callback: (maximized: boolean) => void): () => void;
  onCliChunk(callback: (data: { storyId: string; text: string }) => void): () => void;
}

declare global {
  interface Window {
    specops: SpecOpsApi;
  }
}

export {};
