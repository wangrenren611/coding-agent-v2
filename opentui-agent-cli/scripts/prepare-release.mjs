#!/usr/bin/env bun

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const stageRoot = path.join(packageRoot, "release", "publish");
const packageJsonPath = path.join(packageRoot, "package.json");
const readmePath = path.join(packageRoot, "README.md");
const wrapperPath = path.join(packageRoot, "bin", "renx.cjs");
const entryPath = path.join(packageRoot, "src", "index.tsx");
const parserWorker = path.resolve(packageRoot, "node_modules", "@opentui", "core", "parser.worker.js");

const platformMap = {
  win32: { target: "windows", npm: "win32", binary: "renx.exe" },
  linux: { target: "linux", npm: "linux", binary: "renx" },
  darwin: { target: "darwin", npm: "darwin", binary: "renx" },
};

const archMap = {
  x64: "x64",
  arm64: "arm64",
};

const platform = platformMap[process.platform];
if (!platform) {
  throw new Error(`Unsupported platform for release packaging: ${process.platform}`);
}

const arch = archMap[process.arch];
if (!arch) {
  throw new Error(`Unsupported architecture for release packaging: ${process.arch}`);
}

if (!existsSync(entryPath)) {
  throw new Error(`Cannot find CLI entrypoint: ${entryPath}`);
}

if (!existsSync(parserWorker)) {
  throw new Error(`Cannot find OpenTUI parser worker: ${parserWorker}`);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const bunTarget = `bun-${platform.target}-${arch}`;
const binaryOutputPath = path.join(stageRoot, "bin", platform.binary);
const bunfsRoot = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/";
const workerRelativePath = path.relative(packageRoot, parserWorker).replaceAll("\\", "/");

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(path.join(stageRoot, "bin"), { recursive: true });

const result = await Bun.build({
  entrypoints: [entryPath, parserWorker],
  compile: {
    target: bunTarget,
    outfile: binaryOutputPath,
    windows: {},
    execArgv: ["--"],
  },
  define: {
    OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(bunfsRoot + workerRelativePath),
    RENX_BUILD_VERSION: JSON.stringify(packageJson.version ?? "0.0.0"),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log.message);
  }
  throw new Error("Failed to compile Renx binary.");
}

cpSync(wrapperPath, path.join(stageRoot, "bin", "renx.cjs"));
cpSync(readmePath, path.join(stageRoot, "README.md"));

if (process.platform !== "win32") {
  chmodSync(binaryOutputPath, 0o755);
  chmodSync(path.join(stageRoot, "bin", "renx.cjs"), 0o755);
}

const publishPackageJson = {
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description ?? "Renx terminal AI coding assistant",
  type: "commonjs",
  private: false,
  os: [platform.npm],
  cpu: [arch],
  bin: {
    renx: "./bin/renx.cjs",
  },
  files: ["bin", "README.md"],
  engines: packageJson.engines,
};

writeFileSync(path.join(stageRoot, "package.json"), `${JSON.stringify(publishPackageJson, null, 2)}\n`);

console.log(`Prepared publish directory at ${stageRoot}`);
console.log(`Bundled binary target: ${bunTarget}`);
