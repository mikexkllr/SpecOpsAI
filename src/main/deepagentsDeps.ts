import * as fs from "node:fs/promises";
import * as path from "node:path";
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

// Construct a deepagents FilesystemBackend that ALLOWS write_file to overwrite
// an existing file.
//
// deepagents >=1.x changed write_file to refuse any path that already exists
// ("Cannot write to … because it already exists. Read and then make an edit,
// or write to a new path."). Our agents are built around whole-file rewrites:
// artifacts (spec.md, user-stories.md, …) are pre-written to disk before each
// turn, and the prompts tell the model to write_file the FULL markdown / to
// "create or overwrite" a target path. Under the new guard write_file always
// failed; the model fell back to edit_file (exact-match, fragile) and, on a
// miss, followed the error's own advice — writing a DUPLICATE file at a new
// path. We restore overwrite by removing an existing regular file before
// delegating to the real write. Symlinks are left untouched so the real write
// still rejects them, preserving its symlink guard.
export function createFsBackend(
  deepagents: Deps["deepagents"],
  options: { rootDir: string; virtualMode?: boolean },
): InstanceType<Deps["deepagents"]["FilesystemBackend"]> {
  const backend = new deepagents.FilesystemBackend(options);
  const cwd = path.resolve(options.rootDir);
  const virtualMode = options.virtualMode ?? false;
  const realWrite = backend.write.bind(backend);
  backend.write = async (filePath: string, content: string) => {
    try {
      // Mirror FilesystemBackend.resolvePath: in virtualMode a leading-slash
      // path is virtual-absolute under cwd; otherwise resolve against cwd.
      const resolved = virtualMode
        ? path.resolve(cwd, filePath.replace(/^\/+/, ""))
        : path.isAbsolute(filePath)
          ? filePath
          : path.resolve(cwd, filePath);
      if ((await fs.lstat(resolved)).isFile()) await fs.unlink(resolved);
    } catch {
      // Path doesn't exist (or can't be resolved) — let the real write create
      // it, or surface the appropriate error itself.
    }
    return realWrite(filePath, content);
  };
  return backend;
}
