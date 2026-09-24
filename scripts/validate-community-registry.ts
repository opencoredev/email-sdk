import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";
import {
  communityEntrySchema,
  type CommunityEntry,
} from "../apps/fumadocs/src/lib/community-registry";

const repositorySchema = z.union([
  z.string(),
  z.object({ url: z.string().optional() }).transform((repository) => repository.url),
]);

const packageJsonSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  repository: repositorySchema.optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
});

// Only the audited version is parsed strictly, so malformed metadata on unrelated
// historical versions cannot block the audit.
const registryResponseSchema = z.object({
  "dist-tags": z.object({ latest: z.string().optional() }).optional(),
  versions: z.record(z.string(), z.unknown()).optional(),
});

const versionMetadataSchema = z.object({
  repository: repositorySchema.optional(),
  dist: z
    .object({
      tarball: z.string().optional(),
      fileCount: z.number().optional(),
      unpackedSize: z.number().optional(),
    })
    .optional(),
});

const entryLabelSchema = z.object({ package: z.string() });

const root = fileURLToPath(new URL("..", import.meta.url));

const registryPath = join(root, "apps/fumadocs/content/community/plugins.json");

const registryUrl = "https://registry.npmjs.org";

const auditNetwork = process.argv.includes("--network") || process.env.CI === "true";

const errors: string[] = [];

const entries = z.array(z.unknown()).safeParse(JSON.parse(await readFile(registryPath, "utf8")));

if (entries.success) {
  await validateEntries(entries.data);
} else {
  fail("Registry must be a JSON array.");
}

if (errors.length > 0) {
  console.error(errors.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`Community registry check passed for ${entries.data?.length ?? 0} entries.`);

async function validateEntries(entriesToValidate: readonly unknown[]) {
  const names = new Set<string>();
  const packages = new Set<string>();
  const pluginIds = new Set<string>();
  const typedEntries: CommunityEntry[] = [];

  for (const [index, rawEntry] of entriesToValidate.entries()) {
    const parsedLabel = entryLabelSchema.safeParse(rawEntry);
    const label = parsedLabel.success ? parsedLabel.data.package : `entry ${index + 1}`;
    const parsed = communityEntrySchema.safeParse(rawEntry);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.map(String).join(".");

        fail(path ? `${label}: ${path} ${issue.message}` : `${label}: ${issue.message}`);
      }

      continue;
    }

    const entry = parsed.data;

    rejectDuplicate(names, entry.name, `${label}: duplicate name`);
    rejectDuplicate(packages, entry.package, `${label}: duplicate package`);

    if (entry.pluginId) rejectDuplicate(pluginIds, entry.pluginId, `${label}: duplicate pluginId`);

    if (entry.kind !== "plugin" && !entry.adapter) {
      fail(`${label}: adapter is required for adapter and hybrid entries.`);
    }

    if (entry.status === "verified" || entry.status === "official") {
      validateVerification(entry);
    }

    typedEntries.push(entry);
  }

  if (auditNetwork) {
    await Promise.all(typedEntries.map((entry) => auditPackage(entry)));
  }
}

function validateVerification(entry: CommunityEntry) {
  const label = entry.package;
  const verification = entry.verification;

  if (!verification) {
    fail(`${label}: verification is required for ${entry.status} entries.`);

    return;
  }

  if (!entry.verifiedVersion) {
    fail(`${label}: verifiedVersion must be a non-empty string.`);
  }

  if (!verification.provenance) {
    fail(`${label}: verified entries must require npm provenance or trusted publishing.`);
  }

  if (!verification.noInstallScripts) {
    fail(`${label}: verified entries must have no install scripts.`);
  }
}

