// Builds the static page into dist/ (relative URLs only, so it works from any sub-path).
// esbuild comes from the extension's install: nothing is installed for this folder.
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const extension = join(root, "..", "extension");
const { build } = createRequire(join(extension, "package.json"))("esbuild");
const dist = join(root, "dist");
const { version } = JSON.parse(readFileSync(join(root, "..", "version.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);

await build({
  entryPoints: { app: join(root, "src/main.ts") },
  bundle: true,
  format: "iife",
  target: "safari15",
  outdir: dist,
  absWorkingDir: root,
  tsconfig: join(root, "tsconfig.json"),
  minify: false,
  logLevel: "warning",
  charset: "utf8",
});

// Shared look: the design tokens and base styles of the extension.
for (const file of ["tokens.css", "base.css"]) cpSync(join(extension, "src/ui", file), join(dist, file));
for (const file of ["index.html", "ios.css", "manifest.webmanifest"]) cpSync(join(root, "public", file), join(dist, file));
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// The service worker precaches every file of the page; its cache name changes whenever any of them changes.
const files = walk(dist).map((p) => relative(dist, p).split("\\").join("/")).sort();
const hash = createHash("sha256");
for (const f of files) hash.update(f).update(readFileSync(join(dist, f)));
const buildId = `${version}-${hash.digest("hex").slice(0, 10)}`;
const precache = ["./", ...files];
const sw = readFileSync(join(root, "public/sw.js"), "utf8").replaceAll("__BUILD__", buildId).replaceAll("__FILES__", JSON.stringify(precache));
writeFileSync(join(dist, "sw.js"), sw);

console.log(`Built DopaDam for iPhone ${buildId} → ios/dist (${files.length + 1} files)`);
