export const warned = new Set<string>();

export function warnOnce(feature: string, message: string) {
  if (
    warned.has(feature) ||
    process.env.NODE_ENV === "production" ||
    process.env.NODE_ENV === "test"
  ) {
    return;
  }

  warned.add(feature);
  console.warn(`[email-sdk/compat] ${message}`);
}
