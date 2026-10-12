// Builds the unpacked extension into dist/ (load it from edge://extensions → "Load unpacked").
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const { version } = JSON.parse(readFileSync(join(root, "..", "version.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);

const common = { bundle: true, target: "chrome120", outdir: dist, absWorkingDir: root, logLevel: "warning", charset: "utf8" };
await build({ ...common, entryPoints: { background: "src/background/index.ts" }, format: "esm" });
await build({
  ...common,
  entryPoints: { warning: "src/pages/warning.ts", options: "src/pages/options.ts", popup: "src/pages/popup.ts" },
  format: "iife",
});

for (const file of ["warning.html", "options.html", "popup.html", "blank.html", "warning.css", "options.css"]) {
  cpSync(join(root, "src/pages", file), join(dist, file));
}
for (const file of ["tokens.css", "base.css"]) cpSync(join(root, "src/ui", file), join(dist, file));
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });

const manifest = JSON.parse(readFileSync(join(root, "src/manifest.json"), "utf8"));
manifest.version = version;
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

/** Chromium derives the extension id from the public key: sha256, first 32 hex digits mapped to a-p. */
export function extensionId(key) {
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");
}

console.log(`Built DopaDam extension ${version} → dist/ (id ${extensionId(manifest.key)})`);
