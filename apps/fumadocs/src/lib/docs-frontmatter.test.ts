import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const docsDir = resolve(import.meta.dir, "../../content/docs");

function listMdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listMdxFiles(fullPath);
    return entry.name.endsWith(".mdx") ? [fullPath] : [];
  });
}

function parseFrontmatter(file: string): Record<string, string> {
  const content = readFileSync(file, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const keyValue = line.match(/^(\w+):\s*(.*)$/);
    if (keyValue) fields[keyValue[1]] = keyValue[2].replace(/^["']|["']$/g, "").trim();
  }
  return fields;
}

const pages = listMdxFiles(docsDir).map((file) => ({
  path: relative(docsDir, file),
  frontmatter: parseFrontmatter(file),
}));

describe("current docs frontmatter", () => {
  test("every page has a title", () => {
    const missing = pages.filter((page) => !page.frontmatter.title);
    expect(missing.map((page) => page.path)).toEqual([]);
  });

  test("every page has a SERP-friendly description (40-170 chars)", () => {
    const bad = pages.filter((page) => {
      const description = page.frontmatter.description ?? "";
      return description.length < 40 || description.length > 170;
    });
    expect(
      bad.map((page) => `${page.path} (${page.frontmatter.description?.length ?? 0})`),
    ).toEqual([]);
  });

  test("descriptions are unique across pages", () => {
    const byDescription = new Map<string, string[]>();
    for (const page of pages) {
      const description = page.frontmatter.description ?? "";
      byDescription.set(description, [...(byDescription.get(description) ?? []), page.path]);
    }
    const duplicates = [...byDescription.entries()].filter(([, paths]) => paths.length > 1);
    expect(duplicates).toEqual([]);
  });
});
