import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default defineConfig({
  root: resolve(fileURLToPath(new URL(".", import.meta.url)), "local-client"),
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  build: {
    outDir: resolve(fileURLToPath(new URL(".", import.meta.url)), "local-dist", "client"),
    emptyOutDir: true,
  },
});
