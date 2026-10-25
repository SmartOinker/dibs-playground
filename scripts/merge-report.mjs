#!/usr/bin/env node
// Merge-report for one demo run: how cleanly do the three agents' branches combine?
//
//   node scripts/merge-report.mjs nodibs    # branches nodibs/claude, nodibs/codex, nodibs/droid
//   node scripts/merge-report.mjs dibs      # branches dibs/claude, dibs/codex, dibs/droid
//
// Merges each pushed branch, in order, onto origin/main in a throwaway worktree and reports
// merge conflicts, files more than one agent wrote, and files written outside each agent's folder.
// Nothing is pushed and your checkout is not touched.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const run = process.argv[2];
if (!/^[a-z0-9-]+$/.test(run ?? "")) {
  console.error("usage: node scripts/merge-report.mjs <nodibs|dibs>");
  process.exit(2);
}
const AGENTS = [
  { name: "claude", folder: "server/" },
  { name: "droid", folder: "store/" },
  { name: "codex", folder: "web/" },
];
const git = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const lines = (text) => (text ? text.split(/\r?\n/).filter(Boolean) : []);

git(["fetch", "--quiet", "--prune", "origin"]);
const branches = AGENTS.map((a) => ({ ...a, ref: `origin/${run}/${a.name}` }));
const missing = branches.filter((b) => {
  try {
    git(["rev-parse", "--verify", "--quiet", b.ref]);
    return false;
  } catch {
    return true;
  }
});
if (missing.length) {
  console.error(
    `Missing branches: ${missing.map((b) => `${run}/${b.name}`).join(", ")}. Push them first.`,
  );
  process.exit(1);
}

// What each agent changed relative to main.
for (const b of branches) {
  b.files = lines(git(["diff", "--name-only", `origin/main...${b.ref}`]));
  b.outside = b.files.filter((f) => !f.startsWith(b.folder));
}
const writers = new Map();
for (const b of branches)
  for (const f of b.files) writers.set(f, [...(writers.get(f) ?? []), b.name]);
const shared = [...writers].filter(([, who]) => who.length > 1);

// Merge them one after another, like merging three pull requests.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-report-"));
git(["worktree", "add", "--quiet", "--detach", dir, "origin/main"]);
try {
  git(["config", "user.name", "merge-report"], dir);
  git(["config", "user.email", "merge-report@localhost"], dir);
  for (const b of branches) {
    try {
      git(["merge", "--no-ff", "--no-edit", "--quiet", b.ref], dir);
      b.conflicts = [];
    } catch {
      b.conflicts = lines(git(["diff", "--name-only", "--diff-filter=U"], dir));
      git(["merge", "--abort"], dir);
    }
  }
} finally {
  git(["worktree", "remove", "--force", dir]);
}

const conflicted = branches.filter((b) => b.conflicts.length);
const conflictFiles = new Set(conflicted.flatMap((b) => b.conflicts));
const pad = (s, n) => String(s).padEnd(n);
console.log(
  `\nMerge report: ${run}  (origin/main + 3 agent branches, merged in order)\n`,
);
console.log(
  `  ${pad("agent", 8)}${pad("branch", 16)}${pad("files", 7)}${pad("outside own folder", 34)}merge`,
);
for (const b of branches)
  console.log(
    `  ${pad(b.name, 8)}${pad(`${run}/${b.name}`, 16)}${pad(b.files.length, 7)}${pad(b.outside.join(", ") || "-", 34)}${
      b.conflicts.length ? `CONFLICT: ${b.conflicts.join(", ")}` : "clean"
    }`,
  );
console.log("");
console.log(
  `  Files written by more than one agent: ${
    shared.length
      ? shared.map(([f, who]) => `${f} (${who.join(", ")})`).join("; ")
      : "none"
  }`,
);
console.log(
  `  Merge conflicts: ${conflictFiles.size} file${conflictFiles.size === 1 ? "" : "s"} in ${conflicted.length} of ${branches.length} merges\n`,
);
