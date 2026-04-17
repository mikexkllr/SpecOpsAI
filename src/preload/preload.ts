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
  readWorkers: (specPath) => ipcRenderer.invoke("worker:read", specPath),
  decomposeStory: (request) => ipcRenderer.invoke("worker:decompose", request),
  workerChat: (request) => ipcRenderer.invoke("worker:chat", request),
  runWorkerTask: (request) => ipcRenderer.invoke("worker:run-task", request),
  updateTaskStatus: (specPath, storyId, taskId, status) =>
    ipcRenderer.invoke("worker:update-task", specPath, storyId, taskId, status),
  resetWorker: (specPath, storyId) =>
    ipcRenderer.invoke("worker:reset", specPath, storyId),
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
};

contextBridge.exposeInMainWorld("specops", api);
