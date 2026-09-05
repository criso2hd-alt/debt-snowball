"use client";

import { useSyncExternalStore } from "react";
import { SUPPORT_URL } from "../lib/release";

const DISMISS_KEY = "debt-snowball-hide-support";

/**
 * Read once and cached: localStorage is synchronous and getSnapshot must return
 * a stable value or React re-renders forever.
 */
let dismissed: boolean | null = null;
const listeners = new Set<() => void>();

function isDismissed(): boolean {
  if (dismissed === null) {
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      dismissed = false;
    }
  }
  return dismissed;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function rememberDismissal(): void {
  dismissed = true;
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // A blocked storage API only costs us the memory of the dismissal.
  }
  for (const listener of listeners) listener();
}

/**
 * Buy Me a Coffee prompt, dismissible for good.
 *
 * The button is drawn locally rather than pulled from buymeacoffee's CDN. This
 * app is offline-first and holds financial data, so loading a remote image on
 * every launch would hand a third party the user's IP and the fact that they
 * still run it. Nothing leaves the machine until the link is actually clicked.
 */
export default function SupportBanner() {
  // Hidden in the server snapshot so the banner never flashes for someone who
  // already dismissed it.
  const hidden = useSyncExternalStore(subscribe, isDismissed, () => true);
  if (hidden) return null;

  return (
    <aside className="support-banner">
      <span className="support-cup" aria-hidden="true">☕</span>
      <div className="support-copy">
        <strong>This app is free, and has no ads or tracking</strong>
        <p>If it helped you get a handle on your payoff plan, you can buy me a coffee.</p>
      </div>
      <a className="support-link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
        Buy me a coffee
      </a>
      <button className="support-dismiss" onClick={rememberDismissal} aria-label="Hide this for good" title="Hide for good">
        ×
      </button>
    </aside>
  );
}
