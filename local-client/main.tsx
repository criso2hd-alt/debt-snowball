import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Home, { type DebtState } from "../app/page";
import "../app/globals.css";
import "./local.css";

type Role = "admin" | "user";

type SessionUser = {
  id: string;
  username: string;
  role: Role;
  mustChangePassword: boolean;
};

type ManagedUser = SessionUser & {
  createdAt: string;
};

type StateResponse = {
  state: DebtState;
  version: number;
  updatedAt: string;
};

type DataFileInfo = {
  exists: boolean;
  path: string;
  modifiedAt?: string;
  size?: number;
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload as T;
}

function Login({
  onLogin,
}: {
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(username, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="lan-login">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand-orbit"><i /></span>
          <div>
            <strong>Debt Squasher</strong>
            <span>Private network access</span>
          </div>
        </div>
        <p className="login-eyebrow">SECURE LOCAL DASHBOARD</p>
        <h1>Welcome back.</h1>
        <p>Sign in to view and update the shared payoff plan.</p>
        <form onSubmit={submit}>
          <label>
            Username
            <input
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <small>First launch only: use <b>admin</b> / <b>admin</b>. You will be required to replace it immediately.</small>
      </section>
    </main>
  );
}

function PasswordDialog({
  forced,
  onClose,
  onChanged,
}: {
  forced: boolean;
  onClose: () => void;
  onChanged: (user: SessionUser) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: SessionUser }>("/api/account/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onChanged(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Password change failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="access-backdrop">
      <section className="access-dialog compact" role="dialog" aria-modal="true" aria-labelledby="password-title">
        {!forced && <button className="access-close" onClick={onClose} aria-label="Close">×</button>}
        <p className="login-eyebrow">{forced ? "FIRST-RUN SECURITY" : "ACCOUNT SECURITY"}</p>
        <h2 id="password-title">{forced ? "Choose a private password" : "Change your password"}</h2>
        <p>{forced ? "The starter password must be replaced before the dashboard can be opened." : "Use at least eight characters."}</p>
        <form className="access-form" onSubmit={submit}>
          <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
          <label>New password<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="access-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
        </form>
      </section>
    </div>
  );
}

function UserManager({
  currentUser,
  onClose,
}: {
  currentUser: SessionUser;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadUsers = useCallback(async () => {
    try {
      const result = await api<{ users: ManagedUser[] }>("/api/users");
      setUsers(result.users);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load users.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({ username, password, role }),
      });
      setUsername("");
      setPassword("");
      setRole("user");
      setNotice("User created.");
      await loadUsers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create user.");
    }
  }

  async function resetPassword(user: ManagedUser) {
    const nextPassword = resetPasswords[user.id] || "";
    setError("");
    setNotice("");
    try {
      await api(`/api/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ password: nextPassword }),
      });
      setResetPasswords((current) => ({ ...current, [user.id]: "" }));
      setNotice(`${user.username}'s password was reset.`);
      await loadUsers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reset password.");
    }
  }

  async function deleteUser(user: ManagedUser) {
    if (!window.confirm(`Delete access for ${user.username}?`)) return;
    setError("");
    setNotice("");
    try {
      await api(`/api/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      setNotice(`${user.username} was removed.`);
      await loadUsers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete user.");
    }
  }

  return (
    <div className="access-backdrop">
      <section className="access-dialog user-dialog" role="dialog" aria-modal="true" aria-labelledby="users-title">
        <button className="access-close" onClick={onClose} aria-label="Close">×</button>
        <p className="login-eyebrow">ADMINISTRATION</p>
        <h2 id="users-title">Access manager</h2>
        <p>Create accounts for people on your private network or reset existing passwords.</p>

        <form className="create-user-grid" onSubmit={createUser}>
          <label>Username<input value={username} minLength={3} maxLength={32} onChange={(event) => setUsername(event.target.value)} required /></label>
          <label>Starter password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <label>Role<select value={role} onChange={(event) => setRole(event.target.value as Role)}><option value="user">User</option><option value="admin">Admin</option></select></label>
          <button className="access-primary" type="submit">Add user</button>
        </form>

        {(error || notice) && <p className={error ? "form-error" : "form-notice"} role="status">{error || notice}</p>}

        <div className="user-list">
          {users.map((user) => (
            <article key={user.id}>
              <div className="user-identity">
                <span>{user.username.slice(0, 1).toUpperCase()}</span>
                <div><strong>{user.username}</strong><small>{user.role}{user.mustChangePassword ? " · password change required" : ""}</small></div>
              </div>
              <div className="reset-row">
                <input type="password" minLength={8} placeholder="New password" aria-label={`New password for ${user.username}`} value={resetPasswords[user.id] || ""} onChange={(event) => setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))} />
                <button onClick={() => void resetPassword(user)} disabled={(resetPasswords[user.id] || "").length < 8}>Reset</button>
                <button className="danger-button" onClick={() => void deleteUser(user)} disabled={user.id === currentUser.id}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function DataManager({
  onClose,
  onStateChanged,
}: {
  onClose: () => void;
  onStateChanged: (result: StateResponse) => void;
}) {
  const [info, setInfo] = useState<DataFileInfo | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshInfo = useCallback(async () => {
    try {
      setInfo(await api<DataFileInfo>("/api/data-file"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to check the data file.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshInfo(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshInfo]);

  async function saveFile() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<DataFileInfo>("/api/data-file/save", { method: "POST" });
      setInfo(saved);
      setNotice("DebtSquasherData.dat was saved beside the executable.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the data file.");
    } finally {
      setBusy(false);
    }
  }

  async function loadFile() {
    if (!window.confirm("Replace the current shared plan with DebtSquasherData.dat?")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<StateResponse>("/api/data-file/load", { method: "POST" });
      onStateChanged(result);
      setNotice("The shared plan was restored from DebtSquasherData.dat.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the data file.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPlan() {
    if (!window.confirm("Reset the shared plan? This removes every debt and sets the monthly extra to $0. Save a .dat backup first if you may need these numbers again.")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<StateResponse>("/api/data-file/reset", { method: "POST" });
      onStateChanged(result);
      setNotice("The shared plan is now blank.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reset the plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="access-backdrop">
      <section className="access-dialog compact" role="dialog" aria-modal="true" aria-labelledby="data-title">
        <button className="access-close" onClick={onClose} aria-label="Close">×</button>
        <p className="login-eyebrow">PORTABLE DATA</p>
        <h2 id="data-title">Backup or reset</h2>
        <p>The `.dat` file contains the shared debt plan, not usernames or passwords. Keep it private and do not include it when sharing the executable.</p>

        <div className="data-file-status">
          <span>{info?.exists ? "DATA FILE READY" : "NO DATA FILE YET"}</span>
          <strong>DebtSquasherData.dat</strong>
          <small>{info?.path ?? "Checking location…"}</small>
          {info?.modifiedAt && <small>Last saved {new Date(info.modifiedAt).toLocaleString()}</small>}
        </div>

        {(error || notice) && <p className={error ? "form-error" : "form-notice"} role="status">{error || notice}</p>}

        <div className="data-actions">
          <button className="access-primary" onClick={() => void saveFile()} disabled={busy}>Save current plan</button>
          <button onClick={() => void loadFile()} disabled={busy || !info?.exists}>Load saved plan</button>
          <button className="danger-button" onClick={() => void resetPlan()} disabled={busy}>Reset to blank</button>
        </div>
      </section>
    </div>
  );
}

function LocalApp() {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sharedState, setSharedState] = useState<DebtState | null>(null);
  const [showUsers, setShowUsers] = useState(false);
  const [showData, setShowData] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const version = useRef(0);

  const loadSession = useCallback(async () => {
    try {
      const result = await api<{ user: SessionUser }>("/api/auth/me");
      setUser(result.user);
    } catch {
      setUser(null);
    } finally {
      setChecking(false);
    }
  }, []);

  const loadState = useCallback(async () => {
    try {
      const result = await api<StateResponse>("/api/state");
      if (result.version !== version.current) {
        version.current = result.version;
        setSharedState(result.state);
      }
    } catch (reason) {
      if (reason instanceof Error && /sign in/i.test(reason.message)) {
        setUser(null);
      } else {
        setSyncMessage("Unable to refresh shared data.");
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSession(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSession]);

  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    const initialTimer = window.setTimeout(() => void loadState(), 0);
    const timer = window.setInterval(() => void loadState(), 3000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadState, user]);

  async function login(username: string, password: string) {
    const result = await api<{ user: SessionUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setUser(result.user);
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setSharedState(null);
    version.current = 0;
    setUser(null);
  }

  async function saveSharedState(nextState: DebtState) {
    setSharedState(nextState);
    setSyncMessage("Saving…");
    try {
      const result = await api<StateResponse>("/api/state", {
        method: "PUT",
        body: JSON.stringify({ state: nextState }),
      });
      version.current = result.version;
      setSharedState(result.state);
      setSyncMessage("Saved");
      window.setTimeout(() => setSyncMessage(""), 1800);
    } catch (reason) {
      setSyncMessage(reason instanceof Error ? reason.message : "Save failed.");
      await loadState();
    }
  }

  if (checking) {
    return <main className="lan-loading"><span className="brand-orbit"><i /></span><p>Opening Debt Squasher…</p></main>;
  }

  if (!user) {
    return <Login onLogin={login} />;
  }

  if (user.mustChangePassword) {
    return <PasswordDialog forced onClose={() => undefined} onChanged={(updatedUser) => setUser(updatedUser)} />;
  }

  if (!sharedState) {
    return <main className="lan-loading"><span className="brand-orbit"><i /></span><p>Loading the shared plan…</p></main>;
  }

  const controls = (
    <div className="lan-header-controls">
      {syncMessage && <span className="sync-status">{syncMessage}</span>}
      {user.role === "admin" && <button className="access-button" onClick={() => setShowUsers(true)}>Users</button>}
      {user.role === "admin" && <button className="access-button" onClick={() => setShowData(true)}>Data</button>}
      <button className="access-button" onClick={() => setShowPassword(true)}>Password</button>
      <button className="access-button signout" onClick={() => void logout()}>Sign out</button>
    </div>
  );

  return (
    <>
      <Home
        sharedState={sharedState}
        onSharedStateChange={(state) => void saveSharedState(state)}
        headerControls={controls}
        userDisplayName={user.username}
      />
      {showUsers && <UserManager currentUser={user} onClose={() => setShowUsers(false)} />}
      {showData && <DataManager onClose={() => setShowData(false)} onStateChanged={(result) => { version.current = result.version; setSharedState(result.state); }} />}
      {showPassword && <PasswordDialog forced={false} onClose={() => setShowPassword(false)} onChanged={(updatedUser) => { setUser(updatedUser); setShowPassword(false); }} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<LocalApp />);
