import { spawn } from "node:child_process";
import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir, networkInterfaces } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { isSea, getAsset } from "node:sea";

type Role = "admin" | "user";

type Debt = {
  id: number;
  name: string;
  balance: number;
  original: number;
  apr: number;
  minimum: number;
  dueDay: number;
  accent: string;
  mark: string;
};

type DebtState = {
  debts: Debt[];
  extra: number;
  strategy: "snowball" | "avalanche";
};

type StoredUser = {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  mustChangePassword: boolean;
  createdAt: string;
};

type Store = {
  users: StoredUser[];
  state: DebtState;
  version: number;
  updatedAt: string;
};

type Session = {
  userId: string;
  expiresAt: number;
};

type PublicUser = Omit<StoredUser, "passwordHash">;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_STATE: DebtState = {
  debts: [],
  extra: 0,
  strategy: "snowball",
};

const SESSION_COOKIE = "debt_squasher_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const sessions = new Map<string, Session>();
const loginAttempts = new Map<string, { failures: number; blockedUntil: number }>();

const args = new Set(process.argv.slice(2));
const requestedPort = Number(
  process.argv.find((value) => value.startsWith("--port="))?.slice(7)
    ?? process.env.DEBT_SQUASHER_PORT
    ?? 8787,
);
const cliDataDir = process.argv.find((value) => value.startsWith("--data-dir="))?.slice(11);
const defaultDataRoot =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support")
    : process.env.LOCALAPPDATA
      ?? process.env.APPDATA
      ?? dirname(process.execPath);
const dataDirectory = resolve(
  cliDataDir
    ?? process.env.DEBT_SQUASHER_DATA_DIR
    ?? join(defaultDataRoot, "DebtSquasher"),
);
const storePath = join(dataDirectory, "debt-squasher-data.json");
const executableDirectory = isSea()
  ? process.platform === "darwin"
    ? dirname(process.execPath)
    : dirname(process.execPath)
  : dirname(resolve(process.argv[1] ?? process.cwd()));
const portableDataPath = join(executableDirectory, "DebtSquasherData.dat");
const developmentClientDirectory = resolve(process.cwd(), "local-dist", "client");

/**
 * Every open window holds a /api/heartbeat stream. When the last one goes away
 * the server stops itself, so closing the browser does not leave a process
 * listening in the background.
 *
 * On by default. --no-open implies a headless launch where no window was ever
 * expected, so it turns this off unless --auto-stop asks for it back.
 * --keep-running always wins: that is an intentional always-on LAN server.
 */
const autoStopEnabled = !args.has("--keep-running")
  && (args.has("--auto-stop") || !args.has("--no-open"));
function graceMs(variable: string, fallback: number): number {
  const value = Number(process.env[variable]);
  return Number.isFinite(value) && value >= 250 && value <= 3_600_000 ? value : fallback;
}

/** How long to wait for the first window before giving up on one arriving. */
const FIRST_WINDOW_GRACE_MS = graceMs("DEBT_SQUASHER_FIRST_WINDOW_GRACE_MS", 2 * 60 * 1000);
/** Long enough to survive a page reload, short enough to feel like quitting. */
const IDLE_GRACE_MS = graceMs("DEBT_SQUASHER_IDLE_GRACE_MS", 15 * 1000);
/** Bounds the memory an unauthenticated caller can pin by opening streams. */
const MAX_OPEN_WINDOWS = 64;

const openWindows = new Set<ServerResponse>();
let idleTimer: NodeJS.Timeout | null = null;
let stopServer: ((reason: string) => void) | null = null;

let store: Store;
let saveQueue = Promise.resolve();

function cancelIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function startIdleTimer(delay: number, reason: string): void {
  if (!autoStopEnabled) return;
  cancelIdleTimer();
  idleTimer = setTimeout(() => stopServer?.(reason), delay);
}

function passwordKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolveKey, reject) => {
    scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolveKey(derivedKey);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await passwordKey(password, salt);
  return `${salt}:${key.toString("hex")}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await passwordKey(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function publicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  };
}

async function freshStore(): Promise<Store> {
  return {
    users: [
      {
        id: randomUUID(),
        username: "admin",
        passwordHash: await hashPassword("admin"),
        role: "admin",
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
      },
    ],
    state: DEFAULT_STATE,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

async function loadStore(): Promise<Store> {
  await mkdir(dataDirectory, { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Store;
    if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
      throw new Error("No users found.");
    }
    parsed.state = validateState(parsed.state);
    parsed.version = Number.isSafeInteger(parsed.version) ? parsed.version : 1;
    parsed.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString();
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      const backup = `${storePath}.corrupt-${Date.now()}`;
      await copyFile(storePath, backup).catch(() => undefined);
      console.error(`The data file could not be read. A backup was saved to:\n  ${backup}`);
    }
    const created = await freshStore();
    await writeStore(created);
    return created;
  }
}

async function writeStore(value: Store): Promise<void> {
  const temporaryPath = `${storePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await rename(temporaryPath, storePath);
  } catch {
    await copyFile(temporaryPath, storePath);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function persistStore(): Promise<void> {
  const snapshot = structuredClone(store);
  saveQueue = saveQueue.then(() => writeStore(snapshot));
  return saveQueue;
}

async function savePortableData(): Promise<void> {
  const payload = {
    application: "Debt Squasher",
    formatVersion: 1,
    savedAt: new Date().toISOString(),
    state: store.state,
  };
  const temporaryPath = `${portableDataPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    await rename(temporaryPath, portableDataPath);
  } catch {
    await copyFile(temporaryPath, portableDataPath);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function portableDataInfo(): Promise<{ exists: boolean; path: string; modifiedAt?: string; size?: number }> {
  try {
    const details = await stat(portableDataPath);
    return {
      exists: true,
      path: portableDataPath,
      modifiedAt: details.mtime.toISOString(),
      size: details.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, path: portableDataPath };
    }
    throw error;
  }
}

function finiteNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, `${label} is invalid.`);
  }
  return value;
}

function validateState(value: unknown): DebtState {
  if (!value || typeof value !== "object") {
    throw new HttpError(400, "The debt plan is invalid.");
  }
  const candidate = value as Partial<DebtState>;
  if (!Array.isArray(candidate.debts) || candidate.debts.length > 100) {
    throw new HttpError(400, "The debt list is invalid.");
  }

  const ids = new Set<number>();
  const debts = candidate.debts.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new HttpError(400, `Debt ${index + 1} is invalid.`);
    }
    const debt = item as Partial<Debt>;
    const id = finiteNumber(debt.id, "Debt id", 1, Number.MAX_SAFE_INTEGER);
    if (!Number.isInteger(id) || ids.has(id)) {
      throw new HttpError(400, "Debt ids must be unique integers.");
    }
    ids.add(id);
    if (typeof debt.name !== "string" || debt.name.trim().length < 1 || debt.name.length > 80) {
      throw new HttpError(400, "A debt name is invalid.");
    }
    if (typeof debt.accent !== "string" || !/^#[0-9a-f]{6}$/i.test(debt.accent)) {
      throw new HttpError(400, "A debt color is invalid.");
    }
    if (typeof debt.mark !== "string" || debt.mark.length > 8) {
      throw new HttpError(400, "A debt symbol is invalid.");
    }
    return {
      id,
      name: debt.name.trim(),
      balance: finiteNumber(debt.balance, "Balance", 0, 1_000_000_000),
      original: finiteNumber(debt.original, "Original balance", 0.01, 1_000_000_000),
      apr: finiteNumber(debt.apr, "APR", 0, 1000),
      minimum: finiteNumber(debt.minimum, "Minimum payment", 0, 10_000_000),
      dueDay: Math.trunc(finiteNumber(debt.dueDay, "Due day", 1, 31)),
      accent: debt.accent,
      mark: debt.mark,
    };
  });

  return {
    debts,
    extra: finiteNumber(candidate.extra, "Monthly snowball", 0, 10_000_000),
    strategy: candidate.strategy === "avalanche" ? "avalanche" : "snowball",
  };
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [decodeURIComponent(key), decodeURIComponent(value)]),
  );
}

function currentUser(request: IncomingMessage): StoredUser | null {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return store.users.find((user) => user.id === session.userId) ?? null;
}

function requireUser(request: IncomingMessage, allowPasswordChange = false): StoredUser {
  const user = currentUser(request);
  if (!user) throw new HttpError(401, "Please sign in.");
  if (user.mustChangePassword && !allowPasswordChange) {
    throw new HttpError(403, "Change the starter password before continuing.");
  }
  return user;
}

function requireAdmin(request: IncomingMessage): StoredUser {
  const user = requireUser(request);
  if (user.role !== "admin") throw new HttpError(403, "Administrator access is required.");
  return user;
}

function mutationIsSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, "Request is too large.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function setSessionCookie(response: ServerResponse, token: string): void {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`,
  );
}

function clearSessionCookie(response: ServerResponse): void {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
  );
}

