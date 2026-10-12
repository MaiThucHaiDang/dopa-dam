import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "ui",
  plugins: [react()],
  // The UI reuses the extension's TypeScript core (domain and link parsing, labels).
  resolve: { alias: { "@core": fileURLToPath(new URL("../extension/src/core", import.meta.url)) } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: [here, fileURLToPath(new URL("../extension/src", import.meta.url))] } },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2021" },
  test: { root: ".", include: ["ui/test/**/*.test.ts"] },
});
