import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CheckoutSpecBranchResult, GitSyncResult } from "../shared/api";

const execFileP = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd });
  return stdout.trim();
}

export async function gitOk(cwd: string, ...args: string[]): Promise<boolean> {
  try {
    await git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
}

export async function currentBranch(cwd: string): Promise<string> {
  return git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
}

export async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  const out = await git(cwd, "status", "--porcelain");
  return out.length === 0;
}

export async function hasRemote(cwd: string, remote = "origin"): Promise<boolean> {
  try {
    await git(cwd, "remote", "get-url", remote);
    return true;
  } catch {
    return false;
  }
}

async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return gitOk(cwd, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
}

// Stage the given paths (or everything) and commit if anything is actually
// staged. Returns true when a commit was created. Never throws — auto-commit
// is a convenience that must not break the agent flow it rides on.
export async function commitPaths(
  root: string,
  paths: string[] | "all",
  message: string,
): Promise<boolean> {
  try {
    if (paths === "all") await git(root, "add", "-A");
    else await git(root, "add", "--", ...paths);
    const staged = await git(root, "diff", "--cached", "--name-only");
    if (!staged) return false;
    await git(root, "commit", "-m", message);
    return true;
  } catch {
    return false;
  }
}

// Fetch + pull --rebase + push the current branch. Conservative: a dirty
// working tree skips the pull/push instead of stashing behind the user's back.
export async function syncWithRemote(root: string): Promise<GitSyncResult> {
  let branch = "";
  try {
    branch = await currentBranch(root);
    if (!(await hasRemote(root))) {
      return { ok: false, branch, message: "no 'origin' remote configured" };
    }
    if (!(await isWorkingTreeClean(root))) {
      return {
        ok: false,
        branch,
        message: "working tree has uncommitted changes — commit them first",
      };
    }
    await git(root, "fetch", "origin");
    // Pull only when the branch has an upstream; otherwise this is the first push.
    const hasUpstream = await gitOk(
      root,
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    );
    if (hasUpstream) await git(root, "pull", "--rebase", "origin", branch);
    await git(root, "push", "-u", "origin", branch);
    return { ok: true, branch, message: `synced ${branch} with origin` };
  } catch (err) {
    // A failed rebase leaves the repo mid-rebase — abort to restore a sane state.
    await gitOk(root, "rebase", "--abort");
    return {
      ok: false,
      branch,
      message: `sync failed: ${firstLine((err as Error).message)}`,
    };
  }
}

// Switch the repo to a spec's branch when the user selects the spec. Never
// forces: a dirty tree or a missing branch yields a warning instead.
export async function checkoutBranch(
  root: string,
  branch: string,
): Promise<CheckoutSpecBranchResult> {
  try {
    const current = await currentBranch(root);
    if (current === branch) return { ok: true, branch };
    if (!(await isWorkingTreeClean(root))) {
      return {
        ok: false,
        branch,
        warning: `staying on ${current} — uncommitted changes block switching to ${branch}`,
      };
    }
    if (!(await branchExists(root, branch))) {
      // Collaborator case: the branch may exist on the remote only.
      if (await gitOk(root, "fetch", "origin", branch)) {
        if (await gitOk(root, "checkout", "-b", branch, `origin/${branch}`)) {
          return { ok: true, branch };
        }
      }
      return { ok: false, branch, warning: `branch ${branch} does not exist` };
    }
    await git(root, "checkout", branch);
    return { ok: true, branch };
  } catch (err) {
    return {
      ok: false,
      branch,
      warning: `checkout failed: ${firstLine((err as Error).message)}`,
    };
  }
}

function firstLine(s: string): string {
  return s.split("\n").find((l) => l.trim()) ?? s;
}
