import { mkdir, readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const appRoot = new URL("..", import.meta.url).pathname;
const docsRoot = join(appRoot, "content/docs/ui");
const outputRoot = join(appRoot, "public/r");
const check = process.argv.includes("--check");
const categories = ["account", "product", "commerce"];

const pages = (
  await Promise.all(
    categories.map(async (category) => {
      const directory = join(docsRoot, category);
      return (await readdir(directory))
        .filter((file) => file.endsWith(".mdx"))
        .map((file) => join(directory, file));
    }),
  )
).flat();

await mkdir(outputRoot, { recursive: true });

const expectedFiles = new Set<string>();
let failed = false;

for (const pagePath of pages) {
  const source = await Bun.file(pagePath).text();
  const slug = basename(pagePath, ".mdx");
  const title = frontmatterValue(source, "title");
  const description = frontmatterValue(source, "description");
  const code = source.match(/```tsx title="([^"]+)"\n([\s\S]*?)\n```/);

  if (!code) {
    throw new Error(`Missing manual TSX block in ${relative(appRoot, pagePath)}`);
  }

  const [, target, content] = code;
  const registryTarget = target.replace(/^src\//, "");
  const outputPath = join(outputRoot, `${slug}.json`);
  const registryItem = {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: slug,
    type: "registry:component",
    title,
    description,
    dependencies: [
      "@opencoredev/email-sdk",
      "@react-email/render",
      "react",
      "react-dom",
    ],
    files: [
      {
        path: registryTarget,
        content: `${content}\n`,
        type: "registry:component",
        target: registryTarget,
      },
    ],
  };
  const expected = `${JSON.stringify(registryItem, null, 2)}\n`;
  expectedFiles.add(`${slug}.json`);

  if (check) {
    const current = await Bun.file(outputPath).text().catch(() => "");
    if (current !== expected) {
      console.error(`[email-registry] stale: ${relative(appRoot, outputPath)}`);
      failed = true;
    }
  } else {
    await Bun.write(outputPath, expected);
    console.log(`[email-registry] wrote ${relative(appRoot, outputPath)}`);
  }
}

for (const file of await readdir(outputRoot)) {
  if (file.endsWith(".json") && !expectedFiles.has(file)) {
    console.error(`[email-registry] unexpected: ${relative(appRoot, join(outputRoot, file))}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

if (check) {
  console.log(`[email-registry] ok: ${expectedFiles.size} templates`);
}

function frontmatterValue(source: string, key: string) {
  const match = source.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) {
    throw new Error(`Missing ${key} frontmatter`);
  }

  return match[1].trim();
}
