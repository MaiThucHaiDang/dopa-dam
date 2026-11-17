import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// No node_modules here: vitest and its plugins come from the extension's install.
export default {
  root: here,
  test: { include: ["test/**/*.test.ts"], environment: "node" },
  server: { fs: { allow: [join(here, "..")] } },
  resolve: { alias: { vitest: join(here, "..", "extension", "node_modules", "vitest", "dist", "index.js") } },
};
