import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

type PackageJson = {
  version: string;
};

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJsonPath = join(root, "packages/email-sdk/package.json");
const formulaPath = join(root, "Formula/email-sdk.rb");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageJson;
const version = packageJson.version;
const tarballUrl = `https://registry.npmjs.org/@opencoredev/email-sdk/-/email-sdk-${version}.tgz`;
const sha256 = await resolvePublishedSha(tarballUrl);

let formula = await readFile(formulaPath, "utf8");
formula = formula.replace(
  /url "https:\/\/registry\.npmjs\.org\/@opencoredev\/email-sdk\/-\/email-sdk-[^"]+\.tgz"/,
  `url "${tarballUrl}"`,
);
formula = formula.replace(/sha256 "[^"]+"/, `sha256 "${sha256}"`);

await writeFile(formulaPath, formula);

async function resolvePublishedSha(url: string) {
  const maxAttempts = 12;
  const retryDelayMs = 5_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, { cache: "no-store" });

    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      return createHash("sha256").update(bytes).digest("hex");
    }

    if (attempt === maxAttempts) {
      throw new Error(`Unable to fetch published npm tarball ${url}: ${response.status}`);
    }

    await delay(retryDelayMs);
  }

  throw new Error(`Unable to fetch published npm tarball ${url}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
