/**
 * Single source of truth for the component's adapter configuration surface.
 *
 * Every adapter is described as data: which Email SDK option keys it takes, which Convex
 * environment variable supplies each one by default, and which ones may also be passed inline.
 * The wire validators (`shared/validators.ts`), the public config types (`shared/types.ts`),
 * the component's declared environment (`component/convex.config.ts`), and the runtime option
 * resolver (`component/providers.ts`) are all derived from this table, so adding an adapter is
 * one entry here plus one line in the factory map.
 *
 * This module is imported by the Convex isolate, so it must stay free of Node and Email SDK
 * runtime imports.
 */

export type ConvexAdapterFieldType = "string" | "number" | "boolean" | "record";

export type ConvexAdapterField = {
  /** Value type of the underlying Email SDK adapter option. */
  readonly type: ConvexAdapterFieldType;
  /**
   * Default Convex environment variable name. Fields with an `env` accept a `<field>Env`
   * config key that overrides which variable is read.
   */
  readonly env?: string;
  /**
   * Whether the literal value may be written into adapter config. Credentials are never
   * inline: they are read from the component's environment so config stays storable.
   */
  readonly inline?: boolean;
  /** Whether resolution fails when neither the inline value nor the environment provides one. */
  readonly required?: boolean;
};

export type ConvexAdapterFields = Readonly<Record<string, ConvexAdapterField>>;

/** Non-secret endpoint override, always inline-only. */
const BASE_URL = { type: "string", inline: true } as const;

