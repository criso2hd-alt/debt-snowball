/**
 * Version identity and the GitHub release check.
 *
 * The update check is deliberately manual: this app holds financial data and
 * makes no network requests of its own, and a silent background poll would
 * quietly tell github.com the user's IP and that they still run this app.
 * Nothing is contacted until the button is pressed.
 */

declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

export const GITHUB_OWNER = "criso2hd-alt";
export const GITHUB_REPO = "debt-snowball";
export const GITHUB_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
export const RELEASES_URL = `${GITHUB_URL}/releases/latest`;
export const SUPPORT_URL = "https://buymeacoffee.com/criso2hdj";

/** Numeric-only comparison; anything unparsable sorts as 0. */
function parts(version: string): number[] {
  return version.replace(/^v/i, "").split(/[.\-+]/).map((piece) => Number(piece) || 0);
}

/** > 0 when a is newer than b, < 0 when older, 0 when equivalent. */
export function compareVersions(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export type UpdateCheck =
  | { status: "current"; version: string }
  | { status: "available"; version: string; url: string; notes: string; published: string | null }
  | { status: "error"; message: string };

type GitHubRelease = {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
};

/**
 * Ask GitHub for the newest published release. Returns a result object rather
 * than throwing: a failed update check must never take the dashboard down.
 */
export async function checkForUpdate(
  current: string = APP_VERSION,
  signal?: AbortSignal,
): Promise<UpdateCheck> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      { headers: { accept: "application/vnd.github+json" }, signal, cache: "no-store" },
    );

    if (response.status === 404) {
      return { status: "error", message: "No releases have been published yet." };
    }
    if (response.status === 403) {
      return { status: "error", message: "GitHub is rate limiting this address. Try again in a little while." };
    }
    if (!response.ok) {
      return { status: "error", message: `GitHub replied ${response.status}.` };
    }

    const release = (await response.json()) as GitHubRelease;
    if (release.draft === true || release.prerelease === true) {
      return { status: "current", version: current };
    }

    const tag = typeof release.tag_name === "string" ? release.tag_name : "";
    if (!tag) return { status: "error", message: "That release has no version tag." };

    if (compareVersions(tag, current) <= 0) {
      return { status: "current", version: current };
    }

    const notes = typeof release.body === "string" ? release.body.trim().slice(0, 400) : "";
    return {
      status: "available",
      version: tag.replace(/^v/i, ""),
      url: typeof release.html_url === "string" ? release.html_url : RELEASES_URL,
      notes,
      published: typeof release.published_at === "string" ? release.published_at : null,
    };
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") {
      return { status: "error", message: "The check was cancelled." };
    }
    return { status: "error", message: "Could not reach GitHub. Check your internet connection." };
  }
}
