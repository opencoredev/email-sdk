import emailSdkPackage from "../../../../packages/email-sdk/package.json";

const fallbackBuildId = emailSdkPackage.version;
const buildEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

export const currentBuildInfo = {
  buildId: buildEnv?.VITE_EMAIL_SDK_BUILD_ID || fallbackBuildId,
  packageVersion: emailSdkPackage.version,
} as const;

export type BuildInfo = typeof currentBuildInfo;

export function isOutdatedBuild(currentBuildId: string, deployedBuildId: string | null | undefined) {
  return Boolean(deployedBuildId && deployedBuildId !== currentBuildId);
}
