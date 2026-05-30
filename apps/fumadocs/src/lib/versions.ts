import emailSdkPackage from "../../../../packages/email-sdk/package.json";

export const sdkPackageName = emailSdkPackage.name;
export const sdkVersion = emailSdkPackage.version;
export const docsVersion = `v${sdkVersion}`;

export const docsVersions = [
  {
    label: docsVersion,
    description: "Current SDK, CLI, and docs",
    href: "/docs",
    current: true,
  },
] as const;

export const versionLinks = [
  {
    label: "npm package",
    href: `https://www.npmjs.com/package/${sdkPackageName}/v/${sdkVersion}`,
  },
  {
    label: "Changelog",
    href: "https://github.com/opencoredev/email-sdk/blob/main/packages/email-sdk/CHANGELOG.md",
  },
] as const;
