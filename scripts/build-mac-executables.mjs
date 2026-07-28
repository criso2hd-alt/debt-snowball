import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { c as createTar, x as extractTar } from "tar";
import { build as viteBuild } from "vite";

const require = createRequire(import.meta.url);
const { inject } = require("postject");

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const localOutput = resolve(projectRoot, "local-dist");
const clientOutput = resolve(localOutput, "client");
const serverBundle = resolve(localOutput, "server.cjs");
const seaBlob = resolve(localOutput, "debt-squasher-mac.blob");
const seaConfigPath = resolve(localOutput, "sea-config-mac.json");
const releaseDirectory = resolve(projectRoot, "release");
const cacheDirectory = resolve(projectRoot, ".sites-runtime", "mac-node-cache");
const macGuide = resolve(projectRoot, "MAC_EXECUTABLE.md");
const nodeVersion = process.versions.node;
const architectures = ["arm64", "x64"];
const sentinelFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function assertProjectPath(path) {
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

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function verifiedNodeBinary(architecture, checksums) {
  const filename = `node-v${nodeVersion}-darwin-${architecture}.tar.gz`;
  const expected = checksums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === filename)?.[0];
  if (!expected) throw new Error(`No official checksum was found for ${filename}.`);

  const archivePath = resolve(cacheDirectory, filename);
  const extractedDirectory = resolve(cacheDirectory, `${nodeVersion}-${architecture}`);
  const binaryPath = resolve(extractedDirectory, "node");
  await mkdir(cacheDirectory, { recursive: true });

  let downloadRequired = true;
  try {
    const digest = createHash("sha256").update(await readFile(archivePath)).digest("hex");
    downloadRequired = digest !== expected;
  } catch {
    downloadRequired = true;
  }

  if (downloadRequired) {
    console.log(`Downloading official Node.js ${nodeVersion} for macOS ${architecture}...`);
    await download(`https://nodejs.org/download/release/v${nodeVersion}/${filename}`, archivePath);
  }

  const digest = createHash("sha256").update(await readFile(archivePath)).digest("hex");
  if (digest !== expected) throw new Error(`Checksum verification failed for ${filename}.`);

  try {
    if ((await stat(binaryPath)).size > 50_000_000) return binaryPath;
  } catch {
    // Extract below.
  }

  assertProjectPath(extractedDirectory);
  await rm(extractedDirectory, { recursive: true, force: true });
  await mkdir(extractedDirectory, { recursive: true });
  await extractTar({
    file: archivePath,
    cwd: extractedDirectory,
    gzip: true,
    strip: 2,
    filter: (path) => path.endsWith("/bin/node"),
  });
  if ((await stat(binaryPath)).size < 50_000_000) {
    throw new Error(`The extracted ${architecture} Node binary is incomplete.`);
  }
  return binaryPath;
}

await mkdir(localOutput, { recursive: true });
await mkdir(releaseDirectory, { recursive: true });

console.log("Building the shared browser application...");
await viteBuild({
  configFile: resolve(projectRoot, "vite.local.config.ts"),
  logLevel: "info",
});

console.log("Bundling the cross-platform LAN server...");
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
  assets[relative(clientOutput, path).split(sep).join("/")] = path;
}
await writeFile(seaConfigPath, `${JSON.stringify({
  main: serverBundle,
  output: seaBlob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  execArgvExtension: "none",
  assets,
}, null, 2)}\n`, "utf8");

const { spawnSync } = await import("node:child_process");
const seaResult = spawnSync(
  process.execPath,
  ["--experimental-sea-config", seaConfigPath],
  { cwd: projectRoot, stdio: "inherit" },
);
if (seaResult.status !== 0) {
  throw new Error(`Node SEA payload creation failed with exit code ${seaResult.status}.`);
}

const checksumUrl = `https://nodejs.org/download/release/v${nodeVersion}/SHASUMS256.txt`;
const checksumPath = resolve(cacheDirectory, `SHASUMS256-${nodeVersion}.txt`);
await mkdir(cacheDirectory, { recursive: true });
console.log("Refreshing official Node.js checksums...");
await download(checksumUrl, checksumPath);
const checksums = await readFile(checksumPath, "utf8");
const blob = await readFile(seaBlob);
const guide = await readFile(macGuide, "utf8");

for (const architecture of architectures) {
  const sourceBinary = await verifiedNodeBinary(architecture, checksums);
  const folderName = `DebtSquasher-macOS-${architecture}`;
  const packageDirectory = resolve(localOutput, folderName);
  const binaryPath = resolve(packageDirectory, "DebtSquasher");
  const launcherPath = resolve(packageDirectory, "Start Debt Squasher.command");
  const archivePath = resolve(releaseDirectory, `${folderName}.tar.gz`);
  assertProjectPath(packageDirectory);
  await rm(packageDirectory, { recursive: true, force: true });
  await mkdir(packageDirectory, { recursive: true });
  await copyFile(sourceBinary, binaryPath);

  console.log(`Injecting Debt Squasher into the macOS ${architecture} binary...`);
  await inject(binaryPath, "NODE_SEA_BLOB", blob, {
    machoSegmentName: "NODE_SEA",
    sentinelFuse,
    overwrite: true,
  });

  const launcher = `#!/bin/zsh
set -e
SCRIPT_DIR="\${0:A:h}"
BINARY="\${SCRIPT_DIR}/DebtSquasher"
chmod +x "\${BINARY}"
codesign --force --sign - "\${BINARY}" >/dev/null 2>&1 || true
exec "\${BINARY}"
`;
  await writeFile(launcherPath, launcher, "utf8");
  await writeFile(resolve(packageDirectory, "README.txt"), guide, "utf8");

  await rm(archivePath, { force: true });
  await createTar({
    gzip: true,
    file: archivePath,
    cwd: packageDirectory,
    prefix: `${folderName}/`,
    portable: true,
    onWriteEntry: (entry) => {
      if (entry.stat && (entry.path === "DebtSquasher" || entry.path.endsWith(".command"))) {
        entry.stat.mode = 0o100755;
      }
    },
  }, ["DebtSquasher", "Start Debt Squasher.command", "README.txt"]);

  const binary = await readFile(binaryPath);
  const cpuType = binary.readUInt32LE(4);
  const expectedCpuType = architecture === "arm64" ? 0x0100000c : 0x01000007;
  if (binary.readUInt32LE(0) !== 0xfeedfacf || cpuType !== expectedCpuType) {
    throw new Error(`The generated ${architecture} file is not the expected Mach-O binary.`);
  }

  const archiveSize = (await stat(archivePath)).size;
  console.log(`Created ${archivePath} (${(archiveSize / 1024 / 1024).toFixed(1)} MB)`);
}
