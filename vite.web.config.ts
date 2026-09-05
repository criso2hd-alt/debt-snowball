import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

/**
 * Static single-page build.
 *
 * Defaults to the GitHub Pages project subpath. Override with WEB_BASE to serve
 * from somewhere else, using the literal word "root" for a domain root: Git
 * Bash on Windows rewrites a bare "/" into the MSYS install path, which
 * silently produces an unloadable build.
 */
const configuredBase = process.env.WEB_BASE?.trim();
const base = !configuredBase
  ? "/debt-snowball/"
  : configuredBase === "root" || configuredBase === "/"
    ? "/"
    : configuredBase;

export default defineConfig({
  root: resolve(here, "web"),
  base,
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    outDir: resolve(here, "web-dist"),
    emptyOutDir: true,
  },
});
