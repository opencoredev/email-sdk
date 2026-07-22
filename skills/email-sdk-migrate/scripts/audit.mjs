#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".md", ".mdx"]);
const ignored = new Set([".git", ".next", ".output", ".turbo", "coverage", "dist", "node_modules"]);
const patterns = [
  ["providers option", /\bproviders\s*:/g, "Rename to adapters."],
  ["defaultProvider option", /\bdefaultProvider\b/g, "Rename to defaultAdapter."],
  ["fallbackProviders option", /\bfallbackProviders\b/g, "Use fallback: { adapters: [...] }."],
  ["provider send option/event", /\bprovider\s*:/g, "Review Email SDK options/events and rename to adapter."],
  ["provider() helper", /\.provider\s*\(/g, "Use adapter(name)."],
  ["withProvider() helper", /\.withProvider\s*\(/g, "Use withAdapter(name)."],
  ["retry count", /\bretries\s*:/g, "Convert retry count to total maxAttempts."],
  ["sendBatch()", /\.sendBatch\s*\(/g, "Use sendMany([{ message, options }])."],
  ["recipientVariables", /\brecipientVariables\b/g, "Use sendPersonalized({ message, recipients })."],
  ["EmailProvider type", /\bEmailProvider(?:Context|Response|Error|NotFoundError)?\b/g, "Use the EmailAdapter/EmailSendResult v1 types."],
  ["legacy batch types", /\b(?:SendOptions|SendBatchItem|SendBatchResult|RecipientVariables)\b/g, "Use v1 Email-prefixed types."],
];

const findings = [];
await walk(root);

if (findings.length === 0) {
  console.log("No common Email SDK v0 migration patterns found.");
  process.exit(0);
}

console.log("# Email SDK migration audit\n");
console.log(`Scanned: ${root}\n`);
for (const finding of findings) {
  console.log(`- \`${finding.file}:${finding.line}\` **${finding.pattern}**: ${finding.guidance}`);
  console.log(`  - \`${finding.preview}\``);
}

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!extensions.has(extname(entry.name))) continue;
    await scan(path);
  }
}

async function scan(path) {
  const source = await readFile(path, "utf8");
  if (!source.includes("email-sdk") && !patterns.some(([, pattern]) => test(pattern, source))) return;

  const lines = source.split("\n");
  for (const [pattern, expression, guidance] of patterns) {
    for (const [index, line] of lines.entries()) {
      if (!test(expression, line)) continue;
      findings.push({
        file: relative(root, path),
        line: index + 1,
        pattern,
        guidance,
        preview: line.trim().slice(0, 180),
      });
    }
  }
}

function test(expression, value) {
  expression.lastIndex = 0;
  return expression.test(value);
}
