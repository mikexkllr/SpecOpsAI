import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentStreamEvent,
  ArtifactFiles,
  SpecOpsApi,
  TestLoopState,
} from "../shared/api";

const api: SpecOpsApi = {
  version: "0.1.0",
  openProject: () => ipcRenderer.invoke("project:open"),
  loadProject: (projectPath) => ipcRenderer.invoke("project:load", projectPath),
  listSpecs: (projectPath) => ipcRenderer.invoke("project:list-specs", projectPath),
  getSession: () => ipcRenderer.invoke("session:get"),
  saveSession: (session) => ipcRenderer.invoke("session:save", session),
  readChat: (specPath) => ipcRenderer.invoke("chat:read", specPath),
  writeChat: (specPath, history) =>
    ipcRenderer.invoke("chat:write", specPath, history),
  createSpec: (projectPath, name) =>
    ipcRenderer.invoke("project:create-spec", projectPath, name),
  readArtifacts: (specPath) => ipcRenderer.invoke("spec:read", specPath),
  writeArtifact: (specPath, artifact: keyof ArtifactFiles, content) =>
    ipcRenderer.invoke("spec:write", specPath, artifact, content),
  agentChat: (request) => ipcRenderer.invoke("agent:chat", request),
  onAgentEvent: (callback: (event: AgentStreamEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: AgentStreamEvent) =>
      callback(event);
    ipcRenderer.on("agent:event", handler);
    return () => {
      ipcRenderer.removeListener("agent:event", handler);
    };
  },
  readWorkers: (specPath) => ipcRenderer.invoke("worker:read", specPath),
  decomposeStory: (request) => ipcRenderer.invoke("worker:decompose", request),
  workerChat: (request) => ipcRenderer.invoke("worker:chat", request),
  runWorkerTask: (request) => ipcRenderer.invoke("worker:run-task", request),
  updateTaskStatus: (specPath, storyId, taskId, status) =>
    ipcRenderer.invoke("worker:update-task", specPath, storyId, taskId, status),
  resetWorker: (specPath, storyId) =>
    ipcRenderer.invoke("worker:reset", specPath, storyId),
  stopWorker: (specPath, storyId) =>
    ipcRenderer.invoke("worker:stop", specPath, storyId),
  reviewTask: (request) => ipcRenderer.invoke("worker:review-task", request),
  readProjectTree: (specPath) => ipcRenderer.invoke("code:tree", specPath),
  readProjectFile: (specPath, relPath) =>
    ipcRenderer.invoke("code:read", specPath, relPath),
  writeProjectFile: (specPath, relPath, content) =>
    ipcRenderer.invoke("code:write", specPath, relPath, content),
  generateCodeReview: (request) => ipcRenderer.invoke("code:generate-review", request),
  reviewCode: (request) => ipcRenderer.invoke("code:review", request),
  generateUnitTests: (request) =>
    ipcRenderer.invoke("worker:generate-unit-tests", request),
  generateIntegrationTests: (request) =>
    ipcRenderer.invoke("worker:generate-integration-tests", request),
  startTestLoop: (request) => ipcRenderer.invoke("testloop:start", request),
  stopTestLoop: () => ipcRenderer.invoke("testloop:stop"),
  getTestLoopState: () => ipcRenderer.invoke("testloop:state"),
  checkMerge: (specPath) => ipcRenderer.invoke("merge:check", specPath),
  mergeToMain: (specPath) => ipcRenderer.invoke("merge:run", specPath),
  onTestLoopUpdate: (callback: (state: TestLoopState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: TestLoopState) =>
      callback(state);
    ipcRenderer.on("testloop:update", handler);
    return () => {
      ipcRenderer.removeListener("testloop:update", handler);
    };
  },
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
      callback(maximized);
    ipcRenderer.on("window:maximized", handler);
    return () => {
      ipcRenderer.removeListener("window:maximized", handler);
    };
  },
  onCliChunk: (callback: (data: { storyId: string; text: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { storyId: string; text: string }) =>
      callback(data);
    ipcRenderer.on("worker:cli-chunk", handler);
    return () => {
      ipcRenderer.removeListener("worker:cli-chunk", handler);
    };
  },
};

contextBridge.exposeInMainWorld("specops", api);
