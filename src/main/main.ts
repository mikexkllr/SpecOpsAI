import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as path from "path";
import type {
  AgentTurnRequest,
  AppSettings,
  ArtifactFiles,
  GenerateIntegrationTestsRequest,
  GenerateUnitTestsRequest,
  SubAgentChatRequest,
  SubAgentDecomposeRequest,
  SubAgentRunTaskRequest,
  TaskStatus,
} from "../shared/api";
import { runAgentTurn } from "./agent";
import {
  createSpec,
  listSpecs,
  openProject,
  readArtifacts,
  writeArtifact,
} from "./project";
import { loadSettings, saveSettings } from "./settings";
import {
  decomposeStory,
  generateIntegrationTests,
  generateUnitTests,
  readSubAgents,
  resetSubAgent,
  runSubAgentTask,
  subAgentChat,
  updateTaskStatus,
} from "./subagent";

const isDev = !app.isPackaged;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function registerIpc(): void {
  ipcMain.handle("project:open", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select project folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return openProject(result.filePaths[0]);
  });

  ipcMain.handle("project:list-specs", (_e, projectPath: string) =>
    listSpecs(projectPath),
  );

  ipcMain.handle(
    "project:create-spec",
    (_e, projectPath: string, name: string) => createSpec(projectPath, name),
  );

  ipcMain.handle("spec:read", (_e, specPath: string) => readArtifacts(specPath));

  ipcMain.handle(
    "spec:write",
    (_e, specPath: string, artifact: keyof ArtifactFiles, content: string) =>
      writeArtifact(specPath, artifact, content),
  );

  ipcMain.handle("agent:chat", (_e, request: AgentTurnRequest) =>
    runAgentTurn(request),
  );

  ipcMain.handle("subagent:read", (_e, specPath: string) =>
    readSubAgents(specPath),
  );
  ipcMain.handle(
    "subagent:decompose",
    (_e, request: SubAgentDecomposeRequest) => decomposeStory(request),
  );
  ipcMain.handle("subagent:chat", (_e, request: SubAgentChatRequest) =>
    subAgentChat(request),
  );
  ipcMain.handle("subagent:run-task", (_e, request: SubAgentRunTaskRequest) =>
    runSubAgentTask(request),
  );
  ipcMain.handle(
    "subagent:update-task",
    (_e, specPath: string, storyId: string, taskId: string, status: TaskStatus) =>
      updateTaskStatus(specPath, storyId, taskId, status),
  );
  ipcMain.handle("subagent:reset", (_e, specPath: string, storyId: string) =>
    resetSubAgent(specPath, storyId),
  );
  ipcMain.handle(
    "subagent:generate-unit-tests",
    (_e, request: GenerateUnitTestsRequest) => generateUnitTests(request),
  );
  ipcMain.handle(
    "subagent:generate-integration-tests",
    (_e, request: GenerateIntegrationTestsRequest) =>
      generateIntegrationTests(request),
  );

  ipcMain.handle("settings:get", () => loadSettings());
  ipcMain.handle("settings:save", (_e, settings: AppSettings) =>
    saveSettings(settings),
  );
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
