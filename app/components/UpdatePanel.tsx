"use client";

import { useState } from "react";
import {
  APP_VERSION,
  GITHUB_URL,
  RELEASES_URL,
  type UpdateCheck,
  checkForUpdate,
} from "../lib/release";

/**
 * Manual update check against the project's GitHub releases.
 *
 * Nothing is contacted until the button is pressed — no background polling,
 * no launch-time ping. See app/lib/release.ts for why.
 */
export default function UpdatePanel() {
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await checkForUpdate());
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="update-panel">
      <div className="update-head">
        <div>
          <p className="card-label">VERSION</p>
          <strong className="panel-title">You are running {APP_VERSION}</strong>
          <p className="panel-note">
            Checks the releases on GitHub. Nothing is sent when you press it beyond the request itself —
            no balances, no account names, nothing about your plan.
          </p>
        </div>
        <button className="btn-primary" onClick={() => void run()} disabled={busy}>
          {busy ? "Checking…" : "Check for updates"}
        </button>
      </div>

      {result?.status === "current" && (
        <p className="update-result current">
          <span aria-hidden="true">✓</span> You are on the latest release.
        </p>
      )}

      {result?.status === "error" && (
        <p className="update-result error">
          <span aria-hidden="true">!</span> {result.message}
        </p>
      )}

      {result?.status === "available" && (
        <div className="update-result available">
          <div>
            <strong>Version {result.version} is available</strong>
            {result.published && (
              <span> · published {new Date(result.published).toLocaleDateString()}</span>
            )}
            {result.notes && <p className="update-notes">{result.notes}</p>}
            <p className="update-how">
              Download the new build, quit this one, and replace the old file. Your data is stored
              separately and is not touched by an update.
            </p>
          </div>
          <a className="btn-primary" href={result.url} target="_blank" rel="noopener noreferrer">
            Open the download
          </a>
        </div>
      )}

      <p className="update-links">
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">Source and wiki</a>
        <span aria-hidden="true">·</span>
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">All releases</a>
      </p>
    </article>
  );
}
