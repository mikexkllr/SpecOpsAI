import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { DevServerEvent, DevServerState, PreviewInfo } from "../shared/api";
import { loadSettings } from "./settings";
import { devServerUrlFromOutput, projectRoot, scriptPort } from "./utils";

// ---------------------------------------------------------------------------
// App preview backend: detect whether the generated project is web-based, and
// manage a single dev-server process whose output/URL feed the internal
// browser (<webview>) in the renderer.

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as PackageJson;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Framework detection ordered by specificity — the first dependency hit wins.
// Port is the framework's default dev port, used as the URL guess when the
// script itself doesn't name one.
const FRAMEWORKS: Array<{ dep: RegExp; label: string; port: number }> = [
  { dep: /^next$/, label: "next", port: 3000 },
  { dep: /^nuxt3?$/, label: "nuxt", port: 3000 },
  { dep: /^@remix-run\//, label: "remix", port: 3000 },
  { dep: /^astro$/, label: "astro", port: 4321 },
  { dep: /^@angular\//, label: "angular", port: 4200 },
  { dep: /^@sveltejs\/kit$/, label: "sveltekit", port: 5173 },
  { dep: /^react-scripts$/, label: "create-react-app", port: 3000 },
  { dep: /^vite$/, label: "vite", port: 5173 },
  { dep: /^(express|fastify|koa|hono)$/, label: "node server", port: 3000 },
];

// Deps that mark a project as web-based even without a recognized framework.
const WEB_HINT = /^(react|react-dom|vue|svelte|preact|solid-js|lit)$/;

export async function detectPreview(specPath: string): Promise<PreviewInfo> {
  const root = projectRoot(specPath);
  const settings = await loadSettings();
  const pkg = await readPackageJson(root);

  if (!pkg) {
    // No package.json — a bare index.html can still be previewed straight from disk.
    try {
      const indexPath = path.join(root, "index.html");
      await fs.access(indexPath);
      return {
        webBased: true,
        framework: "static html",
        url: settings.devServerUrl || pathToFileURL(indexPath).toString(),
        reason: "index.html found at the project root",
      };
    } catch {
      return {
        webBased: false,
        reason: "no package.json or index.html at the project root",
      };
    }
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const depNames = Object.keys(deps);
  const hit = FRAMEWORKS.find((f) => depNames.some((d) => f.dep.test(d)));
  const hasWebHint = depNames.some((d) => WEB_HINT.test(d));

  const scripts = pkg.scripts ?? {};
  const scriptName = ["dev", "start", "serve", "preview"].find((s) => scripts[s]);
  const command = scriptName
    ? scriptName === "start"
      ? "npm start"
      : `npm run ${scriptName}`
    : undefined;

  if (!hit && !hasWebHint) {
    return {
      webBased: false,
      command,
      reason: "no web framework found in package.json dependencies",
    };
  }

  const port = scriptPort(scriptName ? scripts[scriptName] : undefined) ?? hit?.port ?? 3000;
  return {
    webBased: true,
    framework: hit?.label ?? "web app",
    command,
    url: settings.devServerUrl || `http://localhost:${port}`,
    reason: hit
      ? `detected ${hit.label} in package.json`
      : "web dependencies found in package.json",
  };
}

// --- managed dev-server process --------------------------------------------

const OUTPUT_TAIL_MAX = 20_000;
const URL_PROBE_INTERVAL_MS = 1500;
const URL_PROBE_MAX_MS = 5 * 60_000;

let state: DevServerState = { phase: "stopped" };
let child: ChildProcess | null = null;
let probeTimer: NodeJS.Timeout | null = null;
let probeStartedAt = 0;
let stopping = false;
let outputTail = "";

let listener: ((event: DevServerEvent) => void) | null = null;

export function onDevServerEvent(cb: (event: DevServerEvent) => void): () => void {
  listener = cb;
  return () => {
    if (listener === cb) listener = null;
  };
}

function emitStatus(patch: Partial<DevServerState>): void {
  state = { ...state, ...patch };
  listener?.({ kind: "status", state });
}

function emitOutput(text: string): void {
  outputTail = (outputTail + text).slice(-OUTPUT_TAIL_MAX);
  listener?.({ kind: "output", text });
}

export function getDevServerState(): DevServerState {
  return state;
}

function clearProbe(): void {
  if (probeTimer) clearInterval(probeTimer);
  probeTimer = null;
}

// Fallback for servers that never print their URL: poll the guessed URL until
// it answers. Any HTTP response (even a 404) means something is listening.
function startProbe(guessUrl: string): void {
  clearProbe();
  probeStartedAt = Date.now();
  probeTimer = setInterval(() => {
    if (state.phase !== "starting") return clearProbe();
    if (Date.now() - probeStartedAt > URL_PROBE_MAX_MS) {
      clearProbe();
      emitStatus({
        phase: "error",
        error:
          "Could not detect the dev server URL — check the server log, or set a Dev server URL in Settings.",
      });
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1000);
    fetch(guessUrl, { signal: ac.signal })
      .then(() => {
        clearTimeout(t);
        if (state.phase === "starting") {
          clearProbe();
          emitStatus({ phase: "running", url: guessUrl });
        }
      })
      .catch(() => clearTimeout(t));
  }, URL_PROBE_INTERVAL_MS);
}

function killTree(proc: ChildProcess): void {
  if (proc.exitCode !== null || proc.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
    } else {
      // Negative pid signals the whole process group (spawned detached below),
      // so `npm run dev` children (vite, next…) die with the shell.
      process.kill(-proc.pid, "SIGTERM");
    }
  } catch {
    try {
      proc.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
}

export async function startDevServer(specPath: string): Promise<DevServerState> {
  const root = projectRoot(specPath);

  if (child && state.projectRoot === root && (state.phase === "running" || state.phase === "starting")) {
    return state;
  }
  await stopDevServer();

  const info = await detectPreview(specPath);
  if (!info.webBased) {
    emitStatus({
      phase: "error",
      projectRoot: root,
      error: info.reason ?? "project does not look web-based",
    });
    return state;
  }

  // Static site: nothing to run — the webview loads the file:// URL directly.
  if (!info.command) {
    if (info.url) {
      emitStatus({ phase: "running", url: info.url, command: undefined, projectRoot: root, error: undefined });
      return state;
    }
    emitStatus({
      phase: "error",
      projectRoot: root,
      error: "no dev/start script found in package.json",
    });
    return state;
  }

  outputTail = "";
  stopping = false;
  emitStatus({
    phase: "starting",
    url: undefined,
    command: info.command,
    projectRoot: root,
    error: undefined,
  });
  emitOutput(`$ ${info.command}\n`);

  const proc = spawn(info.command, {
    cwd: root,
    shell: true,
    detached: process.platform !== "win32",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", BROWSER: "none" },
  });
  child = proc;

  const onChunk = (chunk: Buffer): void => {
    const text = chunk.toString("utf8");
    emitOutput(text);
    if (state.phase === "starting") {
      const url = devServerUrlFromOutput(text);
      if (url) {
        clearProbe();
        emitStatus({ phase: "running", url });
      }
    }
  };
  proc.stdout?.on("data", onChunk);
  proc.stderr?.on("data", onChunk);

  proc.on("exit", (code) => {
    if (child !== proc) return;
    child = null;
    clearProbe();
    if (stopping) {
      emitStatus({ phase: "stopped", url: undefined, error: undefined });
    } else {
      emitStatus({
        phase: "error",
        url: undefined,
        error: `dev server exited with code ${code ?? "?"} — see the server log`,
      });
    }
  });

  proc.on("error", (err) => {
    if (child !== proc) return;
    child = null;
    clearProbe();
    emitStatus({ phase: "error", error: err.message });
  });

  if (info.url) startProbe(info.url);
  return state;
}

export async function stopDevServer(): Promise<DevServerState> {
  clearProbe();
  const proc = child;
  if (!proc) {
    if (state.phase !== "stopped") emitStatus({ phase: "stopped", url: undefined, error: undefined });
    return state;
  }
  stopping = true;
  killTree(proc);
  // Escalate if the group ignores SIGTERM; the exit handler emits "stopped".
  setTimeout(() => {
    if (child === proc && proc.exitCode === null) {
      try {
        if (proc.pid !== undefined && process.platform !== "win32") process.kill(-proc.pid, "SIGKILL");
        else proc.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
  }, 3000).unref();
  emitStatus({ phase: "stopped", url: undefined, error: undefined });
  child = null;
  return state;
}

export function getDevServerOutputTail(): string {
  return outputTail;
}

// Called on app quit so no orphaned dev server keeps the port busy.
export function disposeDevServer(): void {
  const proc = child;
  if (proc) {
    stopping = true;
    killTree(proc);
    child = null;
  }
  clearProbe();
}
