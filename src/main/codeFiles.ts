import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FileNode, ProjectFileResult } from "../shared/api";
import { projectRoot } from "./utils";

// Directories we never want to surface in the Code Studio tree — noise the user
// would never hand-edit, and (for node_modules/.git) huge enough to freeze the
// walk. The spec workflow's own bookkeeping (.specops) is hidden too.
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  ".turbo",
  ".vite",
  "coverage",
  ".specops",
  ".DS_Store",
]);

// Guard rails so a pathological project can't lock the UI or balloon IPC.
const MAX_DEPTH = 8;
const MAX_ENTRIES_PER_DIR = 500;
const MAX_FILE_BYTES = 512 * 1024;

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

// Resolve a project-relative path and refuse anything that escapes the root, so
// a crafted relPath ("../../etc/passwd") can't read or clobber outside the
// project the user opened.
function resolveInRoot(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return resolved;
}

async function walk(dir: string, root: string, depth: number): Promise<FileNode[]> {
  if (depth > MAX_DEPTH) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: FileNode[] = [];
  for (const entry of entries.slice(0, MAX_ENTRIES_PER_DIR)) {
    if (entry.name.startsWith(".") && entry.name !== ".gitignore") {
      // Hide dotfiles/dirs by default except a couple of useful ones.
      if (entry.isDirectory()) continue;
    }
    if (IGNORED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = toPosix(path.relative(root, abs));
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: rel,
        type: "dir",
        children: await walk(abs, root, depth + 1),
      });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: rel, type: "file" });
    }
  }
  // Directories first, then files, each alphabetical — the familiar IDE order.
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

export async function readProjectTree(specPath: string): Promise<FileNode[]> {
  const root = projectRoot(specPath);
  return walk(root, root, 0);
}

function looksBinary(buf: Buffer): boolean {
  // A NUL byte in the first chunk is the classic, cheap binary heuristic.
  const sample = buf.subarray(0, 8000);
  return sample.includes(0);
}

export async function readProjectFile(
  specPath: string,
  relPath: string,
): Promise<ProjectFileResult> {
  const root = projectRoot(specPath);
  const abs = resolveInRoot(root, relPath);
  const stat = await fs.stat(abs);
  if (stat.size > MAX_FILE_BYTES) {
    return {
      path: relPath,
      content: `// File is ${(stat.size / 1024).toFixed(0)} KB — too large to open in the editor.`,
      binary: false,
      tooLarge: true,
    };
  }
  const buf = await fs.readFile(abs);
  if (looksBinary(buf)) {
    return {
      path: relPath,
      content: "// Binary file — cannot display.",
      binary: true,
      tooLarge: false,
    };
  }
  return { path: relPath, content: buf.toString("utf8"), binary: false, tooLarge: false };
}

export async function writeProjectFile(
  specPath: string,
  relPath: string,
  content: string,
): Promise<void> {
  const root = projectRoot(specPath);
  const abs = resolveInRoot(root, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}
