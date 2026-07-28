import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function request(baseUrl, path, { cookie, body, method = "GET" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json", origin: baseUrl } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

test("protects and shares LAN data across managed users", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "debt-squasher-test-"));
  const port = 9100 + (process.pid % 300);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      "local-dist/server.cjs",
      "--no-open",
      `--port=${port}`,
      `--data-dir=${dataDirectory}`,
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let childOutput = "";
  child.stdout.on("data", (chunk) => { childOutput += chunk; });
  child.stderr.on("data", (chunk) => { childOutput += chunk; });

  context.after(async () => {
    if (!child.killed) child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(dataDirectory, { recursive: true, force: true });
  });

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(ready, true, childOutput || "Server did not start.");

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Debt Squasher/);

  const anonymousState = await request(baseUrl, "/api/state");
  assert.equal(anonymousState.response.status, 401);

  const login = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "admin" },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.payload.user.mustChangePassword, true);
  const adminCookie = login.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(adminCookie);

  const blockedState = await request(baseUrl, "/api/state", { cookie: adminCookie });
  assert.equal(blockedState.response.status, 403);

  const changedAdmin = await request(baseUrl, "/api/account/password", {
    method: "PATCH",
    cookie: adminCookie,
    body: { currentPassword: "admin", newPassword: "AdminTest123!" },
  });
  assert.equal(changedAdmin.response.status, 200);
  assert.equal(changedAdmin.payload.user.mustChangePassword, false);

  const initialState = await request(baseUrl, "/api/state", { cookie: adminCookie });
  assert.equal(initialState.response.status, 200);
  assert.equal(initialState.payload.state.extra, 0);

  const savedState = await request(baseUrl, "/api/state", {
    method: "PUT",
    cookie: adminCookie,
    body: {
      state: {
        ...initialState.payload.state,
        extra: 333,
      },
    },
  });
  assert.equal(savedState.response.status, 200);
  assert.equal(savedState.payload.state.extra, 333);

  const savedFile = await request(baseUrl, "/api/data-file/save", {
    method: "POST",
    cookie: adminCookie,
  });
  assert.equal(savedFile.response.status, 200);
  assert.equal(savedFile.payload.exists, true);
  assert.match(savedFile.payload.path, /DebtSquasherData\.dat$/);

  const resetState = await request(baseUrl, "/api/data-file/reset", {
    method: "POST",
    cookie: adminCookie,
  });
  assert.equal(resetState.response.status, 200);
  assert.deepEqual(resetState.payload.state, { debts: [], extra: 0 });

  const restoredState = await request(baseUrl, "/api/data-file/load", {
    method: "POST",
    cookie: adminCookie,
  });
  assert.equal(restoredState.response.status, 200);
  assert.equal(restoredState.payload.state.extra, 333);

  const created = await request(baseUrl, "/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: {
      username: "household",
      password: "Starter123!",
      role: "user",
    },
  });
  assert.equal(created.response.status, 201);

  const userLogin = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { username: "household", password: "Starter123!" },
  });
  const userCookie = userLogin.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(userCookie);

  const changedUser = await request(baseUrl, "/api/account/password", {
    method: "PATCH",
    cookie: userCookie,
    body: { currentPassword: "Starter123!", newPassword: "Household123!" },
  });
  assert.equal(changedUser.response.status, 200);

  const sharedState = await request(baseUrl, "/api/state", { cookie: userCookie });
  assert.equal(sharedState.response.status, 200);
  assert.equal(sharedState.payload.state.extra, 333);

  const forbiddenUsers = await request(baseUrl, "/api/users", { cookie: userCookie });
  assert.equal(forbiddenUsers.response.status, 403);
});
