import emailSdkPackage from "../../../../packages/email-sdk/package.json";

const fallbackBuildId = emailSdkPackage.version;

export const currentBuildInfo = {
  buildId: import.meta.env?.VITE_EMAIL_SDK_BUILD_ID || fallbackBuildId,
  packageVersion: emailSdkPackage.version,
} as const;

export type BuildInfo = typeof currentBuildInfo;

export function isOutdatedBuild(currentBuildId: string, deployedBuildId: string | null | undefined) {
  return Boolean(deployedBuildId && deployedBuildId !== currentBuildId);
}
