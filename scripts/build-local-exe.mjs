import { createRequire } from "node:module";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

const require = createRequire(import.meta.url);
const { inject } = require("postject");

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const localOutput = resolve(projectRoot, "local-dist");
const clientOutput = resolve(localOutput, "client");
const serverBundle = resolve(localOutput, "server.cjs");
const seaBlob = resolve(localOutput, "debt-squasher.blob");
const seaConfigPath = resolve(localOutput, "sea-config.json");
const releaseDirectory = resolve(projectRoot, "release");
const executablePath = resolve(releaseDirectory, "DebtSquasher.exe");
const guideSource = resolve(projectRoot, "LOCAL_EXECUTABLE.md");
const guideDestination = resolve(releaseDirectory, "README.txt");

function assertBuildPath(path) {
  const relativePath = relative(projectRoot, path);
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes(`..${sep}`)) {
    throw new Error(`Refusing to modify an unsafe build path: ${path}`);
  }
}

async function filesUnder(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) results.push(...await filesUnder(path));
    else if (entry.isFile()) results.push(path);
  }
  return results;
}

for (const path of [localOutput, releaseDirectory]) assertBuildPath(path);
await rm(localOutput, { recursive: true, force: true });
await mkdir(localOutput, { recursive: true });
await mkdir(releaseDirectory, { recursive: true });

console.log("Building browser application...");
await viteBuild({
  configFile: resolve(projectRoot, "vite.local.config.ts"),
  logLevel: "info",
});

console.log("Bundling local server...");
await esbuild({
  entryPoints: [resolve(projectRoot, "local-server", "server.ts")],
  outfile: serverBundle,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node24",
  sourcemap: false,
  minify: true,
  external: ["node:sea"],
});

const assets = {};
for (const path of await filesUnder(clientOutput)) {
  const key = relative(clientOutput, path).split(sep).join("/");
  assets[key] = path;
}

const seaConfig = {
  main: serverBundle,
  output: seaBlob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  execArgvExtension: "none",
  assets,
};
await writeFile(seaConfigPath, `${JSON.stringify(seaConfig, null, 2)}\n`, "utf8");

console.log("Creating Node.js executable payload...");
const originalArgv = process.argv;
process.argv = [process.execPath, "--experimental-sea-config", seaConfigPath];
const { spawnSync } = await import("node:child_process");
const seaResult = spawnSync(
  process.execPath,
  ["--experimental-sea-config", seaConfigPath],
  { cwd: projectRoot, encoding: "utf8", stdio: "inherit" },
);
process.argv = originalArgv;
if (seaResult.status !== 0) {
  throw new Error(`Node SEA payload creation failed with exit code ${seaResult.status}.`);
}

await rm(executablePath, { force: true });
await copyFile(process.execPath, executablePath);

console.log("Injecting application into DebtSquasher.exe...");
await inject(
  executablePath,
  "NODE_SEA_BLOB",
  await (await import("node:fs/promises")).readFile(seaBlob),
  {
    sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    overwrite: true,
  },
);

await copyFile(guideSource, guideDestination);
const size = (await stat(executablePath)).size;
console.log(`\nCreated ${executablePath}`);
console.log(`Executable size: ${(size / 1024 / 1024).toFixed(1)} MB`);
