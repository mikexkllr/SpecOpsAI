import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  ARTIFACT_FILENAMES,
  type ArtifactFiles,
  type CheckoutSpecBranchResult,
  type MergeCheckResult,
  type MergeResult,
  type ProjectInfo,
  type SpecInfo,
  type TestLoopState,
} from "../shared/api";
import {
  checkoutBranch,
  commitPaths,
  currentBranch,
  git,
  gitOk,
  hasRemote,
  isWorkingTreeClean,
} from "./git";
import { ensureProjectContextFiles } from "./projectContext";
import { loadSettings } from "./settings";
import { projectRoot } from "./utils";

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
  const createdContext = await ensureProjectContextFiles(projectPath);
  if (createdContext && (await loadSettings()).autoCommit !== false) {
    // Commit the scaffolding right away so it doesn't sit as untracked noise
    // blocking sync, and so collaborators get the constitution immediately.
    await commitPaths(projectPath, [".specops"], "chore: add SpecOps project context");
  }
  const specs = await listSpecs(projectPath);
  return {
    path: projectPath,
    name: path.basename(projectPath),
    specs,
  };
}

export async function loadProject(
  projectPath: string,
): Promise<ProjectInfo | null> {
  if (!(await pathExists(projectPath))) return null;
  return openProject(projectPath);
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
  for (const file of Object.values(ARTIFACT_FILENAMES)) {
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

// Switch the repo to the spec's branch (used when the user selects a spec in
// the project bar, so artifacts/worker state always match the branch on disk).
export async function checkoutSpecBranch(
  specPath: string,
): Promise<CheckoutSpecBranchResult> {
  const meta = await readSpecMeta(specPath);
  if (!meta || !meta.branch) {
    return { ok: false, branch: "", warning: "spec metadata missing — cannot determine branch" };
  }
  return checkoutBranch(projectRoot(specPath), meta.branch);
}

export async function readArtifacts(specPath: string): Promise<ArtifactFiles> {
  const result = {} as ArtifactFiles;
  for (const [key, file] of Object.entries(ARTIFACT_FILENAMES) as [
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
  const file = ARTIFACT_FILENAMES[artifact];
  if (!file) throw new Error(`unknown artifact: ${artifact}`);
  await fs.writeFile(path.join(specPath, file), content, "utf8");
}

export async function checkMergeReadiness(
  specPath: string,
  testLoop: TestLoopState,
): Promise<MergeCheckResult> {
  const root = projectRoot(specPath);
  const issues: string[] = [];

  const meta = await readSpecMeta(specPath);
  if (!meta) {
    return {
      ready: false,
      branch: "",
      mainBranch: "main",
      issues: ["Spec metadata missing — cannot determine branch."],
      testsPassed: false,
      workingTreeClean: false,
      branchUpToDate: false,
    };
  }

  const branch = meta.branch;
  const mainBranch = "main";

  if (branch === mainBranch) {
    issues.push(`Spec is already on the ${mainBranch} branch — nothing to merge.`);
  }

  const testsPassed = testLoop.status === "passed";
  if (!testsPassed) {
    issues.push(
      `Test loop has not reported success (current status: ${testLoop.status}). Run the test loop to green before merging.`,
    );
  }

  const workingTreeClean = await isWorkingTreeClean(root);
  if (!workingTreeClean) {
    issues.push("Working tree has uncommitted changes — commit or stash before merging.");
  }

  let branchUpToDate = true;
  if (await hasRemote(root)) {
    if (await gitOk(root, "fetch", "origin", mainBranch)) {
      try {
        const behind = await git(
          root,
          "rev-list",
          "--count",
          `${branch}..origin/${mainBranch}`,
        );
        if (behind !== "0") {
          branchUpToDate = false;
          issues.push(
            `Branch ${branch} is ${behind} commit(s) behind origin/${mainBranch} — rebase or merge first.`,
          );
        }
      } catch {
        /* branch may not exist on remote yet — ignore */
      }
    }
  }

  return {
    ready: issues.length === 0,
    branch,
    mainBranch,
    issues,
    testsPassed,
    workingTreeClean,
    branchUpToDate,
  };
}

export async function mergeSpecToMain(
  specPath: string,
  testLoop: TestLoopState,
): Promise<MergeResult> {
  const check = await checkMergeReadiness(specPath, testLoop);
  if (!check.ready) {
    return { ok: false, branch: check.branch, mainBranch: check.mainBranch, check };
  }

  const root = projectRoot(specPath);
  const branch = check.branch;
  const mainBranch = check.mainBranch;
  const startBranch = await currentBranch(root);

  try {
    await git(root, "checkout", mainBranch);
    await git(
      root,
      "merge",
      "--no-ff",
      "-m",
      `merge: ${branch} into ${mainBranch}`,
      branch,
    );
    return {
      ok: true,
      branch,
      mainBranch,
      check,
      mergedAt: new Date().toISOString(),
    };
  } catch (err) {
    await gitOk(root, "merge", "--abort");
    await gitOk(root, "checkout", startBranch);
    return {
      ok: false,
      branch,
      mainBranch,
      check,
      error: (err as Error).message,
    };
  }
}
