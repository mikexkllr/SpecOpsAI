import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  GenerateIntegrationTestsResult,
  IntegrationRunResult,
  IntegrationTestFramework,
  PlaywrightStatus,
  UserStory,
} from "../../shared/api";

const FRAMEWORK_BADGE: Record<
  Exclude<IntegrationTestFramework, "generic">,
  { label: string; cls: string }
> = {
  playwright: { label: "Playwright", cls: "ok" },
  flutter: { label: "Flutter", cls: "info" },
  xcuitest: { label: "XCUITest", cls: "warn" },
  espresso: { label: "Espresso", cls: "magenta" },
};

const CONSOLE_MAX = 20_000;
const RUN_ALL = "__all__";

interface IntegrationTestsPanelProps {
  specPath: string;
  userStories: UserStory[];
  results: Record<string, GenerateIntegrationTestsResult>;
  busyId: string | null;
  onGenerate: (story: UserStory) => void;
}

export function IntegrationTestsPanel({
  specPath,
  userStories,
  results,
  busyId,
  onGenerate,
}: IntegrationTestsPanelProps): JSX.Element {
  const [status, setStatus] = useState<PlaywrightStatus | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  // Target of the run in flight: a repo-relative file, RUN_ALL, or null.
  const [running, setRunning] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<Record<string, IntegrationRunResult>>({});
  const [consoleText, setConsoleText] = useState("");
  const [showConsole, setShowConsole] = useState(false);
  const consoleRef = useRef<HTMLPreElement>(null);

  async function refreshStatus(): Promise<void> {
    setStatus(await window.specops.getPlaywrightStatus(specPath));
  }

  // Re-check on mount and whenever a generation finishes (new files on disk).
  useEffect(() => {
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specPath, results, busyId]);

  useEffect(() => {
    return window.specops.onIntegrationOutput(({ text }) => {
      setConsoleText((prev) => (prev + text).slice(-CONSOLE_MAX));
      setShowConsole(true);
    });
  }, []);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [consoleText, showConsole]);

  // Story id → playwright spec file, combining files discovered on disk with
  // fresh in-memory generation results.
  const fileByStory = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of status?.testFiles ?? []) {
      if (f.storyId) map.set(f.storyId, f.path);
    }
    for (const [storyId, res] of Object.entries(results)) {
      if (!res.error && res.framework === "playwright" && res.path) {
        map.set(storyId, res.path.split("\\").join("/"));
      }
    }
    return map;
  }, [status, results]);

  const playwrightReady = status !== null && status.installed && status.configPresent;

  async function setup(): Promise<void> {
    if (setupBusy || running) return;
    setSetupBusy(true);
    setSetupError(null);
    setConsoleText("");
    setShowConsole(true);
    try {
      const res = await window.specops.setupPlaywright(specPath);
      setStatus(res.status);
      if (res.error) setSetupError(res.error);
    } finally {
      setSetupBusy(false);
    }
  }

  async function run(file?: string): Promise<void> {
    if (running || setupBusy) return;
    const key = file ?? RUN_ALL;
    setRunning(key);
    setConsoleText("");
    setShowConsole(true);
    try {
      const res = await window.specops.runIntegrationTests({ specPath, file });
      setRunResults((m) => ({ ...m, [key]: res }));
    } finally {
      setRunning(null);
    }
  }

  if (userStories.length === 0) {
    return (
      <div className="empty-state">
        <div className="msg">
          no user stories detected. go back to the user stories phase and add some
          (headings like <code className="inline">## US-1: …</code> or bullets
          starting with <code className="inline">As a …</code>).
        </div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
      <div style={{ fontSize: "var(--fs-sm)", color: "var(--fg-2)", marginBottom: 14 }}>
        integration tests are derived from user stories and saved under{" "}
        <code className="inline">tests/integration/</code>. the Worker picks an
        appropriate stack (Playwright, Flutter, XCUITest, Espresso) from your spec
        or writes framework-agnostic Given/When/Then scenarios.
      </div>

      {/* Playwright runner: set up @playwright/test in the target project and run the specs */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div className="section-title" style={{ flex: 1 }}>
            playwright runner
          </div>
          {status === null ? (
            <span style={{ color: "var(--fg-2)", fontSize: "var(--fs-sm)" }}>checking…</span>
          ) : (
            <>
              <span className={`badge ${status.installed ? "ok" : "warn"}`}>
                {status.installed ? "@playwright/test installed" : "not installed"}
              </span>
              <span className={`badge ${status.configPresent ? "ok" : "warn"}`}>
                {status.configPresent ? "config present" : "no config"}
              </span>
              <span className="badge info">
                {status.testFiles.length} spec file{status.testFiles.length === 1 ? "" : "s"}
              </span>
            </>
          )}
          {status !== null && !playwrightReady && (
            <button
              className="btn btn-sm btn-primary"
              onClick={setup}
              disabled={setupBusy || running !== null}
              title="installs @playwright/test in the project, writes playwright.config.ts (baseURL + dev server), and downloads chromium"
            >
              {setupBusy ? "setting up…" : "set up playwright"}
            </button>
          )}
          {playwrightReady && (
            <button
              className="btn btn-sm btn-success"
              onClick={() => run()}
              disabled={running !== null || setupBusy || status.testFiles.length === 0}
              title="run every spec under tests/integration"
            >
              {running === RUN_ALL ? "running…" : "run all tests"}
            </button>
          )}
          {(running !== null || setupBusy) && (
            <button
              className="btn btn-sm btn-danger"
              onClick={() => void window.specops.stopIntegrationTests()}
              title="stop the current playwright process"
            >
              stop
            </button>
          )}
        </div>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--fg-2)", marginTop: 6 }}>
          the generated <code className="inline">playwright.config.ts</code> starts your dev
          server automatically (and reuses one already running, e.g. the preview tab).
        </div>
        {setupError && <div className="notice danger">setup failed: {setupError}</div>}
        <RunResultNotice result={runResults[RUN_ALL] ?? null} />
        {showConsole && (consoleText || running || setupBusy) && (
          <pre ref={consoleRef} className="runner-console">
            {consoleText || "(waiting for output…)"}
          </pre>
        )}
      </div>

      <div className="flex-col" style={{ gap: 10 }}>
        {userStories.map((story) => {
          const res = results[story.id] ?? null;
          const busy = busyId === story.id;
          const specFile = fileByStory.get(story.id) ?? null;
          const runKey = specFile ?? "";
          const runRes = specFile ? runResults[runKey] ?? null : null;
          return (
            <div key={story.id} className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--accent)", fontWeight: 600 }}>
                    {story.id}
                  </div>
                  <div style={{ fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--fg-0)" }}>
                    {story.title || "(untitled)"}
                  </div>
                </div>
                {specFile && (
                  <button
                    className="btn btn-sm btn-success"
                    onClick={() => run(specFile)}
                    disabled={running !== null || setupBusy || !playwrightReady}
                    title={
                      playwrightReady
                        ? `npx playwright test ${specFile}`
                        : "set up playwright first"
                    }
                  >
                    {running === specFile ? "running…" : "run"}
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  onClick={() => onGenerate(story)}
                  disabled={busyId !== null}
                  title="generate integration tests for this story"
                >
                  {busy ? "generating…" : res || specFile ? "regenerate" : "generate"}
                </button>
              </div>
              {story.body && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: "var(--fs-sm)",
                    color: "var(--fg-2)",
                    whiteSpace: "pre-wrap",
                    maxHeight: 90,
                    overflowY: "auto",
                  }}
                >
                  {story.body}
                </div>
              )}
              {!res && specFile && (
                <div style={{ marginTop: 8, fontSize: "var(--fs-xs)", color: "var(--fg-2)" }}>
                  existing spec: <code className="inline">{specFile}</code>
                </div>
              )}
              {res && (
                <div className={`notice ${res.error ? "danger" : "ok"}`}>
                  {res.error ? (
                    <div>integration test generation failed: {res.error}</div>
                  ) : (
                    <div className="grow">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span>
                          written to <code className="inline">{res.path}</code>
                        </span>
                        {res.framework !== "generic" && (
                          <span className={`badge ${FRAMEWORK_BADGE[res.framework].cls}`}>
                            {FRAMEWORK_BADGE[res.framework].label}
                          </span>
                        )}
                      </div>
                      {res.summary && (
                        <div style={{ marginTop: 4, color: "var(--fg-2)" }}>{res.summary}</div>
                      )}
                      {res.content && <pre className="code-block">{res.content}</pre>}
                    </div>
                  )}
                </div>
              )}
              <RunResultNotice result={runRes} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RunResultNotice({ result }: { result: IntegrationRunResult | null }): JSX.Element | null {
  const [showOutput, setShowOutput] = useState(false);
  if (!result) return null;
  const failed = !result.passed || result.error;
  return (
    <div className={`notice ${failed ? "danger" : "ok"}`}>
      <div className="grow">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>
            {result.error
              ? `run ${result.error}`
              : result.passed
                ? `tests passed in ${(result.duration / 1000).toFixed(1)}s`
                : `tests failed (exit ${result.exitCode}) after ${(result.duration / 1000).toFixed(1)}s`}
          </span>
          {result.output && (
            <button className="btn btn-sm" onClick={() => setShowOutput((v) => !v)}>
              {showOutput ? "hide output" : "output"}
            </button>
          )}
        </div>
        {(showOutput || (failed && !result.error)) && result.output && (
          <pre className="code-block">{result.output}</pre>
        )}
      </div>
    </div>
  );
}
