import React from "react";
import type {
  GenerateIntegrationTestsResult,
  IntegrationTestFramework,
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

interface IntegrationTestsPanelProps {
  userStories: UserStory[];
  results: Record<string, GenerateIntegrationTestsResult>;
  busyId: string | null;
  onGenerate: (story: UserStory) => void;
}

export function IntegrationTestsPanel({
  userStories,
  results,
  busyId,
  onGenerate,
}: IntegrationTestsPanelProps): JSX.Element {
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
      <div className="flex-col" style={{ gap: 10 }}>
        {userStories.map((story) => {
          const res = results[story.id] ?? null;
          const busy = busyId === story.id;
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
                <button
                  className="btn btn-sm"
                  onClick={() => onGenerate(story)}
                  disabled={busyId !== null}
                  title="generate integration tests for this story"
                >
                  {busy ? "generating…" : res ? "regenerate" : "generate"}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
