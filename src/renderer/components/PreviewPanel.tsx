import React, { useEffect, useRef, useState } from "react";
import type { DevServerState, PreviewInfo } from "../../shared/api";

// Internal browser for web-based projects: manages the project's dev server in
// the main process and renders the app in an Electron <webview>, with a URL
// bar, reload, responsive width presets, and the server log.

// Minimal surface of Electron's WebviewTag we actually use — React's DOM types
// already declare the <webview> intrinsic element; this adds its methods
// without pulling Electron's Node-flavoured types into the renderer tsconfig.
type WebviewElement = HTMLElement & {
  src: string;
  reload(): void;
  goBack(): void;
  goForward(): void;
  getURL(): string;
};

const DEVICE_WIDTHS: Record<string, number | undefined> = {
  desktop: undefined, // full width
  tablet: 768,
  mobile: 390,
};

const LOG_MAX = 20_000;

interface PreviewPanelProps {
  specPath: string;
}

// specPath is <project>/<specs-dir>/<spec-id> — the project root is two up.
// Mirrors projectRoot() in the main process, for comparing dev-server state.
function rootFromSpecPath(specPath: string): string {
  const parts = specPath.split(/[\\/]/).filter(Boolean);
  const prefix = specPath.startsWith("/") ? "/" : "";
  return prefix + parts.slice(0, -2).join("/");
}

