import { z } from "zod";

// Schema for content/community/plugins.json. The site renders parsed entries and
// scripts/validate-community-registry.ts reports every issue with these messages.
const nonEmptyString = z
  .string({ error: "must be a non-empty string." })
  .refine((value) => value.trim() !== "", "must be a non-empty string.");

const packageName = nonEmptyString.refine(
  (value) => /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value),
  "must be a valid lowercase npm package name.",
);

const httpsUrl = nonEmptyString.superRefine((value, context) => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    context.addIssue({ code: "custom", message: "must be a valid URL." });

    return;
  }

  if (url.protocol !== "https:") {
    context.addIssue({ code: "custom", message: "must use https." });
  }
});

const isoDate = nonEmptyString.refine(
  (value) => !Number.isNaN(Date.parse(value)),
  "must be an ISO date string.",
);

const communityKinds = ["adapter", "plugin", "hybrid"] as const;

const communityStatuses = ["community", "verified", "official"] as const;

const verificationSchema = z.object({
  reviewedAt: isoDate,
  reviewedBy: nonEmptyString,
  provenance: z.boolean({ error: "must be a boolean." }),
  noInstallScripts: z.boolean({ error: "must be a boolean." }),
  runtimeDependencies: z
    .number({ error: "must be a non-negative integer." })
    .int("must be a non-negative integer.")
    .min(0, "must be a non-negative integer."),
  notes: z.string().optional(),
});

export const communityEntrySchema = z.object(
  {
    name: nonEmptyString,
    package: packageName,
    kind: z.enum(communityKinds, { error: `must be one of: ${communityKinds.join(", ")}.` }),
    status: z.enum(communityStatuses, {
      error: `must be one of: ${communityStatuses.join(", ")}.`,
    }),
    description: nonEmptyString,
    href: httpsUrl,
    repo: httpsUrl,
    maintainer: nonEmptyString,
    pluginId: z.string().optional(),
    adapter: z.string().optional(),
    importName: z.string().optional(),
    verifiedVersion: nonEmptyString.optional(),
    verification: verificationSchema.optional(),
  },
  { error: "registry entries must be objects." },
);

export type CommunityEntry = z.infer<typeof communityEntrySchema>;