function assertUsername(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(value)) {
    throw new HttpError(400, "Username must be 3–32 letters, numbers, dots, dashes, or underscores.");
  }
  return value.toLowerCase();
}

function assertPassword(value: unknown, allowStarter = false): string {
  if (typeof value !== "string" || (!allowStarter && value.length < 8) || value.length > 128) {
    throw new HttpError(400, "Password must contain 8–128 characters.");
  }
  return value;
}

function clearUserSessions(userId: string, exceptToken?: string): void {
  for (const [token, session] of sessions) {
    if (session.userId === userId && token !== exceptToken) sessions.delete(token);
  }
}

function sessionToken(request: IncomingMessage): string | undefined {
  return parseCookies(request)[SESSION_COOKIE];
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!pathname.startsWith("/api/")) return false;
  const method = request.method ?? "GET";
  if (!["GET", "HEAD"].includes(method) && !mutationIsSameOrigin(request)) {
    throw new HttpError(403, "Cross-origin request rejected.");
  }

  // Deliberately unauthenticated: someone sitting on the sign-in screen still
  // has a window open, and shutting down underneath them would be wrong.
  if (pathname === "/api/heartbeat" && method === "GET") {
    if (openWindows.size >= MAX_OPEN_WINDOWS) {
      throw new HttpError(503, "Too many open windows.");
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    response.write(": open\n\n");
    openWindows.add(response);
    cancelIdleTimer();

    // Traffic keeps proxies and idle-connection reapers from closing the stream.
    const ping = setInterval(() => response.write(": ping\n\n"), 25_000);
    const released = () => {
      clearInterval(ping);
      if (openWindows.delete(response) && openWindows.size === 0) {
        startIdleTimer(IDLE_GRACE_MS, "the last window was closed");
      }
    };
    request.once("close", released);
    response.once("close", released);
    return true;
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    const ip = request.socket.remoteAddress ?? "unknown";
    const attempt = loginAttempts.get(ip);
    if (attempt && attempt.blockedUntil > Date.now()) {
      throw new HttpError(429, "Too many attempts. Try again in five minutes.");
    }
    const body = await jsonBody(request);
    const username = typeof body.username === "string" ? body.username.toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = store.users.find((candidate) => candidate.username.toLowerCase() === username);
    const valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !valid) {
      const failures = (attempt?.failures ?? 0) + 1;
      loginAttempts.set(ip, {
        failures,
        blockedUntil: failures >= 8 ? Date.now() + 5 * 60 * 1000 : 0,
      });
      throw new HttpError(401, "Incorrect username or password.");
    }
    loginAttempts.delete(ip);
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    setSessionCookie(response, token);
    sendJson(response, 200, { user: publicUser(user) });
    return true;
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    const token = sessionToken(request);
    if (token) sessions.delete(token);
    clearSessionCookie(response);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/auth/me" && method === "GET") {
    const user = requireUser(request, true);
    sendJson(response, 200, { user: publicUser(user) });
    return true;
  }

  if (pathname === "/api/account/password" && method === "PATCH") {
    const user = requireUser(request, true);
    const body = await jsonBody(request);
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = assertPassword(body.newPassword);
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new HttpError(400, "Current password is incorrect.");
    }
    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    const token = sessionToken(request);
    clearUserSessions(user.id, token);
    await persistStore();
    sendJson(response, 200, { user: publicUser(user) });
    return true;
  }

  if (pathname === "/api/state" && method === "GET") {
    requireUser(request);
    sendJson(response, 200, {
      state: store.state,
      version: store.version,
      updatedAt: store.updatedAt,
    });
    return true;
  }

  if (pathname === "/api/state" && method === "PUT") {
    requireUser(request);
    const body = await jsonBody(request);
    store.state = validateState(body.state);
    store.version += 1;
    store.updatedAt = new Date().toISOString();
    await persistStore();
    sendJson(response, 200, {
      state: store.state,
      version: store.version,
      updatedAt: store.updatedAt,
    });
    return true;
  }

  if (pathname === "/api/data-file" && method === "GET") {
    requireAdmin(request);
    sendJson(response, 200, await portableDataInfo());
    return true;
  }

  if (pathname === "/api/data-file/save" && method === "POST") {
    requireAdmin(request);
    await savePortableData();
    sendJson(response, 200, {
      ok: true,
      ...await portableDataInfo(),
    });
    return true;
  }

  if (pathname === "/api/data-file/load" && method === "POST") {
    requireAdmin(request);
    let payload: unknown;
    try {
      payload = JSON.parse(await readFile(portableDataPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new HttpError(404, "DebtSquasherData.dat was not found beside the executable.");
      }
      if (error instanceof SyntaxError) {
        throw new HttpError(400, "DebtSquasherData.dat is not valid.");
      }
      throw error;
    }
    const portable = payload as { application?: unknown; formatVersion?: unknown; state?: unknown };
    if (portable.application !== "Debt Squasher" || portable.formatVersion !== 1) {
      throw new HttpError(400, "This is not a supported Debt Squasher data file.");
    }
    store.state = validateState(portable.state);
    store.version += 1;
    store.updatedAt = new Date().toISOString();
    await persistStore();
    sendJson(response, 200, {
      state: store.state,
      version: store.version,
      updatedAt: store.updatedAt,
    });
    return true;
  }

  if (pathname === "/api/data-file/reset" && method === "POST") {
    requireAdmin(request);
    store.state = { debts: [], extra: 0, strategy: "snowball" };
    store.version += 1;
    store.updatedAt = new Date().toISOString();
    await persistStore();
    sendJson(response, 200, {
      state: store.state,
      version: store.version,
      updatedAt: store.updatedAt,
    });
    return true;
  }

  if (pathname === "/api/users" && method === "GET") {
    requireAdmin(request);
    sendJson(response, 200, {
      users: store.users.map(publicUser).sort((a, b) => a.username.localeCompare(b.username)),
    });
    return true;
  }

  if (pathname === "/api/users" && method === "POST") {
    requireAdmin(request);
    const body = await jsonBody(request);
    const username = assertUsername(body.username);
    const password = assertPassword(body.password);
    const role: Role = body.role === "admin" ? "admin" : "user";
    if (store.users.some((user) => user.username.toLowerCase() === username)) {
      throw new HttpError(409, "That username already exists.");
    }
    const user: StoredUser = {
      id: randomUUID(),
      username,
      passwordHash: await hashPassword(password),
      role,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    await persistStore();
    sendJson(response, 201, { user: publicUser(user) });
    return true;
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && method === "PATCH") {
    requireAdmin(request);
    const user = store.users.find((candidate) => candidate.id === decodeURIComponent(userMatch[1]));
    if (!user) throw new HttpError(404, "User not found.");
    const body = await jsonBody(request);
    user.passwordHash = await hashPassword(assertPassword(body.password));
    user.mustChangePassword = true;
    clearUserSessions(user.id);
    await persistStore();
    sendJson(response, 200, { user: publicUser(user) });
    return true;
  }

  if (userMatch && method === "DELETE") {
    const admin = requireAdmin(request);
    const userId = decodeURIComponent(userMatch[1]);
    const user = store.users.find((candidate) => candidate.id === userId);
    if (!user) throw new HttpError(404, "User not found.");
    if (user.id === admin.id) throw new HttpError(400, "You cannot delete your own account.");
    if (user.role === "admin" && store.users.filter((candidate) => candidate.role === "admin").length === 1) {
      throw new HttpError(400, "The final administrator cannot be deleted.");
    }
    store.users = store.users.filter((candidate) => candidate.id !== user.id);
    clearUserSessions(user.id);
    await persistStore();
    sendJson(response, 200, { ok: true });
    return true;
  }

  throw new HttpError(404, "API endpoint not found.");
}

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function staticAsset(key: string): Promise<Buffer> {
  if (isSea()) {
    return Buffer.from(getAsset(key));
  }
  return readFile(join(developmentClientDirectory, key));
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  let key = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  key = normalize(key).replaceAll("\\", "/");
  if (key.startsWith("../") || key.includes("/../")) throw new HttpError(400, "Invalid path.");
  try {
    const body = await staticAsset(key);
    securityHeaders(response);
    response.statusCode = 200;
    response.setHeader("Content-Type", mimeTypes[extname(key).toLowerCase()] ?? "application/octet-stream");
    response.setHeader(
      "Cache-Control",
      key.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    );
    response.end(body);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const body = await staticAsset("index.html");
      securityHeaders(response);
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache");
      response.end(body);
      return;
    }
    throw error;
  }
}