export function PreviewPanel({ specPath }: PreviewPanelProps): JSX.Element {
  const [info, setInfo] = useState<PreviewInfo | null>(null);
  const [server, setServer] = useState<DevServerState>({ phase: "stopped" });
  const [serverBusy, setServerBusy] = useState(false);
  const [log, setLog] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [src, setSrc] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const webviewRef = useRef<WebviewElement | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setSrc(null);
    setLog("");
    void window.specops.detectPreview(specPath).then((i) => {
      if (cancelled) return;
      setInfo(i);
      if (i.url) setUrlDraft(i.url);
    });
    void window.specops.getDevServerState().then((s) => {
      if (cancelled) return;
      setServer(s);
      // Re-attach to a server that is already running for this project.
      if (s.phase === "running" && s.url && s.projectRoot === rootFromSpecPath(specPath)) {
        setSrc(s.url);
        setUrlDraft(s.url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [specPath]);

  useEffect(() => {
    return window.specops.onDevServerEvent((event) => {
      if (event.kind === "output") {
        setLog((prev) => (prev + event.text).slice(-LOG_MAX));
      } else {
        setServer(event.state);
        if (event.state.phase === "running" && event.state.url) {
          setSrc(event.state.url);
          setUrlDraft(event.state.url);
        }
      }
    });
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log, showLog]);

  // Keep the URL bar in sync when the user clicks links inside the preview.
  useEffect(() => {
    const view = webviewRef.current;
    if (!view || src === null) return;
    const onNavigate = (): void => {
      try {
        setUrlDraft(view.getURL());
      } catch {
        // webview not ready yet
      }
    };
    view.addEventListener("did-navigate", onNavigate);
    view.addEventListener("did-navigate-in-page", onNavigate);
    return () => {
      view.removeEventListener("did-navigate", onNavigate);
      view.removeEventListener("did-navigate-in-page", onNavigate);
    };
  }, [src]);

  async function startServer(): Promise<void> {
    if (serverBusy) return;
    setServerBusy(true);
    setShowLog(true);
    try {
      setServer(await window.specops.startDevServer(specPath));
    } finally {
      setServerBusy(false);
    }
  }

  async function stopServer(): Promise<void> {
    if (serverBusy) return;
    setServerBusy(true);
    try {
      setServer(await window.specops.stopDevServer());
    } finally {
      setServerBusy(false);
    }
  }

  function navigate(): void {
    const raw = urlDraft.trim();
    if (!raw) return;
    const url = /^(https?|file):\/\//.test(raw) ? raw : `http://${raw}`;
    setUrlDraft(url);
    if (url === src) {
      try {
        webviewRef.current?.reload();
      } catch {
        // ignore
      }
    } else {
      setSrc(url);
    }
  }

  function reload(): void {
    try {
      webviewRef.current?.reload();
    } catch {
      // ignore
    }
  }

  const running = server.phase === "running";
  const starting = server.phase === "starting";
  const width = DEVICE_WIDTHS[device];

  return (
    <div className="preview-view">
      <div className="preview-toolbar">
        {info?.command && (
          <>
            <span
              className={`preview-dot ${running ? "ok" : starting ? "warn" : server.phase === "error" ? "danger" : ""}`}
              title={`dev server: ${server.phase}`}
            />
            {running || starting ? (
              <button className="btn btn-sm btn-danger" onClick={stopServer} disabled={serverBusy}>
                stop server
              </button>
            ) : (
              <button
                className="btn btn-sm btn-primary"
                onClick={startServer}
                disabled={serverBusy}
                title={`runs \`${info.command}\` in the project root`}
              >
                {serverBusy ? "starting…" : "start dev server"}
              </button>
            )}
          </>
        )}
        <input
          className="preview-url"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate();
          }}
          placeholder="http://localhost:3000"
          spellCheck={false}
        />
        <button className="btn btn-sm" onClick={navigate} title="load URL">
          go
        </button>
        <button className="btn-icon" onClick={reload} title="reload" disabled={src === null}>
          ⟳
        </button>
        <button
          className="btn-icon"
          onClick={() => src && void window.specops.openExternal(src)}
          title="open in system browser"
          disabled={src === null || !src.startsWith("http")}
        >
          ↗
        </button>
        <div className="preview-devices">
          {(["desktop", "tablet", "mobile"] as const).map((d) => (
            <button
              key={d}
              className={`preview-device${device === d ? " active" : ""}`}
              onClick={() => setDevice(d)}
              title={DEVICE_WIDTHS[d] ? `${DEVICE_WIDTHS[d]}px wide` : "full width"}
            >
              {d === "desktop" ? "🖥" : d === "tablet" ? "▤" : "▯"}
            </button>
          ))}
        </div>
        {info?.command && (
          <button
            className={`btn btn-sm${showLog ? " btn-ghost" : ""}`}
            onClick={() => setShowLog((v) => !v)}
          >
            {showLog ? "hide log" : "server log"}
          </button>
        )}
      </div>

      <div className="preview-body">
        {src ? (
          <div className="preview-frame-wrap">
            <webview
              ref={(el: HTMLWebViewElement | null) => {
                webviewRef.current = el as WebviewElement | null;
              }}
              src={src}
              className="preview-webview"
              style={width ? { width, alignSelf: "center" } : undefined}
            />
          </div>
        ) : (
          <PreviewEmpty
            info={info}
            server={server}
            busy={serverBusy}
            onStart={startServer}
            onOpenUrl={(u) => {
              setSrc(u);
              setUrlDraft(u);
            }}
          />
        )}
        {showLog && (
          <pre ref={logRef} className="preview-logs">
            {log || "(no server output yet)"}
          </pre>
        )}
      </div>
    </div>
  );
}

function PreviewEmpty({
  info,
  server,
  busy,
  onStart,
  onOpenUrl,
}: {
  info: PreviewInfo | null;
  server: DevServerState;
  busy: boolean;
  onStart: () => void;
  onOpenUrl: (url: string) => void;
}): JSX.Element {
  if (!info) {
    return (
      <div className="empty-state">
        <div className="msg">detecting project type…</div>
      </div>
    );
  }
  if (!info.webBased) {
    return (
      <div className="empty-state">
        <div className="msg" style={{ maxWidth: 520 }}>
          this project doesn&rsquo;t look web-based ({info.reason ?? "no web framework detected"}),
          so there&rsquo;s nothing to preview here. if it actually serves a UI, set a{" "}
          <b>dev server URL</b> in settings or enter one in the URL bar above.
        </div>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <div className="msg" style={{ maxWidth: 560 }}>
        <div style={{ marginBottom: 6 }}>
          {info.framework && <span className="badge info">{info.framework}</span>}
        </div>
        <div style={{ marginBottom: 12 }}>
          web app detected{info.reason ? ` (${info.reason})` : ""}.
          {info.command ? (
            <>
              {" "}
              start the dev server (<code className="inline">{info.command}</code>) and the
              preview opens automatically when it&rsquo;s reachable.
            </>
          ) : (
            " it can be previewed straight from disk."
          )}
        </div>
        {info.command ? (
          <button className="btn btn-primary" onClick={onStart} disabled={busy || server.phase === "starting"}>
            {server.phase === "starting" ? "starting…" : "start dev server & preview"}
          </button>
        ) : info.url ? (
          <button className="btn btn-primary" onClick={() => onOpenUrl(info.url!)}>
            open preview
          </button>
        ) : null}
        {server.phase === "starting" && (
          <div style={{ marginTop: 10, color: "var(--fg-2)", fontSize: "var(--fs-sm)" }}>
            waiting for the server to come up — watch the server log below.
          </div>
        )}
        {server.phase === "error" && server.error && (
          <div className="notice danger" style={{ marginTop: 10 }}>
            {server.error}
          </div>
        )}
      </div>
    </div>
  );
}
