import type * as DeepAgents from "deepagents";
import type * as Messages from "@langchain/core/messages";
import type * as Tools from "@langchain/core/tools";

// deepagents and @langchain/core/* are ESM-only. The main process compiles to
// CJS (tsconfig.main.json), and tsc rewrites a native `import()` into
// `Promise.resolve(require(...))`, which throws ERR_REQUIRE_ESM on ESM packages.
// Wrapping in Function(...) hides the expression from tsc so Node evaluates a
// real dynamic import at runtime. Cached so we pay the import cost once.
export type Deps = {
  deepagents: typeof DeepAgents;
  messages: typeof Messages;
  tools: typeof Tools;
};

let cached: Promise<Deps> | null = null;

export function loadDeps(): Promise<Deps> {
  if (!cached) {
    cached = Promise.all([
      Function('return import("deepagents")')() as Promise<typeof DeepAgents>,
      Function('return import("@langchain/core/messages")')() as Promise<typeof Messages>,
      Function('return import("@langchain/core/tools")')() as Promise<typeof Tools>,
    ]).then(([deepagents, messages, tools]) => ({ deepagents, messages, tools }));
  }
  return cached;
}
