import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { ArtifactFiles, ProjectInfo, SpecInfo } from "../shared/api";

const execFileP = promisify(execFile);

const ARTIFACT_FILES: Record<keyof ArtifactFiles, string> = {
  spec: "spec.md",
  userStories: "user-stories.md",
  technicalStories: "technical-stories.md",
  code: "code.md",
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd });
  return stdout.trim();
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureGitRepo(projectPath: string): Promise<void> {
  if (!(await pathExists(path.join(projectPath, ".git")))) {
    await git(projectPath, "init");
    await git(projectPath, "checkout", "-b", "main").catch(() => undefined);
    const readme = path.join(projectPath, "README.md");
    if (!(await pathExists(readme))) {
      await fs.writeFile(readme, `# ${path.basename(projectPath)}\n`, "utf8");
    }
    await git(projectPath, "add", "-A").catch(() => undefined);
    await git(projectPath, "commit", "-m", "chore: initialize SpecOps project").catch(
      () => undefined,
    );
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `spec-${Date.now()}`;
}

async function uniqueSlug(specsRoot: string, base: string): Promise<string> {
  let candidate = base;
  let n = 2;
  while (await pathExists(path.join(specsRoot, candidate))) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

async function readSpecMeta(specDir: string): Promise<SpecInfo | null> {
  const metaPath = path.join(specDir, ".specops.json");
  if (!(await pathExists(metaPath))) return null;
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as SpecInfo;
    return { ...parsed, path: specDir };
  } catch {
    return null;
  }
}

async function writeSpecMeta(specDir: string, info: SpecInfo): Promise<void> {
  await fs.writeFile(
    path.join(specDir, ".specops.json"),
    JSON.stringify(info, null, 2),
    "utf8",
  );
}

export async function listSpecs(projectPath: string): Promise<SpecInfo[]> {
  const specsRoot = path.join(projectPath, "specs");
  if (!(await pathExists(specsRoot))) return [];
  const entries = await fs.readdir(specsRoot, { withFileTypes: true });
  const specs: SpecInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const meta = await readSpecMeta(path.join(specsRoot, e.name));
    if (meta) specs.push(meta);
  }
  specs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return specs;
}

export async function openProject(projectPath: string): Promise<ProjectInfo> {
  await fs.mkdir(projectPath, { recursive: true });
  await ensureGitRepo(projectPath);
  await fs.mkdir(path.join(projectPath, "specs"), { recursive: true });
  const specs = await listSpecs(projectPath);
  return {
    path: projectPath,
    name: path.basename(projectPath),
    specs,
  };
}

export async function createSpec(
  projectPath: string,
  name: string,
): Promise<SpecInfo> {
  await ensureGitRepo(projectPath);
  const specsRoot = path.join(projectPath, "specs");
  await fs.mkdir(specsRoot, { recursive: true });

  const id = await uniqueSlug(specsRoot, slugify(name));
  const specDir = path.join(specsRoot, id);
  const branch = `spec/${id}`;

  await git(projectPath, "checkout", "-b", branch).catch(async () => {
    await git(projectPath, "checkout", branch);
  });

  await fs.mkdir(specDir, { recursive: true });
  for (const file of Object.values(ARTIFACT_FILES)) {
    const p = path.join(specDir, file);
    if (!(await pathExists(p))) await fs.writeFile(p, "", "utf8");
  }

  const info: SpecInfo = {
    id,
    name: name.trim() || id,
    path: specDir,
    branch,
    createdAt: new Date().toISOString(),
  };
  await writeSpecMeta(specDir, info);
  return info;
}

export async function readArtifacts(specPath: string): Promise<ArtifactFiles> {
  const result = {} as ArtifactFiles;
  for (const [key, file] of Object.entries(ARTIFACT_FILES) as [
    keyof ArtifactFiles,
    string,
  ][]) {
    const p = path.join(specPath, file);
    result[key] = (await pathExists(p)) ? await fs.readFile(p, "utf8") : "";
  }
  return result;
}

export async function writeArtifact(
  specPath: string,
  artifact: keyof ArtifactFiles,
  content: string,
): Promise<void> {
  const file = ARTIFACT_FILES[artifact];
  if (!file) throw new Error(`unknown artifact: ${artifact}`);
  await fs.writeFile(path.join(specPath, file), content, "utf8");
}
