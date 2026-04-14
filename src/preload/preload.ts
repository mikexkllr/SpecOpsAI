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
};

contextBridge.exposeInMainWorld("specops", api);
