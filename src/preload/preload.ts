import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("specops", {
  version: "0.1.0",
});
