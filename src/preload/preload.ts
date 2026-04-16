import { contextBridge, ipcRenderer } from "electron";
import type { ArtifactFiles, SpecOpsApi, TestLoopState } from "../shared/api";

const api: SpecOpsApi = {
  version: "0.1.0",
  openProject: () => ipcRenderer.invoke("project:open"),
  listSpecs: (projectPath) => ipcRenderer.invoke("project:list-specs", projectPath),
  createSpec: (projectPath, name) =>
    ipcRenderer.invoke("project:create-spec", projectPath, name),
  readArtifacts: (specPath) => ipcRenderer.invoke("spec:read", specPath),
  writeArtifact: (specPath, artifact: keyof ArtifactFiles, content) =>
    ipcRenderer.invoke("spec:write", specPath, artifact, content),
  agentChat: (request) => ipcRenderer.invoke("agent:chat", request),
  readSubAgents: (specPath) => ipcRenderer.invoke("subagent:read", specPath),
  decomposeStory: (request) => ipcRenderer.invoke("subagent:decompose", request),
  subAgentChat: (request) => ipcRenderer.invoke("subagent:chat", request),
  runSubAgentTask: (request) => ipcRenderer.invoke("subagent:run-task", request),
  updateTaskStatus: (specPath, storyId, taskId, status) =>
    ipcRenderer.invoke("subagent:update-task", specPath, storyId, taskId, status),
  resetSubAgent: (specPath, storyId) =>
    ipcRenderer.invoke("subagent:reset", specPath, storyId),
  generateUnitTests: (request) =>
    ipcRenderer.invoke("subagent:generate-unit-tests", request),
  generateIntegrationTests: (request) =>
    ipcRenderer.invoke("subagent:generate-integration-tests", request),
  startTestLoop: (request) => ipcRenderer.invoke("testloop:start", request),
  stopTestLoop: () => ipcRenderer.invoke("testloop:stop"),
  getTestLoopState: () => ipcRenderer.invoke("testloop:state"),
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
};

contextBridge.exposeInMainWorld("specops", api);
