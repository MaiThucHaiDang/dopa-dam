// Generates per-platform token files from tokens.json and checks WCAG AA contrast.
// Usage: node shared/design-tokens/generate.mjs [--check]
//   --check  fail if a generated file is missing or out of date (no writes)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const tokens = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));
const checkOnly = process.argv.includes("--check");

const HEADER = "Generated from shared/design-tokens/tokens.json. Do not edit by hand.";

function kebab(name) {
  return name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

function pascal(name) {
  return name[0].toUpperCase() + name.slice(1);
}

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function css() {
  const lines = [`/* ${HEADER} */`, ":root {"];
  for (const [k, v] of Object.entries(tokens.color)) lines.push(`  --dd-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(tokens.fontSize)) lines.push(`  --dd-font-${kebab(k)}: ${v}px;`);
  for (const [k, v] of Object.entries(tokens.radius)) lines.push(`  --dd-radius-${kebab(k)}: ${v}px;`);
  for (const [k, v] of Object.entries(tokens.space)) lines.push(`  --dd-space-${kebab(k)}: ${v}px;`);
  lines.push("  color-scheme: dark;", "}", "");
  return lines.join("\n");
}

function kotlin() {
  const lines = [
    `// ${HEADER}`,
    "package com.dang.dopadam.ui.theme",
    "",
    "import androidx.compose.ui.graphics.Color",
    "import androidx.compose.ui.unit.dp",
    "import androidx.compose.ui.unit.sp",
    "",
    "object Tokens {",
  ];
  for (const [k, v] of Object.entries(tokens.color)) {
    lines.push(`    val ${pascal(k)} = Color(0xFF${v.slice(1).toUpperCase()})`);
  }
  for (const [k, v] of Object.entries(tokens.fontSize)) lines.push(`    val Font${pascal(k)} = ${v}.sp`);
  for (const [k, v] of Object.entries(tokens.radius)) lines.push(`    val Radius${pascal(k)} = ${v}.dp`);
  for (const [k, v] of Object.entries(tokens.space)) lines.push(`    val Space${pascal(k)} = ${v}.dp`);
  lines.push("}", "");
  return lines.join("\n");
}

const outputs = [
  ["extension/src/ui/tokens.css", css()],
  ["agent/ui/src/tokens.css", css()],
  ["android/app/src/main/java/com/dang/dopadam/ui/theme/Tokens.kt", kotlin()],
];

let failed = false;

for (const [a, b] of tokens.contrastPairs) {
  const ratio = contrast(tokens.color[a], tokens.color[b]);
  const ok = ratio >= 4.5;
  console.log(`${ok ? "ok  " : "FAIL"} ${a} on ${b}: ${ratio.toFixed(2)}:1`);
  if (!ok) failed = true;
}

for (const [rel, content] of outputs) {
  const path = join(root, rel);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (checkOnly) {
    if (current !== content) {
      console.log(`STALE ${rel}`);
      failed = true;
    }
  } else if (current !== content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`wrote ${rel}`);
  }
}

if (failed) process.exit(1);