async function auditPackage(entry: CommunityEntry) {
  if (entry.status === "community") return;

  const label = entry.package;

  const metadata = await fetchJson(
    `${registryUrl}/${encodeURIComponent(entry.package)}`,
    registryResponseSchema,
  ).catch((error) => {
    fail(`${label}: ${error instanceof Error ? error.message : String(error)}`);

    return undefined;
  });

  if (!metadata) return;
  const version = entry.verifiedVersion ?? metadata["dist-tags"]?.latest;

  if (!version) {
    fail(`${label}: npm package has no latest version and no verifiedVersion.`);

    return;
  }

  const rawVersionMetadata = metadata.versions?.[version];

  if (rawVersionMetadata === undefined) {
    fail(`${label}: npm package version ${version} was not found.`);

    return;
  }

  const parsedVersionMetadata = versionMetadataSchema.safeParse(rawVersionMetadata);

  if (!parsedVersionMetadata.success) {
    fail(
      `${label}: npm metadata for version ${version} is invalid: ${parsedVersionMetadata.error.message}`,
    );

    return;
  }

  const versionMetadata = parsedVersionMetadata.data;
  const tarball = versionMetadata.dist?.tarball;

  if (!tarball) {
    fail(`${label}: npm package version ${version} has no tarball.`);

    return;
  }

  const repository = normalizeRepository(versionMetadata.repository);

  if (repository && normalizeRepository(entry.repo) !== repository) {
    fail(`${label}: package repository does not match registry entry.`);
  }

  const files = await readTarball(tarball).catch((error) => {
    fail(`${label}: ${error instanceof Error ? error.message : String(error)}`);

    return undefined;
  });

  if (!files) return;
  const packageJsonFile = files.get("package/package.json");

  if (!packageJsonFile) {
    fail(`${label}: npm tarball does not contain package/package.json.`);

    return;
  }

  const parsedPackageJson = parsePackageJson(packageJsonFile);

  if (!parsedPackageJson.success) {
    fail(`${label}: package/package.json is invalid: ${parsedPackageJson.error}`);

    return;
  }

  const packageJson = parsedPackageJson.data;

  const installScripts = ["preinstall", "install", "postinstall"].filter(
    (script) => packageJson.scripts?.[script],
  );

  if (installScripts.length > 0) {
    fail(`${label}: verified packages cannot define ${installScripts.join(", ")} scripts.`);
  }

  const runtimeDependencies = Object.keys(packageJson.dependencies ?? {}).length;

  if (entry.verification && runtimeDependencies !== entry.verification.runtimeDependencies) {
    fail(`${label}: runtime dependency count changed from verification metadata.`);
  }

  if (!packageJson.peerDependencies?.["@opencoredev/email-sdk"]) {
    fail(`${label}: package must declare @opencoredev/email-sdk as a peer dependency.`);
  }

  if (packageJson.bin) {
    fail(`${label}: verified plugins cannot expose binaries.`);
  }

  scanTarballFiles(label, files);
}

function parsePackageJson(source: string) {
  let json: unknown;

  try {
    json = JSON.parse(source);
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const parsed = packageJsonSchema.safeParse(json);

  return parsed.success
    ? { success: true as const, data: parsed.data }
    : { success: false as const, error: parsed.error.message };
}

function scanTarballFiles(label: string, files: Map<string, string>) {
  const suspicious = [
    "child_process",
    "eval(",
    "Function(",
    "process.env.NPM_TOKEN",
    "process.env.GITHUB_TOKEN",
    "curl ",
    "wget ",
  ];

  for (const [file, content] of files) {
    if (!/\.(cjs|js|mjs|ts)$/.test(file)) continue;

    for (const needle of suspicious) {
      if (content.includes(needle)) {
        fail(`${label}: ${file} contains suspicious token ${needle}.`);
      }
    }
  }
}

async function readTarball(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const tar = gunzipSync(bytes);
  const files = new Map<string, string>();
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);

    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(readTarString(header, 124, 12).trim() || "0", 8);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;

    if (size > 0 && /\.(json|cjs|js|mjs|ts)$/.test(fullName)) {
      files.set(fullName, tar.subarray(bodyStart, bodyEnd).toString("utf8"));
    }

    offset = bodyStart + Math.ceil(size / 512) * 512;
  }

  return files;
}

function readTarString(buffer: Buffer, start: number, length: number) {
  return buffer
    .subarray(start, start + length)
    .toString("utf8")
    .split("\u0000", 1)[0];
}

async function fetchJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return schema.parse(await response.json());
}

function normalizeRepository(raw: string | undefined) {
  if (!raw) return undefined;

  return raw
    .replace(/^git\+/, "")
    .replace(/^git:/, "https:")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

function rejectDuplicate(seen: Set<string>, value: string | undefined, message: string) {
  if (!value) return;

  if (seen.has(value)) fail(message);
  seen.add(value);
}

function fail(message: string) {
  errors.push(message);
}
