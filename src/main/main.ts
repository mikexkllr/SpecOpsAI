import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as path from "path";
import type {
  AgentTurnRequest,
  AppSettings,
  ArtifactFiles,
  GenerateIntegrationTestsRequest,
  GenerateUnitTestsRequest,
  TaskStatus,
  TestLoopRequest,
  WorkerChatRequest,
  WorkerDecomposeRequest,
  WorkerRunTaskRequest,
} from "../shared/api";
import { runAgentTurn } from "./agent";
import {
  checkMergeReadiness,
  createSpec,
  listSpecs,
  mergeSpecToMain,
  openProject,
  readArtifacts,
  writeArtifact,
} from "./project";
import { loadSettings, saveSettings } from "./settings";
import {
  decomposeStory,
  generateIntegrationTests,
  generateUnitTests,
  readWorkers,
  resetWorker,
  runWorkerTask,
  updateTaskStatus,
  workerChat,
} from "./worker";
import {
  getTestLoopState,
  onTestLoopUpdate,
  startTestLoop,
  stopTestLoop,
} from "./test-loop";

const isDev = !app.isPackaged;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: "#0b0b0c",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on("maximize", () => win.webContents.send("window:maximized", true));
  win.on("unmaximize", () => win.webContents.send("window:maximized", false));

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function getFocusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
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

  ipcMain.handle("worker:read", (_e, specPath: string) =>
    readWorkers(specPath),
  );
  ipcMain.handle(
    "worker:decompose",
    (_e, request: WorkerDecomposeRequest) => decomposeStory(request),
  );
  ipcMain.handle("worker:chat", (_e, request: WorkerChatRequest) =>
    workerChat(request),
  );
  ipcMain.handle("worker:run-task", (_e, request: WorkerRunTaskRequest) =>
    runWorkerTask(request),
  );
  ipcMain.handle(
    "worker:update-task",
    (_e, specPath: string, storyId: string, taskId: string, status: TaskStatus) =>
      updateTaskStatus(specPath, storyId, taskId, status),
  );
  ipcMain.handle("worker:reset", (_e, specPath: string, storyId: string) =>
    resetWorker(specPath, storyId),
  );
  ipcMain.handle(
    "worker:generate-unit-tests",
    (_e, request: GenerateUnitTestsRequest) => generateUnitTests(request),
  );
  ipcMain.handle(
    "worker:generate-integration-tests",
    (_e, request: GenerateIntegrationTestsRequest) =>
      generateIntegrationTests(request),
  );

  ipcMain.handle("testloop:start", (_e, request: TestLoopRequest) =>
    startTestLoop(request),
  );
  ipcMain.handle("testloop:stop", () => stopTestLoop());
  ipcMain.handle("testloop:state", () => getTestLoopState());

  ipcMain.handle("merge:check", (_e, specPath: string) =>
    checkMergeReadiness(specPath, getTestLoopState()),
  );
  ipcMain.handle("merge:run", (_e, specPath: string) =>
    mergeSpecToMain(specPath, getTestLoopState()),
  );

  ipcMain.handle("settings:get", () => loadSettings());
  ipcMain.handle("settings:save", (_e, settings: AppSettings) =>
    saveSettings(settings),
  );

  ipcMain.handle("window:minimize", () => getFocusedWindow()?.minimize());
  ipcMain.handle("window:toggle-maximize", () => {
    const win = getFocusedWindow();
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle("window:close", () => getFocusedWindow()?.close());
  ipcMain.handle("window:is-maximized", () => getFocusedWindow()?.isMaximized() ?? false);
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  onTestLoopUpdate((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("testloop:update", state);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
