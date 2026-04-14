import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as path from "path";
import type { ArtifactFiles } from "../shared/api";
import {
  createSpec,
  listSpecs,
  openProject,
  readArtifacts,
  writeArtifact,
} from "./project";

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
