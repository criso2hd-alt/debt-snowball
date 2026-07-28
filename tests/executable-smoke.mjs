import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const builtExecutable = resolve("release", "DebtSquasher.exe");
assert.ok((await stat(builtExecutable)).size > 50_000_000, "Executable was not created.");

const testDirectory = await mkdtemp(join(tmpdir(), "debt-squasher-exe-"));
const executable = join(testDirectory, "DebtSquasher.exe");
const dataDirectory = join(testDirectory, "app-data");
const portableData = join(testDirectory, "DebtSquasherData.dat");
await copyFile(builtExecutable, executable);
const port = 9500 + (process.pid % 200);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(
  executable,
  ["--no-open", `--port=${port}`, `--data-dir=${dataDirectory}`],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

try {
  let response;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      response = await fetch(baseUrl);
      if (response.ok) break;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  assert.equal(response?.status, 200, output || "Executable did not start.");
  assert.match(await response.text(), /Debt Squasher/);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });
  assert.equal(login.status, 200);
  const payload = await login.json();
  assert.equal(payload.user.mustChangePassword, true);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  const passwordChange = await fetch(`${baseUrl}/api/account/password`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: baseUrl, cookie },
    body: JSON.stringify({ currentPassword: "admin", newPassword: "Executable123!" }),
  });
  assert.equal(passwordChange.status, 200);

  const saveFile = await fetch(`${baseUrl}/api/data-file/save`, {
    method: "POST",
    headers: { origin: baseUrl, cookie },
  });
  assert.equal(saveFile.status, 200);
  const savedPortableData = JSON.parse(await readFile(portableData, "utf8"));
  assert.equal(savedPortableData.application, "Debt Squasher");
  assert.deepEqual(savedPortableData.state, { debts: [], extra: 0 });
  console.log(`Executable smoke test passed at ${baseUrl}`);
} finally {
  child.kill("SIGTERM");
  await new Promise((resolveExit) => child.once("exit", resolveExit));
  await rm(testDirectory, { recursive: true, force: true });
}
