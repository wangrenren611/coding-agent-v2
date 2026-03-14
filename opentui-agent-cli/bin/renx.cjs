#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const binaryName = process.platform === "win32" ? "renx.exe" : "renx";

function run(target, args, env = process.env) {
  const result = childProcess.spawnSync(target, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(typeof result.status === "number" ? result.status : 0);
}

function resolveBunExecutable() {
  if (process.env.RENX_BUN_PATH) {
    return process.env.RENX_BUN_PATH;
  }

  const candidates =
    process.platform === "win32"
      ? ["bun.exe", "bun.cmd", "bun"]
      : ["bun"];

  for (const candidate of candidates) {
    const probe = childProcess.spawnSync(candidate, ["--version"], {
      stdio: "ignore",
    });

    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }

  return null;
}

function hasAgentSourceRoot(root) {
  return (
    fs.existsSync(path.join(root, "src", "providers", "index.ts")) &&
    fs.existsSync(path.join(root, "src", "config", "index.ts")) &&
    fs.existsSync(path.join(root, "src", "agent", "app", "index.ts"))
  );
}

const binaryCandidates = [
  process.env.RENX_BIN_PATH,
  path.join(__dirname, binaryName),
  path.join(packageRoot, "release", "publish", "bin", binaryName),
].filter(Boolean);

for (const candidate of binaryCandidates) {
  if (fs.existsSync(candidate)) {
    run(candidate, process.argv.slice(2));
  }
}

const sourceEntry = path.join(packageRoot, "src", "index.tsx");
if (fs.existsSync(sourceEntry)) {
  const packagedRepoRoot = path.join(packageRoot, "vendor", "agent-root");
  const localRepoRoot = path.resolve(packageRoot, "..");
  const resolvedRepoRoot =
    process.env.AGENT_REPO_ROOT ||
    (hasAgentSourceRoot(packagedRepoRoot)
      ? packagedRepoRoot
      : hasAgentSourceRoot(localRepoRoot)
        ? localRepoRoot
        : undefined);
  const bunExecutable = resolveBunExecutable();

  if (bunExecutable) {
    run(bunExecutable, ["run", sourceEntry, ...process.argv.slice(2)], {
      ...process.env,
      AGENT_WORKDIR: process.env.AGENT_WORKDIR || process.cwd(),
      ...(resolvedRepoRoot ? { AGENT_REPO_ROOT: resolvedRepoRoot } : {}),
    });
  }
}

console.error(`Could not find Renx executable: expected ${binaryName} next to ${__filename}.`);
console.error("Run `npm run release:prepare` to build a local binary, or set RENX_BIN_PATH.");
process.exit(1);
