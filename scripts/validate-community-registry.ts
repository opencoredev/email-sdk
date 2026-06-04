import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

type CommunityEntry = {
  name: string;
  package: string;
  kind: "adapter" | "plugin" | "hybrid";
  status: "community" | "verified" | "official";
  description: string;
  href: string;
  repo: string;
  maintainer: string;
  pluginId?: string;
  adapter?: string;
  importName?: string;
  verifiedVersion?: string;
  verification?: {
    reviewedAt: string;
    reviewedBy: string;
    provenance: boolean;
    noInstallScripts: boolean;
    runtimeDependencies: number;
    notes?: string;
  };
};

type PackageJson = {
  name?: string;
  version?: string;
  repository?: string | { url?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports?: unknown;
  bin?: unknown;
};

type RegistryVersion = {
  repository?: PackageJson["repository"];
  dist?: {
    tarball?: string;
    fileCount?: number;
    unpackedSize?: number;
  };
};

type RegistryResponse = {
  "dist-tags"?: {
    latest?: string;
  };
  versions?: Record<string, RegistryVersion>;
};

const root = fileURLToPath(new URL("..", import.meta.url));
const registryPath = join(root, "apps/fumadocs/content/community/plugins.json");
const registryUrl = "https://registry.npmjs.org";
const auditNetwork = process.argv.includes("--network") || process.env.CI === "true";
const errors: string[] = [];

const entries = JSON.parse(await readFile(registryPath, "utf8")) as unknown;

if (!Array.isArray(entries)) {
  fail("Registry must be a JSON array.");
} else {
  await validateEntries(entries);
}

if (errors.length > 0) {
  console.error(errors.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(
  `Community registry check passed for ${Array.isArray(entries) ? entries.length : 0} entries.`,
);

async function validateEntries(entriesToValidate: unknown[]) {
  const names = new Set<string>();
  const packages = new Set<string>();
  const pluginIds = new Set<string>();
  const typedEntries: CommunityEntry[] = [];

  for (const [index, rawEntry] of entriesToValidate.entries()) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      fail(`entry ${index + 1}: registry entries must be objects.`);
      continue;
    }

    const entry = rawEntry as CommunityEntry;
    const label = typeof entry.package === "string" ? entry.package : `entry ${index + 1}`;

    requireString(entry.name, `${label}: name`);
    requirePackageName(entry.package, `${label}: package`);
    requireEnum(entry.kind, ["adapter", "plugin", "hybrid"], `${label}: kind`);
    requireEnum(entry.status, ["community", "verified", "official"], `${label}: status`);
    requireString(entry.description, `${label}: description`);
    requireHttps(entry.href, `${label}: href`);
    requireHttps(entry.repo, `${label}: repo`);
    requireString(entry.maintainer, `${label}: maintainer`);

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

  requireString(entry.verifiedVersion, `${label}: verifiedVersion`);
  requireIsoDate(verification.reviewedAt, `${label}: verification.reviewedAt`);
  requireString(verification.reviewedBy, `${label}: verification.reviewedBy`);
  requireBoolean(verification.provenance, `${label}: verification.provenance`);
  requireBoolean(verification.noInstallScripts, `${label}: verification.noInstallScripts`);

  if (verification.provenance !== true) {
    fail(`${label}: verified entries must require npm provenance or trusted publishing.`);
  }

  if (verification.noInstallScripts !== true) {
    fail(`${label}: verified entries must have no install scripts.`);
  }

  if (!Number.isInteger(verification.runtimeDependencies) || verification.runtimeDependencies < 0) {
    fail(`${label}: verification.runtimeDependencies must be a non-negative integer.`);
  }
}

async function auditPackage(entry: CommunityEntry) {
  if (entry.status === "community") return;

  const label = entry.package;
  const metadata = await fetchJson<RegistryResponse>(
    `${registryUrl}/${encodeURIComponent(entry.package)}`,
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

  const versionMetadata = metadata.versions?.[version];
  const tarball = versionMetadata?.dist?.tarball;

  if (!versionMetadata || !tarball) {
    fail(`${label}: npm package version ${version} was not found.`);
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

  const packageJson = JSON.parse(packageJsonFile) as PackageJson;
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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

function normalizeRepository(value: PackageJson["repository"]) {
  const raw = typeof value === "string" ? value : value?.url;
  if (!raw) return undefined;

  return raw
    .replace(/^git\+/, "")
    .replace(/^git:/, "https:")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string.`);
  }
}

function requirePackageName(value: unknown, label: string) {
  requireString(value, label);
  if (
    typeof value === "string" &&
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)
  ) {
    fail(`${label} must be a valid lowercase npm package name.`);
  }
}

function requireHttps(value: unknown, label: string) {
  requireString(value, label);
  if (typeof value !== "string") return;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") fail(`${label} must use https.`);
  } catch {
    fail(`${label} must be a valid URL.`);
  }
}

function requireEnum(value: unknown, allowed: readonly string[], label: string) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(`${label} must be one of: ${allowed.join(", ")}.`);
  }
}

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    fail(`${label} must be a boolean.`);
  }
}

function requireIsoDate(value: unknown, label: string) {
  requireString(value, label);
  if (typeof value === "string" && Number.isNaN(Date.parse(value))) {
    fail(`${label} must be an ISO date string.`);
  }
}

function rejectDuplicate(seen: Set<string>, value: string | undefined, message: string) {
  if (!value) return;
  if (seen.has(value)) fail(message);
  seen.add(value);
}

function fail(message: string): never {
  errors.push(message);
  return undefined as never;
}
