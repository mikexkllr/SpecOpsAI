import { contextBridge, ipcRenderer } from "electron";
import type { ArtifactFiles, SpecOpsApi } from "../shared/api";

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
  updateTaskStatus: (specPath, storyId, taskId, status) =>
    ipcRenderer.invoke("subagent:update-task", specPath, storyId, taskId, status),
  resetSubAgent: (specPath, storyId) =>
    ipcRenderer.invoke("subagent:reset", specPath, storyId),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
};

contextBridge.exposeInMainWorld("specops", api);
