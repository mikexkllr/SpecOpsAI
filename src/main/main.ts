import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage } from "electron";
import * as path from "path";
import type {
  AgentTurnRequest,
  AppSettings,
  ArtifactFiles,
  ChatHistory,
  CodeReviewRequest,
  EditorAgentRequest,
  GenerateCodeReviewRequest,
  GenerateIntegrationTestsRequest,
  GenerateUnitTestsRequest,
  ReviewTaskRequest,
  SessionState,
  TaskStatus,
  TestLoopRequest,
  WorkerChatRequest,
  WorkerDecomposeRequest,
  WorkerRunTaskRequest,
} from "../shared/api";
import { runAgentTurn, onAgentEvent } from "./agent";
import {
  checkMergeReadiness,
  createSpec,
  listSpecs,
  loadProject,
  mergeSpecToMain,
  openProject,
  readArtifacts,
  writeArtifact,
} from "./project";
import { loadSession, saveSession } from "./session";
import { readChat, writeChat } from "./chat";
import { loadSettings, saveSettings } from "./settings";
import {
  decomposeStory,
  generateIntegrationTests,
  generateUnitTests,
  readWorkers,
  resetWorker,
  runWorkerTask,
  stopWorker,
  updateTaskStatus,
  workerChat,
} from "./worker";
import {
  getTestLoopState,
  onTestLoopUpdate,
  startTestLoop,
  stopTestLoop,
} from "./test-loop";
import { onCliChunk } from "./cliAgent";
import { runReviewerAgent, runCodeReview, generateCodeReview } from "./reviewer";
import { readProjectTree, readProjectFile, writeProjectFile } from "./codeFiles";
import { runEditorAgent } from "./editorAgent";

const isDev = !app.isPackaged;

// Branding: replace the default "Electron" name/icon in the menu bar, dock,
// and cmd-tab switcher. Set the name as early as possible (before `whenReady`)
// so the macOS application menu and dock pick it up even in dev, where the
// running binary is still `Electron`.
const APP_NAME = "SpecOps";
app.setName(APP_NAME);
// `app.name` (the setter) is what the default application menu reads for the
// first menu's title; setting both is the reliable way to drop "Electron".
app.name = APP_NAME;

const iconPath = path.join(app.getAppPath(), "assets/icon.png");
const appIcon = nativeImage.createFromPath(iconPath);

// A custom application menu whose first item is labelled with APP_NAME — in
// dev the default menu would otherwise title the app menu "Electron".
function buildAppMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: "#0b0b0c",
    title: APP_NAME,
    icon: appIcon,
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

  ipcMain.handle("project:load", (_e, projectPath: string) =>
    loadProject(projectPath),
  );

  ipcMain.handle("project:list-specs", (_e, projectPath: string) =>
    listSpecs(projectPath),
  );

  ipcMain.handle("session:get", () => loadSession());
  ipcMain.handle("session:save", (_e, session: SessionState) =>
    saveSession(session),
  );

  ipcMain.handle("chat:read", (_e, specPath: string) => readChat(specPath));
  ipcMain.handle(
    "chat:write",
    (_e, specPath: string, history: ChatHistory) => writeChat(specPath, history),
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
  ipcMain.handle("worker:stop", (_e, specPath: string, storyId: string) => {
    stopWorker(specPath, storyId);
  });
  ipcMain.handle(
    "worker:generate-unit-tests",
    (_e, request: GenerateUnitTestsRequest) => generateUnitTests(request),
  );
  ipcMain.handle(
    "worker:generate-integration-tests",
    (_e, request: GenerateIntegrationTestsRequest) =>
      generateIntegrationTests(request),
  );

  ipcMain.handle("worker:review-task", async (_e, request: ReviewTaskRequest) => {
    const settings = await loadSettings();
    return runReviewerAgent({
      specPath: request.specPath,
      story: request.story,
      task: request.task,
      artifacts: request.artifacts,
      devServerUrl: settings.devServerUrl,
    });
  });

  ipcMain.handle("code:tree", (_e, specPath: string) => readProjectTree(specPath));
  ipcMain.handle("code:read", (_e, specPath: string, relPath: string) =>
    readProjectFile(specPath, relPath),
  );
  ipcMain.handle(
    "code:write",
    (_e, specPath: string, relPath: string, content: string) =>
      writeProjectFile(specPath, relPath, content),
  );
  ipcMain.handle("code:generate-review", (_e, request: GenerateCodeReviewRequest) =>
    generateCodeReview(request),
  );
  ipcMain.handle("code:review", (_e, request: CodeReviewRequest) =>
    runCodeReview(request),
  );
  ipcMain.handle("code:editor-agent", (_e, request: EditorAgentRequest) =>
    runEditorAgent(request),
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
  if (process.platform === "darwin" && !appIcon.isEmpty()) {
    app.dock?.setIcon(appIcon);
  }
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
  });
  buildAppMenu();
  registerIpc();
  createWindow();

  onTestLoopUpdate((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("testloop:update", state);
    }
  });

  onCliChunk((storyId, text) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("worker:cli-chunk", { storyId, text });
    }
  });

  onAgentEvent((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("agent:event", event);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
