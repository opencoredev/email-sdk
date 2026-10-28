import { createEmailClient } from "@opencoredev/email-sdk";
import { mailgun } from "@opencoredev/email-sdk/mailgun";
import { resend } from "@opencoredev/email-sdk/resend";

const adapterNames = ["resend", "mailgun"] as const;

type AdapterName = (typeof adapterNames)[number];

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Missing environment variable ${name}.`);

  return value;
}

function parsePrimary(value = "mailgun"): AdapterName {
  const name = adapterNames.find((candidate) => candidate === value);

  if (!name) throw new Error(`EMAIL_PRIMARY must be one of: ${adapterNames.join(", ")}.`);

  return name;
}

export const email = createEmailClient({
  adapters: [
    resend({ apiKey: requireEnv("RESEND_API_KEY") }),
    mailgun({
      apiKey: requireEnv("MAILGUN_API_KEY"),
      domain: requireEnv("MAILGUN_DOMAIN"),
      baseUrl: process.env.MAILGUN_BASE_URL,
    }),
  ],
  defaultAdapter: parsePrimary(process.env.EMAIL_PRIMARY),
  fallback: {
    adapters: adapterNames,
    onUnknownDelivery: "continue",
  },
});
