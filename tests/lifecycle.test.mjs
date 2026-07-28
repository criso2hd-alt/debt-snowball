import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Real durations are minutes; the server reads these so the behaviour can be
// exercised in seconds without changing what it does.
const FIRST_WINDOW_GRACE = 1500;
const IDLE_GRACE = 1000;

let nextPort = 9720;

async function startServer(context, extraArgs = []) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "ds-lifecycle-"));
  const port = nextPort++;
  const child = spawn(
    process.execPath,
    ["local-dist/server.cjs", `--port=${port}`, `--data-dir=${dataDirectory}`, "--no-open", ...extraArgs],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DEBT_SQUASHER_FIRST_WINDOW_GRACE_MS: String(FIRST_WINDOW_GRACE),
        DEBT_SQUASHER_IDLE_GRACE_MS: String(IDLE_GRACE),
      },
    },
  );

  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  const state = { exited: false, exitedAt: 0 };
  child.once("exit", () => { state.exited = true; state.exitedAt = Date.now(); });

  context.after(async () => {
    if (!state.exited) child.kill("SIGKILL");
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return { child, port, baseUrl, state, output: () => output };
}

/** A browser window: an open heartbeat stream that dies when the socket does. */
function openWindow(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`GET /api/heartbeat HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAccept: text/event-stream\r\n\r\n`);
    });
    socket.once("data", (chunk) => resolve({ socket, status: chunk.toString().split("\r\n")[0] }));
    socket.once("error", reject);
  });
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForExit(state, timeout) {
  const deadline = Date.now() + timeout;
  while (!state.exited && Date.now() < deadline) await settle(50);
  return state.exited;
}

test("stops once the last window closes", async (context) => {
  const server = await startServer(context, ["--auto-stop"]);

  const first = await openWindow(server.port);
  const second = await openWindow(server.port);
  assert.match(first.status, /200/);
  assert.match(second.status, /200/);

  // One window closing must not take the server down for everyone else.
  first.socket.destroy();
  await settle(IDLE_GRACE * 2);
  assert.equal(server.state.exited, false, "closing one of two windows should not stop the server");

  second.socket.destroy();
  assert.equal(await waitForExit(server.state, IDLE_GRACE + 4000), true, "the last window closing should stop the server");
  assert.match(server.output(), /Stopping Debt Squasher — the last window was closed/);
});

test("a reload does not stop the server", async (context) => {
  const server = await startServer(context, ["--auto-stop"]);

  const before = await openWindow(server.port);
  before.socket.destroy();
  // A reload reconnects well inside the grace window.
  await settle(IDLE_GRACE / 2);
  const after = await openWindow(server.port);
  assert.match(after.status, /200/);

  await settle(IDLE_GRACE * 3);
  assert.equal(server.state.exited, false, "reconnecting should cancel the pending shutdown");
  after.socket.destroy();
});

test("gives up when no window ever connects", async (context) => {
  const server = await startServer(context, ["--auto-stop"]);
  assert.equal(await waitForExit(server.state, FIRST_WINDOW_GRACE + 4000), true);
  assert.match(server.output(), /no browser window ever connected/);
});

test("connecting cancels the first-window deadline", async (context) => {
  const server = await startServer(context, ["--auto-stop"]);
  const window = await openWindow(server.port);

  await settle(FIRST_WINDOW_GRACE * 2);
  assert.equal(server.state.exited, false, "an open window should outlive the startup deadline");
  window.socket.destroy();
});

test("--keep-running leaves the server up with no windows", async (context) => {
  const server = await startServer(context, ["--auto-stop", "--keep-running"]);
  await settle(FIRST_WINDOW_GRACE * 2);
  assert.equal(server.state.exited, false);
  assert.match(server.output(), /Keep this window open/);
});

test("--no-open alone keeps the old always-on behaviour", async (context) => {
  const server = await startServer(context);
  await settle(FIRST_WINDOW_GRACE * 2);
  assert.equal(server.state.exited, false, "headless launches should not auto-stop unless asked");
});
