import React from "react";
import type {
  MergeCheckResult,
  MergeResult,
  TestLoopState,
  TestLoopStatus,
} from "../../shared/api";

const TESTLOOP_STATUS_LABEL: Record<TestLoopStatus, string> = {
  idle: "ready to run",
  "running-tests": "running tests…",
  analyzing: "analyzing failures…",
  fixing: "applying fix…",
  passed: "all tests passed",
  "max-iterations": "max iterations reached — failures remain",
  error: "error",
  stopped: "stopped",
};

function testLoopStatusClass(status: TestLoopStatus): string {
  switch (status) {
    case "passed":
      return "ok";
    case "error":
    case "stopped":
      return "danger";
    case "max-iterations":
      return "warn";
    default:
      return "info";
  }
}

function MergePanel({
  testsPassed,
  check,
  result,
  busy,
  onCheck,
  onMerge,
}: {
  testsPassed: boolean;
  check: MergeCheckResult | null;
  result: MergeResult | null;
  busy: "check" | "merge" | null;
  onCheck: () => void;
  onMerge: () => void;
}): JSX.Element {
  const ready = check?.ready ?? false;
  const merged = result?.ok ?? false;

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div className="section-title" style={{ flex: 1 }}>merge to main</div>
        <button
          className="btn btn-sm"
          onClick={onCheck}
          disabled={busy !== null}
          title="re-run merge safety checks"
        >
          {busy === "check" ? "checking…" : "run safety checks"}
        </button>
        <button
          className={`btn btn-sm ${ready ? "btn-success" : ""}`}
          onClick={onMerge}
          disabled={busy !== null || !ready}
          title={
            ready
              ? "merge this spec branch into main"
              : "run safety checks and resolve issues before merging"
          }
        >
          {busy === "merge" ? "merging…" : "merge to main"}
        </button>
      </div>
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--fg-2)", marginBottom: 8 }}>
        auto-merges <code className="inline">{check?.branch ?? "this spec branch"}</code> into{" "}
        <code className="inline">{check?.mainBranch ?? "main"}</code> after verifying the test
        loop is green, the working tree is clean, and the branch is up-to-date with the remote
        (when present).
      </div>
      {!testsPassed && !check && (
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--fg-2)" }}>
          tip: run the test loop to "passed" first, then re-run safety checks.
        </div>
      )}
      {check && (
        <div className="flex-col" style={{ gap: 4, marginBottom: 8 }}>
          <CheckRow label="tests passed" ok={check.testsPassed} />
          <CheckRow label="working tree clean" ok={check.workingTreeClean} />
          <CheckRow label="branch up-to-date with origin/main" ok={check.branchUpToDate} />
          {check.issues.length > 0 && (
            <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: "var(--fs-sm)", color: "var(--danger)" }}>
              {check.issues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result && (
        <div className={`notice ${merged ? "ok" : "danger"}`}>
          {merged
            ? `merged ${result.branch} → ${result.mainBranch} at ${result.mergedAt}`
            : `merge failed: ${result.error ?? "see safety checks above"}`}
        </div>
      )}
    </div>
  );
}

function CheckRow({ label, ok }: { label: string; ok: boolean }): JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-sm)" }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: ok ? "var(--ok)" : "var(--danger)",
          boxShadow: `0 0 4px ${ok ? "var(--ok)" : "var(--danger)"}`,
          flexShrink: 0,
        }}
      />
      <span style={{ color: "var(--fg-1)" }}>{label}</span>
    </div>
  );
}

interface TestLoopPanelProps {
  state: TestLoopState;
  onStart: () => void;
  onStop: () => void;
  mergeCheck: MergeCheckResult | null;
  mergeResult: MergeResult | null;
  mergeBusy: "check" | "merge" | null;
  onCheckMerge: () => void;
  onMerge: () => void;
}

export function TestLoopPanel({
  state,
  onStart,
  onStop,
  mergeCheck,
  mergeResult,
  mergeBusy,
  onCheckMerge,
  onMerge,
}: TestLoopPanelProps): JSX.Element {
  const isRunning =
    state.status === "running-tests" ||
    state.status === "analyzing" ||
    state.status === "fixing";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
      <div style={{ fontSize: "var(--fs-sm)", color: "var(--fg-2)", marginBottom: 14 }}>
        the autonomous test loop runs all unit and integration tests, then asks
        the agent to decide — fix the source code or correct the test — and
        applies the fix. it repeats until everything passes or the iteration
        limit is reached.
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <div className={`status-text ${testLoopStatusClass(state.status)}`} style={{ flex: 1 }}>
          ● {TESTLOOP_STATUS_LABEL[state.status]}
        </div>
        {isRunning ? (
          <button className="btn btn-danger btn-sm" onClick={onStop}>
            stop
          </button>
        ) : (
          <button className="btn btn-success btn-sm" onClick={onStart}>
            {state.iterations.length > 0 ? "▶ re-run loop" : "▶ start test loop"}
          </button>
        )}
      </div>

      {state.error && <div className="notice danger">{state.error}</div>}

      <MergePanel
        testsPassed={state.status === "passed"}
        check={mergeCheck}
        result={mergeResult}
        busy={mergeBusy}
        onCheck={onCheckMerge}
        onMerge={onMerge}
      />

      {state.iterations.length === 0 ? (
        <div style={{ color: "var(--fg-3)", fontSize: "var(--fs-sm)" }}>
          no iterations yet. generate unit / integration tests in the other tabs,
          then start the loop.
        </div>
      ) : (
        <div className="flex-col" style={{ gap: 12 }}>
          {state.iterations.map((iter) => (
            <div
              key={iter.iteration}
              className={`iter ${iter.failures === 0 ? "passed" : "failing"}`}
            >
              <div className="iter-head">
                <span className="iter-title">iteration {iter.iteration}</span>
                <span className={`badge ${iter.failures === 0 ? "ok" : "warn"}`}>
                  {iter.failures === 0
                    ? "ALL PASSED"
                    : `${iter.failures} FAILURE${iter.failures > 1 ? "S" : ""}`}
                </span>
                {iter.verdict && (
                  <span className={`badge ${iter.verdict === "fix-code" ? "info" : "magenta"}`}>
                    {iter.verdict === "fix-code" ? "FIXED CODE" : "FIXED TEST"}
                  </span>
                )}
              </div>

              {iter.agentSummary && (
                <div
                  style={{
                    fontSize: "var(--fs-sm)",
                    color: "var(--fg-1)",
                    marginBottom: 8,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {iter.agentSummary}
                </div>
              )}

              <div className="flex-col" style={{ gap: 4 }}>
                {iter.results.map((r) => (
                  <div key={r.file} className="test-row">
                    <span className={`dot ${r.passed ? "ok" : "fail"}`} />
                    <code>{r.file}</code>
                    <span className="duration">
                      {r.duration > 0 ? `${(r.duration / 1000).toFixed(1)}s` : ""}
                    </span>
                  </div>
                ))}
              </div>

              {iter.results.some((r) => !r.passed) && (
                <details style={{ marginTop: 8 }}>
                  <summary
                    style={{
                      fontSize: "var(--fs-xs)",
                      cursor: "pointer",
                      color: "var(--fg-2)",
                    }}
                  >
                    show failure output
                  </summary>
                  {iter.results
                    .filter((r) => !r.passed)
                    .map((r) => (
                      <pre key={r.file} className="code-block failure">
                        {`--- ${r.file} ---\n${r.stderr || r.stdout}`}
                      </pre>
                    ))}
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