export const CONVEX_EMAIL_ADAPTERS = {
  memory: {},
  brevo: {
    apiKey: { type: "string", env: "BREVO_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  cloudflare: {
    apiToken: { type: "string", env: "CLOUDFLARE_API_TOKEN", required: true },
    accountId: { type: "string", env: "CLOUDFLARE_ACCOUNT_ID", inline: true, required: true },
    baseUrl: BASE_URL,
  },
  iterable: {
    apiKey: { type: "string", env: "ITERABLE_API_KEY", required: true },
    campaignId: { type: "number", env: "ITERABLE_CAMPAIGN_ID", inline: true, required: true },
    allowRepeatMarketingSends: { type: "boolean", inline: true },
    dataFields: { type: "record", inline: true },
    sendAt: { type: "string", inline: true },
    baseUrl: BASE_URL,
  },
  jetemail: {
    apiKey: { type: "string", env: "JETEMAIL_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  lettermint: {
    apiToken: { type: "string", env: "LETTERMINT_API_TOKEN", required: true },
    route: { type: "string", env: "LETTERMINT_ROUTE", inline: true },
    baseUrl: BASE_URL,
  },
  lettr: {
    apiKey: { type: "string", env: "LETTR_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  loops: {
    apiKey: { type: "string", env: "LOOPS_API_KEY", required: true },
    transactionalId: {
      type: "string",
      env: "LOOPS_TRANSACTIONAL_ID",
      inline: true,
      required: true,
    },
    baseUrl: BASE_URL,
  },
  mailchimp: {
    apiKey: { type: "string", env: "MAILCHIMP_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  mailersend: {
    apiKey: { type: "string", env: "MAILERSEND_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  mailgun: {
    apiKey: { type: "string", env: "MAILGUN_API_KEY", required: true },
    domain: { type: "string", env: "MAILGUN_DOMAIN", inline: true, required: true },
    baseUrl: BASE_URL,
  },
  mailpace: {
    apiKey: { type: "string", env: "MAILPACE_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  mailtrap: {
    apiKey: { type: "string", env: "MAILTRAP_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  plunk: {
    apiKey: { type: "string", env: "PLUNK_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  postmark: {
    serverToken: { type: "string", env: "POSTMARK_SERVER_TOKEN", required: true },
    messageStream: { type: "string", inline: true },
    baseUrl: BASE_URL,
  },
  primitive: {
    apiKey: { type: "string", env: "PRIMITIVE_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  resend: {
    apiKey: { type: "string", env: "RESEND_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  scaleway: {
    secretKey: { type: "string", env: "SCALEWAY_SECRET_KEY", required: true },
    projectId: { type: "string", env: "SCALEWAY_PROJECT_ID", inline: true, required: true },
    region: { type: "string", env: "SCALEWAY_REGION", inline: true },
    baseUrl: BASE_URL,
  },
  sendgrid: {
    apiKey: { type: "string", env: "SENDGRID_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  sequenzy: {
    apiKey: { type: "string", env: "SEQUENZY_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  ses: {
    accessKeyId: { type: "string", env: "AWS_ACCESS_KEY_ID", required: true },
    secretAccessKey: { type: "string", env: "AWS_SECRET_ACCESS_KEY", required: true },
    sessionToken: { type: "string", env: "AWS_SESSION_TOKEN" },
    region: { type: "string", env: "AWS_REGION", inline: true, required: true },
    baseUrl: BASE_URL,
  },
  smtp: {
    host: { type: "string", env: "SMTP_HOST", inline: true, required: true },
    port: { type: "number", env: "SMTP_PORT", inline: true },
    secure: { type: "boolean", env: "SMTP_SECURE", inline: true },
    user: { type: "string", env: "SMTP_USER" },
    pass: { type: "string", env: "SMTP_PASS" },
  },
  sparkpost: {
    apiKey: { type: "string", env: "SPARKPOST_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  unosend: {
    apiKey: { type: "string", env: "UNOSEND_API_KEY", required: true },
    baseUrl: BASE_URL,
  },
  zeptomail: {
    token: { type: "string", env: "ZEPTOMAIL_TOKEN", required: true },
    baseUrl: BASE_URL,
  },
} as const satisfies Record<string, ConvexAdapterFields>;

export type ConvexEmailAdapterRegistry = typeof CONVEX_EMAIL_ADAPTERS;

export type ConvexEmailAdapterKind = keyof ConvexEmailAdapterRegistry;

export const CONVEX_EMAIL_ADAPTER_KINDS = Object.keys(
  CONVEX_EMAIL_ADAPTERS,
) as ConvexEmailAdapterKind[];

type ConvexAdapterEnvName<TFields> = {
  [K in keyof TFields]: TFields[K] extends { env: infer TEnv extends string } ? TEnv : never;
}[keyof TFields];

/**
 * Literal union of every environment variable the registry can read. The component's declared
 * environment and the generated `Env` type are both checked against it at compile time, so a new
 * adapter cannot ship with an undeclared credential.
 */
export type ConvexEmailEnvVar = {
  [TKind in ConvexEmailAdapterKind]: ConvexAdapterEnvName<ConvexEmailAdapterRegistry[TKind]>;
}[ConvexEmailAdapterKind];

/** The same set at runtime, sorted so docs and the declared environment stay stable. */
export const CONVEX_EMAIL_ENV_VARS = [
  ...new Set(
    Object.values(CONVEX_EMAIL_ADAPTERS as Record<string, ConvexAdapterFields>).flatMap((fields) =>
      Object.values(fields).flatMap((field) => (field.env ? [field.env] : [])),
    ),
  ),
].sort() as ConvexEmailEnvVar[];

export function adapterFields(kind: string): ConvexAdapterFields | undefined {
  return (CONVEX_EMAIL_ADAPTERS as Record<string, ConvexAdapterFields>)[kind];
}

const declaredEnvVars = new Set<string>(CONVEX_EMAIL_ENV_VARS);

/**
 * A Convex component only receives the environment variables its contract declares, so a
 * `<field>Env` override can only name one of them. Pointing at any other name would silently
 * resolve to nothing once deployed.
 */
export function isDeclaredEnvVar(name: string) {
  return declaredEnvVars.has(name);
}
