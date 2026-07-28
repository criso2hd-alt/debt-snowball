import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: resolve(fileURLToPath(new URL(".", import.meta.url)), "local-client"),
  plugins: [react()],
  build: {
    outDir: resolve(fileURLToPath(new URL(".", import.meta.url)), "local-dist", "client"),
    emptyOutDir: true,
  },
});