function localAddresses(port: number): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const address of entries ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        addresses.add(`http://${address.address}:${port}`);
      }
    }
  }
  return [...addresses];
}

function openBrowser(url: string): void {
  if (args.has("--no-open")) return;
  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/d", "/s", "/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } else if (process.platform === "darwin") {
    const child = spawn("open", [url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

async function start(): Promise<void> {
  store = await loadStore();
  if (args.has("--reset-admin")) {
    let admin = store.users.find((user) => user.username === "admin");
    if (!admin) {
      admin = {
        id: randomUUID(),
        username: "admin",
        passwordHash: "",
        role: "admin",
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
      };
      store.users.push(admin);
    }
    admin.passwordHash = await hashPassword("admin");
    admin.role = "admin";
    admin.mustChangePassword = true;
    clearUserSessions(admin.id);
    await persistStore();
    console.log("\nThe admin password was reset to: admin");
    console.log("You will be required to replace it after signing in.");
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (await handleApi(request, response, url.pathname)) return;
      if (!["GET", "HEAD"].includes(request.method ?? "GET")) {
        throw new HttpError(405, "Method not allowed.");
      }
      await serveStatic(response, url.pathname);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Unexpected server error.";
      if (!(error instanceof HttpError)) console.error(error);
      sendJson(response, status, { error: message });
    }
  });

  let port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536
    ? requestedPort
    : 8787;

  await new Promise<void>((resolveListening, reject) => {
    const tryListen = () => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && port < requestedPort + 10) {
          port += 1;
          tryListen();
        } else {
          reject(error);
        }
      };
      const onListening = () => {
        server.off("error", onError);
        resolveListening();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "0.0.0.0");
    };
    tryListen();
  });

  const localUrl = `http://127.0.0.1:${port}`;
  const networkUrls = localAddresses(port);
  console.log("\nDebt Squasher is running.");
  console.log(`\nThis computer:\n  ${localUrl}`);
  if (networkUrls.length) {
    console.log(`\nPrivate-network access:\n${networkUrls.map((url) => `  ${url}`).join("\n")}`);
  }
  console.log(`\nData folder:\n  ${dataDirectory}`);
  if (store.users.some((user) => user.username === "admin" && user.mustChangePassword)) {
    console.log("\nFirst sign-in:\n  Username: admin\n  Password: admin\n  You must choose a new password immediately.");
  }
  if (autoStopEnabled) {
    console.log("\nThis window closes on its own once you close the app in your browser.");
    console.log("Press Ctrl+C to stop it now, or start with --keep-running to leave it up.");
  } else {
    console.log("\nKeep this window open. Press Ctrl+C or close it to stop the server.");
  }
  console.log("If Windows Firewall asks, allow access on Private networks only.\n");
  openBrowser(localUrl);

  let stopping = false;
  const shutdown = (reason: string) => {
    if (stopping) return;
    stopping = true;
    cancelIdleTimer();
    console.log(`\nStopping Debt Squasher — ${reason}…`);

    // Heartbeat streams never end on their own, so close() would wait forever.
    for (const window of openWindows) window.end();
    openWindows.clear();
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 2000).unref();
  };

  stopServer = shutdown;
  process.once("SIGINT", () => shutdown("you pressed Ctrl+C"));
  process.once("SIGTERM", () => shutdown("the system asked it to stop"));
  process.once("SIGHUP", () => shutdown("this window was closed"));
  process.once("SIGBREAK", () => shutdown("this window was closed"));

  // If the browser never reaches the server there is nothing to wait for.
  startIdleTimer(FIRST_WINDOW_GRACE_MS, "no browser window ever connected");
}

void start().catch((error) => {
  console.error("\nDebt Squasher could not start.");
  console.error(error);
  process.exitCode = 1;
});
